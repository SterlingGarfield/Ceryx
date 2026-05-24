# iPad App Operator Guide

## Development startup

```powershell
pnpm dev:ipad
```

## Build web assets

```powershell
pnpm --filter @ceryx/ipad build
```

Build output:

- `apps/ipad/dist`

## Pairing and connection prerequisites

1. Windows Agent must be running on the same LAN.
2. Pairing endpoints must complete trusted-device registration.
3. A valid token is required for protected APIs.

## Runtime checks

- Verify Agent health:

```powershell
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:41527/api/v1/health
```

- Verify token-based status:

```powershell
$headers = @{ Authorization = "Bearer $env:CERYX_SMOKE_TOKEN" }
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:41527/api/v1/agent/status -Headers $headers
```

## iOS native packaging note

### Requirements

- macOS host with Xcode installed.
- Apple Developer signing setup for device/distribution targets.
- Capacitor native scaffold for iOS project generation.

### Current local limitation (2026-05-24)

- Current workspace under `apps/ipad` contains web-only assets and does not include a committed Capacitor iOS native project scaffold.
- Verified lane in this repository is iPad web build and shared protocol integration tests.
