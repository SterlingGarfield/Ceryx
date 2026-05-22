# Ceryx v0.3 Project / Diff / Logs / Settings APIs

This document summarizes the Agent HTTP endpoints used by Desktop and iPad workspaces in W6.

Base URL (local): `http://127.0.0.1:41527`

All routes below require Bearer auth unless marked otherwise.

## Project Diff

### `GET /api/v1/project/diff?projectId=workspace-default`

Returns diff summary only.

### `GET /api/v1/project/diff/files?projectId=workspace-default`

Returns changed files list with per-file add/delete counts.

### `GET /api/v1/project/diff/file?projectId=workspace-default&path=src/main.ts`

Returns one file diff payload.

Response includes:

- `truncated` (boolean)
- `lineLimit` (number)

## Project Files (lite index)

### `GET /api/v1/project/files?projectId=workspace-default&query=app&limit=400`

Returns a lite file index for Files workspace.

Response file entry fields:

- `path`
- `extension`
- `tracked`
- `changed`

## Project Tasks

### `POST /api/v1/project/test-request`

Body:

```json
{
  "scope": "changed-modules"
}
```

Returns accepted test request state and `requestId`.

### `GET /api/v1/project/tasks?promptLimit=8`

Returns:

- `taskState` (current status/action)
- `recentPromptActions` (from audit logs)
- `testRequest` (latest test request state)

## Logs

### `GET /api/v1/logs?page=1&pageSize=100&severity=info&action=prompt.send.accepted&sessionId=dev_01`

Supports pagination and filters.

Query constraints:

- `page >= 1`
- `1 <= pageSize <= 200`
- `severity in {info, warning, error}`

## Settings

### `GET /api/v1/settings`

Returns:

- `agentSettings`
- `clientSettings`

### `PATCH /api/v1/settings`

Body:

```json
{
  "agentSettings": {
    "httpPort": 41528,
    "directTestCommand": "dotnet test agent/windows/Ceryx.Agent.Windows.sln",
    "allowFullscreenCapture": false,
    "allowClearLogs": false,
    "defaultCaptureMode": "balanced"
  },
  "confirmHighRisk": true
}
```

High-risk keys require `confirmHighRisk=true`:

- `httpPort`
- `directTestCommand`
- `allowFullscreenCapture`
- `allowClearLogs`

## Notifications

### `GET /api/v1/notifications?limit=100`

Returns notification feed based on audit events and read state.

### `POST /api/v1/notifications/{notificationId}/read`

Marks one notification as read.

### `POST /api/v1/notifications/clear`

Clears all notifications up to current timestamp.
