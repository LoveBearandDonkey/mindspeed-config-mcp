[CmdletBinding()]
param(
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
$resolvedRoot = [IO.Path]::GetFullPath($ProjectRoot)
$packageFile = Join-Path $resolvedRoot "package.json"
if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) {
    throw "mindspeed-config-mcp project not found: $resolvedRoot"
}
$serverPackageFile = Join-Path $resolvedRoot "apps\mcp-server\package.json"
$serverPackage = Get-Content -Raw -Encoding UTF8 -LiteralPath $serverPackageFile | ConvertFrom-Json
$productVersion = [string]$serverPackage.productVersion
if ($productVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw "apps/mcp-server/package.json productVersion must be a numeric semver."
}
$productVersionLabel = "v$productVersion"
if (-not (Get-Command "npm.cmd" -ErrorAction SilentlyContinue)) {
    throw "Command not found: npm.cmd"
}

$artifactDirectory = Join-Path $resolvedRoot "apps\mcp-server\ui\dist\ui-shell-v1\training-run-twin-standalone"
$targetDirectory = [IO.Path]::GetFullPath((Join-Path $resolvedRoot "deploy\github-pages"))
$expectedTargetRoot = [IO.Path]::GetFullPath((Join-Path $resolvedRoot "deploy"))
if (-not $targetDirectory.StartsWith($expectedTargetRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to package outside deploy/: $targetDirectory"
}

$previousMode = $env:MINDSPEED_CONFIG_MCP_STATIC_DEMO
$staticBuildAttempted = $false
Push-Location $resolvedRoot
try {
    $env:MINDSPEED_CONFIG_MCP_STATIC_DEMO = "1"
    $staticBuildAttempted = $true
    & npm.cmd run build:ui
    if ($LASTEXITCODE -ne 0) { throw "Static demo build failed with exit code $LASTEXITCODE." }

    $pattern = '^config-relation-plane-mindspeed-config-mcp-(\d{8}-\d{6})\.html$'
    $artifacts = @(Get-ChildItem -LiteralPath $artifactDirectory -File | Where-Object { $_.Name -match $pattern })
    if ($artifacts.Count -ne 1) {
        $names = ($artifacts | ForEach-Object Name) -join ", "
        throw "Expected exactly one timestamped static demo HTML; found $($artifacts.Count): $names"
    }

    $artifact = $artifacts[0]
    $html = [IO.File]::ReadAllText($artifact.FullName, [Text.Encoding]::UTF8)
    if (-not $html.Contains('mcpDistribution=`github-pages`')) {
        throw "Static demo marker missing; refusing to publish a host-dependent MCP App."
    }
    if (-not $html.Contains("mcp-product-tag mcp-product-version") -or -not $html.Contains(">$productVersionLabel</span>")) {
        throw "Static demo product version is not $productVersionLabel."
    }
    if ($html -match '<(?:script|link|img|source|video|audio|iframe|object|embed)\b[^>]*(?:src|href|data)\s*=\s*["''][^"'']+["'']') {
        throw "Static demo HTML contains an external element asset."
    }

    $null = New-Item -ItemType Directory -Path $targetDirectory -Force
    $indexFile = Join-Path $targetDirectory "index.html"
    Copy-Item -LiteralPath $artifact.FullName -Destination $indexFile -Force

    $null = $artifact.Name -match $pattern
    $timestamp = $Matches[1]
    $hash = Get-FileHash -LiteralPath $indexFile -Algorithm SHA256
    $bytes = (Get-Item -LiteralPath $indexFile).Length
    $manifest = [ordered]@{
        schema_version = "1.0"
        packaged_at_asia_shanghai = $timestamp
        product_version = $productVersionLabel
        entry = "index.html"
        bytes = $bytes
        sha256 = $hash.Hash
        execution_mode = "browser-local-config-core"
        mcp_protocol_endpoint = $false
        capabilities = @(
            "parse_training_config"
            "validate_parallel_config"
            "compute_rank_topology"
            "suggest_config_fixes"
            "estimate_training_capacity"
        )
    }
    [IO.File]::WriteAllText(
        (Join-Path $targetDirectory "manifest.json"),
        (($manifest | ConvertTo-Json -Depth 4) + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false)
    )
    [IO.File]::WriteAllText(
        (Join-Path $targetDirectory "SHA256SUMS"),
        ($hash.Hash.ToLowerInvariant() + "  index.html" + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false)
    )
    if (-not (Test-Path -LiteralPath (Join-Path $targetDirectory ".nojekyll") -PathType Leaf)) {
        [IO.File]::WriteAllText((Join-Path $targetDirectory ".nojekyll"), "", [Text.UTF8Encoding]::new($false))
    }

    Write-Host "GitHub Pages package ready."
    [PSCustomObject]@{
        timestamp = $timestamp
        product_version = $productVersionLabel
        directory = $targetDirectory
        entry = $indexFile
        bytes = $bytes
        sha256 = $hash.Hash
        execution_mode = "browser-local-config-core"
    }
} finally {
    if ($null -eq $previousMode) {
        Remove-Item Env:MINDSPEED_CONFIG_MCP_STATIC_DEMO -ErrorAction SilentlyContinue
    } else {
        $env:MINDSPEED_CONFIG_MCP_STATIC_DEMO = $previousMode
    }

    if ($staticBuildAttempted) {
        & npm.cmd run build:ui
        if ($LASTEXITCODE -ne 0) {
            Write-Error "GitHub Pages package was created, but restoring the normal MCP App build failed with exit code $LASTEXITCODE."
        }
    }
    Pop-Location
}
