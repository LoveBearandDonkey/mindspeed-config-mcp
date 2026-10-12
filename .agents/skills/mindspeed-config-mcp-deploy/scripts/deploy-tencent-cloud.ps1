[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [string]$SshHost = "ubuntu@42.192.111.92",
    [string]$SshKey = (Join-Path $env:USERPROFILE ".ssh\mindspeed_config_mcp"),
    [string]$RemoteBase = "/home/ubuntu",
    [string]$ContainerName = "mindspeed-config-mcp",
    [int]$HealthAttempts = 12,
    [int]$HealthDelaySeconds = 5,
    [switch]$SkipLocalVerify
)

$ErrorActionPreference = "Stop"
$script:CommonSshArguments = @(
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=15",
    "-o", "IdentitiesOnly=yes",
    "-i", $SshKey
)

function ConvertTo-PosixLiteral {
    param([Parameter(Mandatory)][string]$Value)
    return "'" + $Value.Replace("'", "'`"'`"'") + "'"
}

function Invoke-NativeChecked {
    param(
        [Parameter(Mandatory)][string]$Command,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$FailureMessage
    )
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code $LASTEXITCODE)."
    }
}

function Invoke-NativeText {
    param(
        [Parameter(Mandatory)][string]$Command,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$FailureMessage
    )
    $output = @(& $Command @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        $detail = ($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
        throw "$FailureMessage (exit code $LASTEXITCODE).`n$detail"
    }
    return (($output | ForEach-Object { $_.ToString() }) -join "`n").Trim()
}

function Invoke-SshChecked {
    param([Parameter(Mandatory)][string]$RemoteCommand)
    Invoke-NativeChecked -Command "ssh.exe" -Arguments ($script:CommonSshArguments + @($SshHost, $RemoteCommand)) -FailureMessage "Remote command failed"
}

function Invoke-SshText {
    param([Parameter(Mandatory)][string]$RemoteCommand)
    return Invoke-NativeText -Command "ssh.exe" -Arguments ($script:CommonSshArguments + @($SshHost, $RemoteCommand)) -FailureMessage "Remote command failed"
}

function Get-RemoteContainer {
    $quotedContainer = ConvertTo-PosixLiteral $ContainerName
    $stateJson = Invoke-SshText -RemoteCommand ("sudo docker inspect --format " + (ConvertTo-PosixLiteral '{{json .State}}') + " " + $quotedContainer)
    $imageId = Invoke-SshText -RemoteCommand ("sudo docker inspect --format " + (ConvertTo-PosixLiteral '{{.Image}}') + " " + $quotedContainer)
    $labelsJson = Invoke-SshText -RemoteCommand ("sudo docker inspect --format " + (ConvertTo-PosixLiteral '{{json .Config.Labels}}') + " " + $quotedContainer)
    $labels = $labelsJson | ConvertFrom-Json
    [PSCustomObject]@{
        State = $stateJson | ConvertFrom-Json
        Image = $imageId
        WorkingDirectory = [string]$labels.'com.docker.compose.project.working_dir'
    }
}

function Wait-RemoteHealthy {
    param([Parameter(Mandatory)][string]$ExpectedImageId)
    for ($attempt = 1; $attempt -le $HealthAttempts; $attempt++) {
        try {
            $container = Get-RemoteContainer
            $health = if ($null -ne $container.State.Health) { [string]$container.State.Health.Status } else { "missing" }
            if ($container.State.Status -eq "running" -and $health -eq "healthy" -and $container.Image -eq $ExpectedImageId) {
                return $container
            }
        } catch {
            if ($attempt -eq $HealthAttempts) { throw }
        }
        if ($attempt -lt $HealthAttempts) {
            Start-Sleep -Seconds $HealthDelaySeconds
        }
    }
    throw "Container did not become healthy on image $ExpectedImageId after $HealthAttempts attempts."
}

foreach ($command in @("git.exe", "ssh.exe", "scp.exe")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Command not found: $command"
    }
}
if (-not (Test-Path -LiteralPath $SshKey -PathType Leaf)) {
    throw "SSH key not found: $SshKey"
}
if ($HealthAttempts -lt 1 -or $HealthDelaySeconds -lt 1) {
    throw "HealthAttempts and HealthDelaySeconds must both be positive."
}

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\..\.."))
} else {
    $ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
}
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "package.json") -PathType Leaf)) {
    throw "MindSpeed Config MCP project not found: $ProjectRoot"
}

$tempDirectory = $null
$switched = $false
$previousDeployDirectory = $null
$previousImageId = $null
$rollbackTag = $null
$newDeployDirectory = $null
try {
    Push-Location $ProjectRoot
    try {
        $repositoryRoot = Invoke-NativeText -Command "git.exe" -Arguments @("rev-parse", "--show-toplevel") -FailureMessage "Cannot resolve repository root"
        if ([IO.Path]::GetFullPath($repositoryRoot) -ne $ProjectRoot) {
            throw "ProjectRoot must be the repository root: $repositoryRoot"
        }

        Invoke-NativeChecked -Command "git.exe" -Arguments @("diff", "--quiet") -FailureMessage "Tracked worktree changes block deployment"
        Invoke-NativeChecked -Command "git.exe" -Arguments @("diff", "--cached", "--quiet") -FailureMessage "Staged changes block deployment"
        $untracked = @(Invoke-NativeText -Command "git.exe" -Arguments @("-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard") -FailureMessage "Cannot inspect untracked files" -ErrorAction SilentlyContinue) -split "`n" |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and $_ -notmatch '^\.tmp(?:-|/)' }
        if ($untracked.Count -gt 0) {
            throw "Untracked release inputs block deployment:`n$($untracked -join "`n")"
        }

        $branch = Invoke-NativeText -Command "git.exe" -Arguments @("symbolic-ref", "--short", "HEAD") -FailureMessage "Deployment requires a named branch"
        if ($branch -ne "main") {
            throw "Deployment requires branch main; current branch is $branch."
        }
        $commit = Invoke-NativeText -Command "git.exe" -Arguments @("rev-parse", "HEAD") -FailureMessage "Cannot resolve HEAD"
        Invoke-NativeChecked -Command "git.exe" -Arguments @("fetch", "origin", "main") -FailureMessage "Cannot refresh origin/main"
        $remoteCommit = Invoke-NativeText -Command "git.exe" -Arguments @("rev-parse", "origin/main") -FailureMessage "Cannot resolve origin/main"
        if ($commit -ne $remoteCommit) {
            throw "HEAD $commit is not the pushed origin/main $remoteCommit. Commit and push the intended version first."
        }

        if (-not $SkipLocalVerify) {
            $packageScript = Join-Path $ProjectRoot ".agents\skills\mindspeed-config-mcp-package\scripts\package-ui.ps1"
            if (-not (Test-Path -LiteralPath $packageScript -PathType Leaf)) {
                throw "Packaging skill script not found: $packageScript"
            }
            & $packageScript -ProjectRoot $ProjectRoot -FullVerify
            if ($LASTEXITCODE -ne 0) { throw "Local full verification failed with exit code $LASTEXITCODE." }
        }

        $artifactDirectory = Join-Path $ProjectRoot "apps\mcp-server\ui\dist\ui-shell-v1\training-run-twin-standalone"
        $artifacts = @(Get-ChildItem -LiteralPath $artifactDirectory -File | Where-Object { $_.Name -match '^config-relation-plane-mindspeed-config-mcp-\d{8}-\d{6}\.html$' })
        if ($artifacts.Count -ne 1) {
            throw "Expected exactly one local packaged HTML; found $($artifacts.Count)."
        }
        $localArtifact = $artifacts[0]
        $localArtifactHash = (Get-FileHash -LiteralPath $localArtifact.FullName -Algorithm SHA256).Hash.ToLowerInvariant()

        $releaseId = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, "China Standard Time").ToString("yyyyMMdd-HHmmss")
        $tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ("mindspeed-config-mcp-deploy-" + [guid]::NewGuid().ToString("N"))
        $null = New-Item -ItemType Directory -Path $tempDirectory
        $bundlePath = Join-Path $tempDirectory "mindspeed-config-mcp-$commit.bundle"
        Invoke-NativeChecked -Command "git.exe" -Arguments @("bundle", "create", $bundlePath, "main") -FailureMessage "Cannot create Git bundle"
        Invoke-NativeChecked -Command "git.exe" -Arguments @("bundle", "verify", $bundlePath) -FailureMessage "Git bundle verification failed"
        $bundleHash = (Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash.ToLowerInvariant()
    } finally {
        Pop-Location
    }

    Invoke-SshChecked -RemoteCommand "true"
    $previousContainer = Get-RemoteContainer
    $previousImageId = [string]$previousContainer.Image
    $previousDeployDirectory = [string]$previousContainer.WorkingDirectory
    $safeBase = [regex]::Escape($RemoteBase.TrimEnd('/'))
    if ($previousDeployDirectory -notmatch "^$safeBase/mindspeed-config-mcp(?:-\d{8}-\d{6})?/deploy$") {
        throw "Refusing unexpected remote compose directory: $previousDeployDirectory"
    }

    $remoteBundleDirectory = "$($RemoteBase.TrimEnd('/'))/.mindspeed-config-mcp-releases"
    $remoteBundle = "$remoteBundleDirectory/$(Split-Path -Leaf $bundlePath)"
    $remoteRelease = "$($RemoteBase.TrimEnd('/'))/mindspeed-config-mcp-$releaseId"
    $newDeployDirectory = "$remoteRelease/deploy"
    $rollbackTag = "mindspeed-config-mcp:rollback-$releaseId"

    Invoke-SshChecked -RemoteCommand ("install -d -m 700 -- " + (ConvertTo-PosixLiteral $remoteBundleDirectory))
    Invoke-SshChecked -RemoteCommand ("test ! -e " + (ConvertTo-PosixLiteral $remoteRelease))
    Invoke-NativeChecked -Command "scp.exe" -Arguments ($script:CommonSshArguments + @($bundlePath, "${SshHost}:$remoteBundle")) -FailureMessage "Cannot upload Git bundle"
    $remoteBundleHashOutput = Invoke-SshText -RemoteCommand ("sha256sum -- " + (ConvertTo-PosixLiteral $remoteBundle))
    $remoteBundleHash = ($remoteBundleHashOutput -split '\s+')[0].ToLowerInvariant()
    if ($remoteBundleHash -ne $bundleHash) {
        throw "Uploaded bundle SHA-256 mismatch: local=$bundleHash remote=$remoteBundleHash"
    }

    Invoke-SshChecked -RemoteCommand ("git clone --quiet --branch main --single-branch " + (ConvertTo-PosixLiteral $remoteBundle) + " " + (ConvertTo-PosixLiteral $remoteRelease))
    $deployedCommit = Invoke-SshText -RemoteCommand ("git -C " + (ConvertTo-PosixLiteral $remoteRelease) + " rev-parse HEAD")
    if ($deployedCommit -ne $commit) {
        throw "Remote checkout mismatch: expected=$commit actual=$deployedCommit"
    }
    Invoke-SshChecked -RemoteCommand ("install -m 600 " + (ConvertTo-PosixLiteral "$previousDeployDirectory/.env") + " " + (ConvertTo-PosixLiteral "$newDeployDirectory/.env"))
    Invoke-SshChecked -RemoteCommand ("cd " + (ConvertTo-PosixLiteral $newDeployDirectory) + " && sudo docker compose --env-file .env config --quiet")
    Invoke-SshChecked -RemoteCommand ("sudo docker tag " + (ConvertTo-PosixLiteral $previousImageId) + " " + (ConvertTo-PosixLiteral $rollbackTag))
    Invoke-SshChecked -RemoteCommand ("cd " + (ConvertTo-PosixLiteral $newDeployDirectory) + " && sudo docker compose --env-file .env build --pull")

    $builtImageId = Invoke-SshText -RemoteCommand ("sudo docker image inspect --format " + (ConvertTo-PosixLiteral '{{.Id}}') + " mindspeed-config-mcp:0.1.0")
    if ([string]::IsNullOrWhiteSpace($builtImageId)) {
        throw "Cannot resolve the newly built image ID."
    }

    Invoke-SshChecked -RemoteCommand ("cd " + (ConvertTo-PosixLiteral $newDeployDirectory) + " && sudo docker compose --env-file .env up -d --no-build")
    $switched = $true
    $null = Wait-RemoteHealthy -ExpectedImageId $builtImageId

    $healthJson = Invoke-SshText -RemoteCommand "curl -fsS http://127.0.0.1:3002/health"
    $health = $healthJson | ConvertFrom-Json
    if ($health.status -ne "ok") {
        throw "Unexpected /health response: $healthJson"
    }
    $unauthorizedStatus = Invoke-SshText -RemoteCommand "curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3002/mcp"
    if ($unauthorizedStatus -ne "401") {
        throw "Unauthenticated /mcp returned $unauthorizedStatus instead of 401."
    }

    $containerArtifactOutput = Invoke-SshText -RemoteCommand ("sudo docker exec " + (ConvertTo-PosixLiteral $ContainerName) + " find /app/apps/mcp-server/ui/dist/ui-shell-v1/training-run-twin-standalone -maxdepth 1 -type f -name 'config-relation-plane-mindspeed-config-mcp-*.html'")
    $containerArtifacts = @($containerArtifactOutput -split "`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($containerArtifacts.Count -ne 1) {
        throw "Expected exactly one packaged HTML in the container; found $($containerArtifacts.Count)."
    }
    $containerArtifact = $containerArtifacts[0]
    if ($containerArtifact -notmatch '^/app/apps/mcp-server/ui/dist/ui-shell-v1/training-run-twin-standalone/config-relation-plane-mindspeed-config-mcp-\d{8}-\d{6}\.html$') {
        throw "Unexpected container artifact path: $containerArtifact"
    }
    $containerHashOutput = Invoke-SshText -RemoteCommand ("sudo docker exec " + (ConvertTo-PosixLiteral $ContainerName) + " sha256sum " + (ConvertTo-PosixLiteral $containerArtifact))
    $containerHash = ($containerHashOutput -split '\s+')[0].ToLowerInvariant()
    $containerBytes = Invoke-SshText -RemoteCommand ("sudo docker exec " + (ConvertTo-PosixLiteral $ContainerName) + " wc -c " + (ConvertTo-PosixLiteral $containerArtifact))
    $containerByteCount = [long](($containerBytes -split '\s+')[0])

    [PSCustomObject]@{
        release_id = $releaseId
        commit = $commit
        release_directory = $remoteRelease
        image_id = $builtImageId
        rollback_image = $rollbackTag
        health = [string]$health.status
        tool_count = $health.tools
        unauthenticated_mcp_status = [int]$unauthorizedStatus
        local_artifact = $localArtifact.Name
        local_artifact_sha256 = $localArtifactHash
        container_artifact = Split-Path -Leaf $containerArtifact
        container_artifact_bytes = $containerByteCount
        container_artifact_sha256 = $containerHash
    }
} catch {
    $deploymentError = $_
    if ($switched -and $null -ne $previousImageId -and $null -ne $previousDeployDirectory) {
        try {
            Write-Warning "Post-switch verification failed. Restoring image $previousImageId from $previousDeployDirectory."
            Invoke-SshChecked -RemoteCommand ("sudo docker tag " + (ConvertTo-PosixLiteral $previousImageId) + " mindspeed-config-mcp:0.1.0")
            Invoke-SshChecked -RemoteCommand ("cd " + (ConvertTo-PosixLiteral $previousDeployDirectory) + " && sudo docker compose --env-file .env up -d --no-build")
            $null = Wait-RemoteHealthy -ExpectedImageId $previousImageId
        } catch {
            throw "Deployment failed: $($deploymentError.Exception.Message)`nRollback also failed: $($_.Exception.Message)"
        }
    }
    throw $deploymentError
} finally {
    if ($null -ne $tempDirectory -and (Test-Path -LiteralPath $tempDirectory)) {
        $resolvedTemp = [IO.Path]::GetFullPath($tempDirectory)
        $systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        if ($resolvedTemp.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedTemp) -match '^mindspeed-config-mcp-deploy-[0-9a-f]{32}$') {
            Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
        }
    }
}
