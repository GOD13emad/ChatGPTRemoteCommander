@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Commander V2 Workspace requires Node.js 22 or later.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)"
if errorlevel 1 (
  echo Node.js 22 or later is required.
  pause
  exit /b 1
)
echo Launching owner-local Commander V2 Workspace...
node "%~dp0server.mjs"
if errorlevel 1 (
  echo Cannot start. Check whether the workspace port is already used.
  pause
  exit /b 1
)
