# 1Password MCP Server — for Claude

### Let Claude safely use your 1Password treasure chest. A step-by-step guide so simple anyone can follow it.

---

## 1. What is this? (in plain words)

Imagine three friends:

| Friend | What it is | What it does |
|---|---|---|
| **1Password** | A locked treasure chest | Keeps all your passwords and secrets safe |
| **Claude** | A smart robot helper | Can read and write things for you |
| **This project** | A special door (called "MCP") | Lets the robot *politely ask* the treasure chest for things |

```
   [ Claude the robot ]  <-- special door -->  [ this little program ]  <-- official key -->  [ your 1Password chest ]
```

Without this door, you have to copy-paste passwords yourself. With this door,
you can just tell Claude: *"find my GitHub password item"* and Claude looks it
up for you — safely.

**The 3 Golden Rules (remember these!):**

1. **Never** tell anyone your master password or Secret Key. Not even an AI. Not even me.
2. The project uses a special "key card" (called a *service account token*). It lives **only on your computer**.
3. By default Claude can only **look** at your vault. It cannot change or delete anything unless *you* flip a switch first.

---

## 2. What you need before starting

- [ ] A computer (Mac, Windows, or Linux)
- [ ] 10–15 quiet minutes
- [ ] Your 1Password account (you already have one — you are reading this!)
- [ ] That's it. Everything else is free.

---

## 3. Step 1 — Install Node.js (the engine this program runs on)

1. Go to **https://nodejs.org**
2. Click the big green button that says **LTS** (that means "the safe version")
3. Open the file you downloaded and click **Next → Next → Install** (like any app)
4. Now check it worked:
   - **Mac**: press `Cmd + Space`, type `Terminal`, press Enter
   - **Windows**: press the Start button, type `powershell`, press Enter
   - Type this and press Enter:
     ```
     node --version
     ```
   - You should see something like `v20.11.0` or `v22.x.x`. **If the first number is 18 or bigger — perfect!**

---

## 4. Step 2 — Install the 1Password CLI (a tiny helper called `op`)

This is the only official "key" that can talk to your treasure chest.

**On Mac** (in Terminal):
```
brew install 1password-cli
```
> If it says "brew: command not found", first install Homebrew from **https://brew.sh** (one copy-paste command on that page), then try again.

**On Windows** (in PowerShell):
```
winget install AgileBits.1Password.CLI
```

Also make sure the normal **1Password app** is installed from https://1password.com/downloads

**Check it worked:** type `op --version` — you should see a version number like `2.x.x`.

---

## 5. Step 3 — Make the magic key card (service account token)

This key card lets the program read your vault **without ever knowing your
master password**. Like a hotel key card: it opens only the rooms you choose,
and you can cancel it any time.

1. In your browser, go to **https://1password.com** and sign in
2. On the left sidebar, click **Developer**
   > *Don't see it?* Ask your team admin — you may not have permission. That's okay, admins can make it.
3. Click **Service accounts** → **New service account** (or "+ Create")
4. Name it: `claude-mcp`
5. Under vault access: pick your vault (the one called something like **All Items**) and choose **Read**
   > Only pick **Read/Write** if you *want* Claude to be able to add new items later.
6. Click **Create service account**
7. A long token appears (starts with `sva_` or `ops_`). **Copy it now** — it is shown only ONCE!
8. Keep it in a private note for a moment — you will paste it into a config file in Step 6.

> **Warning:** Never paste this token in a chat, an email, or a website. Only into the config file on YOUR computer.

---

## 6. Step 4 — Download this project

**Easy way:** on this GitHub page, click the green **`<> Code`** button → **Download ZIP** → unzip it (double-click on Mac, right-click → Extract All on Windows).

**Nerd way** (in Terminal):
```
git clone https://github.com/YOUR-USERNAME/onepassword-mcp.git
```

---

## 7. Step 5 — Build it (just 2 commands)

In the Terminal, go inside the folder and run:

```
cd onepassword-mcp
npm install
npm run build
```

- `npm install` downloads the building blocks (takes about 1 minute)
- `npm run build` assembles the final program

**You know it worked when:** a new folder named `dist` appears inside the project, and there are no red error messages.

---

## 8. Step 6 — Plug it into Claude

### If you use the Claude Desktop app:

1. Find Claude's settings file:
   - **Mac**: in Finder press `Cmd + Shift + G`, paste this, press Enter:
     ```
     ~/Library/Application Support/Claude/
     ```
     Look for a file named `claude_desktop_config.json`. If it doesn't exist, create it with TextEdit (plain text mode!).
   - **Windows**: press `Win + R`, paste this, press Enter:
     ```
     %APPDATA%\Claude\
     ```
     Same file name: `claude_desktop_config.json`.
2. Paste this into the file, then change the **2 UPPERCASE parts**:

```json
{
  "mcpServers": {
    "onepassword": {
      "command": "node",
      "args": ["/PUT/THE/FULL/FOLDER/PATH/HERE/onepassword-mcp/dist/index.js"],
      "env": {
        "OP_SERVICE_ACCOUNT_TOKEN": "PASTE_YOUR_TOKEN_HERE",
        "OP_VAULT": "All Items",
        "OP_MCP_ALLOW_WRITE": "0"
      }
    }
  }
}
```

   - **How to get the folder path:**
     - Mac: right-click the `onepassword-mcp` folder, press and hold the `Option` key → "Copy ... as Pathname"
     - Windows: hold `Shift`, right-click the folder → "Copy as path"
3. **Fully quit** Claude (right-click its icon → Quit) and open it again
4. In a new chat, look for the **tools icon** (a little hammer/wrench). "onepassword" should be listed there. Success!

### If you use Claude Code (in the Terminal):

```
claude mcp add onepassword -e OP_SERVICE_ACCOUNT_TOKEN=PASTE_YOUR_TOKEN_HERE -e OP_VAULT="All Items" -- node /FULL/PATH/TO/onepassword-mcp/dist/index.js
```

Then check it:
```
claude mcp list
```
It should say `connected`.

---

## 9. Step 7 — Try it out! (the fun part)

Type these to Claude, one at a time:

1. **"List my 1Password vaults"**
   → Claude shows your vault names. That means the door works!
2. **"Search my 1Password vault for github"**
   → Claude lists matching items (just titles, no secrets).
3. **"Show me the item called GitHub"**
   → You see the details, but the password looks like:
   `password = [MASKED - to reveal, call reveal_secret with reference: op://...]`
   That's the safety net working — passwords stay hidden.
4. **"Reveal the secret op://All Items/GitHub/password"**
   → NOW Claude shows that one real secret. Use this only when you actually need it.

---

## 10. The safety switches (game settings for grown-ups' peace of mind)

These live in the `env` part of the config file:

| Setting | What it does | Kid translation |
|---|---|---|
| `OP_VAULT` | Locks the door to ONE vault only | "The robot may only open this chest, no others" |
| `OP_MCP_ALLOW_WRITE` | `0` = look only, `1` = can also create/delete items | "The robot can only window-shop, or can also put things in the cart" |
| `OP_BIN_PATH` | Where the `op` helper lives, if not found automatically | "Address of the key" |
| `OP_TIMEOUT_MS` | How long to wait before giving up | "Patience timer" |

**Keep `OP_MCP_ALLOW_WRITE` at `0`** until you have a real reason to change it.

---

## 11. If something breaks (rescue section)

| Problem | Fix |
|---|---|
| "op CLI not found" | Redo Step 2. On Windows/WSL you can point to the Windows exe: set `OP_BIN_PATH` to `op.exe`'s full path |
| "Access restricted by configuration" | You asked about a different vault than `OP_VAULT` allows. That's the lock working, not a bug! |
| "No accessible vaults" / vault not visible | The key card (token) wasn't given that vault. Redo Step 3 and share the vault with the service account |
| Claude Desktop shows no tools | Check the JSON for typos (every quote and comma matters!), make sure the path is the FULL path to `dist/index.js`, fully restart the app. Logs: `~/Library/Logs/Claude/mcp*.log` (Mac) |
| Still broken? | Delete the service account at 1password.com, make a new one, redo Steps 3 → 6 |

---

## 12. Why can't we just use my email and password? (great question!)

1Password sign-in needs **THREE** things: email + master password + **Secret Key**.
The Secret Key never leaves your devices — that's what makes 1Password so safe.
Programs like this one therefore use a **service account token** instead.

Anyone (or any AI) asking for "just your email and password" to automate
1Password is doing it wrong. And if you already typed a password into a chat
with an AI — go **change that password right now**, and turn on 2FA.

---

## 13. Word list (glossary)

| Word | Meaning |
|---|---|
| **Terminal / PowerShell** | A window where you type commands instead of clicking buttons |
| **CLI** | Command Line Interface — a program that lives in the Terminal (`op` is one) |
| **Node.js** | An engine that runs JavaScript programs on your computer |
| **npm** | The app store for Node.js building blocks |
| **Token** | A long secret string that acts like a key card (`sva_...`) |
| **Vault** | A folder inside 1Password holding your items |
| **Item** | One saved thing: a login, a note, a card, a key... |
| **MCP** | Model Context Protocol — the "special door" standard that lets Claude talk to tools |
| **Config file** | A small text file with settings (`claude_desktop_config.json`) |

---

## 14. For adults — quick technical summary

- **Stack:** TypeScript + official MCP SDK (`@modelcontextprotocol/sdk`), wraps the official 1Password CLI (`op`).
- **Auth:** `OP_SERVICE_ACCOUNT_TOKEN` (headless) or desktop-app biometric unlock. No master password / Secret Key handling anywhere.
- **Tools:** `list_vaults`, `list_items`, `search_items`, `get_item` (sensitive fields masked with `op://` hints), `reveal_secret` (explicit single-value read).
- **Write tools** (`create_login`, `create_note`, `delete_item` with mandatory `confirm: true`) register **only** when `OP_MCP_ALLOW_WRITE=1`.
- **Least privilege:** optional single-vault lockdown via `OP_VAULT`; recommend a Read-only service account.
- **Build:** `npm install && npm run build` → `dist/index.js` (stdio MCP server).

**Push this project to your own GitHub** (from inside the folder):

- With GitHub CLI installed and `gh auth login` done once:
  - Mac/Linux: `bash push-to-github.sh`
  - Windows: double-click `push-to-github.bat`
- Or manually:
  ```
  git init -b main
  git add .
  git commit -m "1Password MCP server for Claude"
  git remote add origin https://github.com/YOUR-USERNAME/onepassword-mcp.git
  git push -u origin main
  ```
  (When pushing, GitHub asks you to log in **in your browser** — it never accepts your password inside the Terminal.)
