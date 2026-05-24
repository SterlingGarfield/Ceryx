param(
    [string]$BaseUrl = "http://127.0.0.1:41527",
    [string]$Token = "",
    [int]$TimeoutSeconds = 8
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

function Invoke-JsonGet {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Uri,
        [hashtable]$Headers = @{}
    )

    return Invoke-RestMethod -Method Get -Uri $Uri -Headers $Headers -TimeoutSec $TimeoutSeconds
}

Write-Host "Running Agent API smoke checks..."
Write-Host "  baseUrl   : $BaseUrl"
Write-Host "  repoRoot  : $repoRoot"

Invoke-SmokeStep -Name "GET /api/v1/health" -Action {
    $health = Invoke-JsonGet -Uri ($BaseUrl.TrimEnd("/") + "/api/v1/health")
    if (-not $health.ok) {
        throw "health.ok is false."
    }

    if ([string]::IsNullOrWhiteSpace($health.service)) {
        throw "health.service is empty."
    }
}

Invoke-SmokeStep -Name "GET /api/v1/agent/status" -Action {
    $headers = @{
        Authorization = "Bearer $Token"
    }

    $status = Invoke-JsonGet -Uri ($BaseUrl.TrimEnd("/") + "/api/v1/agent/status") -Headers $headers
    if ([string]::IsNullOrWhiteSpace($status.agentVersion)) {
        throw "status.agentVersion is empty."
    }

    if ([string]::IsNullOrWhiteSpace($status.status)) {
        throw "status.status is empty."
    }
}

Write-Host ""
Write-Host "Smoke result: PASS"
