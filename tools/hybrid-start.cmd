@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. 1>&2
  exit /b 1
)
node "tools\hybrid-quickstart.mjs" --serve %*
