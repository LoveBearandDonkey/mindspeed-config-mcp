[CmdletBinding()]
param(
    [ValidateSet("Start", "Preview", "Refresh", "Stop", "Status")]
    [string]$Action = "Start",
    [string]$ProjectRoot = $env:MINDSPEED_CONFIG_MCP_ROOT,
    [int]$PreferredMcpPort = 3000,
    [int]$PreferredInspectorPort = 6274,
    [int]$PreviewPort = 4174,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$defaultProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\..\.."))
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { $ProjectRoot = $defaultProjectRoot }
$stateRoot = Join-Path ([IO.Path]::GetTempPath()) "mindspeed-config-mcp-local"
$statePath = Join-Path $stateRoot "state.json"

function New-RandomHex([int]$ByteCount = 32) {
    $bytes = New-Object byte[] $ByteCount
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
}

function Test-PortAvailable([int]$Port) {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
    try {
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        try { $listener.Stop() } catch { }
    }
}

function Find-FreePort([int]$StartPort) {
    foreach ($port in $StartPort..($StartPort + 30)) {
        if (Test-PortAvailable $port) { return $port }
    }
    throw "No free port found in range $StartPort..$($StartPort + 30)."
}

function Find-InspectorPorts([int]$StartPort) {
    for ($base = $StartPort; $base -le ($StartPort + 100); $base += 10) {
        $ports = @($base, $base + 1, $base + 4)
        if (($ports | Where-Object { -not (Test-PortAvailable $_) }).Count -eq 0) {
            return [PSCustomObject]@{ Web = $base; Sandbox = $base + 1; AppOrigin = $base + 4 }
        }
    }
    throw "No free port group found for MCP Inspector."
}

function Read-State {
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { return $null }
    try { return Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
}

function Get-TrackedProcess($Record) {
    if (-not $Record -or -not $Record.pid -or -not $Record.start_time_utc) { return $null }
    $process = Get-Process -Id ([int]$Record.pid) -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    $actual = $process.StartTime.ToUniversalTime().ToString("o")
    if ($actual -ne [string]$Record.start_time_utc) { return $null }
    return $process
}

function Stop-TrackedProcess($Record, [string]$Label) {
    $process = Get-TrackedProcess $Record
    if (-not $process) { return }
    & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
    Write-Host "Stopped $Label (PID $($process.Id))."
}

function Stop-ManagedServices {
    $state = Read-State
    if (-not $state) {
        Write-Host "No services managed by this skill were found."
        return
    }
    Stop-TrackedProcess $state.preview_process "MCP App preview"
    Stop-TrackedProcess $state.inspector_process "MCP Inspector"
    Stop-TrackedProcess $state.mcp_process "MindSpeed Config MCP"
    if (Test-Path -LiteralPath $statePath -PathType Leaf) {
        Remove-Item -LiteralPath $statePath -Force
    }
}

function Wait-Http([string]$Url, [int]$Seconds = 45) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
        } catch { }
        Start-Sleep -Milliseconds 350
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for local URL: $Url"
}

function Save-State($State) {
    if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
        New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
    }
    $State | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding UTF8
}

function Process-Record($Process) {
    if (-not $Process) { return $null }
    $liveProcess = Get-Process -Id $Process.Id -ErrorAction SilentlyContinue
    if (-not $liveProcess) { return $null }
    return [PSCustomObject]@{
        pid = $liveProcess.Id
        start_time_utc = $liveProcess.StartTime.ToUniversalTime().ToString("o")
    }
}

function Assert-Prerequisites {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "package.json") -PathType Leaf)) {
        throw "mindspeed-config-mcp project not found: $ProjectRoot"
    }
    foreach ($command in @("node.exe", "npm.cmd", "npx.cmd")) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Command not found: $command" }
    }
    $versionText = (& node.exe --version).Trim().TrimStart("v")
    $version = [Version]$versionText
    if ($version -lt [Version]"22.19.0") {
        throw "MCP Inspector requires Node.js >= 22.19.0; current version: $versionText."
    }
}

function Start-ManagedServices {
    Assert-Prerequisites
    Stop-ManagedServices
    if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
        New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
    }

    $mcpPort = Find-FreePort $PreferredMcpPort
    $inspectorPorts = Find-InspectorPorts $PreferredInspectorPort
    $mcpToken = New-RandomHex
    $inspectorToken = New-RandomHex
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $mcpLog = Join-Path $stateRoot "mcp-$timestamp.log"
    $mcpErrorLog = Join-Path $stateRoot "mcp-$timestamp.err.log"
    $inspectorLog = Join-Path $stateRoot "inspector-$timestamp.log"
    $inspectorErrorLog = Join-Path $stateRoot "inspector-$timestamp.err.log"

    Push-Location $ProjectRoot
    try {
        & npm.cmd run build:ui
        if ($LASTEXITCODE -ne 0) { throw "MCP App build failed with exit code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }

    $oldEnvironment = @{
        MCP_BEARER_TOKEN = $env:MCP_BEARER_TOKEN
        MCP_HTTP_HOST = $env:MCP_HTTP_HOST
        MCP_HTTP_PORT = $env:MCP_HTTP_PORT
        HOST = $env:HOST
        CLIENT_PORT = $env:CLIENT_PORT
        MCP_SANDBOX_PORT = $env:MCP_SANDBOX_PORT
        MCP_APP_ORIGIN_PORT = $env:MCP_APP_ORIGIN_PORT
        MCP_AUTO_OPEN_ENABLED = $env:MCP_AUTO_OPEN_ENABLED
        MCP_INSPECTOR_API_TOKEN = $env:MCP_INSPECTOR_API_TOKEN
    }

    try {
        $env:MCP_BEARER_TOKEN = $mcpToken
        $env:MCP_HTTP_HOST = "127.0.0.1"
        $env:MCP_HTTP_PORT = [string]$mcpPort
        $mcpProcess = Start-Process -FilePath "node.exe" `
            -ArgumentList @("apps/mcp-server/src/http-entry.js") `
            -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $mcpLog -RedirectStandardError $mcpErrorLog

        $mcpUrl = "http://127.0.0.1:$mcpPort/mcp"
        Wait-Http "http://127.0.0.1:$mcpPort/health"

        $env:HOST = "127.0.0.1"
        $env:CLIENT_PORT = [string]$inspectorPorts.Web
        $env:MCP_SANDBOX_PORT = [string]$inspectorPorts.Sandbox
        $env:MCP_APP_ORIGIN_PORT = [string]$inspectorPorts.AppOrigin
        $env:MCP_AUTO_OPEN_ENABLED = "false"
        $env:MCP_INSPECTOR_API_TOKEN = $inspectorToken
        $headerArgument = '"Authorization: Bearer {0}"' -f $mcpToken
        $inspectorProcess = Start-Process -FilePath "npx.cmd" `
            -ArgumentList @("--yes", "--package", "@modelcontextprotocol/inspector@2.10.0", "mcp-inspector", "--web", "--server-url", $mcpUrl, "--transport", "http", "--header", $headerArgument) `
            -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $inspectorLog -RedirectStandardError $inspectorErrorLog

        $inspectorUrl = "http://127.0.0.1:$($inspectorPorts.Web)"
        Wait-Http $inspectorUrl
        $encodedServer = [Uri]::EscapeDataString($mcpUrl)
        $browserUrl = "$inspectorUrl/?MCP_INSPECTOR_API_TOKEN=$inspectorToken&serverUrl=$encodedServer&transport=http&autoConnect=$inspectorToken&openApp=open_config_workbench&appArgs=e30&autoOpen=$inspectorToken"

        $state = [PSCustomObject]@{
            project_root = $ProjectRoot
            started_at = (Get-Date).ToUniversalTime().ToString("o")
            mcp_url = $mcpUrl
            inspector_url = $inspectorUrl
            browser_url = $browserUrl
            mcp_log = $mcpLog
            mcp_error_log = $mcpErrorLog
            inspector_log = $inspectorLog
            inspector_error_log = $inspectorErrorLog
            mcp_process = Process-Record $mcpProcess
            inspector_process = Process-Record $inspectorProcess
        }
        Save-State $state
        if (-not $NoBrowser) { Start-Process $browserUrl }
        Write-Host "MindSpeed Config MCP local workbench started."
        $state | Select-Object mcp_url, inspector_url, browser_url, mcp_log, inspector_log
    } catch {
        if ($inspectorProcess) { Stop-TrackedProcess (Process-Record $inspectorProcess) "MCP Inspector" }
        if ($mcpProcess) { Stop-TrackedProcess (Process-Record $mcpProcess) "MindSpeed Config MCP" }
        throw
    } finally {
        foreach ($entry in $oldEnvironment.GetEnumerator()) {
            if ($null -eq $entry.Value) { Remove-Item -LiteralPath "Env:$($entry.Key)" -ErrorAction SilentlyContinue }
            else { Set-Item -LiteralPath "Env:$($entry.Key)" -Value $entry.Value }
        }
    }
}

function Start-Preview {
    Assert-Prerequisites
    Stop-ManagedServices
    if (-not (Test-PortAvailable $PreviewPort)) {
        throw "Preview port $PreviewPort is occupied by a process not managed by this skill."
    }
    if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
        New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
    }

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $previewLog = Join-Path $stateRoot "preview-$timestamp.log"
    $previewErrorLog = Join-Path $stateRoot "preview-$timestamp.err.log"
    $viteCommand = Join-Path $ProjectRoot "node_modules\.bin\vite.cmd"
    if (-not (Test-Path -LiteralPath $viteCommand -PathType Leaf)) {
        throw "Vite command not found: $viteCommand. Run npm install first."
    }

    try {
        $previewProcess = Start-Process -FilePath $viteCommand `
            -ArgumentList @("--config", "apps/mcp-server/vite.config.js", "--host", "127.0.0.1", "--port", [string]$PreviewPort, "--strictPort") `
            -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $previewLog -RedirectStandardError $previewErrorLog
        $previewUrl = "http://127.0.0.1:$PreviewPort/training-run-twin-standalone/config-relation-plane-mindspeed-config-mcp.html?preview=1"
        Wait-Http $previewUrl
        $state = [PSCustomObject]@{
            mode = "preview"
            project_root = $ProjectRoot
            started_at = (Get-Date).ToUniversalTime().ToString("o")
            preview_url = $previewUrl
            browser_url = $previewUrl
            preview_log = $previewLog
            preview_error_log = $previewErrorLog
            preview_process = Process-Record $previewProcess
        }
        Save-State $state
        if (-not $NoBrowser) { Start-Process $previewUrl }
        Write-Host "MindSpeed Config MCP standalone preview started."
        $state | Select-Object preview_url, preview_log
    } catch {
        if ($previewProcess) { Stop-TrackedProcess (Process-Record $previewProcess) "MCP App preview" }
        throw
    }
}

switch ($Action) {
    "Start" { Start-ManagedServices }
    "Preview" { Start-Preview }
    "Refresh" { Start-ManagedServices }
    "Stop" { Stop-ManagedServices }
    "Status" {
        $state = Read-State
        if (-not $state) { Write-Host "Status: not started by this skill."; exit 1 }
        if ($state.mode -eq "preview") {
            $previewRunning = [bool](Get-TrackedProcess $state.preview_process)
            [PSCustomObject]@{
                mode = "preview"
                preview = if ($previewRunning) { "running" } else { "stopped" }
                preview_url = $state.preview_url
            }
            if (-not $previewRunning) { exit 1 }
        } else {
            $mcpRunning = [bool](Get-TrackedProcess $state.mcp_process)
            $inspectorRunning = [bool](Get-TrackedProcess $state.inspector_process)
            [PSCustomObject]@{
                mode = "mcp"
                mcp = if ($mcpRunning) { "running" } else { "stopped" }
                inspector = if ($inspectorRunning) { "running" } else { "stopped" }
                mcp_url = $state.mcp_url
                inspector_url = $state.inspector_url
                browser_url = $state.browser_url
            }
            if (-not ($mcpRunning -and $inspectorRunning)) { exit 1 }
        }
    }
}
