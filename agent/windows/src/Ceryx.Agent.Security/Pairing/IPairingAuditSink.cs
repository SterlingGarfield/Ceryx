namespace Ceryx.Agent.Security.Pairing;

public interface IPairingAuditSink
{
    Task WriteAsync(
        string action,
        string pairingId,
        string state,
        string message,
        CancellationToken cancellationToken = default);
}

public sealed class NoOpPairingAuditSink : IPairingAuditSink
{
    public Task WriteAsync(
        string action,
        string pairingId,
        string state,
        string message,
        CancellationToken cancellationToken = default)
    {
        return Task.CompletedTask;
    }
}
