param(
    [ValidateSet("dev", "prod")]
    [string]$DesktopMode = "prod",
    [string]$BaseUrl = "http://127.0.0.1:41527",
    [int]$DesktopPort = 4173,
    [string]$Token = "",
    [int]$TimeoutSeconds = 40
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
. (Join-Path $PSScriptRoot "use-disk-boundary.ps1") -Quiet

if ([string]::IsNullOrWhiteSpace($Token)) {
    $Token = [Environment]::GetEnvironmentVariable("CERYX_SMOKE_TOKEN")
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    throw "Missing token. Provide -Token or set CERYX_SMOKE_TOKEN for /api/v1/agent/status verification."
}

function Wait-HttpReady {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [hashtable]$Headers = @{},
        [int]$Timeout = 15
    )

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($Timeout)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $Url -Headers $Headers -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    throw "$Name not ready within $Timeout seconds: $Url"
}

function Invoke-SmokeStep {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        & $Action
        $watch.Stop()
        Write-Host "[PASS] $Name ($($watch.ElapsedMilliseconds) ms)"
    }
    catch {
        $watch.Stop()
        Write-Host "[FAIL] $Name ($($watch.ElapsedMilliseconds) ms)"
        throw
    }
}

$pwshPath = (Get-Command pwsh).Source
$agentProcess = $null
$desktopProcess = $null
$runStamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
$desktopLogPath = Join-Path $repoRoot ".workspace-data/smoke/desktop-$DesktopMode-$DesktopPort-$runStamp.log"
$desktopErrPath = Join-Path $repoRoot ".workspace-data/smoke/desktop-$DesktopMode-$DesktopPort-$runStamp.err.log"
$agentStartedByScript = $false

try {
    Write-Host "Running local Desktop smoke checks..."
    Write-Host "  desktopMode : $DesktopMode"
    Write-Host "  baseUrl     : $BaseUrl"
    Write-Host "  desktopUrl  : http://127.0.0.1:$DesktopPort"
    Write-Host "  repoRoot    : $repoRoot"

    $healthUrl = $BaseUrl.TrimEnd("/") + "/api/v1/health"
    $statusUrl = $BaseUrl.TrimEnd("/") + "/api/v1/agent/status"

    try {
        Wait-HttpReady -Name "Agent health endpoint" -Url $healthUrl -Timeout 3
    }
    catch {
        $agentProject = Join-Path $repoRoot "agent/windows/src/Ceryx.Agent.App/Ceryx.Agent.App.csproj"
        $agentPublishedExe = Join-Path $repoRoot ".workspace-data/release/v0.3/agent/win-x64/Ceryx.Agent.App.exe"
        if (Test-Path $agentPublishedExe) {
            Write-Host "Agent not ready. Starting with published executable..."
            $agentProcess = Start-Process -FilePath $agentPublishedExe -WindowStyle Hidden -PassThru
        }
        else {
            Write-Host "Agent not ready. Starting with dotnet run..."
            $agentProcess = Start-Process -FilePath $pwshPath -ArgumentList @(
                "-NoProfile",
                "-Command",
                "dotnet run --project `"$agentProject`""
            ) -WindowStyle Hidden -PassThru
        }
        $agentStartedByScript = $true
        Wait-HttpReady -Name "Agent health endpoint" -Url $healthUrl -Timeout $TimeoutSeconds
    }

    Invoke-SmokeStep -Name "GET /api/v1/health" -Action {
        $health = Invoke-RestMethod -Method Get -Uri $healthUrl -TimeoutSec 5
        if (-not $health.ok) {
            throw "health.ok is false."
        }
    }

    Invoke-SmokeStep -Name "GET /api/v1/agent/status" -Action {
        $headers = @{ Authorization = "Bearer $Token" }
        $status = Invoke-RestMethod -Method Get -Uri $statusUrl -Headers $headers -TimeoutSec 5
        if ([string]::IsNullOrWhiteSpace($status.status)) {
            throw "status.status is empty."
        }
    }

    if ($DesktopMode -eq "prod") {
        $desktopDist = Join-Path $repoRoot "apps/desktop/dist/index.html"
        if (-not (Test-Path $desktopDist)) {
            Write-Host "Desktop dist missing. Building @ceryx/desktop..."
            & corepack pnpm --filter @ceryx/desktop build
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to build @ceryx/desktop for prod smoke mode."
            }
        }

        $desktopCommand = "corepack pnpm --filter @ceryx/desktop exec vite preview --host 127.0.0.1 --port $DesktopPort --strictPort"
    }
    else {
        $desktopCommand = "corepack pnpm --filter @ceryx/desktop dev -- --host 127.0.0.1 --port $DesktopPort --strictPort"
    }

    Write-Host "Starting desktop web shell ($DesktopMode)..."
    [void](New-Item -ItemType Directory -Path (Split-Path -Parent $desktopLogPath) -Force)
    $desktopProcess = Start-Process -FilePath $pwshPath -ArgumentList @(
        "-NoProfile",
        "-Command",
        $desktopCommand
    ) -WindowStyle Hidden -PassThru -RedirectStandardOutput $desktopLogPath -RedirectStandardError $desktopErrPath

    $desktopUrl = "http://127.0.0.1:$DesktopPort/"
    try {
        Wait-HttpReady -Name "Desktop shell" -Url $desktopUrl -Timeout $TimeoutSeconds
    }
    catch {
        if (Test-Path $desktopLogPath) {
            Write-Host "Desktop shell log tail:"
            Get-Content -Path $desktopLogPath -Tail 40
        }
        if (Test-Path $desktopErrPath) {
            Write-Host "Desktop shell error log tail:"
            Get-Content -Path $desktopErrPath -Tail 40
        }

        throw
    }

    Invoke-SmokeStep -Name "Desktop shell returns index.html" -Action {
        $response = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $desktopUrl -TimeoutSec 5
        if (-not $response.Content.Contains("<div id=`"root`"></div>")) {
            throw "Desktop index.html root container not found."
        }
    }

    Write-Host ""
    Write-Host "Smoke result: PASS"
}
finally {
    if ($desktopProcess -and -not $desktopProcess.HasExited) {
        Stop-Process -Id $desktopProcess.Id -Force
    }

    if ($agentStartedByScript -and $agentProcess -and -not $agentProcess.HasExited) {
        Stop-Process -Id $agentProcess.Id -Force
    }
}
