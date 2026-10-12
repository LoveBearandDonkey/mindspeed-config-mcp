@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0connect-mindspeed-mcp.ps1"
if errorlevel 1 (
  echo.
  echo Start failed. Read the message above, then press any key to close.
  pause >nul
)
endlocal
