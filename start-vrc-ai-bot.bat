@echo off
setlocal

set "SCRIPT_DIR=%~dp0"

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\docker\start-bot.ps1"

if errorlevel 1 (
  echo Failed to start vrc-ai-bot.
  pause
)
