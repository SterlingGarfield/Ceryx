using Ceryx.Agent.Core;
using Ceryx.Agent.Security.Devices;
using Ceryx.Agent.Security.Tokens;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System.Net;

namespace Ceryx.Agent.Network;

public sealed record AgentAuthorizationMetadata(
    bool AllowAnonymous,
    Permission? RequiredPermission = null
);

public sealed record AgentLocalOnlyMetadata(bool Enabled = true);

public static class AgentAuthorizationExtensions
{
    private const string AuthenticatedDeviceItemKey = "__ceryx.auth.device";
    private const string AllowedOriginsEnvVar = "CERYX_ALLOWED_ORIGINS";

    public static WebApplication UseAgentAuthorization(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        app.Use(async (context, next) =>
        {
            var path = context.Request.Path.Value ?? string.Empty;
            if (IsAgentApiPath(path) && !IsLanRequest(context))
            {
                var networkTraceId = context.GetOrCreateTraceId();
                await WriteAuthErrorAsync(
                    context,
                    StatusCodes.Status403Forbidden,
                    "E_NETWORK_DENIED",
                    "Agent only accepts loopback or LAN requests.",
                    "Use localhost or a private-network address.",
                    networkTraceId);
                return;
            }

            if (IsAgentApiPath(path) && !IsAllowedOrigin(context, out var originHint))
            {
                var originTraceId = context.GetOrCreateTraceId();
                await WriteAuthErrorAsync(
                    context,
                    StatusCodes.Status403Forbidden,
                    "E_ORIGIN_DENIED",
                    "Request origin is not allowed.",
                    originHint,
                    originTraceId);
                return;
            }

            var metadata = ResolveAuthorizationMetadata(context);
            var localOnlyMetadata = ResolveLocalOnlyMetadata(context);
            if (localOnlyMetadata?.Enabled is true && !IsLocalRequest(context))
            {
                var localTraceId = context.GetOrCreateTraceId();
                var loggerFactory = context.RequestServices.GetRequiredService<ILoggerFactory>();
                var logger = loggerFactory.CreateLogger("Ceryx.Agent.Authorization");
                logger.LogWarning(
                    "Rejected remote local-only request. method={Method} path={Path} traceId={TraceId}",
                    context.Request.Method,
                    context.Request.Path,
                    localTraceId);
                await WriteAuthErrorAsync(
                    context,
                    StatusCodes.Status403Forbidden,
                    "E_PERMISSION_DENIED",
                    "Local management endpoints can only be called from localhost.",
                    "Use the local desktop client on the same machine.",
                    localTraceId);
                return;
            }

            var requiresAuth = metadata is not null && !metadata.AllowAnonymous;
            if (IsAgentApiPath(path) && IsWebSocketHandshake(context))
            {
                requiresAuth = true;
            }

            if (!requiresAuth)
            {
                await next(context);
                return;
            }

            var traceId = context.GetOrCreateTraceId();
            var trustedDevice = await TryAuthenticateDeviceAsync(context, traceId);
            if (trustedDevice is null)
            {
                return;
            }

            context.Items[AuthenticatedDeviceItemKey] = trustedDevice;

            if (metadata?.RequiredPermission.HasValue is true &&
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

    public static RouteHandlerBuilder RequireLocalAgent(this RouteHandlerBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        return builder.WithMetadata(new AgentLocalOnlyMetadata());
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

    private static AgentLocalOnlyMetadata? ResolveLocalOnlyMetadata(HttpContext context)
    {
        var endpoint = context.GetEndpoint();
        return endpoint?.Metadata.GetMetadata<AgentLocalOnlyMetadata>();
    }

    private static bool IsPublicRoute(string method, string path)
    {
        return (HttpMethods.IsGet(method) && string.Equals(path, "/api/v1/health", StringComparison.OrdinalIgnoreCase)) ||
               (HttpMethods.IsPost(method) && string.Equals(path, "/api/v1/pairing/request", StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsLocalRequest(HttpContext context)
    {
        var remoteIp = ResolveRequestIp(context);
        return remoteIp is null || IPAddress.IsLoopback(remoteIp);
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

    private static bool IsAgentApiPath(string path)
    {
        return path.StartsWith("/api/v1/", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsWebSocketHandshake(HttpContext context)
    {
        return HttpMethods.IsGet(context.Request.Method) &&
               context.Request.Headers.TryGetValue("Upgrade", out var upgradeValues) &&
               upgradeValues.Any(static value => string.Equals(value, "websocket", StringComparison.OrdinalIgnoreCase));
    }

    private static async Task<TrustedDeviceRecord?> TryAuthenticateDeviceAsync(HttpContext context, string traceId)
    {
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
            return null;
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
            return null;
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
            return null;
        }

        return trustedDevice;
    }

    private static bool IsLanRequest(HttpContext context)
    {
        var remoteIp = ResolveRequestIp(context);
        return remoteIp is null || AgentNetworkBindingResolver.IsLanOrLoopback(remoteIp);
    }

    private static IPAddress? ResolveRequestIp(HttpContext context)
    {
        if (context.Request.Headers.TryGetValue("X-Forwarded-For", out var forwardedValues))
        {
            var firstForwarded = forwardedValues.ToString()
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(firstForwarded) &&
                IPAddress.TryParse(firstForwarded, out var forwardedIp))
            {
                return forwardedIp;
            }
        }

        return context.Connection.RemoteIpAddress;
    }

    private static bool IsAllowedOrigin(HttpContext context, out string hint)
    {
        hint = "Use localhost/private-network origin or configure CERYX_ALLOWED_ORIGINS.";

        if (!context.Request.Headers.TryGetValue("Origin", out var originValues))
        {
            return true;
        }

        var origin = originValues.ToString().Trim();
        if (string.IsNullOrWhiteSpace(origin))
        {
            return true;
        }

        if (!Uri.TryCreate(origin, UriKind.Absolute, out var originUri))
        {
            hint = "Origin header must be an absolute URL.";
            return false;
        }

        if (!string.Equals(originUri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(originUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            hint = "Only HTTP/HTTPS origins are allowed.";
            return false;
        }

        var configuredAllowedOrigins = Environment.GetEnvironmentVariable(AllowedOriginsEnvVar)?
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) ??
            [];
        if (configuredAllowedOrigins.Any(item =>
                string.Equals(item, origin, StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        if (string.Equals(originUri.Host, "localhost", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (IPAddress.TryParse(originUri.Host, out var originIp) &&
            AgentNetworkBindingResolver.IsLanOrLoopback(originIp))
        {
            return true;
        }

        return false;
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
