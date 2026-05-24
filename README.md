# Ceryx

Ceryx v0.3 is planned as a dual-control product for iPad and Windows Desktop, backed by a local Windows Agent.

## Current Status (W8 in progress)

Workspace verification lanes are currently passing:

- `npm run typecheck`
- `npm run test`
- `npm run build`
- `dotnet test agent/windows/Ceryx.Agent.Windows.sln`

W8 packaging blocker:

- Desktop Tauri packaging is blocked by missing `apps/desktop/src-tauri/Cargo.toml`.

## Scripts

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm dev:ipad
pnpm dev:desktop
pnpm dev:agent
pnpm test:agent
powershell -ExecutionPolicy Bypass -File .\scripts\build-all.ps1 -SkipDesktopTauri
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-agent-api.ps1 -Token "<token>"
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-local-desktop.ps1 -Token "<token>"
```

## Plan and Release Docs

- Master/W1-W8 plans: `docs/superpowers/plans`
- Release docs: `docs/release`
- Operator docs: `docs/operator`
