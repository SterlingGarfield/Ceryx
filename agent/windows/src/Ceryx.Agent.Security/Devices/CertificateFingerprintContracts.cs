namespace Ceryx.Agent.Security.Devices;

public interface IAgentCertificateFingerprintProvider
{
    string GetCurrentFingerprint();
}
