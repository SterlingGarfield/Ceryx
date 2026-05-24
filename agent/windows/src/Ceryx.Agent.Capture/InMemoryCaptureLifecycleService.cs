using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;

namespace Ceryx.Agent.Capture;

public sealed class InMemoryCaptureLifecycleService : ICaptureLifecycleService
{
    private const double CpuThrottleThreshold = 70;
    private const double JitterThresholdMs = 120;
    private static readonly TimeSpan CpuThrottleWindow = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan ViewerIdleWindow = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan JitterDownscaleWindow = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan JitterDisconnectWindow = TimeSpan.FromSeconds(6);
    private const int DefaultWidth = 1280;
    private const int DefaultHeight = 720;
    private const int JitterFallbackWidth = 960;
    private const int JitterFallbackHeight = 540;
    private const int MinFrameRate = 12;
    private const int CpuThrottleDrop = 10;

    private readonly object _sync = new();
    private readonly ICaptureClock _clock;

    private CaptureState _state = new(
        Active: false,
        Paused: false,
        Mode: "balanced",
        WindowId: null,
        Width: DefaultWidth,
        Height: DefaultHeight);

    private DateTimeOffset? _cpuHighSince;
    private DateTimeOffset? _jitterHighSince;
    private DateTimeOffset? _viewerSeenAt;
    private bool _cpuThrottleApplied;
    private bool _resolutionDegraded;
    private bool _pausedByMinimized;
    private bool _pausedByViewerIdle;

    public InMemoryCaptureLifecycleService()
        : this(new SystemCaptureClock())
    {
    }

    public InMemoryCaptureLifecycleService(ICaptureClock clock)
    {
        _clock = clock ?? throw new ArgumentNullException(nameof(clock));
    }

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

        lock (_sync)
        {
            var now = _clock.UtcNow;
            _pausedByMinimized = string.Equals(window.Status, "minimized", StringComparison.OrdinalIgnoreCase);
            _pausedByViewerIdle = false;
            _cpuHighSince = null;
            _jitterHighSince = null;
            _cpuThrottleApplied = false;
            _resolutionDegraded = false;
            _viewerSeenAt = now;

            _state = new CaptureState(
                Active: true,
                Paused: _pausedByMinimized,
                Mode: normalizedMode,
                WindowId: window.WindowId,
                Width: DefaultWidth,
                Height: DefaultHeight,
                FrameRate: ResolveFrameRate(normalizedMode),
                Quality: ResolveBaseQuality(normalizedMode));
            return Task.FromResult(Result<CaptureState>.Success(_state));
        }
    }

    public Task<CaptureState> StopAsync(CancellationToken cancellationToken = default)
    {
        lock (_sync)
        {
            _state = ResetToStoppedState(_state.Mode);
            return Task.FromResult(_state);
        }
    }

    public Task<CaptureState> ApplyPerformanceSignalAsync(
        CapturePerformanceSignal signal,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(signal);

        lock (_sync)
        {
            if (!_state.Active)
            {
                return Task.FromResult(_state);
            }

            var observedAt = signal.ObservedAt ?? _clock.UtcNow;
            ApplyCpuPolicy(signal.CpuUsagePercent, observedAt);
            ApplyViewerPolicy(signal.HasActiveViewer, observedAt);
            ApplyJitterPolicy(signal.NetworkJitterMs, observedAt);

            _state = _state with
            {
                Paused = _pausedByMinimized || _pausedByViewerIdle
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

    private void ApplyCpuPolicy(double cpuUsagePercent, DateTimeOffset observedAt)
    {
        if (cpuUsagePercent <= CpuThrottleThreshold)
        {
            _cpuHighSince = null;
            _cpuThrottleApplied = false;
            return;
        }

        _cpuHighSince ??= observedAt;
        if (_cpuThrottleApplied || observedAt - _cpuHighSince < CpuThrottleWindow)
        {
            return;
        }

        _cpuThrottleApplied = true;
        _state = _state with
        {
            FrameRate = Math.Max(MinFrameRate, _state.FrameRate - CpuThrottleDrop),
            Quality = "cpu_throttled"
        };
    }

    private void ApplyViewerPolicy(bool hasActiveViewer, DateTimeOffset observedAt)
    {
        if (hasActiveViewer)
        {
            _viewerSeenAt = observedAt;
            _pausedByViewerIdle = false;
            return;
        }

        _viewerSeenAt ??= observedAt;
        if (observedAt - _viewerSeenAt >= ViewerIdleWindow)
        {
            _pausedByViewerIdle = true;
        }
    }

    private void ApplyJitterPolicy(double jitterMs, DateTimeOffset observedAt)
    {
        if (jitterMs < JitterThresholdMs)
        {
            _jitterHighSince = null;
            return;
        }

        _jitterHighSince ??= observedAt;
        var elapsed = observedAt - _jitterHighSince;

        if (!_resolutionDegraded && elapsed >= JitterDownscaleWindow)
        {
            _resolutionDegraded = true;
            _state = _state with
            {
                Width = JitterFallbackWidth,
                Height = JitterFallbackHeight,
                Quality = "network_degraded"
            };
            return;
        }

        if (_resolutionDegraded && elapsed >= JitterDisconnectWindow)
        {
            _state = ResetToStoppedState(_state.Mode);
        }
    }

    private CaptureState ResetToStoppedState(string mode)
    {
        _pausedByMinimized = false;
        _pausedByViewerIdle = false;
        _cpuHighSince = null;
        _jitterHighSince = null;
        _viewerSeenAt = null;
        _cpuThrottleApplied = false;
        _resolutionDegraded = false;
        return new CaptureState(
            Active: false,
            Paused: false,
            Mode: NormalizeMode(mode),
            WindowId: null,
            Width: DefaultWidth,
            Height: DefaultHeight,
            FrameRate: ResolveFrameRate(mode),
            Quality: ResolveBaseQuality(mode));
    }

    private static int ResolveFrameRate(string mode)
    {
        return mode switch
        {
            "low_latency" => 45,
            "high_quality" => 24,
            "power_save" => 20,
            _ => 30
        };
    }

    private static string ResolveBaseQuality(string mode)
    {
        return mode switch
        {
            "high_quality" => "high",
            "power_save" => "power_save",
            _ => "balanced"
        };
    }
}

public interface ICaptureClock
{
    DateTimeOffset UtcNow { get; }
}

public sealed class SystemCaptureClock : ICaptureClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}
