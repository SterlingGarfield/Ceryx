# Ceryx

Ceryx v0.3 is planned as a dual-control product for iPad and Windows Desktop, backed by a local Windows Agent.

## W1 Status

This repository is currently at W1 Day 1 workspace bootstrap:

- `apps/ipad` will contain the Capacitor iPad client.
- `apps/desktop` will contain the Tauri desktop client.
- `packages/*` will contain shared protocol, SDK, UI, and feature packages.
- `agent/windows` will contain the Windows Agent solution.
- `docs/superpowers/plans` contains the implementation plans.

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
```

`dotnet` is required before Agent work begins. It is not required for W1 Day 1.
