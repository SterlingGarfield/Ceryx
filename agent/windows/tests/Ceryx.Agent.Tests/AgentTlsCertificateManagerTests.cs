using System.Security.Cryptography.X509Certificates;
using Ceryx.Agent.Network;
using Ceryx.Agent.Storage;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class AgentTlsCertificateManagerTests
{
    [Fact]
    public void AgentTlsCertificateManager_CreatesCertificateAndKeepsFingerprintStableAcrossReload()
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), "ceryx-tls-" + Guid.NewGuid().ToString("N"));

        try
        {
            var paths = new LocalPaths(tempRoot);
            paths.EnsureDirectories();

            var settings = new AgentTlsSettings(
                HttpsPort: 41527,
                HttpFallbackPort: 41528,
                ValidityDays: 365);

            var firstManager = new AgentTlsCertificateManager(
                paths,
                settings,
                ["127.0.0.1", "192.168.1.25"]);
            var first = firstManager.GetCurrentCertificate();

            Assert.True(File.Exists(paths.TlsCertificatePath));
            Assert.True(File.Exists(paths.TlsCertificatePasswordPath));
            Assert.Matches("^[A-F0-9]{64}$", first.Fingerprint);

            var reloadedManager = new AgentTlsCertificateManager(
                paths,
                settings,
                ["127.0.0.1", "192.168.1.25"]);
            var reloaded = reloadedManager.GetCurrentCertificate();

            Assert.Equal(first.Fingerprint, reloaded.Fingerprint);
        }
        finally
        {
            if (Directory.Exists(tempRoot))
            {
                Directory.Delete(tempRoot, recursive: true);
            }
        }
    }

    [Fact]
    public void AgentTlsCertificateManager_AddsLoopbackAndLanAddressesToCertificateSan()
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), "ceryx-tls-san-" + Guid.NewGuid().ToString("N"));

        try
        {
            var paths = new LocalPaths(tempRoot);
            paths.EnsureDirectories();

            var manager = new AgentTlsCertificateManager(
                paths,
                new AgentTlsSettings(41527, 41528, 365),
                ["127.0.0.1", "192.168.1.25"]);
            var certificate = manager.GetCurrentCertificate();
            using var parsed = X509CertificateLoader.LoadPkcs12(
                certificate.PfxBytes,
                certificate.Password,
                X509KeyStorageFlags.EphemeralKeySet | X509KeyStorageFlags.Exportable);

            var san = parsed.Extensions["2.5.29.17"];
            var formattedSan = san?.Format(multiLine: false) ?? string.Empty;

            Assert.Contains("127.0.0.1", formattedSan, StringComparison.Ordinal);
            Assert.Contains("192.168.1.25", formattedSan, StringComparison.Ordinal);
            Assert.Contains("localhost", formattedSan, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            if (Directory.Exists(tempRoot))
            {
                Directory.Delete(tempRoot, recursive: true);
            }
        }
    }
}
