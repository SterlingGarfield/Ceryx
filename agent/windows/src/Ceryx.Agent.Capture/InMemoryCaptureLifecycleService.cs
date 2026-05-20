using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;

namespace Ceryx.Agent.Capture;

public sealed class InMemoryCaptureLifecycleService : ICaptureLifecycleService
{
    private readonly object _sync = new();

    private CaptureState _state = new(
        Active: false,
        Paused: false,
        Mode: "balanced",
        WindowId: null,
        Width: 1280,
        Height: 720);

    public CaptureState CurrentState
    {
        get
        {
            lock (_sync)
            {
                return _state;
            }
        }
    }

    public Task<Result<CaptureState>> StartAsync(
        CaptureStartBody body,
        CodexWindowSnapshot window,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(body);
        ArgumentNullException.ThrowIfNull(window);

        if (!string.Equals(body.Target, "codex_window", StringComparison.OrdinalIgnoreCase))
        {
            return Task.FromResult(Result<CaptureState>.Failure(new AgentError(
                Code: "E_CAPTURE_DENIED",
                Message: "Capture target must be codex_window.",
                TraceId: "trace_capture_target")));
        }

        if (window.WindowId is null || window.Status is "not_found" or "multiple_candidates" or "permission_issue")
        {
            return Task.FromResult(Result<CaptureState>.Failure(new AgentError(
                Code: "E_CODEX_NOT_FOUND",
                Message: "Codex window is not available for capture.",
                TraceId: "trace_capture_window")));
        }

        var normalizedMode = NormalizeMode(body.Mode);
        var paused = string.Equals(window.Status, "minimized", StringComparison.OrdinalIgnoreCase);

        lock (_sync)
        {
            _state = new CaptureState(
                Active: true,
                Paused: paused,
                Mode: normalizedMode,
                WindowId: window.WindowId,
                Width: 1280,
                Height: 720);
            return Task.FromResult(Result<CaptureState>.Success(_state));
        }
    }

    public Task<CaptureState> StopAsync(CancellationToken cancellationToken = default)
    {
        lock (_sync)
        {
            _state = _state with
            {
                Active = false,
                Paused = false,
                WindowId = null
            };
            return Task.FromResult(_state);
        }
    }

    private static string NormalizeMode(string? mode)
    {
        return mode?.ToLowerInvariant() switch
        {
            "low_latency" => "low_latency",
            "high_quality" => "high_quality",
            "power_save" => "power_save",
            _ => "balanced"
        };
    }
}
