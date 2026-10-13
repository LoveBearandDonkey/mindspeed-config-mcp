[CmdletBinding()]
param(
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\..\.."))
} else {
    $ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
}

$serverPackageFile = Join-Path $ProjectRoot "apps\mcp-server\package.json"
$pagesDirectory = Join-Path $ProjectRoot "deploy\github-pages"
$requiredFiles = @(".nojekyll", "index.html", "manifest.json", "README.md", "SHA256SUMS")
foreach ($name in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $pagesDirectory $name) -PathType Leaf)) {
        throw "GitHub Pages package is missing $name in $pagesDirectory."
    }
}

$serverPackage = Get-Content -Raw -Encoding UTF8 -LiteralPath $serverPackageFile | ConvertFrom-Json
$productVersion = [string]$serverPackage.productVersion
if ($productVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw "apps/mcp-server/package.json productVersion must be a numeric semver."
}
$productVersionLabel = "v$productVersion"

$indexFile = Join-Path $pagesDirectory "index.html"
$manifestFile = Join-Path $pagesDirectory "manifest.json"
$sumsFile = Join-Path $pagesDirectory "SHA256SUMS"
$html = [IO.File]::ReadAllText($indexFile, [Text.Encoding]::UTF8)
if (-not $html.Contains('mcpDistribution=`github-pages`')) {
    throw "GitHub Pages index.html is not in browser-local static demo mode."
}
if (-not $html.Contains("mcp-product-tag mcp-product-version") -or -not $html.Contains(">$productVersionLabel</span>")) {
    throw "GitHub Pages index.html does not contain product version $productVersionLabel."
}
if ($html -match '<(?:script|link|img|source|video|audio|iframe|object|embed)\b[^>]*(?:src|href|data)\s*=\s*["''][^"'']+["'']') {
    throw "GitHub Pages index.html contains an external element asset."
}

$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestFile | ConvertFrom-Json
if ($manifest.product_version -ne $productVersionLabel) {
    throw "GitHub Pages manifest product_version is $($manifest.product_version), expected $productVersionLabel."
}
if ($manifest.execution_mode -ne "browser-local-config-core" -or $manifest.mcp_protocol_endpoint -ne $false) {
    throw "GitHub Pages manifest does not describe the standalone browser-local mode."
}

$hash = (Get-FileHash -LiteralPath $indexFile -Algorithm SHA256).Hash.ToLowerInvariant()
$bytes = (Get-Item -LiteralPath $indexFile).Length
$manifestHash = ([string]$manifest.sha256).ToLowerInvariant()
$sumLine = [IO.File]::ReadAllText($sumsFile, [Text.Encoding]::UTF8).Trim()
if ($manifestHash -ne $hash -or $sumLine -ne "$hash  index.html") {
    throw "GitHub Pages SHA-256 metadata does not match index.html."
}
if ([long]$manifest.bytes -ne $bytes) {
    throw "GitHub Pages manifest byte count does not match index.html."
}

[PSCustomObject]@{
    product_version = $productVersionLabel
    directory = $pagesDirectory
    entry = $indexFile
    bytes = $bytes
    sha256 = $hash
    execution_mode = [string]$manifest.execution_mode
    mcp_protocol_endpoint = [bool]$manifest.mcp_protocol_endpoint
}
