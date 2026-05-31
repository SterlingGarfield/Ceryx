# Ceryx v0.3 Security Model

更新日期：2026-05-23

## 1. 鉴权模型

- Agent API 默认受保护（`/api/v1/*`）。
- 身份凭据：`Authorization: Bearer <deviceToken>`。
- 服务端不存明文 token，仅存 `token_hash`（SHA-256）。
- 鉴权中间件校验：
  1. token 是否存在且格式正确；
  2. token hash 是否能在 `paired_devices` 命中；
  3. 请求路由所需权限是否包含在设备权限集中；
  4. local-only 路由是否来自 loopback（含 `X-Forwarded-For` 首 IP）。

## 2. 本地管理边界（Local-only）

以下路由只允许本机（localhost/loopback）调用：

- `POST /api/v1/pairing/desktop-confirm`
- `POST /api/v1/agent/pause-control`
- `POST /api/v1/agent/resume-control`
- `POST /api/v1/agent/open-logs-folder`
- `POST /api/v1/agent/restart-request`

远端调用会返回：

- `403 E_PERMISSION_DENIED`

## 3. Endpoint-Permission Matrix

代码源：`agent/windows/src/Ceryx.Agent.Network/AgentRoutePermissionMatrix.cs`

| Method | Path | AllowAnonymous | RequiredPermission | LocalOnly |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/health` | Yes | - | No |
| POST | `/api/v1/pairing/request` | Yes | - | No |
| POST | `/api/v1/pairing/desktop-confirm` | Yes | - | Yes |
| POST | `/api/v1/pairing/confirm` | Yes | - | No |
| GET | `/api/v1/devices` | No | `manage_devices` | No |
| DELETE | `/api/v1/devices/{deviceId}` | No | `manage_devices` | No |
| GET | `/api/v1/agent/status` | No | - | No |
| GET | `/api/v1/agent/paths` | No | - | No |
| GET | `/api/v1/codex/window` | No | `view_window` | No |
| POST | `/api/v1/codex/focus` | No | `control_input` | No |
| POST | `/api/v1/codex/refresh` | No | `view_window` | No |
| POST | `/api/v1/codex/select-window` | No | `control_input` | No |
| POST | `/api/v1/input/key` | No | `control_input` | No |
| POST | `/api/v1/input/mouse` | No | `control_input` | No |
| POST | `/api/v1/input/scroll` | No | `control_input` | No |
| POST | `/api/v1/input/hotkey` | No | `control_input` | No |
| POST | `/api/v1/input/text` | No | `control_input` | No |
| POST | `/api/v1/prompt/send` | No | `send_prompt` | No |
| POST | `/api/v1/capture/start` | No | `view_window` | No |
| POST | `/api/v1/capture/stop` | No | `view_window` | No |
| GET | `/api/v1/capture/state` | No | `view_window` | No |
| GET | `/api/v1/capture/frame` | No | `view_window` | No |
| POST | `/api/v1/capture/webrtc/signal` | No | `view_window` | No |
| POST | `/api/v1/assets/upload-image` | No | `upload_image` | No |
| GET | `/api/v1/project/diff` | No | `read_diff` | No |
| GET | `/api/v1/project/diff/files` | No | `read_diff` | No |
| GET | `/api/v1/project/diff/file` | No | `read_diff` | No |
| GET | `/api/v1/project/files` | No | `read_diff` | No |
| POST | `/api/v1/project/test-request` | No | `run_test` | No |
| GET | `/api/v1/project/tasks` | No | - | No |
| POST | `/api/v1/media/screenshot` | No | `screenshot` | No |
| POST | `/api/v1/media/recording/start` | No | `recording` | No |
| POST | `/api/v1/media/recording/stop` | No | `recording` | No |
| POST | `/api/v1/agent/pause-control` | No | `manage_agent` | Yes |
| POST | `/api/v1/agent/resume-control` | No | `manage_agent` | Yes |
| POST | `/api/v1/agent/open-logs-folder` | No | `manage_agent` | Yes |
| POST | `/api/v1/agent/restart-request` | No | `manage_agent` | Yes |
| GET | `/api/v1/logs` | No | - | No |
| GET | `/api/v1/settings` | No | - | No |
| PATCH | `/api/v1/settings` | No | `manage_agent` | No |
| GET | `/api/v1/notifications` | No | - | No |
| POST | `/api/v1/notifications/{notificationId}/read` | No | - | No |
| POST | `/api/v1/notifications/clear` | No | - | No |

## 4. 设备删除后的失效语义

- 删除 trusted device 时：
  - 删除 `paired_devices` 记录；
  - 同步删除 `remote_sessions` 中该设备的会话记录。
- 被删除设备再次调用受保护接口时返回：
  - `401 E_TOKEN_INVALID`

对应验证：`PermissionCoverage_DeletingTrustedDeviceInvalidatesTokenAndSessions`

## 5. 网络边界与绑定策略（W7 Task3）

- Agent 启动时默认绑定：
  - `127.0.0.1:<port>`（loopback）
  - 本机私有网段/链路本地网卡地址（LAN）
- 不默认绑定公网地址。
- 对 `/api/v1/*` 请求执行源地址校验：
  - 仅允许 loopback/LAN 源地址；
  - 非 LAN/loopback 返回 `403 E_NETWORK_DENIED`。

实现点：

- `agent/windows/src/Ceryx.Agent.Network/AgentNetworkBindingResolver.cs`
- `agent/windows/src/Ceryx.Agent.Network/AgentAuthorizationExtensions.cs`

## 6. Origin 默认拒绝策略（W7 Task3）

- 对 `/api/v1/*` 且携带 `Origin` 的请求：
  - 默认仅允许：
    - `localhost`
    - loopback IP
    - 私有网段 IP（LAN）
  - 可通过 `CERYX_ALLOWED_ORIGINS`（逗号分隔，完整 origin）补充白名单。
- 未命中白名单返回 `403 E_ORIGIN_DENIED`。

## 7. WebSocket 握手鉴权（W7 Task3）

- `GET + Upgrade: websocket` 到 `/api/v1/*` 时强制鉴权，不允许匿名握手。
- 无 token 返回 `401 E_NOT_PAIRED`；
- 非法 token 返回 `401 E_TOKEN_INVALID`；
- 权限不足返回 `403 E_PERMISSION_DENIED`。

## 8. Pairing 请求限流（W7 Task3）

- `POST /api/v1/pairing/request` 按来源地址执行速率限制。
- 默认策略：
  - 窗口：`60s`
  - 次数：`6` 次
- 超限返回：
  - `429 E_PAIRING_RATE_LIMITED`
  - `Retry-After` 响应头（秒）
- 可配置环境变量：
  - `CERYX_PAIRING_RATE_LIMIT_COUNT`
  - `CERYX_PAIRING_RATE_LIMIT_WINDOW_SECONDS`

实现点：

- `agent/windows/src/Ceryx.Agent.Network/PairingRateLimiter.cs`
- `agent/windows/src/Ceryx.Agent.Network/AgentHttpHostExtensions.cs`

## 9. TraceId 错误可观测性

- `/api/v1/*` 的错误响应统一包含 `error.traceId`，并写入 `X-Trace-Id` 响应头。
- 新增的网络拒绝、Origin 拒绝、限流拒绝同样遵循该约定。

## 10. 性能降级与资源守卫（W7 Task4）

- Capture 降级策略（`InMemoryCaptureLifecycleService`）：
  - CPU 持续高于 70% 达到 5 秒：自动降低帧率（最小 12fps）；
  - 网络抖动持续超阈值：先降分辨率（960x540），再在持续超阈值时断开；
  - 连续 3 秒无 active viewer：自动暂停 capture，viewer 恢复后解除暂停。
- Capture 信令（`/api/v1/capture/webrtc/signal`）支持性能信号透传：
  - `type=performance|capture.performance`（payload: `cpuUsagePercent/networkJitterMs/hasActiveViewer`）
  - `type=viewer.heartbeat` / `viewer.idle` / `viewer.inactive`
- Diff 与 Logs 保持分页契约：
  - `/api/v1/project/diff/files` 支持 `page/pageSize`（含 `total/hasMore`）；
  - `/api/v1/logs` 持续要求 `page>=1`、`pageSize in [1,200]`。
- Recording 低磁盘保护：
  - 可用空间 `< 1GB` 时拒绝启动（`E_DISK_LOW`）。
