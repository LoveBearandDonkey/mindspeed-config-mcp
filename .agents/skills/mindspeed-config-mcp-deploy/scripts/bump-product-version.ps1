[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\..\.."))
} else {
    $ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
}

$packageFile = Join-Path $ProjectRoot "apps\mcp-server\package.json"
if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) {
    throw "MCP server package not found: $packageFile"
}

$source = [IO.File]::ReadAllText($packageFile, [Text.Encoding]::UTF8)
$match = [regex]::Match($source, '"productVersion"\s*:\s*"(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)"')
if (-not $match.Success) {
    throw "apps/mcp-server/package.json must contain one numeric productVersion."
}
if ([regex]::Matches($source, '"productVersion"\s*:').Count -ne 1) {
    throw "apps/mcp-server/package.json must contain exactly one productVersion."
}

$currentVersion = "$($match.Groups['major'].Value).$($match.Groups['minor'].Value).$($match.Groups['patch'].Value)"
$nextPatch = [int64]$match.Groups['patch'].Value + 1
$nextVersion = "$($match.Groups['major'].Value).$($match.Groups['minor'].Value).$nextPatch"

$changed = $false
if ($PSCmdlet.ShouldProcess($packageFile, "Bump product version from v$currentVersion to v$nextVersion")) {
    $replacement = '"productVersion": "' + $nextVersion + '"'
    $updated = $source.Remove($match.Index, $match.Length).Insert($match.Index, $replacement)
    [IO.File]::WriteAllText($packageFile, $updated, [Text.UTF8Encoding]::new($false))
    $changed = $true
}

[PSCustomObject]@{
    file = $packageFile
    previous_version = "v$currentVersion"
    next_version = "v$nextVersion"
    changed = $changed
}
