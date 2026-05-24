param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",
    [string]$Runtime = "win-x64",
    [switch]$SkipDesktopTauri
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
. (Join-Path $PSScriptRoot "use-disk-boundary.ps1") -Quiet

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Script
    )

    Write-Host ""
    Write-Host "==> $Name"
    & $Script
    if ($LASTEXITCODE -ne 0) {
        throw "Step failed: $Name (exit code: $LASTEXITCODE)"
    }
}

$desktopAppDir = Join-Path $repoRoot "apps/desktop"
$desktopTauriDir = Join-Path $desktopAppDir "src-tauri"
$desktopTauriConfig = Join-Path $desktopTauriDir "tauri.conf.json"
$desktopCargoToml = Join-Path $desktopTauriDir "Cargo.toml"
$desktopTauriCli = Join-Path $desktopAppDir "node_modules/.bin/tauri.CMD"

$agentProject = Join-Path $repoRoot "agent/windows/src/Ceryx.Agent.App/Ceryx.Agent.App.csproj"
$releaseRoot = Join-Path $repoRoot ".workspace-data/release/v0.3"
$agentPublishDir = Join-Path $releaseRoot ("agent/" + $Runtime)

$desktopWebDist = Join-Path $repoRoot "apps/desktop/dist"
$ipadWebDist = Join-Path $repoRoot "apps/ipad/dist"
$desktopTauriBundleDir = Join-Path $desktopTauriDir ("target/" + $Configuration + "/bundle")

Invoke-Step -Name "Build workspace packages and app web bundles" -Script {
    & corepack pnpm build
}

if (-not $SkipDesktopTauri) {
    if (-not (Test-Path $desktopTauriConfig)) {
        throw "Tauri config not found: $desktopTauriConfig"
    }

    if (-not (Test-Path $desktopCargoToml)) {
        throw "Tauri desktop packaging is blocked: missing Cargo manifest at $desktopCargoToml"
    }

    if (-not (Test-Path $desktopTauriCli)) {
        throw "Tauri desktop packaging is blocked: missing CLI at $desktopTauriCli"
    }

    Invoke-Step -Name "Build Desktop Tauri bundle" -Script {
        & corepack pnpm --dir $desktopAppDir exec tauri build --config src-tauri/tauri.conf.json
    }
}
else {
    Write-Warning "Desktop Tauri bundle step skipped by -SkipDesktopTauri."
}

Invoke-Step -Name "Publish Windows Agent" -Script {
    if (-not (Test-Path $agentPublishDir)) {
        [void](New-Item -ItemType Directory -Path $agentPublishDir -Force)
    }

    & dotnet publish $agentProject -c $Configuration -r $Runtime --self-contained true -o $agentPublishDir
}

Write-Host ""
Write-Host "Build completed."
Write-Host "Artifacts:"
Write-Host "  desktop web dist : $desktopWebDist"
Write-Host "  ipad web dist    : $ipadWebDist"
Write-Host "  desktop tauri    : $desktopTauriBundleDir"
Write-Host "  agent publish    : $agentPublishDir"
