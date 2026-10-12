Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$serverAddress = "42.192.111.92"
$localPort = 13000
$healthUrl = "http://127.0.0.1:$localPort/health"
$clientDirectory = Join-Path $env:USERPROFILE "mindspeed-mcp-client"
$vscodeDirectory = Join-Path $clientDirectory ".vscode"
$mcpConfigPath = Join-Path $vscodeDirectory "mcp.json"
$vscodeSettingsPath = Join-Path $vscodeDirectory "settings.json"
$promptDirectory = Join-Path $clientDirectory ".github\prompts"
$workbenchPromptPath = Join-Path $promptDirectory "open-mindspeed-workbench.prompt.md"
$tunnelLauncher = Join-Path $PSScriptRoot "open-tunnel.cmd"

function Write-Step {
  param([string]$Message)
  Write-Host "[MindSpeed MCP] $Message" -ForegroundColor Cyan
}

function Test-McpHealth {
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2
    return $health.status -eq "ok" -and $health.service -eq "mindspeed-config-mcp"
  }
  catch {
    return $false
  }
}

function Find-SshKey {
  $candidates = @(
    (Join-Path $env:USERPROFILE ".ssh\mindspeed_config_mcp"),
    (Join-Path $env:USERPROFILE ".ssh\mindspeed_config_mcp.pem"),
    (Join-Path $env:USERPROFILE ".ssh\mindspeed-config-key.pem")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return $candidate
    }
  }

  return $null
}

function Open-MindSpeedWorkbench {
  param([string]$Folder)

  $workbenchPrompt = "/open-mindspeed-workbench"

  $codeCommand = Get-Command "code.cmd" -ErrorAction SilentlyContinue
  if (-not $codeCommand) {
    $codeCommand = Get-Command "code" -ErrorAction SilentlyContinue
  }

  if ($codeCommand) {
    & $codeCommand.Source --new-window $Folder
    if ($LASTEXITCODE -ne 0) {
      throw "VS Code could not open the MindSpeed MCP client folder."
    }

    # The first CLI request creates and focuses the workspace window. Route the
    # chat request to that window only after VS Code has registered it.
    Start-Sleep -Milliseconds 1500
    Push-Location -LiteralPath $Folder
    try {
      & $codeCommand.Source chat --reuse-window --maximize --mode agent $workbenchPrompt
    }
    finally {
      Pop-Location
    }
    return
  }

  $codeCandidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code\Code.exe"),
    (Join-Path $env:ProgramFiles "Microsoft VS Code\Code.exe")
  )

  if (${env:ProgramFiles(x86)}) {
    $codeCandidates += Join-Path ${env:ProgramFiles(x86)} "Microsoft VS Code\Code.exe"
  }

  foreach ($candidate in $codeCandidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      Start-Process -FilePath $candidate -ArgumentList @(
        "--new-window",
        ('"{0}"' -f $Folder)
      ) | Out-Null
      Start-Sleep -Milliseconds 1500

      $quotedPrompt = '"{0}"' -f $workbenchPrompt.Replace('"', '\"')
      Start-Process -FilePath $candidate -WorkingDirectory $Folder -ArgumentList @(
        "chat",
        "--reuse-window",
        "--maximize",
        "--mode",
        "agent",
        $quotedPrompt
      )
      return
    }
  }

  Start-Process explorer.exe -ArgumentList ('"{0}"' -f $Folder)
  throw "VS Code was not found. Install VS Code, then double-click Start-MindSpeed-MCP.cmd again."
}

Write-Step "Checking prerequisites."

if (-not (Get-Command "ssh.exe" -ErrorAction SilentlyContinue)) {
  throw "Windows OpenSSH Client was not found. Install the Windows optional feature named OpenSSH Client."
}

if (-not (Test-Path -LiteralPath $tunnelLauncher -PathType Leaf)) {
  throw "open-tunnel.cmd is missing. Copy the complete remote-client folder and try again."
}

$sshKey = Find-SshKey
if (-not $sshKey) {
  throw "No SSH private key was found. Create and bind the key first. Expected location: $env:USERPROFILE\.ssh\mindspeed_config_mcp"
}

Write-Step "Using SSH key: $sshKey"

$tokenInputId = "mindspeed-config-token"
if (Test-Path -LiteralPath $mcpConfigPath -PathType Leaf) {
  $existingMcpConfig = [IO.File]::ReadAllText($mcpConfigPath)
  $tokenInputMatch = [regex]::Match($existingMcpConfig, '"id"\s*:\s*"(mindspeed-config-token[^"]*)"')
  if ($tokenInputMatch.Success) {
    $tokenInputId = $tokenInputMatch.Groups[1].Value
  }
}

# Changing this harmless query value marks the HTTP definition as updated, so
# VS Code's newAndOutdated autostart pass starts it before the Chat request.
$launchNonce = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$mcpConfig = @'
{
  "inputs": [
    {
      "type": "promptString",
      "id": "__TOKEN_INPUT_ID__",
      "description": "Enter the MindSpeed Config MCP token only (do not add Bearer)",
      "password": true
    }
  ],
  "servers": {
    "mindspeedConfig": {
      "type": "http",
      "url": "http://127.0.0.1:13000/mcp?launch=__LAUNCH_NONCE__",
      "headers": {
        "Authorization": "Bearer ${input:__TOKEN_INPUT_ID__}"
      }
    }
  }
}
'@
$mcpConfig = $mcpConfig.Replace("__TOKEN_INPUT_ID__", $tokenInputId).Replace("__LAUNCH_NONCE__", $launchNonce)

New-Item -ItemType Directory -Path $vscodeDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $promptDirectory -Force | Out-Null
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($mcpConfigPath, $mcpConfig, $utf8WithoutBom)

# Keep the PowerShell source ASCII-only for Windows PowerShell 5.1. The prompt
# file itself is UTF-8 and explicitly enables every tool from this MCP server.
$promptBase64 = "6K+35L2/55SoIG1pbmRzcGVlZENvbmZpZyDnmoQgb3Blbl9jb25maWdfd29ya2JlbmNoIOW3peWFt+aJk+W8gOmFjee9ruW3peS9nOWPsOOAguS4jeimgeino+mHiu+8jOebtOaOpeiwg+eUqOivpeW3peWFt+OAgg=="
$promptBody = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($promptBase64))
$promptFile = @"
---
name: open-mindspeed-workbench
description: Open the interactive MindSpeed configuration workbench
agent: agent
tools: ['mindspeedConfig/*']
---
$promptBody
"@
[System.IO.File]::WriteAllText($workbenchPromptPath, $promptFile, $utf8WithoutBom)

$vscodeSettings = [ordered]@{}
if (Test-Path -LiteralPath $vscodeSettingsPath -PathType Leaf) {
  $existingSettings = Get-Content -Raw -LiteralPath $vscodeSettingsPath | ConvertFrom-Json
  foreach ($property in $existingSettings.PSObject.Properties) {
    $vscodeSettings[$property.Name] = $property.Value
  }
}
$vscodeSettings["chat.mcp.autostart"] = "newAndOutdated"
$settingsJson = $vscodeSettings | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($vscodeSettingsPath, $settingsJson, $utf8WithoutBom)
Write-Step "VS Code MCP configuration is ready: $mcpConfigPath"

if (-not (Test-McpHealth)) {
  Write-Step "Checking SSH access to ${serverAddress}:22."
  $sshReachable = Test-NetConnection -ComputerName $serverAddress -Port 22 -InformationLevel Quiet -WarningAction SilentlyContinue
  if (-not $sshReachable) {
    throw "Cannot reach ${serverAddress}:22. Check the network, VPN, and Tencent Cloud firewall rules."
  }

  $localPortInUse = Test-NetConnection -ComputerName "127.0.0.1" -Port $localPort -InformationLevel Quiet -WarningAction SilentlyContinue
  if ($localPortInUse) {
    throw "Local port $localPort is already used by another program, but it is not the MindSpeed MCP service. Close that program and try again."
  }

  Write-Step "Opening the SSH tunnel window. Keep that window open."
  $env:MINDSPEED_MCP_SSH_KEY = $sshKey
  Start-Process -FilePath $tunnelLauncher | Out-Null

  Write-Step "Waiting for the remote service. Complete any SSH prompt in the tunnel window."
  $ready = $false
  for ($attempt = 1; $attempt -le 120; $attempt++) {
    if (Test-McpHealth) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }

  if (-not $ready) {
    throw "The MCP health check did not succeed within 120 seconds. Read the error in the SSH tunnel window."
  }
}
else {
  Write-Step "An existing healthy SSH tunnel is already available."
}

Write-Step "Health check passed. Opening the MindSpeed workbench in a new VS Code window."
Open-MindSpeedWorkbench -Folder $clientDirectory

Write-Host ""
Write-Host "Ready." -ForegroundColor Green
Write-Host "VS Code opens in a separate window and asks mindspeedConfig to render the workbench in Chat."
Write-Host "On first use, click 'Start now' in Chat, then enter the bearer token only; do not add 'Bearer '."
Write-Host "After first-time authorization, double-click this launcher once more to open the workbench automatically."
Write-Host "You can close this launcher window. Keep the SSH tunnel window open."
