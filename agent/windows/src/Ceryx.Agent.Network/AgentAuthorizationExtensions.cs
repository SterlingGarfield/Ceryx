using Ceryx.Agent.Core;
using Ceryx.Agent.Security.Devices;
using Ceryx.Agent.Security.Tokens;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Ceryx.Agent.Network;

public sealed record AgentAuthorizationMetadata(
    bool AllowAnonymous,
    Permission? RequiredPermission = null
);

public static class AgentAuthorizationExtensions
{
    private const string AuthenticatedDeviceItemKey = "__ceryx.auth.device";

    public static WebApplication UseAgentAuthorization(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        app.Use(async (context, next) =>
        {
            var metadata = ResolveAuthorizationMetadata(context);
            if (metadata is null || metadata.AllowAnonymous)
            {
                await next(context);
                return;
            }

            var traceId = context.GetOrCreateTraceId();
            var authorizationHeader = context.Request.Headers.Authorization.ToString();
            if (string.IsNullOrWhiteSpace(authorizationHeader))
            {
                await WriteAuthErrorAsync(
                    context,
                    StatusCodes.Status401Unauthorized,
                    "E_NOT_PAIRED",
                    "Device is not paired.",
                    "Complete pairing and retry.",
                    traceId);
                return;
            }

            if (!TryReadBearerToken(authorizationHeader, out var token))
            {
                await WriteAuthErrorAsync(
                    context,
                    StatusCodes.Status401Unauthorized,
                    "E_TOKEN_INVALID",
                    "Authorization token is invalid.",
                    "Use a valid Bearer token.",
                    traceId);
                return;
            }

            var tokenHasher = context.RequestServices.GetRequiredService<IDeviceTokenHasher>();
            var trustedDeviceStore = context.RequestServices.GetRequiredService<ITrustedDeviceStore>();
            var tokenHash = tokenHasher.Hash(token);
            var trustedDevice = await trustedDeviceStore.FindByTokenHashAsync(tokenHash, context.RequestAborted);

            if (trustedDevice is null)
            {
                await WriteAuthErrorAsync(
                    context,
                    StatusCodes.Status401Unauthorized,
                    "E_TOKEN_INVALID",
                    "Authorization token is invalid.",
                    "Pair again or use a valid device token.",
                    traceId);
                return;
            }

            context.Items[AuthenticatedDeviceItemKey] = trustedDevice;

            if (metadata.RequiredPermission.HasValue &&
                !trustedDevice.Permissions.Contains(metadata.RequiredPermission.Value))
            {
                await WriteAuthErrorAsync(
                    context,
                    StatusCodes.Status403Forbidden,
                    "E_PERMISSION_DENIED",
                    "Permission denied for this endpoint.",
                    $"Required permission: {metadata.RequiredPermission.Value.ToWireValue()}",
                    traceId);
                return;
            }

            await next(context);
        });

        return app;
    }

    public static RouteHandlerBuilder AllowAnonymousAgent(this RouteHandlerBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        return builder.WithMetadata(new AgentAuthorizationMetadata(AllowAnonymous: true));
    }

    public static RouteHandlerBuilder RequireAgentAuth(
        this RouteHandlerBuilder builder,
        Permission? requiredPermission = null)
    {
        ArgumentNullException.ThrowIfNull(builder);
        return builder.WithMetadata(new AgentAuthorizationMetadata(
            AllowAnonymous: false,
            RequiredPermission: requiredPermission));
    }

    public static TrustedDeviceRecord? GetAuthenticatedDevice(this HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        return context.Items.TryGetValue(AuthenticatedDeviceItemKey, out var value)
            ? value as TrustedDeviceRecord
            : null;
    }

    private static AgentAuthorizationMetadata? ResolveAuthorizationMetadata(HttpContext context)
    {
        var endpoint = context.GetEndpoint();
        if (endpoint is null)
        {
            return null;
        }

        var metadata = endpoint.Metadata.GetMetadata<AgentAuthorizationMetadata>();
        if (metadata is not null)
        {
            return metadata;
        }

        var path = context.Request.Path.Value ?? string.Empty;
        if (path.StartsWith("/api/v1/", StringComparison.OrdinalIgnoreCase))
        {
            if (IsPublicRoute(context.Request.Method, path))
            {
                return new AgentAuthorizationMetadata(AllowAnonymous: true);
            }

            return new AgentAuthorizationMetadata(AllowAnonymous: false);
        }

        return null;
    }

    private static bool IsPublicRoute(string method, string path)
    {
        return (HttpMethods.IsGet(method) && string.Equals(path, "/api/v1/health", StringComparison.OrdinalIgnoreCase)) ||
               (HttpMethods.IsPost(method) && string.Equals(path, "/api/v1/pairing/request", StringComparison.OrdinalIgnoreCase));
    }

    private static bool TryReadBearerToken(string authorizationHeader, out string token)
    {
        token = string.Empty;
        var parts = authorizationHeader.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length != 2 || !string.Equals(parts[0], "Bearer", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        token = parts[1];
        return !string.IsNullOrWhiteSpace(token);
    }

    private static Task WriteAuthErrorAsync(
        HttpContext context,
        int statusCode,
        string errorCode,
        string message,
        string hint,
        string traceId)
    {
        var payload = new StandardErrorResponse(
            Ok: false,
            Error: new StandardErrorBody(
                Code: errorCode,
                Message: message,
                Hint: hint,
                TraceId: traceId));

        context.Response.StatusCode = statusCode;
        return context.Response.WriteAsJsonAsync(payload);
    }
}
