using Ceryx.Agent.Core;
using Ceryx.Agent.Capture;
using Ceryx.Agent.Codex.Clipboard;
using Ceryx.Agent.Codex.ImageBridge;
using Ceryx.Agent.Codex.Input;
using Ceryx.Agent.Codex.SessionLock;
using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Media;
using Ceryx.Agent.Project;
using Ceryx.Agent.Security.Devices;
using Ceryx.Agent.Security.Pairing;
using Ceryx.Agent.Storage;
using Ceryx.Agent.Storage.Audit;
using Ceryx.Agent.Storage.Notifications;
using Ceryx.Agent.Storage.Settings;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Data.Sqlite;

namespace Ceryx.Agent.Network;

public static class AgentHttpHostExtensions
{
    private const string ServiceName = "ceryx-agent";
    private const string ServiceVersion = "0.3.0";
    private const int DefaultHttpPort = 41527;

    public static WebApplication UseAgentRequestTracing(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        app.Use(static (context, next) =>
        {
            _ = context.GetOrCreateTraceId();
            context.Response.OnStarting(static state =>
            {
                var httpContext = (HttpContext)state;
                httpContext.Response.Headers[TraceIdHttpContextExtensions.TraceIdHeaderName] =
                    httpContext.GetOrCreateTraceId();
                return Task.CompletedTask;
            }, context);
            return next(context);
        });

        app.Use(async (context, next) =>
        {
            try
            {
                await next(context);
            }
            catch (Exception ex)
            {
                var traceId = context.GetOrCreateTraceId();
                var loggerFactory = context.RequestServices.GetRequiredService<ILoggerFactory>();
                var logger = loggerFactory.CreateLogger("Ceryx.Agent.Route");
                logger.LogError(
                    ex,
                    "Route execution failed: {Method} {Path} traceId={TraceId}",
                    context.Request.Method,
                    context.Request.Path,
                    traceId);
                throw;
            }
        });

        return app;
    }

    public static WebApplication MapAgentRoutes(this WebApplication app, LocalPaths localPaths)
    {
        ArgumentNullException.ThrowIfNull(app);
        ArgumentNullException.ThrowIfNull(localPaths);

        app.MapGet("/api/v1/health", HealthHandler)
            .AllowAnonymousAgent();
        app.MapPost(
            "/api/v1/pairing/request",
            (PairingRequestBody request, PairingStateMachine pairingStateMachine, IPairingRateLimiter pairingRateLimiter, ILoggerFactory loggerFactory, HttpContext context) =>
                PairingRequestHandler(request, pairingStateMachine, pairingRateLimiter, loggerFactory, context))
            .AllowAnonymousAgent();
        app.MapPost(
            "/api/v1/pairing/desktop-confirm",
            (PairingDesktopConfirmBody request, PairingStateMachine pairingStateMachine, ILoggerFactory loggerFactory, HttpContext context) =>
                PairingDesktopConfirmHandler(request, pairingStateMachine, loggerFactory, context))
            .AllowAnonymousAgent()
            .RequireLocalAgent();
        app.MapPost(
            "/api/v1/pairing/confirm",
            (PairingConfirmBody request, PairingCompletionService pairingCompletionService, ILoggerFactory loggerFactory, HttpContext context) =>
                PairingConfirmHandler(request, pairingCompletionService, loggerFactory, context))
            .AllowAnonymousAgent();

        app.MapGet(
            "/api/v1/devices",
            (HttpContext context, ITrustedDeviceStore trustedDeviceStore) =>
                ListDevicesHandler(context, trustedDeviceStore))
            .RequireAgentAuth(Permission.ManageDevices);
        app.MapDelete(
            "/api/v1/devices/{deviceId}",
            (HttpContext context, string deviceId, [FromBody] HighRiskConfirmationBody? body, ITrustedDeviceStore trustedDeviceStore, IAuditLogStore auditLogStore) =>
                DeleteDeviceHandler(context, deviceId, body, trustedDeviceStore, auditLogStore))
            .RequireAgentAuth(Permission.ManageDevices);

        app.MapGet(
            "/api/v1/agent/status",
            (AgentRuntimeState runtimeState, IWindowCaptureBackendInfo backendInfo) => AgentStatusHandler(runtimeState, backendInfo))
            .RequireAgentAuth();
        app.MapGet("/api/v1/agent/paths", () => AgentPathsHandler(localPaths))
            .RequireAgentAuth();

        app.MapGet(
            "/api/v1/codex/window",
            (ICodexWindowLocator locator) => GetCodexWindowHandler(locator))
            .RequireAgentAuth(Permission.ViewWindow);
        app.MapGet(
            "/api/v1/codex/windows",
            (ICodexWindowLocator locator) => ListCodexWindowsHandler(locator))
            .RequireAgentAuth(Permission.ViewWindow);
        app.MapPost(
            "/api/v1/codex/focus",
            (ICodexWindowLocator locator) => FocusCodexWindowHandler(locator))
            .RequireAgentAuth(Permission.ControlInput);
        app.MapPost(
            "/api/v1/codex/refresh",
            (ICodexWindowLocator locator) => RefreshCodexWindowHandler(locator))
            .RequireAgentAuth(Permission.ViewWindow);
        app.MapPost(
            "/api/v1/codex/select-window",
            (HttpContext context, CodexSelectWindowBody body, ICodexWindowLocator locator) => SelectCodexWindowHandler(context, body, locator))
            .RequireAgentAuth(Permission.ControlInput);

        app.MapPost(
            "/api/v1/input/key",
            (HttpContext context, InputKeyBody body, ICodexWindowLocator locator, ISessionLockService lockService, IInputBridge inputBridge, IAuditLogStore auditLogStore) =>
                InputKeyHandler(context, body, locator, lockService, inputBridge, auditLogStore))
            .RequireAgentAuth(Permission.ControlInput);
        app.MapPost(
            "/api/v1/input/mouse",
            (HttpContext context, InputMouseBody body, ICodexWindowLocator locator, ISessionLockService lockService, IInputBridge inputBridge, IAuditLogStore auditLogStore) =>
                InputMouseHandler(context, body, locator, lockService, inputBridge, auditLogStore))
            .RequireAgentAuth(Permission.ControlInput);
        app.MapPost(
            "/api/v1/input/scroll",
            (HttpContext context, InputScrollBody body, ICodexWindowLocator locator, ISessionLockService lockService, IInputCommandMapper mapper, IAuditLogStore auditLogStore) =>
                InputMappedHandler(context, "input.scroll", body, locator, lockService, () => mapper.MapScroll(body), auditLogStore))
            .RequireAgentAuth(Permission.ControlInput);
        app.MapPost(
            "/api/v1/input/hotkey",
            (HttpContext context, InputHotkeyBody body, ICodexWindowLocator locator, ISessionLockService lockService, IInputCommandMapper mapper, IAuditLogStore auditLogStore) =>
                InputMappedHandler(context, "input.hotkey", body, locator, lockService, () => mapper.MapHotkey(body), auditLogStore))
            .RequireAgentAuth(Permission.ControlInput);
        app.MapPost(
            "/api/v1/input/text",
            (HttpContext context, InputTextBody body, ICodexWindowLocator locator, ISessionLockService lockService, IInputCommandMapper mapper, IAuditLogStore auditLogStore) =>
                InputMappedHandler(context, "input.text", body, locator, lockService, () => mapper.MapText(body), auditLogStore))
            .RequireAgentAuth(Permission.ControlInput);

        app.MapPost(
            "/api/v1/prompt/send",
            (HttpContext context, PromptSendBody body, ICodexWindowLocator locator, ISessionLockService lockService, IPromptBridgeService promptBridgeService, IAuditLogStore auditLogStore) =>
                PromptSendHandler(context, body, locator, lockService, promptBridgeService, auditLogStore))
            .RequireAgentAuth(Permission.SendPrompt);
        app.MapPost(
            "/api/v1/clipboard/send",
            (HttpContext context, ClipboardSendBody body, IClipboardService clipboardService, IAuditLogStore auditLogStore) =>
                ClipboardSendHandler(context, body, clipboardService, auditLogStore))
            .RequireAgentAuth(Permission.ManageAgent);
        app.MapGet(
            "/api/v1/clipboard/receive",
            (HttpContext context, IClipboardService clipboardService, IAuditLogStore auditLogStore) =>
                ClipboardReceiveHandler(context, clipboardService, auditLogStore))
            .RequireAgentAuth(Permission.ManageAgent);
        app.MapPost(
            "/api/v1/clipboard/clear",
            (HttpContext context, IClipboardService clipboardService, IAuditLogStore auditLogStore) =>
                ClipboardClearHandler(context, clipboardService, auditLogStore))
            .RequireAgentAuth(Permission.ManageAgent);

        app.MapPost(
            "/api/v1/capture/start",
            (HttpContext context, CaptureStartBody body, ICodexWindowLocator locator, ICaptureLifecycleService captureLifecycleService, IAuditLogStore auditLogStore) =>
                CaptureStartHandler(context, body, locator, captureLifecycleService, auditLogStore))
            .RequireAgentAuth(Permission.ViewWindow);
        app.MapPost(
            "/api/v1/capture/stop",
            (ICaptureLifecycleService captureLifecycleService) => CaptureStopHandler(captureLifecycleService))
            .RequireAgentAuth(Permission.ViewWindow);
        app.MapGet(
            "/api/v1/capture/state",
            (ICaptureLifecycleService captureLifecycleService, IRecordingService recordingService) =>
                CaptureStateHandler(captureLifecycleService, recordingService))
            .RequireAgentAuth(Permission.ViewWindow);
        app.MapGet(
            "/api/v1/capture/frame",
            (HttpContext context, string? windowId, ICodexWindowLocator locator, ICaptureLifecycleService captureLifecycleService, IFramePreviewService framePreviewService) =>
                CaptureFrameHandler(context, windowId, locator, captureLifecycleService, framePreviewService))
            .RequireAgentAuth(Permission.ViewWindow);
        app.MapPost(
            "/api/v1/capture/webrtc/signal",
            (CaptureSignalBody body, ICaptureSignalService signalService) => CaptureSignalHandler(body, signalService))
            .RequireAgentAuth(Permission.ViewWindow);

        app.MapPost(
            "/api/v1/files/upload",
            (HttpContext context, IFileTransferService fileTransferService, IAuditLogStore auditLogStore) =>
                FileUploadHandler(context, fileTransferService, auditLogStore))
            .RequireAgentAuth(Permission.ManageAgent);
        app.MapGet(
            "/api/v1/files/list",
            (HttpContext context, string? path, int? limit, IFileTransferService fileTransferService, IAuditLogStore auditLogStore) =>
                FileListHandler(context, path, limit, fileTransferService, auditLogStore))
            .RequireAgentAuth(Permission.ManageAgent);
        app.MapGet(
            "/api/v1/files/download/{fileId}",
            (HttpContext context, string fileId, IFileTransferService fileTransferService, IAuditLogStore auditLogStore) =>
                FileDownloadHandler(context, fileId, fileTransferService, auditLogStore))
            .RequireAgentAuth(Permission.ManageAgent);
        app.MapDelete(
            "/api/v1/files/{fileId}",
            (HttpContext context, string fileId, IFileTransferService fileTransferService, IAuditLogStore auditLogStore) =>
                FileDeleteHandler(context, fileId, fileTransferService, auditLogStore))
            .RequireAgentAuth(Permission.ManageAgent);

        app.MapPost(
            "/api/v1/assets/upload-image",
            (HttpContext context, IUploadImageService uploadImageService, IImagePasteService imagePasteService, LocalPaths paths, IAuditLogStore auditLogStore) =>
                UploadImageHandler(context, uploadImageService, imagePasteService, paths, auditLogStore))
            .RequireAgentAuth(Permission.UploadImage);
        app.MapGet(
            "/api/v1/project/diff",
            (HttpContext context, string? projectId, IProjectConfigRepository projectConfigRepository, IGitDiffService gitDiffService) =>
                ProjectDiffSummaryHandler(context, projectId, projectConfigRepository, gitDiffService))
            .RequireAgentAuth(Permission.ReadDiff);
        app.MapGet(
            "/api/v1/project/diff/files",
            (HttpContext context, string? projectId, int? page, int? pageSize, IProjectConfigRepository projectConfigRepository, IGitDiffService gitDiffService) =>
                ProjectDiffFilesHandler(context, projectId, page, pageSize, projectConfigRepository, gitDiffService))
            .RequireAgentAuth(Permission.ReadDiff);
        app.MapGet(
            "/api/v1/project/diff/file",
            (HttpContext context, string? projectId, string? path, IProjectConfigRepository projectConfigRepository, IGitDiffService gitDiffService) =>
                ProjectDiffFileHandler(context, projectId, path, projectConfigRepository, gitDiffService))
            .RequireAgentAuth(Permission.ReadDiff);
        app.MapGet(
            "/api/v1/project/files",
            (HttpContext context, string? projectId, string? query, int? limit, IProjectConfigRepository projectConfigRepository, IProjectFileIndexService projectFileIndexService) =>
                ProjectFilesHandler(context, projectId, query, limit, projectConfigRepository, projectFileIndexService))
            .RequireAgentAuth(Permission.ReadDiff);
        app.MapPost(
            "/api/v1/project/test-request",
            (HttpContext context, ProjectTestRequestBody body, IAuditLogStore auditLogStore) =>
                ProjectTestRequestHandler(context, body, auditLogStore))
            .RequireAgentAuth(Permission.RunTest);
        app.MapGet(
            "/api/v1/project/tasks",
            (HttpContext context, int? promptLimit, IAuditLogStore auditLogStore) =>
                ProjectTasksHandler(context, promptLimit, auditLogStore))
            .RequireAgentAuth();
        app.MapPost(
            "/api/v1/media/screenshot",
            (HttpContext context, string? windowId, IScreenshotService screenshotService, ICodexWindowLocator locator, IAuditLogStore auditLogStore) =>
                ScreenshotHandler(context, windowId, screenshotService, locator, auditLogStore))
            .RequireAgentAuth(Permission.Screenshot);
        app.MapGet(
            "/api/v1/media/recordings",
            (HttpContext context, int? limit, IRecordingCatalogService recordingCatalogService, IAuditLogStore auditLogStore) =>
                RecordingListHandler(context, limit, recordingCatalogService, auditLogStore))
            .RequireAgentAuth(Permission.Recording);
        app.MapGet(
            "/api/v1/media/recordings/download/{fileName}",
            (HttpContext context, string fileName, IRecordingCatalogService recordingCatalogService, IAuditLogStore auditLogStore) =>
                RecordingDownloadHandler(context, fileName, recordingCatalogService, auditLogStore))
            .RequireAgentAuth(Permission.Recording);
        app.MapPost(
            "/api/v1/media/recording/start",
            (HttpContext context, RecordingStartBody? body, IRecordingService recordingService, ICodexWindowLocator locator, IAuditLogStore auditLogStore) =>
                RecordingStartHandler(context, body, recordingService, locator, auditLogStore))
            .RequireAgentAuth(Permission.Recording);
        app.MapPost(
            "/api/v1/media/recording/stop",
            (HttpContext context, IRecordingService recordingService, IAuditLogStore auditLogStore) =>
                RecordingStopHandler(context, recordingService, auditLogStore))
            .RequireAgentAuth(Permission.Recording);

        app.MapPost(
            "/api/v1/agent/pause-control",
            (HttpContext context, HighRiskConfirmationBody? body, AgentRuntimeState runtimeState, ILoggerFactory loggerFactory, IAuditLogStore auditLogStore) =>
                PauseControlHandler(context, body, runtimeState, loggerFactory, auditLogStore))
            .RequireAgentAuth(Permission.ManageAgent)
            .RequireLocalAgent();
        app.MapPost(
            "/api/v1/agent/resume-control",
            (HttpContext context, AgentRuntimeState runtimeState, ILoggerFactory loggerFactory) =>
                ResumeControlHandler(context, runtimeState, loggerFactory))
            .RequireAgentAuth(Permission.ManageAgent)
            .RequireLocalAgent();
        app.MapPost(
            "/api/v1/agent/open-logs-folder",
            (HttpContext context, IAgentTrayShell trayShell, ILoggerFactory loggerFactory) =>
                OpenLogsFolderHandler(context, trayShell, loggerFactory))
            .RequireAgentAuth(Permission.ManageAgent)
            .RequireLocalAgent();
        app.MapPost(
            "/api/v1/agent/restart-request",
            (HttpContext context, ILoggerFactory loggerFactory) =>
                RestartRequestHandler(context, loggerFactory))
            .RequireAgentAuth(Permission.ManageAgent)
            .RequireLocalAgent();
        app.MapGet(
            "/api/v1/logs",
            (HttpContext context, int? page, int? pageSize, string? severity, string? action, string? sessionId, IAuditLogStore auditLogStore) =>
                LogsHandler(context, page, pageSize, severity, action, sessionId, auditLogStore))
            .RequireAgentAuth();
        app.MapGet(
            "/api/v1/settings",
            (HttpContext context, IAgentSettingsStore settingsStore) =>
                GetSettingsHandler(context, settingsStore))
            .RequireAgentAuth();
        app.MapPatch(
            "/api/v1/settings",
            (HttpContext context, SettingsPatchBody body, IAgentSettingsStore settingsStore, IAuditLogStore auditLogStore) =>
                PatchSettingsHandler(context, body, settingsStore, auditLogStore))
            .RequireAgentAuth(Permission.ManageAgent);
        app.MapGet(
            "/api/v1/notifications",
            (HttpContext context, int? limit, IAuditLogStore auditLogStore, INotificationStateStore notificationStateStore) =>
                NotificationsHandler(context, limit, auditLogStore, notificationStateStore))
            .RequireAgentAuth();
        app.MapPost(
            "/api/v1/notifications/{notificationId}/read",
            (HttpContext context, string notificationId, INotificationStateStore notificationStateStore) =>
                NotificationReadHandler(context, notificationId, notificationStateStore))
            .RequireAgentAuth();
        app.MapPost(
            "/api/v1/notifications/clear",
            (HttpContext context, INotificationStateStore notificationStateStore) =>
                NotificationClearHandler(context, notificationStateStore))
            .RequireAgentAuth();

        return app;
    }

    private static Ok<HealthResponse> HealthHandler()
    {
        return TypedResults.Ok(new HealthResponse(
            Ok: true,
            Service: ServiceName,
            Version: ServiceVersion));
    }

    private static Ok<AgentStatusResponse> AgentStatusHandler(
        AgentRuntimeState runtimeState,
        IWindowCaptureBackendInfo backendInfo)
    {
        var status = runtimeState.GetStatus();

        return TypedResults.Ok(new AgentStatusResponse(
            AgentVersion: ServiceVersion,
            DeviceName: "Local Windows PC",
            Platform: "windows",
            Status: status.ToWireValue(),
            HttpPort: DefaultHttpPort,
            SupportsWebRTC: true,
            SupportsDesktopClient: true,
            CodexStatus: CodexWindowStatus.NotFound.ToWireValue(),
            CaptureBackend: backendInfo.ActiveBackend));
    }

    private static Ok<AgentPathsResponse> AgentPathsHandler(LocalPaths localPaths)
    {
        return TypedResults.Ok(new AgentPathsResponse(
            Root: localPaths.Root,
            Logs: localPaths.Logs,
            Uploads: localPaths.Uploads,
            Screenshots: localPaths.Screenshots,
            Recordings: localPaths.Recordings,
            Database: localPaths.Database));
    }

    private static async Task<IResult> PairingRequestHandler(
        PairingRequestBody request,
        PairingStateMachine pairingStateMachine,
        IPairingRateLimiter pairingRateLimiter,
        ILoggerFactory loggerFactory,
        HttpContext context)
    {
        if (!TryConsumePairingQuota(context, pairingRateLimiter, out var retryAfter))
        {
            context.Response.Headers.RetryAfter = Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds)).ToString();
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_PAIRING_RATE_LIMITED",
                Message: "Pairing request rate limit exceeded.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: $"Retry after {Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds))} seconds."));
        }

        if (string.IsNullOrWhiteSpace(request.ClientName) ||
            string.IsNullOrWhiteSpace(request.ClientType) ||
            string.IsNullOrWhiteSpace(request.Platform))
        {
            return InvalidPairingPayload(context, "clientName, clientType, and platform are required.");
        }

        var logger = loggerFactory.CreateLogger("Ceryx.Agent.Pairing");
        var result = await pairingStateMachine.RequestAsync(new PairingRequestContext(
            ClientName: request.ClientName.Trim(),
            ClientType: request.ClientType.Trim(),
            Platform: request.Platform.Trim()), context.RequestAborted);

        logger.LogInformation(
            "Pairing request processed. accepted={Accepted} state={State} clientType={ClientType}",
            result.IsAccepted,
            result.State,
            request.ClientType);

        if (!result.IsAccepted)
        {
            return Results.Json(
                new PairingRequestResponse(
                    Ok: false,
                    State: result.State,
                    PairingId: null,
                    ExpiresAt: null,
                    RejectedReason: result.RejectedReason),
                statusCode: StatusCodes.Status409Conflict);
        }

        return TypedResults.Ok(new PairingRequestResponse(
            Ok: true,
            State: result.State,
            PairingId: result.PairingId,
            ExpiresAt: result.ExpiresAt,
            RejectedReason: null));
    }

    private static async Task<IResult> PairingDesktopConfirmHandler(
        PairingDesktopConfirmBody request,
        PairingStateMachine pairingStateMachine,
        ILoggerFactory loggerFactory,
        HttpContext context)
    {
        var logger = loggerFactory.CreateLogger("Ceryx.Agent.Pairing");

        if (string.IsNullOrWhiteSpace(request.PairingId))
        {
            return InvalidPairingPayload(context, "pairingId is required.");
        }

        var approval = await pairingStateMachine.ApproveOnDesktopAsync(
            request.PairingId.Trim(),
            context.RequestAborted);
        if (!approval.IsApproved)
        {
            return Results.Json(
                new PairingDesktopConfirmResponse(
                    Ok: false,
                    State: "rejected",
                    Code: null),
                statusCode: StatusCodes.Status404NotFound);
        }

        return TypedResults.Ok(new PairingDesktopConfirmResponse(
            Ok: true,
            State: approval.State,
            Code: approval.Code));
    }

    private static async Task<IResult> PairingConfirmHandler(
        PairingConfirmBody request,
        PairingCompletionService pairingCompletionService,
        ILoggerFactory loggerFactory,
        HttpContext context)
    {
        if (string.IsNullOrWhiteSpace(request.PairingId) || string.IsNullOrWhiteSpace(request.Code))
        {
            return InvalidPairingPayload(context, "pairingId and code are required.");
        }

        var logger = loggerFactory.CreateLogger("Ceryx.Agent.Pairing");
        PairingCompletionResult result;
        try
        {
            result = await pairingCompletionService.ConfirmAsync(
                request.PairingId.Trim(),
                request.Code.Trim(),
                context.RequestAborted);
        }
        catch (SqliteException ex)
        {
            var traceId = context.GetOrCreateTraceId();
            logger.LogError(
                ex,
                "Pairing confirm storage failure. traceId={TraceId} sqliteCode={SqliteCode} sqliteExtendedCode={SqliteExtendedCode}",
                traceId,
                ex.SqliteErrorCode,
                ex.SqliteExtendedErrorCode);
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_STORAGE_IO",
                Message: "Failed to persist trusted device during pairing.",
                TraceId: traceId,
                Hint: "Retry pairing. If this repeats, restart Agent and check writable access to .workspace-data/agent."));
        }
        catch (Exception ex)
        {
            var traceId = context.GetOrCreateTraceId();
            logger.LogError(
                ex,
                "Pairing confirm unexpected failure. traceId={TraceId}",
                traceId);
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_PAIRING_CONFIRM_FAILED",
                Message: "Pairing confirmation failed unexpectedly.",
                TraceId: traceId,
                Hint: "Retry pairing. If this repeats, restart Agent and review agent logs."));
        }

        if (!result.IsSuccess || result.Success is null)
        {
            logger.LogInformation(
                "Pairing confirm rejected. state={State} isLocked={IsLocked} failedAttempts={FailedAttempts}",
                result.State,
                result.IsLocked,
                result.FailedAttempts);

            return Results.Json(
                new PairingConfirmRejectedResponse(
                    Ok: false,
                    State: result.State,
                    IsLocked: result.IsLocked,
                    FailedAttempts: result.FailedAttempts,
                    RejectedReason: result.RejectedReason),
                statusCode: StatusCodes.Status409Conflict);
        }

        logger.LogInformation("Pairing confirm success. deviceId={DeviceId}", result.Success.DeviceId);
        return TypedResults.Ok(new PairingConfirmResponse(
            Ok: true,
            DeviceId: result.Success.DeviceId,
            DeviceToken: result.Success.DeviceToken,
            Permissions: result.Success.Permissions.Select(static permission => permission.ToWireValue()).ToArray()));
    }

    private static async Task<IResult> ListDevicesHandler(
        HttpContext context,
        ITrustedDeviceStore trustedDeviceStore)
    {
        var devices = await trustedDeviceStore.ListAsync(context.RequestAborted);
        var response = devices.Select(static device => new TrustedDeviceResponse(
            Id: device.DeviceId,
            Name: device.Name,
            Platform: device.Platform,
            Permissions: device.Permissions.Select(static permission => permission.ToWireValue()).ToArray(),
            AutoConnect: true,
            CreatedAt: device.CreatedAt.ToString("O"),
            LastConnectedAt: null));
        return TypedResults.Ok(response);
    }

    private static async Task<IResult> DeleteDeviceHandler(
        HttpContext context,
        string deviceId,
        HighRiskConfirmationBody? body,
        ITrustedDeviceStore trustedDeviceStore,
        IAuditLogStore auditLogStore)
    {
        if (string.IsNullOrWhiteSpace(deviceId))
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_PROJECT_INVALID_REQUEST",
                Message: "deviceId is required.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Provide a valid deviceId."));
        }

        if (!IsHighRiskConfirmed(body))
        {
            await WriteAuditAsync(
                auditLogStore,
                context,
                "device.delete.rejected",
                $"device={ResolveAuditDeviceId(context)};target={deviceId};result=rejected;reason=confirm_required",
                severity: "warning");
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_CONFIRM_REQUIRED",
                Message: "High-risk action requires confirmHighRisk=true.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Send confirmHighRisk=true to delete trusted device."));
        }

        var deleted = await trustedDeviceStore.DeleteAsync(deviceId, context.RequestAborted);
        await WriteAuditAsync(
            auditLogStore,
            context,
            "device.delete.completed",
            $"device={ResolveAuditDeviceId(context)};target={deviceId};result={(deleted ? "deleted" : "not_found")}",
            severity: deleted ? "info" : "warning");
        return TypedResults.Ok(new DeviceDeleteResponse(
            Ok: true,
            Deleted: deleted));
    }

    private static async Task<IResult> GetCodexWindowHandler(ICodexWindowLocator locator)
    {
        var snapshot = await locator.GetWindowAsync();
        return TypedResults.Ok(ToCodexWindowResponse(snapshot));
    }

    private static async Task<IResult> FocusCodexWindowHandler(ICodexWindowLocator locator)
    {
        var snapshot = await locator.FocusAsync();
        return TypedResults.Ok(ToCodexWindowResponse(snapshot));
    }

    private static async Task<IResult> RefreshCodexWindowHandler(ICodexWindowLocator locator)
    {
        var snapshot = await locator.RefreshAsync();
        return TypedResults.Ok(ToCodexWindowResponse(snapshot));
    }

    private static async Task<IResult> SelectCodexWindowHandler(HttpContext context, CodexSelectWindowBody body, ICodexWindowLocator locator)
    {
        if (string.IsNullOrWhiteSpace(body.WindowId))
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_CODEX_NOT_FOUND",
                Message: "windowId is required.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Provide a valid windowId from /api/v1/codex/windows or /api/v1/codex/window."));
        }

        var snapshot = await locator.SelectWindowAsync(body.WindowId);
        return TypedResults.Ok(ToCodexWindowResponse(snapshot));
    }

    private static async Task<IResult> ListCodexWindowsHandler(ICodexWindowLocator locator)
    {
        var snapshot = await locator.ListWindowsAsync();
        return TypedResults.Ok(ToCodexWindowListResponse(snapshot));
    }

    private static async Task<IResult> InputKeyHandler(
        HttpContext context,
        InputKeyBody body,
        ICodexWindowLocator locator,
        ISessionLockService lockService,
        IInputBridge inputBridge,
        IAuditLogStore auditLogStore)
    {
        var prepare = await PrepareInputContextAsync(context, locator, lockService, auditLogStore);
        if (!prepare.IsSuccess || prepare.Context is null)
        {
            return prepare.ErrorResult!;
        }

        var result = await inputBridge.ExecuteKeyAsync(prepare.Context, body, context.RequestAborted);
        await WriteAuditAsync(auditLogStore, context, "input.key.accepted", result.Message);
        return TypedResults.Ok(new InputActionResponse(
            Ok: result.IsAccepted,
            Action: result.Action,
            Status: result.Status,
            Message: result.Message));
    }

    private static async Task<IResult> InputMouseHandler(
        HttpContext context,
        InputMouseBody body,
        ICodexWindowLocator locator,
        ISessionLockService lockService,
        IInputBridge inputBridge,
        IAuditLogStore auditLogStore)
    {
        var prepare = await PrepareInputContextAsync(context, locator, lockService, auditLogStore);
        if (!prepare.IsSuccess || prepare.Context is null)
        {
            return prepare.ErrorResult!;
        }

        var result = await inputBridge.ExecuteMouseAsync(prepare.Context, body, context.RequestAborted);
        await WriteAuditAsync(auditLogStore, context, "input.mouse.accepted", result.Message);
        return TypedResults.Ok(new InputActionResponse(
            Ok: result.IsAccepted,
            Action: result.Action,
            Status: result.Status,
            Message: result.Message));
    }

    private static async Task<IResult> InputMappedHandler<TBody>(
        HttpContext context,
        string action,
        TBody body,
        ICodexWindowLocator locator,
        ISessionLockService lockService,
        Func<IReadOnlyList<string>> mapOperation,
        IAuditLogStore auditLogStore)
    {
        var prepare = await PrepareInputContextAsync(context, locator, lockService, auditLogStore);
        if (!prepare.IsSuccess || prepare.Context is null)
        {
            return prepare.ErrorResult!;
        }

        _ = mapOperation();
        var message = $"{action} accepted for window {prepare.Context.WindowId}";
        await WriteAuditAsync(auditLogStore, context, $"{action}.accepted", message);
        return TypedResults.Ok(new InputActionResponse(
            Ok: true,
            Action: action,
            Status: "applied",
            Message: message));
    }

    private static async Task<IResult> PromptSendHandler(
        HttpContext context,
        PromptSendBody body,
        ICodexWindowLocator locator,
        ISessionLockService lockService,
        IPromptBridgeService promptBridgeService,
        IAuditLogStore auditLogStore)
    {
        var prepare = await PrepareInputContextAsync(context, locator, lockService, auditLogStore);
        if (!prepare.IsSuccess || prepare.Context is null)
        {
            return prepare.ErrorResult!;
        }

        var response = await promptBridgeService.SendPromptAsync(prepare.Context, body, context.RequestAborted);
        await WriteAuditAsync(
            auditLogStore,
            context,
            "prompt.send.accepted",
            $"submitted={response.Submitted}");
        return TypedResults.Ok(response);
    }

    private static async Task<IResult> ClipboardSendHandler(
        HttpContext context,
        ClipboardSendBody body,
        IClipboardService clipboardService,
        IAuditLogStore auditLogStore)
    {
        if (string.IsNullOrWhiteSpace(body.Type))
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_CLIPBOARD_INVALID_REQUEST",
                Message: "Clipboard type is required.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Use type=text or type=image."));
        }

        var result = await clipboardService.SetAsync(
            new ClipboardWriteRequest(
                Type: body.Type,
                Content: body.Content ?? string.Empty,
                MimeType: body.MimeType),
            context.RequestAborted);
        if (!result.IsSuccess || result.Value is null)
        {
            return ErrorFromAgentError(context, result.Error ?? new AgentError(
                Code: "E_CLIPBOARD_INVALID_REQUEST",
                Message: "Failed to write clipboard payload.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Check clipboard request payload and retry."));
        }

        await WriteAuditAsync(
            auditLogStore,
            context,
            "clipboard.send",
            $"type={result.Value.Type};mimeType={result.Value.MimeType};sizeBytes={result.Value.SizeBytes}");
        return TypedResults.Ok(new ClipboardSendResponse(
            Ok: true,
            Type: result.Value.Type,
            MimeType: result.Value.MimeType,
            SizeBytes: result.Value.SizeBytes));
    }

    private static async Task<IResult> ClipboardReceiveHandler(
        HttpContext context,
        IClipboardService clipboardService,
        IAuditLogStore auditLogStore)
    {
        var result = await clipboardService.GetAsync(context.RequestAborted);
        if (!result.IsSuccess || result.Value is null)
        {
            return ErrorFromAgentError(context, result.Error ?? new AgentError(
                Code: "E_CLIPBOARD_EMPTY",
                Message: "Clipboard is empty.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Send clipboard content before receiving."));
        }

        await WriteAuditAsync(
            auditLogStore,
            context,
            "clipboard.receive",
            $"type={result.Value.Type};mimeType={result.Value.MimeType};sizeBytes={result.Value.SizeBytes}");
        return TypedResults.Ok(new ClipboardReceiveResponse(
            Ok: true,
            Type: result.Value.Type,
            Content: result.Value.Content,
            MimeType: result.Value.MimeType,
            SizeBytes: result.Value.SizeBytes));
    }

    private static async Task<IResult> ClipboardClearHandler(
        HttpContext context,
        IClipboardService clipboardService,
        IAuditLogStore auditLogStore)
    {
        await clipboardService.ClearAsync(context.RequestAborted);
        await WriteAuditAsync(auditLogStore, context, "clipboard.clear", "cleared=true");
        return TypedResults.Ok(new ClipboardClearResponse(
            Ok: true,
            Cleared: true));
    }

    private static async Task<IResult> CaptureStartHandler(
        HttpContext context,
        CaptureStartBody body,
        ICodexWindowLocator locator,
        ICaptureLifecycleService captureLifecycleService,
        IAuditLogStore auditLogStore)
    {
        CodexWindowSnapshot window;
        if (!string.IsNullOrWhiteSpace(body.WindowId))
        {
            window = await FindCodexWindowAsync(locator, body.WindowId, context.RequestAborted);
            if (window.WindowId is null)
            {
                return ErrorFromAgentError(context, new AgentError(
                    Code: "E_CODEX_NOT_FOUND",
                    Message: "Codex window is not available for capture.",
                    TraceId: context.GetOrCreateTraceId(),
                    Hint: "Provide a valid windowId from /api/v1/codex/windows or /api/v1/codex/window."));
            }

            await locator.SelectWindowAsync(window.WindowId, context.RequestAborted);
        }
        else
        {
            window = await locator.GetWindowAsync(context.RequestAborted);
        }

        var result = await captureLifecycleService.StartAsync(body, window, context.RequestAborted);
        if (!result.IsSuccess || result.Value is null)
        {
            return ErrorFromAgentError(context, result.Error ?? new AgentError("E_CAPTURE_FAILED", "Failed to start capture.", context.GetOrCreateTraceId()));
        }

        await WriteAuditAsync(
            auditLogStore,
            context,
            "capture.started",
            $"mode={result.Value.Mode};window={result.Value.WindowId}");
        return TypedResults.Ok(ToCaptureStateResponse(result.Value));
    }

    private static async Task<IResult> CaptureStopHandler(ICaptureLifecycleService captureLifecycleService)
    {
        var state = await captureLifecycleService.StopAsync();
        return TypedResults.Ok(ToCaptureStateResponse(state));
    }

    private static IResult CaptureStateHandler(ICaptureLifecycleService captureLifecycleService, IRecordingService recordingService)
    {
        return TypedResults.Ok(ToCaptureStateResponse(captureLifecycleService.CurrentState, recordingService.IsAudioActive));
    }

    private static async Task<IResult> CaptureFrameHandler(
        HttpContext context,
        string? windowId,
        ICodexWindowLocator locator,
        ICaptureLifecycleService captureLifecycleService,
        IFramePreviewService framePreviewService)
    {
        var captureState = captureLifecycleService.CurrentState;
        var requestedWindowId = !string.IsNullOrWhiteSpace(windowId) ? windowId : captureState.WindowId;
        var window = !string.IsNullOrWhiteSpace(requestedWindowId)
            ? await FindCodexWindowAsync(locator, requestedWindowId!, context.RequestAborted)
            : await locator.GetWindowAsync(context.RequestAborted);
        if (window.WindowId is null)
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_CODEX_NOT_FOUND",
                Message: "Codex window is not available for capture preview.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Provide a valid windowId from /api/v1/codex/windows or /api/v1/codex/window."));
        }

        var frame = await framePreviewService.CaptureLatestAsync(window, captureState, context.RequestAborted);
        if (!frame.IsSuccess || frame.Value is null)
        {
            return ErrorFromAgentError(context, frame.Error ?? new AgentError(
                "E_CAPTURE_FAILED",
                "Failed to capture frame preview.",
                context.GetOrCreateTraceId()));
        }

        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers["X-Ceryx-Frame-Captured-At"] = frame.Value.CapturedAt.ToString("O");
        context.Response.Headers["X-Ceryx-Frame-Width"] = frame.Value.Width.ToString();
        context.Response.Headers["X-Ceryx-Frame-Height"] = frame.Value.Height.ToString();
        return Results.File(frame.Value.Bytes, frame.Value.ContentType);
    }

    private static async Task<IResult> CaptureSignalHandler(
        CaptureSignalBody body,
        ICaptureSignalService signalService)
    {
        var response = await signalService.SubmitSignalAsync(body);
        return TypedResults.Ok(response);
    }

    private static async Task<IResult> FileUploadHandler(
        HttpContext context,
        IFileTransferService fileTransferService,
        IAuditLogStore auditLogStore)
    {
        if (!context.Request.HasFormContentType)
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_FILE_INVALID_REQUEST",
                Message: "multipart/form-data is required.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Send file uploads as multipart/form-data."));
        }

        var form = await context.Request.ReadFormAsync(context.RequestAborted);
        var file = form.Files.FirstOrDefault();
        if (file is null)
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_FILE_INVALID_REQUEST",
                Message: "No file provided.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Include a file field in the multipart form."));
        }

        var targetPath = form["targetPath"].FirstOrDefault();
        await using var stream = file.OpenReadStream();
        var uploadResult = await fileTransferService.UploadAsync(
            file.FileName,
            file.ContentType,
            targetPath,
            stream,
            context.RequestAborted);

        if (!uploadResult.IsSuccess || uploadResult.Value is null)
        {
            return ErrorFromAgentError(context, uploadResult.Error ?? new AgentError(
                Code: "E_FILE_UPLOAD_FAILED",
                Message: "Failed to upload file.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Retry the upload or choose a smaller file."));
        }

        await WriteAuditAsync(
            auditLogStore,
            context,
            "file.upload",
            $"fileId={uploadResult.Value.FileId};fileName={uploadResult.Value.FileName};sizeBytes={uploadResult.Value.SizeBytes};targetPath={uploadResult.Value.TargetPath ?? ""}");

        return TypedResults.Ok(new FileTransferUploadResponse(
            Ok: true,
            FileId: uploadResult.Value.FileId,
            FileName: uploadResult.Value.FileName,
            SizeBytes: uploadResult.Value.SizeBytes,
            MimeType: uploadResult.Value.MimeType,
            StoredPath: uploadResult.Value.StoredPath,
            UploadedAt: uploadResult.Value.UploadedAt,
            TargetPath: uploadResult.Value.TargetPath));
    }

    private static async Task<IResult> FileListHandler(
        HttpContext context,
        string? path,
        int? limit,
        IFileTransferService fileTransferService,
        IAuditLogStore auditLogStore)
    {
        var effectiveLimit = limit ?? 100;
        if (effectiveLimit <= 0 || effectiveLimit > 500)
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_FILE_INVALID_REQUEST",
                Message: "limit must be between 1 and 500.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Retry with a smaller limit."));
        }

        var result = await fileTransferService.ListAsync(path, effectiveLimit, context.RequestAborted);
        if (!result.IsSuccess || result.Value is null)
        {
            return ErrorFromAgentError(context, result.Error ?? new AgentError(
                Code: "E_FILE_UPLOAD_FAILED",
                Message: "Failed to load file list.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Retry or verify the uploads directory is accessible."));
        }

        await WriteAuditAsync(
            auditLogStore,
            context,
            "file.list",
            $"path={path ?? "uploads"};limit={effectiveLimit};total={result.Value.Count}");

        var entries = result.Value
            .Select(static file => new FileTransferEntryResponse(
                FileId: file.FileId,
                FileName: file.FileName,
                SizeBytes: file.SizeBytes,
                MimeType: file.MimeType,
                StoredPath: file.StoredPath,
                UploadedAt: file.UploadedAt,
                TargetPath: file.TargetPath))
            .ToArray();

        return TypedResults.Ok(new FileTransferListResponse(
            Ok: true,
            Path: path ?? "uploads",
            Limit: effectiveLimit,
            Total: entries.Length,
            Files: entries));
    }

    private static async Task<IResult> FileDownloadHandler(
        HttpContext context,
        string fileId,
        IFileTransferService fileTransferService,
        IAuditLogStore auditLogStore)
    {
        var result = await fileTransferService.GetAsync(fileId, context.RequestAborted);
        if (!result.IsSuccess || result.Value is null)
        {
            return ErrorFromAgentError(context, result.Error ?? new AgentError(
                Code: "E_FILE_NOT_FOUND",
                Message: $"File '{fileId}' was not found.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Upload the file first."));
        }

        if (!File.Exists(result.Value.StoredPath))
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_FILE_NOT_FOUND",
                Message: $"File '{fileId}' was not found on disk.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Upload the file again."));
        }

        await WriteAuditAsync(
            auditLogStore,
            context,
            "file.download",
            $"fileId={result.Value.FileId};fileName={result.Value.FileName};sizeBytes={result.Value.SizeBytes}");

        var fileStream = File.Open(
            result.Value.StoredPath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read);
        return Results.File(
            fileStream,
            string.IsNullOrWhiteSpace(result.Value.MimeType) ? "application/octet-stream" : result.Value.MimeType,
            fileDownloadName: result.Value.FileName,
            lastModified: result.Value.UploadedAt,
            enableRangeProcessing: true);
    }

    private static async Task<IResult> FileDeleteHandler(
        HttpContext context,
        string fileId,
        IFileTransferService fileTransferService,
        IAuditLogStore auditLogStore)
    {
        var result = await fileTransferService.DeleteAsync(fileId, context.RequestAborted);
        if (!result.IsSuccess || result.Value is null)
        {
            return ErrorFromAgentError(context, result.Error ?? new AgentError(
                Code: "E_FILE_NOT_FOUND",
                Message: $"File '{fileId}' was not found.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Upload the file first."));
        }

        await WriteAuditAsync(
            auditLogStore,
            context,
            "file.delete",
            $"fileId={result.Value.FileId};fileName={result.Value.FileName};sizeBytes={result.Value.SizeBytes}");

        return TypedResults.Ok(new FileTransferDeleteResponse(
            Ok: true,
            Deleted: true,
            FileId: result.Value.FileId));
    }

    private static async Task<IResult> UploadImageHandler(
        HttpContext context,
        IUploadImageService uploadImageService,
        IImagePasteService imagePasteService,
        LocalPaths paths,
        IAuditLogStore auditLogStore)
    {
        if (!context.Request.HasFormContentType)
        {
            return InvalidPairingPayload(context, "multipart/form-data is required.");
        }

        var form = await context.Request.ReadFormAsync(context.RequestAborted);
        var file = form.Files.FirstOrDefault();
        if (file is null)
        {
            return InvalidPairingPayload(context, "No file provided.");
        }

        await using var stream = file.OpenReadStream();
        var upload = await uploadImageService.UploadImageAsync(file.FileName, stream, context.RequestAborted);
        if (!upload.IsSuccess || upload.Value is null)
        {
            return ErrorFromAgentError(context, upload.Error ?? new AgentError("E_CAPTURE_FAILED", "Upload failed.", context.GetOrCreateTraceId()));
        }

        var absolutePath = Path.Combine(paths.Uploads, upload.Value.FileName);
        var pasted = await imagePasteService.TryPasteImageAsync(absolutePath, context.RequestAborted);
        await WriteAuditAsync(
            auditLogStore,
            context,
            "assets.upload-image.accepted",
            $"assetId={upload.Value.AssetId};pasted={pasted}");
        return TypedResults.Ok(upload.Value);
    }

    private static async Task<IResult> ProjectDiffSummaryHandler(
        HttpContext context,
        string? projectId,
        IProjectConfigRepository projectConfigRepository,
        IGitDiffService gitDiffService)
    {
        var projectResult = await ResolveProjectConfigAsync(context, projectId, projectConfigRepository);
        if (!projectResult.IsSuccess || projectResult.Value is null)
        {
            return ErrorFromAgentError(context, projectResult.Error!);
        }

        var changesResult = await gitDiffService.ListChangedFilesAsync(projectResult.Value, context.RequestAborted);
        if (!changesResult.IsSuccess || changesResult.Value is null)
        {
            return ErrorFromAgentError(context, changesResult.Error ?? new AgentError(
                Code: "E_PROJECT_GIT_FAILED",
                Message: "Failed to load project diff.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Verify the project root is a valid git repository."));
        }

        var changedCount = changesResult.Value.Count;
        var summary = changedCount == 0
            ? "No changed files detected."
            : $"{changedCount} changed file(s) ready for review.";

        return TypedResults.Ok(new ProjectDiffResponse(
            Ok: true,
            Status: "ready",
            Summary: summary,
            DiffText: null));
    }

    private static async Task<IResult> ProjectDiffFilesHandler(
        HttpContext context,
        string? projectId,
        int? page,
        int? pageSize,
        IProjectConfigRepository projectConfigRepository,
        IGitDiffService gitDiffService)
    {
        var requestedPage = page ?? 1;
        var requestedPageSize = pageSize ?? 100;
        if (requestedPage <= 0)
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_PROJECT_INVALID_REQUEST",
                Message: "page must be >= 1.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Retry with page >= 1."));
        }

        if (requestedPageSize <= 0 || requestedPageSize > 500)
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_PROJECT_INVALID_REQUEST",
                Message: "pageSize must be between 1 and 500.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Retry with pageSize in [1, 500]."));
        }

        var projectResult = await ResolveProjectConfigAsync(context, projectId, projectConfigRepository);
        if (!projectResult.IsSuccess || projectResult.Value is null)
        {
            return ErrorFromAgentError(context, projectResult.Error!);
        }

        var changesResult = await gitDiffService.ListChangedFilesAsync(projectResult.Value, context.RequestAborted);
        if (!changesResult.IsSuccess || changesResult.Value is null)
        {
            return ErrorFromAgentError(context, changesResult.Error ?? new AgentError(
                Code: "E_PROJECT_GIT_FAILED",
                Message: "Failed to load changed files.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Verify the project root is a valid git repository."));
        }

        var fileEntries = changesResult.Value
            .Select(static change => new ProjectDiffFileEntryResponse(
                Path: change.Path,
                Status: change.Status,
                Additions: change.Additions,
                Deletions: change.Deletions))
            .ToArray();
        var total = fileEntries.Length;
        var skip = (requestedPage - 1) * requestedPageSize;
        var pagedEntries = skip >= total
            ? Array.Empty<ProjectDiffFileEntryResponse>()
            : fileEntries.Skip(skip).Take(requestedPageSize).ToArray();

        return TypedResults.Ok(new ProjectDiffFilesResponse(
            Ok: true,
            ProjectId: projectResult.Value.Id,
            ProjectName: projectResult.Value.ProjectName,
            Page: requestedPage,
            PageSize: requestedPageSize,
            Total: total,
            HasMore: skip + pagedEntries.Length < total,
            Files: pagedEntries));
    }

    private static async Task<IResult> ProjectDiffFileHandler(
        HttpContext context,
        string? projectId,
        string? path,
        IProjectConfigRepository projectConfigRepository,
        IGitDiffService gitDiffService)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_PROJECT_INVALID_REQUEST",
                Message: "path query parameter is required.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Provide a project-relative path from /api/v1/project/diff/files."));
        }

        var projectResult = await ResolveProjectConfigAsync(context, projectId, projectConfigRepository);
        if (!projectResult.IsSuccess || projectResult.Value is null)
        {
            return ErrorFromAgentError(context, projectResult.Error!);
        }

        var lineLimit = ResolveDiffLineLimit();
        var diffResult = await gitDiffService.GetFileDiffAsync(
            projectResult.Value,
            path,
            lineLimit,
            context.RequestAborted);

        if (!diffResult.IsSuccess || diffResult.Value is null)
        {
            return ErrorFromAgentError(context, diffResult.Error ?? new AgentError(
                Code: "E_PROJECT_GIT_FAILED",
                Message: "Failed to load file diff.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Retry with a valid file path from /api/v1/project/diff/files."));
        }

        var file = diffResult.Value;
        return TypedResults.Ok(new ProjectDiffFileResponse(
            Ok: true,
            ProjectId: projectResult.Value.Id,
            Path: file.Path,
            Status: file.Status,
            Additions: file.Additions,
            Deletions: file.Deletions,
            DiffText: file.DiffText,
            Truncated: file.Truncated,
            LineLimit: file.LineLimit));
    }

    private static async Task<IResult> ProjectFilesHandler(
        HttpContext context,
        string? projectId,
        string? query,
        int? limit,
        IProjectConfigRepository projectConfigRepository,
        IProjectFileIndexService projectFileIndexService)
    {
        var effectiveLimit = limit ?? 400;
        if (effectiveLimit <= 0 || effectiveLimit > 2000)
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_PROJECT_INVALID_REQUEST",
                Message: "limit must be between 1 and 2000.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Retry with limit in [1, 2000]."));
        }

        var projectResult = await ResolveProjectConfigAsync(context, projectId, projectConfigRepository);
        if (!projectResult.IsSuccess || projectResult.Value is null)
        {
            return ErrorFromAgentError(context, projectResult.Error!);
        }

        var filesResult = await projectFileIndexService.ListFilesAsync(
            projectResult.Value,
            query,
            effectiveLimit,
            context.RequestAborted);
        if (!filesResult.IsSuccess || filesResult.Value is null)
        {
            return ErrorFromAgentError(context, filesResult.Error ?? new AgentError(
                Code: "E_PROJECT_GIT_FAILED",
                Message: "Failed to build project file index.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Verify the project root is a valid git repository."));
        }

        var files = filesResult.Value
            .Select(static file => new ProjectIndexedFileResponse(
                Path: file.Path,
                Extension: file.Extension,
                Tracked: file.IsTracked,
                Changed: file.IsChanged))
            .ToArray();

        return TypedResults.Ok(new ProjectFilesResponse(
            Ok: true,
            ProjectId: projectResult.Value.Id,
            ProjectName: projectResult.Value.ProjectName,
            GeneratedAt: DateTimeOffset.UtcNow.ToString("O"),
            Files: files));
    }

    private static async Task<IResult> ProjectTestRequestHandler(
        HttpContext context,
        ProjectTestRequestBody body,
        IAuditLogStore auditLogStore)
    {
        var scope = NormalizeQueryValue(body.Scope) ?? "changed-modules";
        var requestId = "testreq_" + Guid.NewGuid().ToString("N");

        await WriteAuditAsync(
            auditLogStore,
            context,
            "project.test-request.accepted",
            $"requestId={requestId};scope={scope};status=accepted");

        return TypedResults.Ok(new ProjectTestResponse(
            Ok: true,
            Status: "accepted",
            Message: "Test request submitted.",
            RequestId: requestId));
    }

    private static async Task<IResult> ProjectTasksHandler(
        HttpContext context,
        int? promptLimit,
        IAuditLogStore auditLogStore)
    {
        var effectivePromptLimit = promptLimit ?? 8;
        if (effectivePromptLimit <= 0 || effectivePromptLimit > 40)
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_PROJECT_INVALID_REQUEST",
                Message: "promptLimit must be between 1 and 40.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Retry with promptLimit in [1, 40]."));
        }

        var logs = await auditLogStore.QueryAsync(
            new AuditLogQuery(Page: 1, PageSize: 240),
            context.RequestAborted);

        var promptActions = logs.Items
            .Where(static item =>
                item.Action.StartsWith("prompt.send", StringComparison.OrdinalIgnoreCase))
            .Take(effectivePromptLimit)
            .Select(static item => new ProjectTaskPromptActionResponse(
                Id: item.Id,
                Action: item.Action,
                Details: item.Details,
                Severity: item.Severity,
                SessionId: item.SessionId,
                CreatedAt: item.CreatedAt.ToString("O")))
            .ToArray();

        var latestTestRequest = logs.Items.FirstOrDefault(static item =>
            item.Action.StartsWith("project.test-request", StringComparison.OrdinalIgnoreCase));
        var testRequestDetails = ParseKeyValueDetails(latestTestRequest?.Details);
        var testRequestStatus = latestTestRequest is null
            ? new ProjectTestRequestStateResponse(
                Status: "idle",
                RequestId: null,
                Scope: null,
                Message: "No test request submitted.",
                RequestedAt: null)
            : new ProjectTestRequestStateResponse(
                Status: ResolveTaskStatus(testRequestDetails, "status", "accepted"),
                RequestId: ResolveTaskStatus(testRequestDetails, "requestId"),
                Scope: ResolveTaskStatus(testRequestDetails, "scope"),
                Message: "Latest test request tracked from audit events.",
                RequestedAt: latestTestRequest.CreatedAt.ToString("O"));

        var latestAction = promptActions.FirstOrDefault()?.Action ?? latestTestRequest?.Action;
        var updatedAt = promptActions.FirstOrDefault()?.CreatedAt
            ?? latestTestRequest?.CreatedAt.ToString("O")
            ?? DateTimeOffset.UtcNow.ToString("O");
        var taskState = new ProjectTaskStateResponse(
            Status: latestAction is null ? "idle" : "active",
            CurrentAction: latestAction,
            UpdatedAt: updatedAt);

        return TypedResults.Ok(new ProjectTasksResponse(
            Ok: true,
            TaskState: taskState,
            RecentPromptActions: promptActions,
            TestRequest: testRequestStatus));
    }

    private static async Task<IResult> NotificationsHandler(
        HttpContext context,
        int? limit,
        IAuditLogStore auditLogStore,
        INotificationStateStore notificationStateStore)
    {
        var effectiveLimit = limit ?? 60;
        if (effectiveLimit <= 0 || effectiveLimit > 200)
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_LOGS_INVALID_REQUEST",
                Message: "limit must be between 1 and 200.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Retry with limit in [1, 200]."));
        }

        var logs = await auditLogStore.QueryAsync(
            new AuditLogQuery(Page: 1, PageSize: effectiveLimit),
            context.RequestAborted);
        var clearedBefore = await notificationStateStore.GetClearedBeforeAsync(context.RequestAborted);
        var ids = logs.Items.Select(static item => item.Id).ToArray();
        var readIds = await notificationStateStore.GetReadIdsAsync(ids, context.RequestAborted);

        var items = logs.Items
            .Select(item =>
            {
                var isRead = readIds.Contains(item.Id) ||
                    (clearedBefore is DateTimeOffset cleared && item.CreatedAt <= cleared);
                return new NotificationEntryResponse(
                    Id: item.Id,
                    Title: BuildNotificationTitle(item.Action),
                    Message: string.IsNullOrWhiteSpace(item.Details)
                        ? $"Audit event: {item.Action}"
                        : item.Details,
                    Severity: item.Severity,
                    CreatedAt: item.CreatedAt.ToString("O"),
                    Read: isRead);
            })
            .ToArray();

        var unread = items.Count(static item => !item.Read);
        return TypedResults.Ok(new NotificationsResponse(
            Ok: true,
            Total: items.Length,
            Unread: unread,
            Items: items));
    }

    private static async Task<IResult> NotificationReadHandler(
        HttpContext context,
        string notificationId,
        INotificationStateStore notificationStateStore)
    {
        if (string.IsNullOrWhiteSpace(notificationId))
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_PROJECT_INVALID_REQUEST",
                Message: "notificationId is required.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Pass a valid notification id from GET /api/v1/notifications."));
        }

        await notificationStateStore.MarkReadAsync(notificationId, context.RequestAborted);
        return TypedResults.Ok(new NotificationReadResponse(
            Ok: true,
            Id: notificationId,
            Read: true));
    }

    private static async Task<IResult> NotificationClearHandler(
        HttpContext context,
        INotificationStateStore notificationStateStore)
    {
        var clearedBefore = DateTimeOffset.UtcNow;
        await notificationStateStore.ClearAllAsync(clearedBefore, context.RequestAborted);
        return TypedResults.Ok(new NotificationClearResponse(
            Ok: true,
            ClearedBefore: clearedBefore.ToString("O")));
    }

    private static async Task<IResult> ScreenshotHandler(
        HttpContext context,
        string? windowId,
        IScreenshotService screenshotService,
        ICodexWindowLocator locator,
        IAuditLogStore auditLogStore)
    {
        var window = !string.IsNullOrWhiteSpace(windowId)
            ? await FindCodexWindowAsync(locator, windowId, context.RequestAborted)
            : await locator.GetWindowAsync(context.RequestAborted);
        if (window.WindowId is null)
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_CODEX_NOT_FOUND",
                Message: "Codex window is not available for screenshot.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Provide a valid windowId from /api/v1/codex/windows or /api/v1/codex/window."));
        }

        var screenshot = await screenshotService.CaptureAsync(window, context.RequestAborted);
        if (!screenshot.IsSuccess || screenshot.Value is null)
        {
            return ErrorFromAgentError(context, screenshot.Error ?? new AgentError("E_CAPTURE_FAILED", "Screenshot failed.", context.GetOrCreateTraceId()));
        }

        await WriteAuditAsync(
            auditLogStore,
            context,
            "media.screenshot.accepted",
            screenshot.Value.FileName);
        return TypedResults.Ok(screenshot.Value);
    }

    private static async Task<IResult> RecordingStartHandler(
        HttpContext context,
        RecordingStartBody? body,
        IRecordingService recordingService,
        ICodexWindowLocator locator,
        IAuditLogStore auditLogStore)
    {
        if (!IsHighRiskConfirmed(body))
        {
            await WriteAuditAsync(
                auditLogStore,
                context,
                "media.recording.start.rejected",
                $"device={ResolveAuditDeviceId(context)};result=rejected;reason=confirm_required",
                severity: "warning");
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_CONFIRM_REQUIRED",
                Message: "High-risk action requires confirmHighRisk=true.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Send confirmHighRisk=true to start recording."));
        }

        var window = await locator.GetWindowAsync(context.RequestAborted);
        var result = await recordingService.StartAsync(window, body, context.RequestAborted);
        if (!result.IsSuccess || result.Value is null)
        {
            await WriteAuditAsync(
                auditLogStore,
                context,
                "media.recording.start.rejected",
                $"device={ResolveAuditDeviceId(context)};result=rejected;reason={(result.Error?.Code ?? "unknown")}",
                severity: "warning");
            return ErrorFromAgentError(context, result.Error ?? new AgentError("E_RECORDING_BUSY", "Failed to start recording.", context.GetOrCreateTraceId()));
        }

        await WriteAuditAsync(
            auditLogStore,
            context,
            "media.recording.started",
            $"device={ResolveAuditDeviceId(context)};result=started;startedAt={result.Value.StartedAt}");
        return TypedResults.Ok(result.Value);
    }

    private static async Task<IResult> RecordingListHandler(
        HttpContext context,
        int? limit,
        IRecordingCatalogService recordingCatalogService,
        IAuditLogStore auditLogStore)
    {
        var result = await recordingCatalogService.ListAsync(Math.Clamp(limit ?? 100, 1, 200), context.RequestAborted);
        if (!result.IsSuccess || result.Value is null)
        {
            return ErrorFromAgentError(context, result.Error ?? new AgentError(
                Code: "E_RECORDING_NOT_FOUND",
                Message: "Failed to list recordings.",
                TraceId: context.GetOrCreateTraceId()));
        }

        await WriteAuditAsync(
            auditLogStore,
            context,
            "media.recordings.listed",
            $"device={ResolveAuditDeviceId(context)};count={result.Value.Count}");
        return TypedResults.Ok(new RecordingListResponse(
            Ok: true,
            Total: result.Value.Count,
            Items: result.Value.Select(entry => new RecordingEntryResponse(
                RecordingId: entry.RecordingId,
                FileName: entry.FileName,
                SizeBytes: entry.SizeBytes,
                DurationSeconds: entry.DurationSeconds,
                AudioEnabled: entry.AudioEnabled,
                AudioFormat: entry.AudioFormat,
                ThumbnailFileName: entry.ThumbnailFileName,
                OutputPaths: entry.OutputPaths,
                StartedAt: entry.StartedAt,
                StoppedAt: entry.StoppedAt)).ToArray()));
    }

    private static async Task<IResult> RecordingDownloadHandler(
        HttpContext context,
        string fileName,
        IRecordingCatalogService recordingCatalogService,
        IAuditLogStore auditLogStore)
    {
        var result = await recordingCatalogService.OpenFileAsync(fileName, context.RequestAborted);
        if (!result.IsSuccess || result.Value is null)
        {
            return ErrorFromAgentError(context, result.Error ?? new AgentError(
                Code: "E_RECORDING_NOT_FOUND",
                Message: $"Recording '{fileName}' was not found.",
                TraceId: context.GetOrCreateTraceId()));
        }

        var contentType = ResolveRecordingContentType(fileName);
        await WriteAuditAsync(
            auditLogStore,
            context,
            "media.recordings.downloaded",
            $"device={ResolveAuditDeviceId(context)};file={fileName}");
        return Results.File(result.Value, contentType, fileDownloadName: fileName);
    }

    private static string ResolveRecordingContentType(string fileName)
    {
        var extension = Path.GetExtension(fileName).ToLowerInvariant();
        return extension switch
        {
            ".mp4" => "video/mp4",
            ".mov" => "video/quicktime",
            ".mkv" => "video/x-matroska",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".wav" => "audio/wav",
            ".json" => "application/json",
            _ => "application/octet-stream"
        };
    }

    private static async Task<IResult> RecordingStopHandler(
        HttpContext context,
        IRecordingService recordingService,
        IAuditLogStore auditLogStore)
    {
        var result = await recordingService.StopAsync(context.RequestAborted);
        if (!result.IsSuccess || result.Value is null)
        {
            return ErrorFromAgentError(context, result.Error ?? new AgentError("E_RECORDING_BUSY", "Failed to stop recording.", context.GetOrCreateTraceId()));
        }

        await WriteAuditAsync(
            auditLogStore,
            context,
            "media.recording.stopped",
            result.Value.FileName);
        return TypedResults.Ok(result.Value);
    }

    private static async Task<IResult> PauseControlHandler(
        HttpContext context,
        HighRiskConfirmationBody? body,
        AgentRuntimeState runtimeState,
        ILoggerFactory loggerFactory,
        IAuditLogStore auditLogStore)
    {
        var logger = loggerFactory.CreateLogger("Ceryx.Agent.Management");

        if (!IsHighRiskConfirmed(body))
        {
            await WriteAuditAsync(
                auditLogStore,
                context,
                "agent.pause-control.rejected",
                $"device={ResolveAuditDeviceId(context)};result=rejected;reason=confirm_required",
                severity: "warning");
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_CONFIRM_REQUIRED",
                Message: "High-risk action requires confirmHighRisk=true.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Send confirmHighRisk=true to pause current task."));
        }

        var status = runtimeState.Pause();
        logger.LogInformation("Applied local management action: pause-control status={Status}", status.ToWireValue());
        await WriteAuditAsync(
            auditLogStore,
            context,
            "agent.pause-control.applied",
            $"device={ResolveAuditDeviceId(context)};result=applied");
        return TypedResults.Ok(new AgentManagementResponse(
            Ok: true,
            Action: "pause-control",
            Status: "applied",
            Executed: true,
            Message: "Agent control paused."));
    }

    private static IResult ResumeControlHandler(
        HttpContext context,
        AgentRuntimeState runtimeState,
        ILoggerFactory loggerFactory)
    {
        var logger = loggerFactory.CreateLogger("Ceryx.Agent.Management");

        var status = runtimeState.Resume();
        logger.LogInformation("Applied local management action: resume-control status={Status}", status.ToWireValue());
        return TypedResults.Ok(new AgentManagementResponse(
            Ok: true,
            Action: "resume-control",
            Status: "applied",
            Executed: true,
            Message: "Agent control resumed."));
    }

    private static async Task<IResult> OpenLogsFolderHandler(
        HttpContext context,
        IAgentTrayShell trayShell,
        ILoggerFactory loggerFactory)
    {
        var logger = loggerFactory.CreateLogger("Ceryx.Agent.Management");

        await trayShell.ExecuteAsync(TrayShellCommandIds.OpenLogsFolder, context.RequestAborted);
        logger.LogInformation("Applied local management action: open-logs-folder");
        return TypedResults.Ok(new AgentManagementResponse(
            Ok: true,
            Action: "open-logs-folder",
            Status: "applied",
            Executed: true,
            Message: "Open logs folder request forwarded to local shell."));
    }

    private static IResult RestartRequestHandler(
        HttpContext context,
        ILoggerFactory loggerFactory)
    {
        var logger = loggerFactory.CreateLogger("Ceryx.Agent.Management");

        logger.LogInformation("Accepted restart request in development mode without execution.");
        return Results.Json(
            new AgentManagementResponse(
                Ok: true,
                Action: "restart-request",
                Status: "accepted",
                Executed: false,
                Message: "Restart request accepted but not executed in development mode."),
            statusCode: StatusCodes.Status202Accepted);
    }

    private static async Task<IResult> LogsHandler(
        HttpContext context,
        int? page,
        int? pageSize,
        string? severity,
        string? action,
        string? sessionId,
        IAuditLogStore auditLogStore)
    {
        var traceId = context.GetOrCreateTraceId();
        var requestedPage = page ?? 1;
        var requestedPageSize = pageSize ?? 100;

        if (requestedPage <= 0)
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_LOGS_INVALID_REQUEST",
                Message: "page must be greater than 0.",
                TraceId: traceId,
                Hint: "Retry with page >= 1."));
        }

        if (requestedPageSize <= 0 || requestedPageSize > 200)
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_LOGS_INVALID_REQUEST",
                Message: "pageSize must be between 1 and 200.",
                TraceId: traceId,
                Hint: "Retry with pageSize in [1, 200]."));
        }

        var normalizedSeverity = NormalizeLogSeverityFilter(severity);
        if (!string.IsNullOrWhiteSpace(severity) && normalizedSeverity is null)
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_LOGS_INVALID_REQUEST",
                Message: "severity must be one of info, warning, error.",
                TraceId: traceId,
                Hint: "Retry with severity filter set to info, warning, or error."));
        }

        var query = new AuditLogQuery(
            Page: requestedPage,
            PageSize: requestedPageSize,
            Severity: normalizedSeverity,
            Action: NormalizeQueryValue(action),
            SessionId: NormalizeQueryValue(sessionId));

        var result = await auditLogStore.QueryAsync(query, context.RequestAborted);
        var items = result.Items
            .Select(static item => new AgentLogEntryResponse(
                Id: item.Id,
                Action: item.Action,
                Details: item.Details,
                Severity: item.Severity,
                SessionId: item.SessionId,
                CreatedAt: item.CreatedAt.ToString("O")))
            .ToArray();

        return TypedResults.Ok(new LogsResponse(
            Ok: true,
            Page: result.Page,
            PageSize: result.PageSize,
            Total: result.Total,
            HasMore: result.HasMore,
            Items: items));
    }

    private static async Task<IResult> GetSettingsHandler(
        HttpContext context,
        IAgentSettingsStore settingsStore)
    {
        var settings = await settingsStore.GetOrCreateAsync(context.RequestAborted);
        return TypedResults.Ok(ToSettingsResponse(settings));
    }

    private static async Task<IResult> PatchSettingsHandler(
        HttpContext context,
        SettingsPatchBody body,
        IAgentSettingsStore settingsStore,
        IAuditLogStore auditLogStore)
    {
        if (body.AgentSettings is null)
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_SETTINGS_INVALID_REQUEST",
                Message: "agentSettings is required.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Provide agentSettings patch body."));
        }

        var current = await settingsStore.GetOrCreateAsync(context.RequestAborted);
        var highRiskChanges = ResolveHighRiskChanges(body.AgentSettings, current);
        if (highRiskChanges.Count > 0 && !body.ConfirmHighRisk)
        {
            await WriteAuditAsync(
                auditLogStore,
                context,
                "settings.patch.rejected",
                $"device={ResolveAuditDeviceId(context)};result=rejected;reason=confirm_required;keys={string.Join(",", highRiskChanges)}",
                severity: "warning");
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_SETTINGS_CONFIRM_REQUIRED",
                Message: "High-risk settings require confirmHighRisk=true.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: $"High-risk keys: {string.Join(", ", highRiskChanges)}"));
        }

        var update = new AgentSettingsUpdate(
            HttpPort: body.AgentSettings.HttpPort,
            DirectTestCommand: body.AgentSettings.DirectTestCommand,
            AllowFullscreenCapture: body.AgentSettings.AllowFullscreenCapture,
            AllowClearLogs: body.AgentSettings.AllowClearLogs,
            DefaultCaptureMode: body.AgentSettings.DefaultCaptureMode);

        try
        {
            var updated = await settingsStore.UpdateAsync(update, context.RequestAborted);
            await WriteAuditAsync(
                auditLogStore,
                context,
                "settings.patch.applied",
                $"device={ResolveAuditDeviceId(context)};result=applied;keys={string.Join(",", highRiskChanges)}");
            return TypedResults.Ok(ToSettingsResponse(updated));
        }
        catch (ArgumentOutOfRangeException ex)
        {
            return ErrorFromAgentError(context, new AgentError(
                Code: "E_SETTINGS_INVALID_REQUEST",
                Message: ex.Message,
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Review provided settings values and retry."));
        }
    }

    private static IResult InvalidPairingPayload(HttpContext context, string message)
    {
        var traceId = context.GetOrCreateTraceId();
        return Results.Json(
            new StandardErrorResponse(
                Ok: false,
                Error: new StandardErrorBody(
                    Code: "E_PAIRING_INVALID_REQUEST",
                    Message: message,
                    Hint: "Check request payload and retry.",
                    TraceId: traceId)),
            statusCode: StatusCodes.Status400BadRequest);
    }

    private static IResult ErrorFromAgentError(HttpContext context, AgentError error)
    {
        var traceId = context.GetOrCreateTraceId();
        var statusCode = error.Code switch
        {
            "E_NOT_PAIRED" => StatusCodes.Status401Unauthorized,
            "E_TOKEN_INVALID" => StatusCodes.Status401Unauthorized,
            "E_PERMISSION_DENIED" => StatusCodes.Status403Forbidden,
            "E_CODEX_NOT_FOUND" => StatusCodes.Status409Conflict,
            "E_CODEX_MINIMIZED" => StatusCodes.Status409Conflict,
            "E_CAPTURE_DENIED" => StatusCodes.Status403Forbidden,
            "E_CAPTURE_INACTIVE" => StatusCodes.Status409Conflict,
            "E_CAPTURE_FAILED" => StatusCodes.Status500InternalServerError,
            "E_CLIPBOARD_INVALID_REQUEST" => StatusCodes.Status400BadRequest,
            "E_CLIPBOARD_TOO_LARGE" => StatusCodes.Status413PayloadTooLarge,
            "E_CLIPBOARD_EMPTY" => StatusCodes.Status404NotFound,
            "E_CLIPBOARD_UNAVAILABLE" => StatusCodes.Status503ServiceUnavailable,
            "E_INPUT_BLOCKED" => StatusCodes.Status409Conflict,
            "E_UPLOAD_TOO_LARGE" => StatusCodes.Status413PayloadTooLarge,
            "E_RECORDING_BUSY" => StatusCodes.Status409Conflict,
            "E_DISK_LOW" => StatusCodes.Status507InsufficientStorage,
            "E_PROJECT_INVALID_REQUEST" => StatusCodes.Status400BadRequest,
            "E_PROJECT_NOT_FOUND" => StatusCodes.Status404NotFound,
            "E_DIFF_PATH_INVALID" => StatusCodes.Status400BadRequest,
            "E_DIFF_FILE_NOT_FOUND" => StatusCodes.Status404NotFound,
            "E_PROJECT_GIT_FAILED" => StatusCodes.Status500InternalServerError,
            "E_LOGS_INVALID_REQUEST" => StatusCodes.Status400BadRequest,
            "E_SETTINGS_INVALID_REQUEST" => StatusCodes.Status400BadRequest,
            "E_SETTINGS_CONFIRM_REQUIRED" => StatusCodes.Status409Conflict,
            "E_CONFIRM_REQUIRED" => StatusCodes.Status409Conflict,
            "E_PAIRING_RATE_LIMITED" => StatusCodes.Status429TooManyRequests,
            _ => StatusCodes.Status400BadRequest
        };

        return Results.Json(new StandardErrorResponse(
            Ok: false,
            Error: new StandardErrorBody(
                Code: error.Code,
                Message: error.Message,
                Hint: error.Hint,
                TraceId: traceId)),
            statusCode: statusCode);
    }

    private static CodexWindowResponse ToCodexWindowResponse(CodexWindowSnapshot snapshot)
    {
        return new CodexWindowResponse(
            Status: snapshot.Status,
            WindowId: snapshot.WindowId,
            Title: snapshot.Title,
            ProcessName: snapshot.ProcessName,
            CandidateCount: snapshot.CandidateCount,
            LastUpdatedAt: snapshot.LastUpdatedAt.ToString("O"));
    }

    private static async Task<CodexWindowSnapshot> FindCodexWindowAsync(
        ICodexWindowLocator locator,
        string windowId,
        CancellationToken cancellationToken)
    {
        var snapshot = await locator.ListWindowsAsync(cancellationToken);
        var window = snapshot.Windows.FirstOrDefault(candidate =>
            string.Equals(candidate.WindowId, windowId, StringComparison.OrdinalIgnoreCase));
        return window ?? new CodexWindowSnapshot(
            Status: "not_found",
            WindowId: null,
            Title: null,
            ProcessName: null,
            CandidateCount: snapshot.TotalCount,
            LastUpdatedAt: snapshot.LastUpdatedAt);
    }

    private static CodexWindowListResponse ToCodexWindowListResponse(CodexWindowListSnapshot snapshot)
    {
        return new CodexWindowListResponse(
            Windows: snapshot.Windows.Select(ToCodexWindowResponse).ToArray(),
            ActiveWindowId: snapshot.ActiveWindowId,
            TotalCount: snapshot.TotalCount,
            LastUpdatedAt: snapshot.LastUpdatedAt.ToString("O"));
    }

    private static CaptureStateResponse ToCaptureStateResponse(CaptureState state, bool recordingAudioActive = false)
    {
        return new CaptureStateResponse(
            Ok: true,
            Active: state.Active,
            Paused: state.Paused,
            Mode: state.Mode,
            WindowId: state.WindowId,
            Width: state.Width,
            Height: state.Height,
            FrameRate: state.FrameRate,
            Quality: state.Quality,
            RecordingAudioActive: recordingAudioActive);
    }

    private static async Task<(bool IsSuccess, InputExecutionContext? Context, IResult? ErrorResult)> PrepareInputContextAsync(
        HttpContext context,
        ICodexWindowLocator locator,
        ISessionLockService lockService,
        IAuditLogStore auditLogStore)
    {
        var device = context.GetAuthenticatedDevice();
        if (device is null)
        {
            return (false, null, ErrorFromAgentError(context, new AgentError(
                Code: "E_NOT_PAIRED",
                Message: "Authenticated device context is missing.",
                TraceId: context.GetOrCreateTraceId())));
        }

        var window = await locator.GetWindowAsync(context.RequestAborted);
        if (window.WindowId is null || window.Status is "not_found" or "multiple_candidates" or "permission_issue")
        {
            await WriteAuditAsync(
                auditLogStore,
                context,
                "input.rejected",
                $"reason={window.Status}",
                severity: "warning");
            return (false, null, ErrorFromAgentError(context, new AgentError(
                Code: "E_CODEX_NOT_FOUND",
                Message: "Codex window is not available.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Use /api/v1/codex/window and /api/v1/codex/select-window first.")));
        }

        if (string.Equals(window.Status, "minimized", StringComparison.OrdinalIgnoreCase))
        {
            await WriteAuditAsync(
                auditLogStore,
                context,
                "input.rejected",
                "reason=minimized",
                severity: "warning");
            return (false, null, ErrorFromAgentError(context, new AgentError(
                Code: "E_CODEX_MINIMIZED",
                Message: "Codex window is minimized.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Focus Codex window and retry.")));
        }

        var lockResult = lockService.AcquireForInput(window.WindowId, device.DeviceId, DateTimeOffset.UtcNow);
        if (!lockResult.IsGranted)
        {
            await WriteAuditAsync(
                auditLogStore,
                context,
                "input.rejected",
                $"reason={lockResult.Reason};active={lockResult.ActiveDeviceId}",
                severity: "warning");
            return (false, null, ErrorFromAgentError(context, new AgentError(
                Code: "E_INPUT_BLOCKED",
                Message: "Another device currently controls input.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: $"Active controller: {lockResult.ActiveDeviceId}")));
        }

        if (lockResult.OwnershipChanged)
        {
            await WriteAuditAsync(
                auditLogStore,
                context,
                "session_lock.changed",
                $"window={window.WindowId};device={device.DeviceId}");
        }

        var executionContext = new InputExecutionContext(
            WindowId: window.WindowId,
            DeviceId: device.DeviceId,
            TraceId: context.GetOrCreateTraceId());
        return (true, executionContext, null);
    }

    private static async Task<Result<ProjectConfigRecord>> ResolveProjectConfigAsync(
        HttpContext context,
        string? projectId,
        IProjectConfigRepository projectConfigRepository)
    {
        var normalizedProjectId = NormalizeQueryValue(projectId);
        if (normalizedProjectId is null)
        {
            var defaultProject = await projectConfigRepository.GetOrCreateDefaultAsync(context.RequestAborted);
            return Result<ProjectConfigRecord>.Success(defaultProject);
        }

        var project = await projectConfigRepository.FindByIdAsync(normalizedProjectId, context.RequestAborted);
        if (project is null &&
            string.Equals(
                normalizedProjectId,
                SqliteProjectConfigRepository.DefaultProjectId,
                StringComparison.OrdinalIgnoreCase))
        {
            var defaultProject = await projectConfigRepository.GetOrCreateDefaultAsync(context.RequestAborted);
            return Result<ProjectConfigRecord>.Success(defaultProject);
        }

        if (project is null)
        {
            return Result<ProjectConfigRecord>.Failure(new AgentError(
                Code: "E_PROJECT_NOT_FOUND",
                Message: $"Project '{normalizedProjectId}' was not found.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Use a valid projectId from local project configuration."));
        }

        return Result<ProjectConfigRecord>.Success(project);
    }

    private static int ResolveDiffLineLimit()
    {
        var configured = Environment.GetEnvironmentVariable("CERYX_DIFF_LINE_LIMIT");
        if (int.TryParse(configured, out var parsed) && parsed > 0)
        {
            return parsed;
        }

        return 1200;
    }

    private static async Task WriteAuditAsync(
        IAuditLogStore auditLogStore,
        HttpContext context,
        string action,
        string details,
        string severity = "info")
    {
        await auditLogStore.WriteAsync(
            action,
            details,
            severity,
            ResolveAuditSessionId(context),
            context.RequestAborted);
    }

    private static string ResolveAuditSessionId(HttpContext context)
    {
        return context.GetAuthenticatedDevice()?.DeviceId ?? "local";
    }

    private static string ResolveAuditDeviceId(HttpContext context)
    {
        return context.GetAuthenticatedDevice()?.DeviceId ?? "local";
    }

    private static string? NormalizeQueryValue(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return value.Trim();
    }

    private static string? NormalizeLogSeverityFilter(string? severity)
    {
        var normalized = NormalizeQueryValue(severity)?.ToLowerInvariant();
        return normalized switch
        {
            null => null,
            "info" => "info",
            "warning" => "warning",
            "error" => "error",
            _ => null
        };
    }

    private static string BuildNotificationTitle(string action)
    {
        if (string.IsNullOrWhiteSpace(action))
        {
            return "System Notification";
        }

        if (action.StartsWith("prompt.send", StringComparison.OrdinalIgnoreCase))
        {
            return "Prompt Action";
        }

        if (action.StartsWith("project.test-request", StringComparison.OrdinalIgnoreCase))
        {
            return "Test Request";
        }

        if (action.StartsWith("media.", StringComparison.OrdinalIgnoreCase))
        {
            return "Media Action";
        }

        if (action.StartsWith("input.", StringComparison.OrdinalIgnoreCase))
        {
            return "Input Action";
        }

        if (action.StartsWith("capture.", StringComparison.OrdinalIgnoreCase))
        {
            return "Capture Action";
        }

        return "System Action";
    }

    private static IReadOnlyDictionary<string, string> ParseKeyValueDetails(string? details)
    {
        if (string.IsNullOrWhiteSpace(details))
        {
            return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        }

        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var segment in details.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var separatorIndex = segment.IndexOf('=');
            if (separatorIndex <= 0 || separatorIndex >= segment.Length - 1)
            {
                continue;
            }

            var key = segment[..separatorIndex].Trim();
            var value = segment[(separatorIndex + 1)..].Trim();
            if (!string.IsNullOrWhiteSpace(key))
            {
                result[key] = value;
            }
        }

        return result;
    }

    private static string ResolveTaskStatus(
        IReadOnlyDictionary<string, string> values,
        string key,
        string fallback = "")
    {
        return values.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value
            : fallback;
    }

    private static SettingsResponse ToSettingsResponse(AgentSettingsRecord settings)
    {
        return new SettingsResponse(
            Ok: true,
            UpdatedAt: settings.UpdatedAt.ToString("O"),
            AgentSettings: new AgentSettingsStateResponse(
                HttpPort: settings.HttpPort,
                DirectTestCommand: settings.DirectTestCommand,
                AllowFullscreenCapture: settings.AllowFullscreenCapture,
                AllowClearLogs: settings.AllowClearLogs,
                DefaultCaptureMode: settings.DefaultCaptureMode),
            ClientSettings: new ClientSettingsStateResponse(
                Theme: "system",
                CompactMode: false,
                ShowLatency: true,
                KeyboardShortcuts: true,
                NotificationsEnabled: true,
                LogsAutoRefresh: true,
                ClipboardAutoSync: false,
                ActiveShortcutProfile: "vscode-style",
                CustomShortcuts: new ShortcutProfileResponse(
                    Id: "custom",
                    Name: "Custom",
                    Bindings: new Dictionary<string, string>
                    {
                        ["capture.toggle"] = "Ctrl+Shift+C",
                        ["media.screenshot"] = "Ctrl+Shift+S",
                        ["input.prompt.send"] = "Ctrl+Enter",
                        ["window.focus"] = "Ctrl+Shift+F",
                        ["navigation.diff"] = "Ctrl+Shift+D",
                        ["navigation.logs"] = "Ctrl+Shift+L",
                        ["navigation.settings"] = "Ctrl+,",
                        ["clipboard.sendToWindows"] = "Ctrl+Shift+V",
                        ["help.toggle"] = "?"
                    }),
                PreviewRefreshProfile: "balanced",
                ViewportTransport: "webrtc"));
    }

    private static IReadOnlyList<string> ResolveHighRiskChanges(
        AgentSettingsPatchBody patch,
        AgentSettingsRecord current)
    {
        var risks = new List<string>();

        if (patch.HttpPort is int httpPort && httpPort != current.HttpPort)
        {
            risks.Add("httpPort");
        }

        if (patch.DirectTestCommand is not null &&
            !string.Equals(
                patch.DirectTestCommand.Trim(),
                current.DirectTestCommand,
                StringComparison.Ordinal))
        {
            risks.Add("directTestCommand");
        }

        if (patch.AllowFullscreenCapture is bool allowFullscreenCapture &&
            allowFullscreenCapture != current.AllowFullscreenCapture)
        {
            risks.Add("allowFullscreenCapture");
        }

        if (patch.AllowClearLogs is bool allowClearLogs &&
            allowClearLogs != current.AllowClearLogs)
        {
            risks.Add("allowClearLogs");
        }

        return risks;
    }

    private static bool IsHighRiskConfirmed(HighRiskConfirmationBody? body)
    {
        return body?.ConfirmHighRisk is true;
    }

    private static bool IsHighRiskConfirmed(RecordingStartBody? body)
    {
        return body?.ConfirmHighRisk is true;
    }

    private static bool TryConsumePairingQuota(
        HttpContext context,
        IPairingRateLimiter pairingRateLimiter,
        out TimeSpan retryAfter)
    {
        var key = ResolvePairingRateLimitKey(context);
        return pairingRateLimiter.TryAcquire(key, DateTimeOffset.UtcNow, out retryAfter);
    }

    private static string ResolvePairingRateLimitKey(HttpContext context)
    {
        if (context.Request.Headers.TryGetValue("X-Forwarded-For", out var forwardedValues))
        {
            var firstForwarded = forwardedValues.ToString()
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(firstForwarded))
            {
                return firstForwarded;
            }
        }

        return context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    }
}
