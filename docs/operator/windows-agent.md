# Windows Agent Operator Guide

## Start Agent (development)

```powershell
pnpm dev:agent
```

## Build and publish Agent (release artifact)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-all.ps1
```

Published artifact output:

- `.workspace-data/release/v0.3/agent/win-x64`
- `.workspace-data/release/v0.3/windows-package/win-x64`
  - `agent\`
  - `desktop-tauri\ceryx-desktop.exe`
  - `config\agent-defaults.env`

## Stop Agent

- If running in a terminal, press `Ctrl+C`.
- If started in background, stop the process:

```powershell
Get-Process -Name Ceryx.Agent.App -ErrorAction SilentlyContinue | Stop-Process -Force
```

## Health checks

```powershell
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:41527/api/v1/health
```

## Authenticated status check

```powershell
$headers = @{ Authorization = "Bearer $env:CERYX_SMOKE_TOKEN" }
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:41527/api/v1/agent/status -Headers $headers
```

## Logs and diagnostics

- Agent runtime root (disk-boundary): `.workspace-data/agent`
- Audit and related data: SQLite files under the Agent root.
- For API smoke:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-agent-api.ps1 -Token "<token>"
```

## Security operations

- Revoke trusted device by deleting it via `/api/v1/devices/{deviceId}` with `confirmHighRisk=true`.
- High-risk actions (recording start, pause control, settings patch for high-risk keys) require explicit confirmation flag and are audit logged.
