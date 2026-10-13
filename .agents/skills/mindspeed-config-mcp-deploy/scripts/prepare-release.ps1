[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [switch]$ReuseCurrentVersion
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\..\.."))
} else {
    $ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
}
if (-not (Get-Command "npm.cmd" -ErrorAction SilentlyContinue)) {
    throw "Command not found: npm.cmd"
}

$bumpScript = Join-Path $PSScriptRoot "bump-product-version.ps1"
$verifyScript = Join-Path $PSScriptRoot "verify-github-pages.ps1"
if (-not $ReuseCurrentVersion) {
    & $bumpScript -ProjectRoot $ProjectRoot
}

Push-Location $ProjectRoot
try {
    & npm.cmd run package:github-pages
    if ($LASTEXITCODE -ne 0) {
        throw "GitHub Pages packaging failed with exit code $LASTEXITCODE. Retry with -ReuseCurrentVersion after fixing the cause."
    }
} finally {
    Pop-Location
}

$verified = & $verifyScript -ProjectRoot $ProjectRoot
Write-Host "Release preparation ready. Commit the product version and complete deploy/github-pages directory together."
$verified
