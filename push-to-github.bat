@echo off
REM =============================================================
REM Push this project to a new private GitHub repo - ONE command.
REM Before running: install GitHub CLI (winget install GitHub.cli)
REM then log in once:  gh auth login
REM Run: double-click this file (or run in PowerShell)
REM =============================================================
cd /d %~dp0

where gh >nul 2>nul
if errorlevel 1 (
  echo Oops: GitHub CLI not installed. Run:  winget install GitHub.cli
  echo Then log in once:  gh auth login
  pause
  exit /b 1
)

gh auth status >nul 2>nul
if errorlevel 1 (
  echo Oops: not logged in. Run:  gh auth login
  pause
  exit /b 1
)

if not exist .git (
  git init -b main
  git add .
  git commit -m "Initial commit: 1Password MCP server for Claude"
  if errorlevel 1 (
    echo Git needs your name first. Run these two, then try again:
    echo   git config --global user.name "Your Name"
    echo   git config --global user.email "you@example.com"
    pause
    exit /b 1
  )
)

gh repo create onepassword-mcp --private --source . --remote origin --push
if errorlevel 1 (
  echo Could not create the repo - maybe the name is taken.
  echo Try a different name, e.g.:  gh repo create my-1password-mcp --private --source . --remote origin --push
  pause
  exit /b 1
)

echo.
echo All done! Check your GitHub page.
pause
