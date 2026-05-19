using Ceryx.Agent.Core;
using Ceryx.Agent.Storage;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

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
        app.MapGet("/api/v1/agent/status", AgentStatusHandler);
        app.MapGet("/api/v1/agent/paths", () => AgentPathsHandler(localPaths));

        return app;
    }

    private static Ok<HealthResponse> HealthHandler()
    {
        return TypedResults.Ok(new HealthResponse(
            Ok: true,
            Service: ServiceName,
            Version: ServiceVersion));
    }

    private static Ok<AgentStatusResponse> AgentStatusHandler()
    {
        return TypedResults.Ok(new AgentStatusResponse(
            AgentVersion: ServiceVersion,
            DeviceName: "Local Windows PC",
            Platform: "windows",
            Status: AgentRuntimeStatus.Running.ToWireValue(),
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
}
