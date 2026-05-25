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

## Sync iOS native project (Capacitor)

```powershell
pnpm --filter @ceryx/ipad exec cap sync ios
```

Native project root:

- `apps/ipad/ios`

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

## iOS native permission baseline (repository-auditable)

### Info.plist keys

- `NSLocalNetworkUsageDescription`
- `NSBonjourServices` (includes `_ceryx-agent._tcp`)
- `NSMicrophoneUsageDescription`
- `NSPhotoLibraryUsageDescription`
- `NSPhotoLibraryAddUsageDescription`
- `NSCameraUsageDescription`
- `NSSpeechRecognitionUsageDescription`
- `NSUserNotificationsUsageDescription`
- `UIFileSharingEnabled = true`
- `LSSupportsOpeningDocumentsInPlace = true`
- `NSAppTransportSecurity` -> `NSAllowsArbitraryLoadsInWebContent = true`

### Localization

- `apps/ipad/ios/App/App/en.lproj/InfoPlist.strings`
- `apps/ipad/ios/App/App/zh-Hans.lproj/InfoPlist.strings`

### Local notification permission entry

- Launch route contains a "Request Notification Permission" action for minimum local-notification permission closure.

## Native build requirements

- macOS host with Xcode installed.
- Apple Developer signing setup for device/distribution targets.
