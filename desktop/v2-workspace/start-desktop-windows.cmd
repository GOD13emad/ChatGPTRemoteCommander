@echo off
setlocal
cd /d "%~dp0"
node "%~dp0desktop-app.mjs"
if errorlevel 1 (echo Could not start Commander V2 GUI & exit /b 1)
