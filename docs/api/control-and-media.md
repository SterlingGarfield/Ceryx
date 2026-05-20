# Ceryx v0.3 Control and Media API

This document captures W4 remote-control transport endpoints and permission requirements.

## Codex Window

- `GET /api/v1/codex/window` (`view_window`)
- `POST /api/v1/codex/refresh` (`view_window`)
- `POST /api/v1/codex/select-window` (`control_input`)
- `POST /api/v1/codex/focus` (`control_input`)

`GET /api/v1/codex/window` returns:

```json
{
  "status": "found",
  "windowId": "hwnd_ABCDEF",
  "title": "Codex",
  "processName": "codex",
  "candidateCount": 1,
  "lastUpdatedAt": "2026-05-20T06:00:00.0000000Z"
}
```

Status values include: `not_found`, `found`, `focused`, `minimized`, `multiple_candidates`, `permission_issue`.

## Input and Prompt

- `POST /api/v1/input/key` (`control_input`)
- `POST /api/v1/input/mouse` (`control_input`)
- `POST /api/v1/input/scroll` (`control_input`)
- `POST /api/v1/input/hotkey` (`control_input`)
- `POST /api/v1/input/text` (`control_input`)
- `POST /api/v1/prompt/send` (`send_prompt`)

All input/prompt operations require:

1. valid paired token
2. required permission
3. Codex window resolved and not minimized
4. active session lock ownership for the caller

## Capture

- `POST /api/v1/capture/start` (`view_window`)
- `POST /api/v1/capture/stop` (`view_window`)
- `GET /api/v1/capture/state` (`view_window`)
- `POST /api/v1/capture/webrtc/signal` (`view_window`)

Capture start body:

```json
{
  "mode": "balanced",
  "target": "codex_window"
}
```

Policy: full-desktop targets are rejected (`E_CAPTURE_DENIED`).

## Media

- `POST /api/v1/assets/upload-image` (`upload_image`)
- `POST /api/v1/media/screenshot` (`screenshot`)
- `POST /api/v1/media/recording/start` (`recording`)
- `POST /api/v1/media/recording/stop` (`recording`)

Upload policy:

- max 20MB
- extensions: `.png`, `.jpg`, `.jpeg`, `.webp`

Recording policy:

- one active recording at a time
- low-disk precheck before start
- max session duration 30 minutes

## Errors

Common control/media errors:

- `E_NOT_PAIRED`
- `E_TOKEN_INVALID`
- `E_PERMISSION_DENIED`
- `E_CODEX_NOT_FOUND`
- `E_CODEX_MINIMIZED`
- `E_INPUT_BLOCKED`
- `E_CAPTURE_DENIED`
- `E_CAPTURE_FAILED`
- `E_UPLOAD_TOO_LARGE`
- `E_RECORDING_BUSY`
- `E_DISK_LOW`
