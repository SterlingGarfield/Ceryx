using System.Security.Cryptography;
using System.Text;

namespace Ceryx.Agent.Security.Tokens;

public interface IDeviceTokenGenerator
{
    string GenerateToken();
}

public interface IDeviceTokenHasher
{
    string Hash(string token);

    bool Verify(string token, string expectedHash);
}

public sealed class DeviceTokenGenerator : IDeviceTokenGenerator
{
    public string GenerateToken()
    {
        var bytes = new byte[32];
        RandomNumberGenerator.Fill(bytes);
        var encoded = Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
        return $"dt_{encoded}";
    }
}

public sealed class DeviceTokenHasher : IDeviceTokenHasher
{
    public string Hash(string token)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(token);

        var input = Encoding.UTF8.GetBytes(token);
        var digest = SHA256.HashData(input);
        return Convert.ToHexString(digest).ToLowerInvariant();
    }

    public bool Verify(string token, string expectedHash)
    {
        if (string.IsNullOrWhiteSpace(expectedHash))
        {
            return false;
        }

        var computed = Hash(token);
        var expectedBytes = Encoding.UTF8.GetBytes(expectedHash);
        var computedBytes = Encoding.UTF8.GetBytes(computed);
        return CryptographicOperations.FixedTimeEquals(computedBytes, expectedBytes);
    }
}
