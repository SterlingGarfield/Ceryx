# Ceryx

Ceryx v0.3 is planned as a dual-control product for iPad and Windows Desktop, backed by a local Windows Agent.

## Current Status (W8 acceptance in progress)

Workspace verification lanes are currently passing:

- `npm run typecheck`
- `npm run test`
- `npm run build`
- `dotnet test agent/windows/Ceryx.Agent.Windows.sln`
- `powershell -ExecutionPolicy Bypass -File .\scripts\build-all.ps1`
- `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-agent-api.ps1 -Token "<token>"`
- `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-local-desktop.ps1 -Token "<token>"`

Current explicit blocker:

- None at repository-audit level for W8.  
- Remaining environment validation still requires macOS/Xcode host execution for native iOS Debug build runtime evidence.

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
pnpm --filter @ceryx/ipad exec cap sync ios
powershell -ExecutionPolicy Bypass -File .\scripts\build-all.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-agent-api.ps1 -Token "<token>"
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-local-desktop.ps1 -Token "<token>"
```

## Plan and Release Docs

- Master/W1-W8 plans: `docs/superpowers/plans`
- Release docs: `docs/release`
- Operator docs: `docs/operator`
