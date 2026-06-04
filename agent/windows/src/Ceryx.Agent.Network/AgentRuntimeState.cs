using Ceryx.Agent.Core;

namespace Ceryx.Agent.Network;

public sealed class AgentRuntimeState
{
    private readonly object _sync = new();
    private readonly DateTimeOffset _startedAt = DateTimeOffset.UtcNow;
    private AgentRuntimeStatus _status = AgentRuntimeStatus.Running;

    public AgentRuntimeStatus GetStatus()
    {
        lock (_sync)
        {
            return _status;
        }
    }

    public AgentRuntimeStatus Pause()
    {
        lock (_sync)
        {
            _status = AgentRuntimeStatus.Paused;
            return _status;
        }
    }

    public AgentRuntimeStatus Resume()
    {
        lock (_sync)
        {
            _status = AgentRuntimeStatus.Running;
            return _status;
        }
    }

    public DateTimeOffset StartedAt => _startedAt;
}
