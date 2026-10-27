#!/usr/bin/env bash
# =============================================================
# Push this project to a new private GitHub repo - ONE command.
# Before running: install GitHub CLI (https://cli.github.com)
#   mac: brew install gh | win: winget install GitHub.cli
#   then log in once:  gh auth login
# Run:  bash push-to-github.sh [repo-name]
# =============================================================
set -e
cd "$(dirname "$0")"

REPO_NAME="${1:-onepassword-mcp}"

if ! command -v gh >/dev/null 2>&1; then
  echo "Oops: GitHub CLI (gh) is not installed."
  echo "  Mac:     brew install gh"
  echo "  Windows: winget install GitHub.cli"
  echo "  Linux:   see https://github.com/cli/cli#installation"
  echo "Then run once:  gh auth login"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Oops: you are not logged in to GitHub yet."
  echo "Run this first and follow the browser steps:"
  echo "  gh auth login"
  exit 1
fi

GH_USER="$(gh api user -q .login)"
echo "Hello, $GH_USER!"

# Git identity (only set locally, only if missing)
git config user.name  >/dev/null 2>&1 || git config user.name  "$GH_USER"
git config user.email >/dev/null 2>&1 || git config user.email "$GH_USER@users.noreply.github.com"

# First commit if this folder is not a git repo yet
if [ ! -d .git ]; then
  git init -b main
  git add .
  git commit -m "Initial commit: 1Password MCP server for Claude"
fi

# Create the private repo and push (fails kindly if the name is taken)
if gh repo create "$REPO_NAME" --private --source=. --remote=origin --push 2>/tmp/gh_err; then
  echo ""
  echo "All done! Your new repo: https://github.com/$GH_USER/$REPO_NAME"
else
  if git remote get-url origin >/dev/null 2>&1; then
    echo "Repo already existed - just pushing..."
    git push -u origin main
    echo "Pushed! https://github.com/$GH_USER/$REPO_NAME"
  else
    echo "Could not create the repo. GitHub said:"
    cat /tmp/gh_err
    echo "Tip: try a different name, e.g.:  bash push-to-github.sh my-1password-mcp"
    exit 1
  fi
fi
