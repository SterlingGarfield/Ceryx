using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;

namespace Ceryx.Agent.Capture;

public sealed class InMemoryCaptureLifecycleService : ICaptureLifecycleService
{
    private enum AdaptiveTier
    {
        Low = 0,
        Medium = 1,
        High = 2
    }

    private const double CpuThrottleThreshold = 70;
    private const double JitterThresholdMs = 120;
    private const double HighBandwidthThresholdKbps = 6000;
    private const double MediumBandwidthThresholdKbps = 2000;
    private const double HighLatencyThresholdMs = 10;
    private const double PacketLossWarningThresholdPercent = 5;
    private const double PacketLossImmediateDowngradeThresholdPercent = 10;
    private static readonly TimeSpan CpuThrottleWindow = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan ViewerIdleWindow = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan JitterDownscaleWindow = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan JitterDisconnectWindow = TimeSpan.FromSeconds(6);
    private static readonly TimeSpan TierUpgradeWindow = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan TierDowngradeWindow = TimeSpan.FromSeconds(3);
    private const int DefaultWidth = 1280;
    private const int DefaultHeight = 720;
    private const int JitterFallbackWidth = 960;
    private const int JitterFallbackHeight = 540;
    private const int MinFrameRate = 12;
    private const int CpuThrottleDrop = 10;
    private const int MediumFrameRate = 15;
    private const int LowFrameRate = 8;
    private const double BandwidthEwmaAlpha = 0.35;
    private const double RoundTripTimeEwmaAlpha = 0.35;
    private const double PacketLossEwmaAlpha = 0.5;

    private readonly object _sync = new();
    private readonly ICaptureClock _clock;

    private CaptureState _state = new(
        Active: false,
        Paused: false,
        Mode: "balanced",
        WindowId: null,
        Width: DefaultWidth,
        Height: DefaultHeight);

    private AdaptiveTier _tier = AdaptiveTier.Medium;
    private AdaptiveTier? _upgradeCandidateTier;
    private DateTimeOffset? _upgradeCandidateSince;
    private AdaptiveTier? _downgradeCandidateTier;
    private DateTimeOffset? _downgradeCandidateSince;
    private double? _bandwidthEstimateKbps;
    private double? _roundTripTimeEstimateMs;
    private double? _packetLossEstimatePercent;
    private double? _jitterEstimateMs;
    private long? _packetsLostEstimate;
    private long? _packetsSentEstimate;
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
            _upgradeCandidateTier = null;
            _upgradeCandidateSince = null;
            _downgradeCandidateTier = null;
            _downgradeCandidateSince = null;
            _bandwidthEstimateKbps = null;
            _roundTripTimeEstimateMs = null;
            _packetLossEstimatePercent = null;
            _jitterEstimateMs = null;
            _packetsLostEstimate = null;
            _packetsSentEstimate = null;
            _tier = ResolveInitialTier(normalizedMode);

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

    public Task<CapturePolicyResult> ApplyPerformanceSignalAsync(
        CapturePerformanceSignal signal,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(signal);

        lock (_sync)
        {
            if (!_state.Active)
            {
                return Task.FromResult(new CapturePolicyResult(_state, RenegotiationNeeded: false));
            }

            var before = _state;
            var observedAt = signal.ObservedAt ?? _clock.UtcNow;

            ApplyBandwidthPolicy(signal, observedAt);
            ApplyCpuPolicy(signal.CpuUsagePercent, observedAt);
            ApplyViewerPolicy(signal.HasActiveViewer, observedAt);
            ApplyJitterPolicy(signal.NetworkJitterMs, observedAt);

            _state = _state with
            {
                Paused = _pausedByMinimized || _pausedByViewerIdle
            };

            var needsRenegotiation =
                before.Width != _state.Width ||
                before.Height != _state.Height ||
                before.FrameRate != _state.FrameRate;

            return Task.FromResult(new CapturePolicyResult(
                State: _state,
                RenegotiationNeeded: needsRenegotiation,
                Reason: needsRenegotiation ? "encoding_parameters_changed" : null));
        }
    }

    public CaptureConnectionStatsSnapshot GetConnectionStatsSnapshot()
    {
        lock (_sync)
        {
            return new CaptureConnectionStatsSnapshot(
                CurrentTier: ResolveTierName(_tier),
                Resolution: $"{_state.Width}x{_state.Height}",
                FrameRate: _state.FrameRate,
                BitrateKbps: Math.Max(0, _bandwidthEstimateKbps ?? 0),
                PacketsLost: Math.Max(0, _packetsLostEstimate ?? 0),
                PacketsSent: Math.Max(0, _packetsSentEstimate ?? 0),
                PacketLossPercent: Math.Max(0, _packetLossEstimatePercent ?? 0),
                RoundTripTimeMs: Math.Max(0, _roundTripTimeEstimateMs ?? 0),
                JitterMs: Math.Max(0, _jitterEstimateMs ?? 0));
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

    private void ApplyBandwidthPolicy(CapturePerformanceSignal signal, DateTimeOffset observedAt)
    {
        if (_resolutionDegraded)
        {
            ClearTierTransitionTracking();
            return;
        }

        var packetLossSample = TryComputePacketLossPercent(signal);
        if (packetLossSample is not null)
        {
            _packetLossEstimatePercent = Smooth(_packetLossEstimatePercent, packetLossSample.Value, PacketLossEwmaAlpha);
        }

        if (signal.PacketsLost is not null)
        {
            _packetsLostEstimate = signal.PacketsLost.Value;
        }

        if (signal.PacketsSent is not null)
        {
            _packetsSentEstimate = signal.PacketsSent.Value;
        }

        if (signal.AvailableOutgoingBitrateKbps is > 0)
        {
            _bandwidthEstimateKbps = Smooth(_bandwidthEstimateKbps, signal.AvailableOutgoingBitrateKbps.Value, BandwidthEwmaAlpha);
        }

        if (signal.RoundTripTimeMs is > 0)
        {
            _roundTripTimeEstimateMs = Smooth(_roundTripTimeEstimateMs, signal.RoundTripTimeMs.Value, RoundTripTimeEwmaAlpha);
        }
        else if (signal.NetworkJitterMs > 0)
        {
            _roundTripTimeEstimateMs = Smooth(_roundTripTimeEstimateMs, signal.NetworkJitterMs, RoundTripTimeEwmaAlpha);
        }

        if (signal.NetworkJitterMs > 0)
        {
            _jitterEstimateMs = Smooth(_jitterEstimateMs, signal.NetworkJitterMs, RoundTripTimeEwmaAlpha);
        }

        var immediateLow = packetLossSample is > PacketLossImmediateDowngradeThresholdPercent;
        var targetTier = DetermineTargetTier(immediateLow);

        if (targetTier == _tier)
        {
            ClearTierTransitionTracking();
            return;
        }

        if (targetTier > _tier)
        {
            if (_upgradeCandidateTier != targetTier)
            {
                _upgradeCandidateTier = targetTier;
                _upgradeCandidateSince = observedAt;
            }

            if (_upgradeCandidateSince is not null && observedAt - _upgradeCandidateSince.Value >= TierUpgradeWindow)
            {
                ApplyTier(targetTier);
                ClearTierTransitionTracking();
            }

            return;
        }

        if (_downgradeCandidateTier != targetTier)
        {
            _downgradeCandidateTier = targetTier;
            _downgradeCandidateSince = observedAt;
        }

        if (immediateLow)
        {
            ApplyTier(AdaptiveTier.Low);
            ClearTierTransitionTracking();
            return;
        }

        if (_downgradeCandidateSince is not null && observedAt - _downgradeCandidateSince.Value >= TierDowngradeWindow)
        {
            ApplyTier(targetTier);
            ClearTierTransitionTracking();
        }
    }

    private AdaptiveTier DetermineTargetTier(bool immediateLow)
    {
        if (immediateLow)
        {
            return AdaptiveTier.Low;
        }

        if (_packetLossEstimatePercent is > PacketLossWarningThresholdPercent)
        {
            return AdaptiveTier.Low;
        }

        if (_bandwidthEstimateKbps is null)
        {
            return _tier;
        }

        var bandwidth = _bandwidthEstimateKbps.Value;
        var roundTrip = _roundTripTimeEstimateMs;

        if (bandwidth >= HighBandwidthThresholdKbps && (roundTrip is null || roundTrip < HighLatencyThresholdMs))
        {
            return AdaptiveTier.High;
        }

        if (bandwidth >= MediumBandwidthThresholdKbps)
        {
            return AdaptiveTier.Medium;
        }

        return AdaptiveTier.Low;
    }

    private void ApplyTier(AdaptiveTier tier)
    {
        var profile = ResolveTierProfile(tier);
        _tier = tier;
        _state = _state with
        {
            Width = profile.Width,
            Height = profile.Height,
            FrameRate = profile.FrameRate,
            Quality = profile.Quality
        };
    }

    private static TierProfile ResolveTierProfile(AdaptiveTier tier)
    {
        return tier switch
        {
            AdaptiveTier.High => new TierProfile(DefaultWidth, DefaultHeight, 30, "high"),
            AdaptiveTier.Medium => new TierProfile(DefaultWidth, DefaultHeight, MediumFrameRate, "medium"),
            _ => new TierProfile(JitterFallbackWidth, JitterFallbackHeight, LowFrameRate, "low")
        };
    }

    private void ClearTierTransitionTracking()
    {
        _upgradeCandidateTier = null;
        _upgradeCandidateSince = null;
        _downgradeCandidateTier = null;
        _downgradeCandidateSince = null;
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
        _upgradeCandidateTier = null;
        _upgradeCandidateSince = null;
        _downgradeCandidateTier = null;
        _downgradeCandidateSince = null;
        _bandwidthEstimateKbps = null;
        _roundTripTimeEstimateMs = null;
        _packetLossEstimatePercent = null;
        _jitterEstimateMs = null;
        _packetsLostEstimate = null;
        _packetsSentEstimate = null;
        _tier = ResolveInitialTier(mode);

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

    private static AdaptiveTier ResolveInitialTier(string mode)
    {
        return mode switch
        {
            "high_quality" => AdaptiveTier.High,
            "low_latency" => AdaptiveTier.High,
            "power_save" => AdaptiveTier.Low,
            _ => AdaptiveTier.Medium
        };
    }

    private static string ResolveTierName(AdaptiveTier tier)
    {
        return tier switch
        {
            AdaptiveTier.High => "high",
            AdaptiveTier.Medium => "medium",
            _ => "low"
        };
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

    private static double? TryComputePacketLossPercent(CapturePerformanceSignal signal)
    {
        if (signal.PacketsLost is null || signal.PacketsSent is null)
        {
            return null;
        }

        var packetsLost = signal.PacketsLost.Value;
        var packetsSent = signal.PacketsSent.Value;
        var total = packetsLost + packetsSent;
        if (total <= 0)
        {
            return null;
        }

        return packetsLost * 100.0 / total;
    }

    private static double Smooth(double? current, double sample, double alpha)
    {
        if (current is null)
        {
            return sample;
        }

        return current.Value + alpha * (sample - current.Value);
    }

    private readonly record struct TierProfile(int Width, int Height, int FrameRate, string Quality);
}

public interface ICaptureClock
{
    DateTimeOffset UtcNow { get; }
}

public sealed class SystemCaptureClock : ICaptureClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}
