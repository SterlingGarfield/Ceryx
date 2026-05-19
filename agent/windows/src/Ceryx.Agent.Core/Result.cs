namespace Ceryx.Agent.Core;

public sealed record Result<T>
{
    public bool IsSuccess { get; init; }

    public T? Value { get; init; }

    public AgentError? Error { get; init; }

    public static Result<T> Success(T value)
    {
        return new Result<T>
        {
            IsSuccess = true,
            Value = value
        };
    }

    public static Result<T> Failure(AgentError error)
    {
        return new Result<T>
        {
            IsSuccess = false,
            Error = error
        };
    }
}
