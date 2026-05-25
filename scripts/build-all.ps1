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
$windowsPackageDir = Join-Path $releaseRoot ("windows-package/" + $Runtime)
$windowsPackageAgentDir = Join-Path $windowsPackageDir "agent"
$windowsPackageDesktopDir = Join-Path $windowsPackageDir "desktop-tauri"
$windowsPackageConfigDir = Join-Path $windowsPackageDir "config"
$windowsPackageReadme = Join-Path $windowsPackageDir "README.txt"
$windowsPackageDefaults = Join-Path $windowsPackageConfigDir "agent-defaults.env"

$desktopWebDist = Join-Path $repoRoot "apps/desktop/dist"
$ipadWebDist = Join-Path $repoRoot "apps/ipad/dist"
$desktopTauriTargetDir = Join-Path $desktopTauriDir ("target/" + $Configuration.ToLowerInvariant())
$desktopTauriBundleDir = Join-Path $desktopTauriTargetDir "bundle"
$desktopTauriExecutable = Join-Path $desktopTauriTargetDir "ceryx-desktop.exe"

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

Invoke-Step -Name "Stage Windows release package" -Script {
    if (Test-Path $windowsPackageDir) {
        Remove-Item -LiteralPath $windowsPackageDir -Recurse -Force
    }

    [void](New-Item -ItemType Directory -Path $windowsPackageAgentDir -Force)
    [void](New-Item -ItemType Directory -Path $windowsPackageDesktopDir -Force)
    [void](New-Item -ItemType Directory -Path $windowsPackageConfigDir -Force)

    Copy-Item -Path (Join-Path $agentPublishDir "*") -Destination $windowsPackageAgentDir -Recurse -Force

    if (-not $SkipDesktopTauri) {
        if ((Test-Path $desktopTauriBundleDir) -and
            (Get-ChildItem -Path $desktopTauriBundleDir -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) {
            Copy-Item -Path (Join-Path $desktopTauriBundleDir "*") -Destination $windowsPackageDesktopDir -Recurse -Force
        }
        elseif (Test-Path $desktopTauriExecutable) {
            Copy-Item -Path $desktopTauriExecutable -Destination (Join-Path $windowsPackageDesktopDir "ceryx-desktop.exe") -Force
        }
    }

    $defaultsContent = @(
        "# Ceryx Windows Agent defaults",
        "# Copy to a local .env file before first launch if you need explicit overrides.",
        "CERYX_REPO_ROOT=$repoRoot",
        "CERYX_AGENT_ROOT=$repoRoot\\.workspace-data\\agent",
        "CERYX_HTTP_PORT=41527"
    )
    Set-Content -Path $windowsPackageDefaults -Value $defaultsContent

    $readmeContent = @(
        "Ceryx v0.3 Windows package ($Runtime)",
        "",
        "agent\\",
        "  Self-contained Windows Agent publish output.",
        "desktop-tauri\\",
        "  Desktop Tauri bundle output (if build step is enabled).",
        "config\\agent-defaults.env",
        "  Default environment values for local first launch."
    )
    Set-Content -Path $windowsPackageReadme -Value $readmeContent
}

Write-Host ""
Write-Host "Build completed."
Write-Host "Artifacts:"
Write-Host "  desktop web dist : $desktopWebDist"
Write-Host "  ipad web dist    : $ipadWebDist"
Write-Host "  desktop tauri    : $desktopTauriBundleDir"
Write-Host "  desktop exe      : $desktopTauriExecutable"
Write-Host "  agent publish    : $agentPublishDir"
Write-Host "  win package      : $windowsPackageDir"
Write-Host "  config defaults  : $windowsPackageDefaults"
