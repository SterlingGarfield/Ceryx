Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "use-disk-boundary.ps1") -Quiet

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$reportDir = Join-Path $repoRoot ".workspace-data"
[void](New-Item -ItemType Directory -Path $reportDir -Force)
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$reportPath = Join-Path $reportDir "migration-report-$timestamp.md"

$results = [System.Collections.Generic.List[object]]::new()

function Copy-DirectoryIfExists([string]$source, [string]$target, [string]$name) {
    if (-not (Test-Path $source)) {
        $results.Add([pscustomobject]@{
                Name   = $name
                Source = $source
                Target = $target
                Status = "Skipped (source not found)"
                Error  = ""
            })
        return
    }

    [void](New-Item -ItemType Directory -Path $target -Force)

    try {
        Copy-Item -Path (Join-Path $source "*") -Destination $target -Recurse -Force -ErrorAction Stop
        $results.Add([pscustomobject]@{
                Name   = $name
                Source = $source
                Target = $target
                Status = "Copied"
                Error  = ""
            })
    }
    catch {
        $results.Add([pscustomobject]@{
                Name   = $name
                Source = $source
                Target = $target
                Status = "Failed"
                Error  = $_.Exception.Message
            })
    }
}

$legacyAgentSource = Join-Path $env:LOCALAPPDATA "Ceryx"
$legacyNugetPackages = Join-Path $env:USERPROFILE ".nuget\\packages"
$legacyNugetV3Cache = Join-Path $env:LOCALAPPDATA "NuGet\\v3-cache"
$legacyNugetPlugins = Join-Path $env:LOCALAPPDATA "NuGet\\plugins-cache"
$legacyCorepack = Join-Path $env:LOCALAPPDATA "node\\corepack"
$legacyNpmCache = Join-Path $env:LOCALAPPDATA "npm-cache"
$legacyPnpmStore = Join-Path $env:LOCALAPPDATA "pnpm\\store"

Copy-DirectoryIfExists $legacyAgentSource $env:CERYX_AGENT_ROOT "Agent runtime data"
Copy-DirectoryIfExists $legacyNugetPackages $env:NUGET_PACKAGES "NuGet global-packages"
Copy-DirectoryIfExists $legacyNugetV3Cache $env:NUGET_HTTP_CACHE_PATH "NuGet v3-cache"
Copy-DirectoryIfExists $legacyNugetPlugins $env:NUGET_PLUGINS_CACHE_PATH "NuGet plugins-cache"
Copy-DirectoryIfExists $legacyCorepack $env:COREPACK_HOME "Corepack home"
Copy-DirectoryIfExists $legacyNpmCache $env:NPM_CONFIG_CACHE "npm cache"
Copy-DirectoryIfExists $legacyPnpmStore $env:PNPM_STORE_DIR "pnpm store"

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("# Ceryx Migration Report")
$lines.Add("")
$lines.Add("- Time: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")")
$lines.Add("- Repo Root: $repoRoot")
$lines.Add("- Strategy: copy-only, source retained")
$lines.Add("")
$lines.Add("| Item | Source | Target | Status | Error |")
$lines.Add("| --- | --- | --- | --- | --- |")

foreach ($item in $results) {
    $escapedError = ($item.Error -replace "\|", "/")
    $lines.Add("| $($item.Name) | $($item.Source) | $($item.Target) | $($item.Status) | $escapedError |")
}

$lines | Set-Content -Path $reportPath -Encoding UTF8

Write-Host "[disk-boundary] migration report: $reportPath"

& (Join-Path $PSScriptRoot "check-disk-boundary.ps1")
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

exit 0
