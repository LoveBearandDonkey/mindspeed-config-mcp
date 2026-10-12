[CmdletBinding()]
param(
    [string]$ProjectRoot = $env:MINDSPEED_CONFIG_MCP_ROOT,
    [switch]$FullVerify
)

$ErrorActionPreference = "Stop"
$defaultProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\..\.."))
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { $ProjectRoot = $defaultProjectRoot }

$packageFile = Join-Path $ProjectRoot "package.json"
if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) {
    throw "mindspeed-config-mcp project not found: $ProjectRoot"
}
if (-not (Get-Command "npm.cmd" -ErrorAction SilentlyContinue)) {
    throw "Command not found: npm.cmd"
}

Push-Location $ProjectRoot
try {
    if ($FullVerify) {
        & npm.cmd test
        if ($LASTEXITCODE -ne 0) { throw "Full test failed with exit code $LASTEXITCODE." }
        & npm.cmd run smoke:http
        if ($LASTEXITCODE -ne 0) { throw "HTTP smoke failed with exit code $LASTEXITCODE." }
    } else {
        & npm.cmd run build:ui
        if ($LASTEXITCODE -ne 0) { throw "MCP App build failed with exit code $LASTEXITCODE." }
    }
} finally {
    Pop-Location
}

$outputDirectory = Join-Path $ProjectRoot "apps\mcp-server\ui\dist\ui-shell-v1\training-run-twin-standalone"
$pattern = '^config-relation-plane-mindspeed-config-mcp-(\d{8}-\d{6})\.html$'
$artifacts = @(Get-ChildItem -LiteralPath $outputDirectory -File | Where-Object { $_.Name -match $pattern })
if ($artifacts.Count -ne 1) {
    $names = ($artifacts | ForEach-Object Name) -join ", "
    throw "Expected exactly one timestamped MCP App HTML; found $($artifacts.Count): $names"
}

$artifact = $artifacts[0]
$null = $artifact.Name -match $pattern
$hash = Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256

Write-Host "MindSpeed Config MCP App package ready."
[PSCustomObject]@{
    timestamp = $Matches[1]
    file_name = $artifact.Name
    full_path = $artifact.FullName
    bytes = $artifact.Length
    sha256 = $hash.Hash
    full_verify = [bool]$FullVerify
}
