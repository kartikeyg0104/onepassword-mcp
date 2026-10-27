#!/usr/bin/env node
/**
 * 1Password MCP Server
 * --------------------
 * Exposes a 1Password vault to Claude (or any MCP client) through the
 * official 1Password CLI (`op`).
 *
 * Security model:
 *   - READ-ONLY by default. Write tools only register when OP_MCP_ALLOW_WRITE=1.
 *   - Sensitive fields (passwords, API keys, OTP, etc.) are MASKED in results;
 *     the actual value is returned only by an explicit reveal_secret call.
 *   - Optional single-vault lockdown via OP_VAULT (least privilege).
 *   - Authentication is delegated to the op CLI: either a Service Account
 *     token (OP_SERVICE_ACCOUNT_TOKEN, headless) or desktop-app biometrics.
 *     The 1Password master password / secret key is NEVER needed here.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/* ------------------------------ configuration ----------------------------- */

const OP_BIN = process.env.OP_BIN_PATH || "op";
const RESTRICTED_VAULT = process.env.OP_VAULT || "";
const ALLOW_WRITE = process.env.OP_MCP_ALLOW_WRITE === "1";
const OP_TIMEOUT_MS = Number(process.env.OP_TIMEOUT_MS || 60000);
const DEFAULT_LIST_LIMIT = 50;

function log(msg: string): void {
  process.stderr.write(`[onepassword-mcp] ${msg}\n`);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "..." : s;
}

/* ------------------------------ op CLI runner ----------------------------- */

async function runOp(args: string[], timeoutMs?: number): Promise<string> {
  try {
    const { stdout } = await execFileP(OP_BIN, args, {
      env: process.env, // passes OP_SERVICE_ACCOUNT_TOKEN through; never logged
      timeout: timeoutMs ?? OP_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (err: unknown) {
    const e = err as { code?: string; stderr?: string; stdout?: string; message?: string };
    if (e.code === "ENOENT") {
      throw new Error(
        "op CLI not found. Install the 1Password CLI " +
          "(macOS: brew install 1password-cli | Windows: winget install AgileBits.1Password.CLI | " +
          "Linux: see developer.1password.com/docs/cli/get-started) " +
          "or set OP_BIN_PATH to the full path of the op binary."
      );
    }
    const detail = String(e.stderr || e.stdout || e.message || "unknown error").trim();
    throw new Error(`op ${args[0]} failed: ${truncate(detail, 600)}`);
  }
}

/* -------------------------------- helpers --------------------------------- */

type Json = any;

function parseJsonArray(raw: string): Json[] {
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

/** Enforce the optional OP_VAULT single-vault lockdown. */
function checkVault(v?: string): string | undefined {
  if (RESTRICTED_VAULT) {
    if (!v) return RESTRICTED_VAULT;
    if (v !== RESTRICTED_VAULT) {
      throw new Error(
        `Access restricted by configuration: only the vault "${RESTRICTED_VAULT}" is allowed (OP_VAULT).`
      );
    }
    return v;
  }
  return v;
}

const SENSITIVE_LABEL_RE =
  /password|passphrase|credential|secret|token|api[._\ -]?key|private[._\ -]?key|otp|totp|one[._\ -]?time|recovery/i;

function isSensitiveField(f: Json): boolean {
  const type = String(f?.type ?? "").toUpperCase();
  if (type === "PASSWORD" || type === "CONCEALED" || type === "OTP" || type === "SSHKEY") return true;
  const id = String(f?.id ?? "").toLowerCase();
  if (id === "password" || id === "credential" || id === "otp" || id === "totp") return true;
  const label = String(f?.label ?? "");
  return SENSITIVE_LABEL_RE.test(label);
}

/** op:// references must not contain "/" in their parts. */
function refEscape(part: string): string {
  return part.replace(/\//g, "-");
}

function buildRef(vaultKey: string, itemKey: string, f: Json): string {
  const fieldKey = refEscape(String(f?.label || f?.id || "field"));
  const sectionPart = f?.section?.id ? `${refEscape(String(f.section.id))}/` : "";
  return `op://${refEscape(vaultKey)}/${refEscape(itemKey)}/${sectionPart}${fieldKey}`;
}

function formatItem(item: Json, fallbackVaultKey: string): string {
  const vaultKey = String(item?.vault?.name || fallbackVaultKey || item?.vault?.id || "");
  const lines: string[] = [];
  lines.push(`title:    ${item?.title ?? ""}`);
  lines.push(`id:       ${item?.id ?? ""}`);
  lines.push(`category: ${item?.category ?? ""}`);
  lines.push(`vault:    ${vaultKey}`);
  if (Array.isArray(item?.urls) && item.urls.length) {
    lines.push(`urls:     ${item.urls.map((u: Json) => u?.href).filter(Boolean).join(", ")}`);
  }
  if (Array.isArray(item?.tags) && item.tags.length) lines.push(`tags:     ${item.tags.join(", ")}`);
  if (item?.favorite) lines.push(`favorite: true`);
  if (item?.updated_at) lines.push(`updated:  ${item.updated_at}`);

  if (Array.isArray(item?.fields) && item.fields.length) {
    lines.push(`fields:`);
    for (const f of item.fields) {
      const label = String(f?.label || f?.id || "?");
      if (isSensitiveField(f)) {
        lines.push(
          `  ${label} = [MASKED - to reveal, call reveal_secret with reference: ${buildRef(
            vaultKey,
            String(item?.id ?? ""),
            f
          )}]`
        );
      } else if (f?.value !== undefined && f?.value !== null && String(f.value) !== "") {
        lines.push(`  ${label} = ${String(f.value)}`);
      }
    }
  }
  return lines.join("\n");
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { isError: true as const, content: [{ type: "text" as const, text: `Error: ${msg}` }] };
}

/* --------------------------------- server --------------------------------- */

const server = new McpServer({ name: "onepassword-mcp", version: "1.0.0" });

/* --- list_vaults --- */
server.registerTool(
  "list_vaults",
  {
    title: "List 1Password vaults",
    description:
      "List the 1Password vaults this server can access. Honors the OP_VAULT single-vault lockdown if set.",
    inputSchema: {},
  },
  async () => {
    try {
      const rows = parseJsonArray(await runOp(["vault", "list", "--format", "json"]));
      const filtered = RESTRICTED_VAULT
        ? rows.filter(
            (r: Json) => String(r?.name) === RESTRICTED_VAULT || String(r?.id) === RESTRICTED_VAULT
          )
        : rows;
      if (!filtered.length) return ok("No accessible vaults found. Check your service account or CLI auth.");
      return ok(filtered.map((v: Json) => `- ${v?.name}  (id: ${v?.id})`).join("\n"));
    } catch (e) {
      return fail(e);
    }
  }
);

/* --- list_items --- */
server.registerTool(
  "list_items",
  {
    title: "List vault items",
    description:
      "List items in a vault: titles, ids and categories only - secrets are never included in listings.",
    inputSchema: {
      vault: z.string().optional().describe("Vault name or id. Defaults to OP_VAULT when set."),
      category: z
        .string()
        .optional()
        .describe("Filter by category, e.g. Login, Secure Note, Password, API Credential, Credit Card, Document"),
      limit: z.number().int().min(1).max(200).optional().describe("Max items to return (default 50)"),
    },
  },
  async ({ vault, category, limit }) => {
    try {
      const v = checkVault(vault);
      const args = ["item", "list", "--format", "json"];
      if (v) args.push("--vault", v);
      if (category) args.push("--categories", category);
      const rows = parseJsonArray(await runOp(args));
      if (!rows.length) return ok("No items found.");
      const max = limit ?? DEFAULT_LIST_LIMIT;
      const text =
        rows
          .slice(0, max)
          .map((r: Json) => `- ${r?.title}  (id: ${r?.id}, category: ${r?.category})`)
          .join("\n") + (rows.length > max ? `\n...and ${rows.length - max} more (raise 'limit')` : "");
      return ok(text);
    } catch (e) {
      return fail(e);
    }
  }
);

/* --- search_items --- */
server.registerTool(
  "search_items",
  {
    title: "Search vault items",
    description: "Search item titles in a vault. Returns matching titles and ids only (no secrets).",
    inputSchema: {
      query: z.string().min(1).describe("Text to match against item titles (case-insensitive substring)"),
      vault: z.string().optional().describe("Vault name or id. Defaults to OP_VAULT when set."),
    },
  },
  async ({ query, vault }) => {
    try {
      const v = checkVault(vault);
      const args = ["item", "list", "--format", "json"];
      if (v) args.push("--vault", v);
      const rows = parseJsonArray(await runOp(args));
      const q = query.toLowerCase();
      const hits = rows.filter((r: Json) => String(r?.title ?? "").toLowerCase().includes(q));
      if (!hits.length) return ok(`No items matching "${query}".`);
      return ok(
        hits
          .slice(0, DEFAULT_LIST_LIMIT)
          .map((r: Json) => `- ${r?.title}  (id: ${r?.id}, category: ${r?.category})`)
          .join("\n")
      );
    } catch (e) {
      return fail(e);
    }
  }
);

/* --- get_item --- */
server.registerTool(
  "get_item",
  {
    title: "Get item details",
    description:
      "Get one item's metadata and non-sensitive fields. Sensitive fields (passwords, keys, OTP) are MASKED with an op:// reference - use reveal_secret to actually read one.",
    inputSchema: {
      item: z.string().min(1).describe("Item title or id"),
      vault: z.string().optional().describe("Vault name or id. Defaults to OP_VAULT when set."),
    },
  },
  async ({ item, vault }) => {
    try {
      const v = checkVault(vault);
      const args = ["item", "get", item, "--format", "json"];
      if (v) args.push("--vault", v);
      const itemJson = JSON.parse(await runOp(args));
      return ok(formatItem(itemJson, v || ""));
    } catch (e) {
      return fail(e);
    }
  }
);

/* --- reveal_secret --- */
server.registerTool(
  "reveal_secret",
  {
    title: "Reveal one secret",
    description:
      "Read exactly ONE secret value by its op:// reference (e.g. op://Vault/Item/password), as returned by get_item's masked hints. Use sparingly - only when the value is genuinely needed.",
    inputSchema: {
      reference: z.string().describe("A secret reference in the op://Vault/Item/Field format"),
    },
  },
  async ({ reference }) => {
    try {
      if (!/^op:\/\//i.test(String(reference))) {
        return fail(new Error("Reference must be in the op://Vault/Item/Field format."));
      }
      const value = await runOp(["read", String(reference)]);
      return ok(value.replace(/\r?\n$/, ""));
    } catch (e) {
      return fail(e);
    }
  }
);

/* --- write tools (only when OP_MCP_ALLOW_WRITE=1) --- */
if (ALLOW_WRITE) {
  server.registerTool(
    "create_login",
    {
      title: "Create a Login item",
      description: "Create a new Login item with username/password (and optional URL and notes). Requires OP_MCP_ALLOW_WRITE=1.",
      inputSchema: {
        vault: z.string().optional().describe("Vault name or id. Defaults to OP_VAULT when set."),
        title: z.string().min(1),
        username: z.string().optional(),
        password: z.string().min(1),
        url: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async ({ vault, title, username, password, url, notes }) => {
      try {
        const v = checkVault(vault);
        const args = ["item", "create", "--category", "Login", "--title", title];
        if (v) args.push("--vault", v);
        args.push(`username=${username ?? ""}`);
        args.push(`password=${password}`);
        if (url) args.push(`url=${url}`);
        if (notes) args.push(`notesPlain=${notes}`);
        const created = JSON.parse(await runOp(args));
        return ok(`Created "${created?.title}" (id: ${created?.id}).`);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "create_note",
    {
      title: "Create a Secure Note",
      description: "Create a new Secure Note item. Requires OP_MCP_ALLOW_WRITE=1.",
      inputSchema: {
        vault: z.string().optional().describe("Vault name or id. Defaults to OP_VAULT when set."),
        title: z.string().min(1),
        notes: z.string().min(1),
      },
    },
    async ({ vault, title, notes }) => {
      try {
        const v = checkVault(vault);
        const args = ["item", "create", "--category", "Secure Note", "--title", title];
        if (v) args.push("--vault", v);
        args.push(`notesPlain=${notes}`);
        const created = JSON.parse(await runOp(args));
        return ok(`Created "${created?.title}" (id: ${created?.id}).`);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "delete_item",
    {
      title: "Delete an item",
      description:
        "Delete an item (it moves to Recently Deleted). Requires OP_MCP_ALLOW_WRITE=1 and confirm=true.",
      inputSchema: {
        item: z.string().min(1).describe("Item title or id"),
        vault: z.string().optional().describe("Vault name or id. Defaults to OP_VAULT when set."),
        confirm: z.literal(true).describe("Must be exactly true to confirm deletion"),
      },
    },
    async ({ item, vault, confirm }) => {
      try {
        if (confirm !== true) return fail(new Error("Deletion requires confirm=true."));
        const v = checkVault(vault);
        const args = ["item", "delete", item];
        if (v) args.push("--vault", v);
        await runOp(args);
        return ok(`Deleted "${item}" (moved to Recently Deleted).`);
      } catch (e) {
        return fail(e);
      }
    }
  );
}

/* ---------------------------------- main ----------------------------------- */

async function main(): Promise<void> {
  log(
    `starting | write=${ALLOW_WRITE ? "ENABLED" : "disabled"} | ` +
      (RESTRICTED_VAULT ? `vault="${RESTRICTED_VAULT}"` : "vaults=all accessible") +
      ` | op="${OP_BIN}"`
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("connected on stdio");
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
