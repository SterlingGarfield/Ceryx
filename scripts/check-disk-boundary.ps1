param(
    [switch]$Bootstrap
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Bootstrap) {
    . (Join-Path $PSScriptRoot "use-disk-boundary.ps1") -Quiet
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$repoRootPrefix = $repoRoot.TrimEnd('\') + '\'

$failures = [System.Collections.Generic.List[string]]::new()

function Test-PathWithinRepo([string]$name, [string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) {
        $failures.Add("$name is empty.")
        return
    }

    try {
        $resolved = [System.IO.Path]::GetFullPath($value)
    }
    catch {
        $failures.Add("$name is not a valid path: $value")
        return
    }

    if ($resolved.StartsWith("C:\", [System.StringComparison]::OrdinalIgnoreCase)) {
        $failures.Add("$name resolved to C drive: $resolved")
    }

    $normalized = $resolved.TrimEnd('\') + '\'
    if (-not $normalized.StartsWith($repoRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        $failures.Add("$name is outside repo root: $resolved")
    }
}

Test-PathWithinRepo "CERYX_REPO_ROOT" $env:CERYX_REPO_ROOT
Test-PathWithinRepo "CERYX_AGENT_ROOT" $env:CERYX_AGENT_ROOT
Test-PathWithinRepo "DOTNET_CLI_HOME" $env:DOTNET_CLI_HOME
Test-PathWithinRepo "NUGET_PACKAGES" $env:NUGET_PACKAGES
Test-PathWithinRepo "NUGET_HTTP_CACHE_PATH" $env:NUGET_HTTP_CACHE_PATH
Test-PathWithinRepo "NUGET_PLUGINS_CACHE_PATH" $env:NUGET_PLUGINS_CACHE_PATH
Test-PathWithinRepo "NPM_CONFIG_CACHE" $env:NPM_CONFIG_CACHE
Test-PathWithinRepo "COREPACK_HOME" $env:COREPACK_HOME
Test-PathWithinRepo "PNPM_HOME" $env:PNPM_HOME
Test-PathWithinRepo "PNPM_STORE_DIR" $env:PNPM_STORE_DIR
Test-PathWithinRepo "TEMP" $env:TEMP
Test-PathWithinRepo "TMP" $env:TMP

$dotnetCmd = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnetCmd) {
    $dotnetPath = "C:\Program Files\dotnet\dotnet.exe"
    if (Test-Path $dotnetPath) {
        $dotnetCmd = Get-Command $dotnetPath -ErrorAction SilentlyContinue
    }
}

if ($dotnetCmd) {
    $nugetLocals = & $dotnetCmd.Source nuget locals all --list
    foreach ($line in $nugetLocals) {
        if ($line -match "^\s*([^:]+):\s*(.+)$") {
            $name = $Matches[1].Trim()
            $path = $Matches[2].Trim()
            Test-PathWithinRepo "dotnet.nuget.$name" $path
        }
    }
}
else {
    $failures.Add("dotnet command not found, cannot verify NuGet locals.")
}

$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if ($npmCmd) {
    $npmCache = (& $npmCmd.Source config get cache).Trim()
    if ([string]::IsNullOrWhiteSpace($npmCache) -or $npmCache -eq "undefined" -or $npmCache -eq "null") {
        $failures.Add("npm cache path is undefined.")
    }
    else {
        Test-PathWithinRepo "npm.cache" $npmCache
    }
}
else {
    $failures.Add("npm command not found, cannot verify npm cache.")
}

$pnpmCacheChecked = $false
$pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
if ($pnpmCmd) {
    $pnpmStore = (& $pnpmCmd.Source config get store-dir).Trim()
    if ([string]::IsNullOrWhiteSpace($pnpmStore) -or $pnpmStore -eq "undefined" -or $pnpmStore -eq "null") {
        $failures.Add("pnpm store-dir is undefined.")
    }
    else {
        Test-PathWithinRepo "pnpm.store-dir" $pnpmStore
    }
    $pnpmCacheChecked = $true
}
else {
    $corepackCmd = Get-Command corepack -ErrorAction SilentlyContinue
    if ($corepackCmd) {
        try {
            $pnpmStore = (& $corepackCmd.Source pnpm config get store-dir 2>$null).Trim()
            if (-not [string]::IsNullOrWhiteSpace($pnpmStore) -and $pnpmStore -ne "undefined" -and $pnpmStore -ne "null") {
                Test-PathWithinRepo "corepack.pnpm.store-dir" $pnpmStore
                $pnpmCacheChecked = $true
            }
        }
        catch {
            # fall back to PNPM_STORE_DIR env check only
        }
    }
}

if (-not $pnpmCacheChecked) {
    Test-PathWithinRepo "pnpm.store-dir(env)" $env:PNPM_STORE_DIR
}

if ($failures.Count -gt 0) {
    Write-Host "[disk-boundary] FAILED" -ForegroundColor Red
    foreach ($failure in $failures) {
        Write-Host " - $failure" -ForegroundColor Red
    }
    exit 1
}

Write-Host "[disk-boundary] OK: all checked paths are inside repo root and not on C drive." -ForegroundColor Green
exit 0
