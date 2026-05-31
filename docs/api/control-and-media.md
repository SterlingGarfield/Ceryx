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
- `GET /api/v1/capture/frame` (`view_window`)
- `POST /api/v1/capture/webrtc/signal` (`view_window`)

Capture start body:

```json
{
  "mode": "balanced",
  "target": "codex_window"
}
```

Policy: full-desktop targets are rejected (`E_CAPTURE_DENIED`).

Preview frame policy:

- `GET /api/v1/capture/frame` returns an authenticated **in-memory JPEG preview frame** for the current Codex window.
- The response body is binary `image/jpeg`.
- The route adds:
  - `Cache-Control: no-store`
  - `X-Ceryx-Frame-Captured-At`
  - `X-Ceryx-Frame-Width`
  - `X-Ceryx-Frame-Height`
- The route rejects when:
  - capture is inactive (`E_CAPTURE_INACTIVE`)
  - the Codex window is unavailable (`E_CODEX_NOT_FOUND`)
  - the Codex window is minimized (`E_CODEX_MINIMIZED`)
- Preview frames are **not persisted** to `Screenshots/`.

WebRTC signaling policy:

- `POST /api/v1/capture/webrtc/signal` is token-authenticated and session-scoped.
- Request body supports:
  - `sessionId`
  - `type`: `offer | answer | ice-candidate | negotiation-needed | performance | viewer.heartbeat | viewer.idle | viewer.inactive`
  - `sdp` (for offer/answer)
  - `candidate` (`candidate`, `sdpMid`, `sdpMLineIndex`)
  - `payload` (for performance envelope passthrough)
- Response body returns normalized status plus optional negotiated fields:
  - `ok`
  - `status`
  - `sessionId`
  - `type`
  - `sdp`
  - `candidate`
- Session lifecycle:
  - in-memory session store keyed by `sessionId`
  - inactive sessions are evicted after 60 seconds
  - disconnected/degraded clients should retry with a fresh `offer`

Capture backend selection:

- Capture backend can be requested with env `CERYX_CAPTURE_BACKEND=auto|wgc|gdi`.
- Runtime status exposure:
  - `GET /api/v1/agent/status` now includes `captureBackend`.
  - `auto` prefers WGC on supported Windows runtime and falls back to GDI when unavailable.

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

Screenshot policy:

- `POST /api/v1/media/screenshot` performs an explicit screenshot action and writes a **real PNG artifact** into `Screenshots/`.
- Screenshot capture and preview-frame capture share the same Codex-window source surface, but only the screenshot route persists files.

## Errors

Common control/media errors:

- `E_NOT_PAIRED`
- `E_TOKEN_INVALID`
- `E_PERMISSION_DENIED`
- `E_CODEX_NOT_FOUND`
- `E_CODEX_MINIMIZED`
- `E_CAPTURE_INACTIVE`
- `E_INPUT_BLOCKED`
- `E_CAPTURE_DENIED`
- `E_CAPTURE_FAILED`
- `E_UPLOAD_TOO_LARGE`
- `E_RECORDING_BUSY`
- `E_DISK_LOW`
