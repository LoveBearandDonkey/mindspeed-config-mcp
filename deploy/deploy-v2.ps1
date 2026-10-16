[CmdletBinding()]
param(
    [string]$SshHost = "ubuntu@42.192.111.92",
    [string]$SshKey = (Join-Path $env:USERPROFILE ".ssh\mindspeed_config_mcp"),
    [string]$RemoteBase = "/home/ubuntu"
)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$sshArgs = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "IdentitiesOnly=yes", "-i", $SshKey)
$container = "mindspeed-config-mcp-v2"
$image = "mindspeed-config-mcp-v2:latest"
$liveContainer = "mindspeed-config-mcp"
$tempDirectory = $null
$previousImage = $null
$previousDeployDirectory = $null
$startedNewContainer = $false

function Quote-Sh([string]$value) { return "'" + $value.Replace("'", "'`"'`"'") + "'" }
function Run([string]$command, [string[]]$arguments) {
    $output = @(& $command @arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "$command failed ($LASTEXITCODE): $($output -join [Environment]::NewLine)"
    }
    return (($output | ForEach-Object { $_.ToString() }) -join "`n").Trim()
}
function Remote([string]$command) { return Run "ssh.exe" ($script:sshArgs + @($script:SshHost, $command)) }
function Remote-Image([string]$name) {
    return Remote ("sudo docker inspect --format " + (Quote-Sh '{{.Image}}') + " " + (Quote-Sh $name))
}
function Wait-Healthy([string]$expectedImage) {
    for ($attempt = 1; $attempt -le 15; $attempt++) {
        try {
            $state = Remote ("sudo docker inspect --format " + (Quote-Sh '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}} {{.Image}}') + " " + (Quote-Sh $script:container))
            if ($state -eq "running healthy $expectedImage") { return }
        } catch { }
        Start-Sleep -Seconds 5
    }
    throw "$container did not become healthy on $expectedImage."
}

foreach ($command in @("git.exe", "ssh.exe", "scp.exe")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command is required." }
}
if (-not (Test-Path -LiteralPath $SshKey -PathType Leaf)) { throw "SSH key not found: $SshKey" }

try {
    Push-Location $root
    try {
        if ((Run "git.exe" @("symbolic-ref", "--short", "HEAD")) -ne "main") { throw "Deploy V2 from main." }
        if ((Run "git.exe" @("status", "--porcelain", "--untracked-files=all"))) { throw "Commit all intended V2 changes before deployment." }
        $commit = Run "git.exe" @("rev-parse", "HEAD")
        $null = Run "git.exe" @("fetch", "origin", "main")
        if ($commit -ne (Run "git.exe" @("rev-parse", "origin/main"))) { throw "Push commit $commit to origin/main first." }
        $releaseId = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, "China Standard Time").ToString("yyyyMMdd-HHmmss")
        $tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ("mindspeed-v2-" + [guid]::NewGuid().ToString("N"))
        $null = New-Item -ItemType Directory -Path $tempDirectory
        $bundle = Join-Path $tempDirectory "v2-$commit.bundle"
        $null = Run "git.exe" @("bundle", "create", $bundle, "main")
        $null = Run "git.exe" @("bundle", "verify", $bundle)
        $bundleSha = (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash.ToLowerInvariant()
    } finally { Pop-Location }

    $null = Remote "true"
    $liveImage = Remote-Image $liveContainer
    $liveHealth = Remote "curl -fsS http://127.0.0.1:3002/health"
    if (($liveHealth | ConvertFrom-Json).status -ne "ok") { throw "V1 health check failed before deployment." }
    $portOwner = Remote "sudo ss -ltn '( sport = :3003 )' | tail -n +2"
    $stageExists = (Remote ("sudo docker ps -a --format " + (Quote-Sh '{{.Names}}') + " --filter " + (Quote-Sh "name=^/$container$") )) -eq $container
    if (-not $stageExists -and $portOwner) { throw "Port 3003 is already occupied." }
    if ($stageExists) {
        $previousImage = Remote-Image $container
        $previousDeployDirectory = Remote ("sudo docker inspect --format " + (Quote-Sh '{{index .Config.Labels "com.docker.compose.project.working_dir"}}') + " " + (Quote-Sh $container))
        if ($previousDeployDirectory -notmatch '^/home/ubuntu/mindspeed-config-mcp-v2-\d{8}-\d{6}/deploy$') {
            throw "Unexpected V2 compose directory: $previousDeployDirectory"
        }
        $null = Remote ("sudo docker tag " + (Quote-Sh $previousImage) + " " + (Quote-Sh "mindspeed-config-mcp-v2:rollback-$releaseId"))
    }

    $release = "$($RemoteBase.TrimEnd('/'))/mindspeed-config-mcp-v2-$releaseId"
    $deploy = "$release/deploy"
    $remoteBundles = "$($RemoteBase.TrimEnd('/'))/.mindspeed-config-mcp-v2-releases"
    $remoteBundle = "$remoteBundles/$(Split-Path -Leaf $bundle)"
    $null = Remote ("install -d -m 700 " + (Quote-Sh $remoteBundles) + " && test ! -e " + (Quote-Sh $release))
    $null = Run "scp.exe" ($sshArgs + @($bundle, "${SshHost}:$remoteBundle"))
    $remoteSha = ((Remote ("sha256sum " + (Quote-Sh $remoteBundle))) -split '\s+')[0].ToLowerInvariant()
    if ($remoteSha -ne $bundleSha) { throw "Uploaded bundle SHA-256 mismatch." }
    $null = Remote ("git clone --quiet --branch main --single-branch " + (Quote-Sh $remoteBundle) + " " + (Quote-Sh $release))
    if ((Remote ("git -C " + (Quote-Sh $release) + " rev-parse HEAD")) -ne $commit) { throw "Remote checkout differs from $commit." }

    $envSource = if ($stageExists) { "$previousDeployDirectory/.env.v2" } else { "$($RemoteBase.TrimEnd('/'))/mindspeed-config-mcp/deploy/.env" }
    $null = Remote ("test -f " + (Quote-Sh $envSource) + " && install -m 600 " + (Quote-Sh $envSource) + " " + (Quote-Sh "$deploy/.env.v2"))
    $compose = "cd " + (Quote-Sh $deploy) + " && sudo env MCP_V2_COMMIT=$commit docker compose -f compose.v2.yaml --env-file .env.v2"
    $null = Remote "$compose config --quiet"
    $null = Remote "$compose build --pull"
    $builtImage = Remote ("sudo docker image inspect --format " + (Quote-Sh '{{.Id}}') + " " + (Quote-Sh $image))
    $null = Remote "$compose up -d --no-build"
    $startedNewContainer = $true
    Wait-Healthy $builtImage

    $health = Remote "curl -fsS http://127.0.0.1:3003/mindspeed-config-v2/health"
    if (($health | ConvertFrom-Json).status -ne "ok") { throw "V2 health check failed." }
    $unauthorized = Remote "curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3003/mindspeed-config-v2/mcp"
    if ($unauthorized -ne "401") { throw "Unauthenticated V2 MCP returned $unauthorized, expected 401." }
    $revision = Remote ("sudo docker image inspect --format " + (Quote-Sh '{{index .Config.Labels "org.opencontainers.image.revision"}}') + " " + (Quote-Sh $builtImage))
    if ($revision -ne $commit) { throw "V2 image revision label mismatch." }
    $v1ImageAfter = Remote-Image $liveContainer
    if ($liveImage -ne $v1ImageAfter) { throw "V1 container image changed during V2 deployment." }
    if (((Remote "curl -fsS http://127.0.0.1:3002/health") | ConvertFrom-Json).status -ne "ok") { throw "V1 health check failed after deployment." }

    $nginxSnippet = "/etc/nginx/snippets/mindspeed-config-v2.conf"
    $nginxParent = "/etc/nginx/snippets/mindspeed-config.conf"
    $include = "include $nginxSnippet;"
    $null = Run "scp.exe" ($sshArgs + @((Join-Path $root "deploy/nginx-mindspeed-config-v2.conf.example"), "${SshHost}:$deploy/nginx-v2.conf"))
    $null = Remote ("sudo install -m 644 " + (Quote-Sh "$deploy/nginx-v2.conf") + " " + (Quote-Sh $nginxSnippet))
    $hasInclude = Remote ("sudo grep -Fqx " + (Quote-Sh $include) + " " + (Quote-Sh $nginxParent) + " && echo yes || echo no")
    if ($hasInclude -ne "yes") {
        $null = Remote ("printf '%s\n' " + (Quote-Sh $include) + " | sudo tee -a " + (Quote-Sh $nginxParent) + " > /dev/null")
    }
    try {
        $null = Remote "sudo nginx -t && sudo systemctl reload nginx"
    } catch {
        if ($hasInclude -ne "yes") {
            $null = Remote ("sudo sed -i " + (Quote-Sh "\|^include $nginxSnippet;$|d") + " " + (Quote-Sh $nginxParent))
        }
        $null = Remote ("sudo rm -f " + (Quote-Sh $nginxSnippet) + " && sudo nginx -t")
        throw
    }

    [PSCustomObject]@{
        stage_url = "https://42.192.111.92/mindspeed-config-v2/"
        mcp_url = "https://42.192.111.92/mindspeed-config-v2/mcp"
        commit = $commit
        release_directory = $release
        image_id = $builtImage
        health = ($health | ConvertFrom-Json).status
        tool_count = ($health | ConvertFrom-Json).tools
        unauthenticated_mcp_status = [int]$unauthorized
        v1_image_unchanged = $true
    }
} catch {
    $failure = $_
    if ($startedNewContainer -and $previousImage -and $previousDeployDirectory) {
        try {
            $null = Remote ("sudo docker tag " + (Quote-Sh $previousImage) + " " + (Quote-Sh $image))
            $rollback = "cd " + (Quote-Sh $previousDeployDirectory) + " && sudo env MCP_V2_COMMIT=rollback docker compose -f compose.v2.yaml --env-file .env.v2 up -d --no-build"
            $null = Remote $rollback
            Wait-Healthy $previousImage
        } catch { throw "V2 deployment failed: $($failure.Exception.Message); V2 rollback also failed: $($_.Exception.Message)" }
    }
    throw $failure
} finally {
    if ($tempDirectory -and (Test-Path -LiteralPath $tempDirectory)) {
        $resolved = [IO.Path]::GetFullPath($tempDirectory)
        $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved) -match '^mindspeed-v2-[0-9a-f]{32}$') {
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
}
