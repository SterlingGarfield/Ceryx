using Ceryx.Agent.Core;
using Ceryx.Agent.Capture;
using Ceryx.Agent.Codex.ImageBridge;
using Ceryx.Agent.Codex.Input;
using Ceryx.Agent.Codex.SessionLock;
using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Media;
using Ceryx.Agent.Security.Devices;
using Ceryx.Agent.Security.Pairing;
using Ceryx.Agent.Storage;
using Ceryx.Agent.Storage.Audit;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System.Net;

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
            (PairingRequestBody request, PairingStateMachine pairingStateMachine, ILoggerFactory loggerFactory, HttpContext context) =>
                PairingRequestHandler(request, pairingStateMachine, loggerFactory, context))
            .AllowAnonymousAgent();
        app.MapPost(
            "/api/v1/pairing/desktop-confirm",
            (PairingDesktopConfirmBody request, PairingStateMachine pairingStateMachine, ILoggerFactory loggerFactory, HttpContext context) =>
                PairingDesktopConfirmHandler(request, pairingStateMachine, loggerFactory, context))
            .AllowAnonymousAgent();
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
            (HttpContext context, string deviceId, ITrustedDeviceStore trustedDeviceStore) =>
                DeleteDeviceHandler(context, deviceId, trustedDeviceStore))
            .RequireAgentAuth(Permission.ManageDevices);

        app.MapGet("/api/v1/agent/status", (AgentRuntimeState runtimeState) => AgentStatusHandler(runtimeState))
            .RequireAgentAuth();
        app.MapGet("/api/v1/agent/paths", () => AgentPathsHandler(localPaths))
            .RequireAgentAuth();

        app.MapGet(
            "/api/v1/codex/window",
            (ICodexWindowLocator locator) => GetCodexWindowHandler(locator))
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
            (CodexSelectWindowBody body, ICodexWindowLocator locator) => SelectCodexWindowHandler(body, locator))
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
            (ICaptureLifecycleService captureLifecycleService) => CaptureStateHandler(captureLifecycleService))
            .RequireAgentAuth(Permission.ViewWindow);
        app.MapPost(
            "/api/v1/capture/webrtc/signal",
            (CaptureSignalBody body, ICaptureSignalService signalService) => CaptureSignalHandler(body, signalService))
            .RequireAgentAuth(Permission.ViewWindow);

        app.MapPost(
            "/api/v1/assets/upload-image",
            (HttpContext context, IUploadImageService uploadImageService, IImagePasteService imagePasteService, LocalPaths paths, IAuditLogStore auditLogStore) =>
                UploadImageHandler(context, uploadImageService, imagePasteService, paths, auditLogStore))
            .RequireAgentAuth(Permission.UploadImage);
        app.MapPost(
            "/api/v1/media/screenshot",
            (HttpContext context, IScreenshotService screenshotService, ICodexWindowLocator locator, IAuditLogStore auditLogStore) =>
                ScreenshotHandler(context, screenshotService, locator, auditLogStore))
            .RequireAgentAuth(Permission.Screenshot);
        app.MapPost(
            "/api/v1/media/recording/start",
            (HttpContext context, IRecordingService recordingService, ICodexWindowLocator locator, IAuditLogStore auditLogStore) =>
                RecordingStartHandler(context, recordingService, locator, auditLogStore))
            .RequireAgentAuth(Permission.Recording);
        app.MapPost(
            "/api/v1/media/recording/stop",
            (HttpContext context, IRecordingService recordingService, IAuditLogStore auditLogStore) =>
                RecordingStopHandler(context, recordingService, auditLogStore))
            .RequireAgentAuth(Permission.Recording);

        app.MapPost(
            "/api/v1/agent/pause-control",
            (HttpContext context, AgentRuntimeState runtimeState, ILoggerFactory loggerFactory) =>
                PauseControlHandler(context, runtimeState, loggerFactory))
            .RequireAgentAuth(Permission.ManageAgent);
        app.MapPost(
            "/api/v1/agent/resume-control",
            (HttpContext context, AgentRuntimeState runtimeState, ILoggerFactory loggerFactory) =>
                ResumeControlHandler(context, runtimeState, loggerFactory))
            .RequireAgentAuth(Permission.ManageAgent);
        app.MapPost(
            "/api/v1/agent/open-logs-folder",
            (HttpContext context, IAgentTrayShell trayShell, ILoggerFactory loggerFactory) =>
                OpenLogsFolderHandler(context, trayShell, loggerFactory))
            .RequireAgentAuth(Permission.ManageAgent);
        app.MapPost(
            "/api/v1/agent/restart-request",
            (HttpContext context, ILoggerFactory loggerFactory) =>
                RestartRequestHandler(context, loggerFactory))
            .RequireAgentAuth(Permission.ManageAgent);

        return app;
    }

    private static Ok<HealthResponse> HealthHandler()
    {
        return TypedResults.Ok(new HealthResponse(
            Ok: true,
            Service: ServiceName,
            Version: ServiceVersion));
    }

    private static Ok<AgentStatusResponse> AgentStatusHandler(AgentRuntimeState runtimeState)
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
            CodexStatus: CodexWindowStatus.NotFound.ToWireValue()));
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
        ILoggerFactory loggerFactory,
        HttpContext context)
    {
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
        var remoteError = EnsureLocalManagementRequest(context, logger);
        if (remoteError is not null)
        {
            return remoteError;
        }

        if (string.IsNullOrWhiteSpace(request.PairingId))
        {
            return InvalidPairingPayload(context, "pairingId is required.");
        }

        var approved = await pairingStateMachine.ApproveOnDesktopAsync(request.PairingId.Trim(), context.RequestAborted);
        if (!approved)
        {
            return Results.Json(
                new PairingDesktopConfirmResponse(
                    Ok: false,
                    State: "rejected"),
                statusCode: StatusCodes.Status404NotFound);
        }

        return TypedResults.Ok(new PairingDesktopConfirmResponse(
            Ok: true,
            State: "code_input"));
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
        var result = await pairingCompletionService.ConfirmAsync(
            request.PairingId.Trim(),
            request.Code.Trim(),
            context.RequestAborted);

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
        ITrustedDeviceStore trustedDeviceStore)
    {
        var deleted = await trustedDeviceStore.DeleteAsync(deviceId, context.RequestAborted);
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

    private static async Task<IResult> SelectCodexWindowHandler(CodexSelectWindowBody body, ICodexWindowLocator locator)
    {
        if (string.IsNullOrWhiteSpace(body.WindowId))
        {
            return Results.Json(new StandardErrorResponse(
                Ok: false,
                Error: new StandardErrorBody(
                    Code: "E_CODEX_NOT_FOUND",
                    Message: "windowId is required.",
                    Hint: "Provide a valid windowId from /api/v1/codex/window.",
                    TraceId: "trace_codex_select")));
        }

        var snapshot = await locator.SelectWindowAsync(body.WindowId);
        return TypedResults.Ok(ToCodexWindowResponse(snapshot));
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
        await auditLogStore.WriteAsync("input.key.accepted", result.Message, context.RequestAborted);
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
        await auditLogStore.WriteAsync("input.mouse.accepted", result.Message, context.RequestAborted);
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
        await auditLogStore.WriteAsync($"{action}.accepted", message, context.RequestAborted);
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
        await auditLogStore.WriteAsync("prompt.send.accepted", $"submitted={response.Submitted}", context.RequestAborted);
        return TypedResults.Ok(response);
    }

    private static async Task<IResult> CaptureStartHandler(
        HttpContext context,
        CaptureStartBody body,
        ICodexWindowLocator locator,
        ICaptureLifecycleService captureLifecycleService,
        IAuditLogStore auditLogStore)
    {
        var window = await locator.GetWindowAsync(context.RequestAborted);
        var result = await captureLifecycleService.StartAsync(body, window, context.RequestAborted);
        if (!result.IsSuccess || result.Error is null || result.Value is null)
        {
            return ErrorFromAgentError(context, result.Error ?? new AgentError("E_CAPTURE_FAILED", "Failed to start capture.", context.GetOrCreateTraceId()));
        }

        await auditLogStore.WriteAsync("capture.started", $"mode={result.Value.Mode};window={result.Value.WindowId}", context.RequestAborted);
        return TypedResults.Ok(ToCaptureStateResponse(result.Value));
    }

    private static async Task<IResult> CaptureStopHandler(ICaptureLifecycleService captureLifecycleService)
    {
        var state = await captureLifecycleService.StopAsync();
        return TypedResults.Ok(ToCaptureStateResponse(state));
    }

    private static IResult CaptureStateHandler(ICaptureLifecycleService captureLifecycleService)
    {
        return TypedResults.Ok(ToCaptureStateResponse(captureLifecycleService.CurrentState));
    }

    private static async Task<IResult> CaptureSignalHandler(
        CaptureSignalBody body,
        ICaptureSignalService signalService)
    {
        var response = await signalService.SubmitSignalAsync(body);
        return TypedResults.Ok(response);
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
        if (!upload.IsSuccess || upload.Error is null || upload.Value is null)
        {
            return ErrorFromAgentError(context, upload.Error ?? new AgentError("E_CAPTURE_FAILED", "Upload failed.", context.GetOrCreateTraceId()));
        }

        var absolutePath = Path.Combine(paths.Uploads, upload.Value.FileName);
        var pasted = await imagePasteService.TryPasteImageAsync(absolutePath, context.RequestAborted);
        await auditLogStore.WriteAsync("assets.upload-image.accepted", $"assetId={upload.Value.AssetId};pasted={pasted}", context.RequestAborted);
        return TypedResults.Ok(upload.Value);
    }

    private static async Task<IResult> ScreenshotHandler(
        HttpContext context,
        IScreenshotService screenshotService,
        ICodexWindowLocator locator,
        IAuditLogStore auditLogStore)
    {
        var window = await locator.GetWindowAsync(context.RequestAborted);
        var screenshot = await screenshotService.CaptureAsync(window, context.RequestAborted);
        if (!screenshot.IsSuccess || screenshot.Error is null || screenshot.Value is null)
        {
            return ErrorFromAgentError(context, screenshot.Error ?? new AgentError("E_CAPTURE_FAILED", "Screenshot failed.", context.GetOrCreateTraceId()));
        }

        await auditLogStore.WriteAsync("media.screenshot.accepted", screenshot.Value.FileName, context.RequestAborted);
        return TypedResults.Ok(screenshot.Value);
    }

    private static async Task<IResult> RecordingStartHandler(
        HttpContext context,
        IRecordingService recordingService,
        ICodexWindowLocator locator,
        IAuditLogStore auditLogStore)
    {
        var window = await locator.GetWindowAsync(context.RequestAborted);
        var result = await recordingService.StartAsync(window, context.RequestAborted);
        if (!result.IsSuccess || result.Error is null || result.Value is null)
        {
            return ErrorFromAgentError(context, result.Error ?? new AgentError("E_RECORDING_BUSY", "Failed to start recording.", context.GetOrCreateTraceId()));
        }

        await auditLogStore.WriteAsync("media.recording.started", result.Value.StartedAt, context.RequestAborted);
        return TypedResults.Ok(result.Value);
    }

    private static async Task<IResult> RecordingStopHandler(
        HttpContext context,
        IRecordingService recordingService,
        IAuditLogStore auditLogStore)
    {
        var result = await recordingService.StopAsync(context.RequestAborted);
        if (!result.IsSuccess || result.Error is null || result.Value is null)
        {
            return ErrorFromAgentError(context, result.Error ?? new AgentError("E_RECORDING_BUSY", "Failed to stop recording.", context.GetOrCreateTraceId()));
        }

        await auditLogStore.WriteAsync("media.recording.stopped", result.Value.FileName, context.RequestAborted);
        return TypedResults.Ok(result.Value);
    }

    private static IResult PauseControlHandler(
        HttpContext context,
        AgentRuntimeState runtimeState,
        ILoggerFactory loggerFactory)
    {
        var logger = loggerFactory.CreateLogger("Ceryx.Agent.Management");
        var remoteError = EnsureLocalManagementRequest(context, logger);
        if (remoteError is not null)
        {
            return remoteError;
        }

        var status = runtimeState.Pause();
        logger.LogInformation("Applied local management action: pause-control status={Status}", status.ToWireValue());
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
        var remoteError = EnsureLocalManagementRequest(context, logger);
        if (remoteError is not null)
        {
            return remoteError;
        }

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
        var remoteError = EnsureLocalManagementRequest(context, logger);
        if (remoteError is not null)
        {
            return remoteError;
        }

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
        var remoteError = EnsureLocalManagementRequest(context, logger);
        if (remoteError is not null)
        {
            return remoteError;
        }

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
            "E_CAPTURE_FAILED" => StatusCodes.Status500InternalServerError,
            "E_INPUT_BLOCKED" => StatusCodes.Status409Conflict,
            "E_UPLOAD_TOO_LARGE" => StatusCodes.Status413PayloadTooLarge,
            "E_RECORDING_BUSY" => StatusCodes.Status409Conflict,
            "E_DISK_LOW" => StatusCodes.Status507InsufficientStorage,
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

    private static IResult? EnsureLocalManagementRequest(HttpContext context, ILogger logger)
    {
        if (IsLocalManagementRequest(context))
        {
            return null;
        }

        var traceId = context.GetOrCreateTraceId();
        logger.LogWarning(
            "Rejected remote local-management request. method={Method} path={Path} traceId={TraceId}",
            context.Request.Method,
            context.Request.Path,
            traceId);

        var error = new StandardErrorResponse(
            Ok: false,
            Error: new StandardErrorBody(
                Code: "E_PERMISSION_DENIED",
                Message: "Local management endpoints can only be called from localhost.",
                Hint: "Use the local desktop client on the same machine.",
                TraceId: traceId));

        return Results.Json(error, statusCode: StatusCodes.Status403Forbidden);
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

    private static CaptureStateResponse ToCaptureStateResponse(CaptureState state)
    {
        return new CaptureStateResponse(
            Ok: true,
            Active: state.Active,
            Paused: state.Paused,
            Mode: state.Mode,
            WindowId: state.WindowId,
            Width: state.Width,
            Height: state.Height);
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
            await auditLogStore.WriteAsync("input.rejected", $"reason={window.Status}", context.RequestAborted);
            return (false, null, ErrorFromAgentError(context, new AgentError(
                Code: "E_CODEX_NOT_FOUND",
                Message: "Codex window is not available.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Use /api/v1/codex/window and /api/v1/codex/select-window first.")));
        }

        if (string.Equals(window.Status, "minimized", StringComparison.OrdinalIgnoreCase))
        {
            await auditLogStore.WriteAsync("input.rejected", "reason=minimized", context.RequestAborted);
            return (false, null, ErrorFromAgentError(context, new AgentError(
                Code: "E_CODEX_MINIMIZED",
                Message: "Codex window is minimized.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: "Focus Codex window and retry.")));
        }

        var lockResult = lockService.AcquireForInput(window.WindowId, device.DeviceId, DateTimeOffset.UtcNow);
        if (!lockResult.IsGranted)
        {
            await auditLogStore.WriteAsync("input.rejected", $"reason={lockResult.Reason};active={lockResult.ActiveDeviceId}", context.RequestAborted);
            return (false, null, ErrorFromAgentError(context, new AgentError(
                Code: "E_INPUT_BLOCKED",
                Message: "Another device currently controls input.",
                TraceId: context.GetOrCreateTraceId(),
                Hint: $"Active controller: {lockResult.ActiveDeviceId}")));
        }

        if (lockResult.OwnershipChanged)
        {
            await auditLogStore.WriteAsync("session_lock.changed", $"window={window.WindowId};device={device.DeviceId}", context.RequestAborted);
        }

        var executionContext = new InputExecutionContext(
            WindowId: window.WindowId,
            DeviceId: device.DeviceId,
            TraceId: context.GetOrCreateTraceId());
        return (true, executionContext, null);
    }

    private static bool IsLocalManagementRequest(HttpContext context)
    {
        if (context.Request.Headers.TryGetValue("X-Forwarded-For", out var forwardedValues))
        {
            var firstForwarded = forwardedValues.ToString()
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(firstForwarded) &&
                IPAddress.TryParse(firstForwarded, out var forwardedIp))
            {
                return IPAddress.IsLoopback(forwardedIp);
            }
        }

        var remoteIp = context.Connection.RemoteIpAddress;
        if (remoteIp is null)
        {
            return true;
        }

        return IPAddress.IsLoopback(remoteIp);
    }
}
