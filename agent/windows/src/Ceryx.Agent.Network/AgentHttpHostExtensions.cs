using Ceryx.Agent.Core;
using Ceryx.Agent.Storage;
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

        app.MapGet("/api/v1/health", HealthHandler);
        app.MapGet("/api/v1/agent/status", (AgentRuntimeState runtimeState) => AgentStatusHandler(runtimeState));
        app.MapGet("/api/v1/agent/paths", () => AgentPathsHandler(localPaths));
        app.MapPost(
            "/api/v1/agent/pause-control",
            (HttpContext context, AgentRuntimeState runtimeState, ILoggerFactory loggerFactory) =>
                PauseControlHandler(context, runtimeState, loggerFactory));
        app.MapPost(
            "/api/v1/agent/resume-control",
            (HttpContext context, AgentRuntimeState runtimeState, ILoggerFactory loggerFactory) =>
                ResumeControlHandler(context, runtimeState, loggerFactory));
        app.MapPost(
            "/api/v1/agent/open-logs-folder",
            (HttpContext context, IAgentTrayShell trayShell, ILoggerFactory loggerFactory) =>
                OpenLogsFolderHandler(context, trayShell, loggerFactory));
        app.MapPost(
            "/api/v1/agent/restart-request",
            (HttpContext context, ILoggerFactory loggerFactory) =>
                RestartRequestHandler(context, loggerFactory));

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
            SupportsWebRTC: false,
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
