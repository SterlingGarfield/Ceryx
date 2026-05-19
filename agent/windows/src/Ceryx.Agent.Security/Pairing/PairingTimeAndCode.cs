using System.Security.Cryptography;

namespace Ceryx.Agent.Security.Pairing;

public interface IPairingClock
{
    DateTimeOffset UtcNow { get; }
}

public sealed class SystemPairingClock : IPairingClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}

public interface IPairingCodeGenerator
{
    string GenerateSixDigitCode();
}

public sealed class RandomPairingCodeGenerator : IPairingCodeGenerator
{
    public string GenerateSixDigitCode()
    {
        var value = RandomNumberGenerator.GetInt32(0, 1_000_000);
        return value.ToString("D6", System.Globalization.CultureInfo.InvariantCulture);
    }
}
