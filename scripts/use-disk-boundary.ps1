param(
    [string]$Command,
    [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$workspaceDataRoot = Join-Path $repoRoot ".workspace-data"
$agentRoot = Join-Path $workspaceDataRoot "agent"
$cacheRoot = Join-Path $repoRoot ".cache"

$paths = [ordered]@{
    RepoRoot             = $repoRoot
    WorkspaceDataRoot    = $workspaceDataRoot
    AgentRoot            = $agentRoot
    CacheRoot            = $cacheRoot
    CacheTemp            = (Join-Path $cacheRoot "tmp")
    DotnetCliHome        = (Join-Path $cacheRoot "dotnet-cli-home")
    NugetPackages        = (Join-Path $cacheRoot "nuget/packages")
    NugetHttpCache       = (Join-Path $cacheRoot "nuget/v3-cache")
    NugetPluginsCache    = (Join-Path $cacheRoot "nuget/plugins-cache")
    CorepackHome         = (Join-Path $cacheRoot "corepack")
    PnpmHome             = (Join-Path $cacheRoot "pnpm-home")
    PnpmStoreDir         = (Join-Path $cacheRoot "pnpm-store")
    NpmCache             = (Join-Path $cacheRoot "npm-cache")
    AgentLogs            = (Join-Path $agentRoot "Logs")
    AgentUploads         = (Join-Path $agentRoot "Uploads")
    AgentScreenshots     = (Join-Path $agentRoot "Screenshots")
    AgentRecordings      = (Join-Path $agentRoot "Recordings")
}

foreach ($path in $paths.Values) {
    [void](New-Item -ItemType Directory -Path $path -Force)
}

$env:CERYX_REPO_ROOT = $repoRoot
$env:CERYX_AGENT_ROOT = $paths.AgentRoot

$env:DOTNET_CLI_HOME = $paths.DotnetCliHome
$env:NUGET_PACKAGES = $paths.NugetPackages
$env:NUGET_HTTP_CACHE_PATH = $paths.NugetHttpCache
$env:NUGET_PLUGINS_CACHE_PATH = $paths.NugetPluginsCache

$env:TEMP = $paths.CacheTemp
$env:TMP = $paths.CacheTemp

$env:NPM_CONFIG_CACHE = $paths.NpmCache
$env:COREPACK_HOME = $paths.CorepackHome
$env:PNPM_HOME = $paths.PnpmHome
$env:PNPM_STORE_DIR = $paths.PnpmStoreDir

if (-not $Quiet) {
    Write-Host "[disk-boundary] repoRoot           = $repoRoot"
    Write-Host "[disk-boundary] agentRoot          = $env:CERYX_AGENT_ROOT"
    Write-Host "[disk-boundary] dotnetCliHome      = $env:DOTNET_CLI_HOME"
    Write-Host "[disk-boundary] nugetPackages      = $env:NUGET_PACKAGES"
    Write-Host "[disk-boundary] npmCache           = $env:NPM_CONFIG_CACHE"
    Write-Host "[disk-boundary] corepackHome       = $env:COREPACK_HOME"
    Write-Host "[disk-boundary] pnpmStoreDir       = $env:PNPM_STORE_DIR"
    Write-Host "[disk-boundary] temp               = $env:TEMP"
}

if (-not [string]::IsNullOrWhiteSpace($Command)) {
    if (-not $Quiet) {
        Write-Host "[disk-boundary] executing: $Command"
    }

    Invoke-Expression $Command
    exit $LASTEXITCODE
}
