@echo off
setlocal
title MindSpeed Config MCP - Keep This Window Open

if not defined MINDSPEED_MCP_SSH_KEY set "MINDSPEED_MCP_SSH_KEY=%USERPROFILE%\.ssh\mindspeed_config_mcp"

echo MindSpeed Config MCP SSH tunnel
echo Keep this window open while using the MCP service.
echo If prompted, enter the passphrase for your SSH private key.
echo.

ssh.exe -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=60 -o ServerAliveCountMax=3 -i "%MINDSPEED_MCP_SSH_KEY%" -N -L 13000:127.0.0.1:3002 ubuntu@42.192.111.92

echo.
echo The SSH tunnel has stopped. MCP access is now disconnected.
echo Press any key to close this window.
pause >nul
endlocal
