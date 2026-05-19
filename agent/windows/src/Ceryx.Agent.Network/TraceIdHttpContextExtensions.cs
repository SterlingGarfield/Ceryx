using Microsoft.AspNetCore.Http;

namespace Ceryx.Agent.Network;

public static class TraceIdHttpContextExtensions
{
    public const string TraceIdHeaderName = "X-Trace-Id";
    private const string TraceIdItemKey = "__CeryxTraceId";

    public static string GetOrCreateTraceId(this HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        if (context.Items.TryGetValue(TraceIdItemKey, out var existing) &&
            existing is string traceId &&
            !string.IsNullOrWhiteSpace(traceId))
        {
            return traceId;
        }

        var generated = "trace_" + Guid.NewGuid().ToString("N");
        context.Items[TraceIdItemKey] = generated;
        context.TraceIdentifier = generated;
        return generated;
    }
}
