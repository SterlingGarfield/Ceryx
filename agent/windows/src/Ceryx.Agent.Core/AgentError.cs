namespace Ceryx.Agent.Core;

public sealed record AgentError(string Code, string Message, string TraceId, string? Hint = null);
