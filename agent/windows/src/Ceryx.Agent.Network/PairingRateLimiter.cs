using System.Collections.Concurrent;

namespace Ceryx.Agent.Network;

public interface IPairingRateLimiter
{
    bool TryAcquire(string key, DateTimeOffset now, out TimeSpan retryAfter);
}

public sealed class InMemoryPairingRateLimiter : IPairingRateLimiter
{
    private const string LimitEnvVar = "CERYX_PAIRING_RATE_LIMIT_COUNT";
    private const string WindowEnvVar = "CERYX_PAIRING_RATE_LIMIT_WINDOW_SECONDS";
    private readonly ConcurrentDictionary<string, Queue<DateTimeOffset>> _entries = new(StringComparer.Ordinal);
    private readonly int _limit;
    private readonly TimeSpan _window;
    private readonly object _gate = new();

    public InMemoryPairingRateLimiter()
    {
        _limit = ResolveInt(LimitEnvVar, fallback: 6, min: 1, max: 120);
        _window = TimeSpan.FromSeconds(ResolveInt(WindowEnvVar, fallback: 60, min: 5, max: 3600));
    }

    public bool TryAcquire(string key, DateTimeOffset now, out TimeSpan retryAfter)
    {
        key = string.IsNullOrWhiteSpace(key) ? "unknown" : key.Trim();
        var queue = _entries.GetOrAdd(key, static _ => new Queue<DateTimeOffset>());

        lock (_gate)
        {
            while (queue.Count > 0 && now - queue.Peek() >= _window)
            {
                queue.Dequeue();
            }

            if (queue.Count >= _limit)
            {
                var retryAt = queue.Peek().Add(_window);
                retryAfter = retryAt > now ? retryAt - now : TimeSpan.FromSeconds(1);
                return false;
            }

            queue.Enqueue(now);
            retryAfter = TimeSpan.Zero;
            return true;
        }
    }

    private static int ResolveInt(string envVar, int fallback, int min, int max)
    {
        var raw = Environment.GetEnvironmentVariable(envVar);
        if (!int.TryParse(raw, out var parsed))
        {
            return fallback;
        }

        if (parsed < min)
        {
            return min;
        }

        if (parsed > max)
        {
            return max;
        }

        return parsed;
    }
}
