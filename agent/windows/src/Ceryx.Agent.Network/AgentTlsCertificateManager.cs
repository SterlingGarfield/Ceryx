using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Ceryx.Agent.Security.Devices;
using Ceryx.Agent.Storage;

namespace Ceryx.Agent.Network;

public sealed record AgentTlsSettings(
    int HttpsPort,
    int HttpFallbackPort,
    int ValidityDays);

public sealed record AgentTlsCertificateSnapshot(
    X509Certificate2 Certificate,
    byte[] PfxBytes,
    string Password,
    string Fingerprint);

public sealed class AgentTlsCertificateManager : IAgentCertificateFingerprintProvider
{
    private readonly LocalPaths _paths;
    private readonly AgentTlsSettings _settings;
    private readonly string[] _subjectAlternativeNames;
    private readonly object _sync = new();
    private AgentTlsCertificateSnapshot? _current;

    public AgentTlsCertificateManager(
        LocalPaths paths,
        AgentTlsSettings settings,
        IEnumerable<string>? subjectAlternativeNames = null)
    {
        _paths = paths ?? throw new ArgumentNullException(nameof(paths));
        _settings = settings ?? throw new ArgumentNullException(nameof(settings));
        _subjectAlternativeNames = BuildSubjectAlternativeNames(subjectAlternativeNames);
    }

    public AgentTlsCertificateSnapshot GetCurrentCertificate()
    {
        lock (_sync)
        {
            _current ??= LoadOrCreateCertificate();
            return _current;
        }
    }

    public AgentTlsCertificateSnapshot RegenerateCertificate()
    {
        lock (_sync)
        {
            _current = CreateAndPersistCertificate();
            return _current;
        }
    }

    public string GetCurrentFingerprint()
    {
        return GetCurrentCertificate().Fingerprint;
    }

    private AgentTlsCertificateSnapshot LoadOrCreateCertificate()
    {
        _paths.EnsureDirectories();
        if (!File.Exists(_paths.TlsCertificatePath) || !File.Exists(_paths.TlsCertificatePasswordPath))
        {
            return CreateAndPersistCertificate();
        }

        var pfxBytes = File.ReadAllBytes(_paths.TlsCertificatePath);
        var password = File.ReadAllText(_paths.TlsCertificatePasswordPath).Trim();
        if (pfxBytes.Length == 0 || string.IsNullOrWhiteSpace(password))
        {
            return CreateAndPersistCertificate();
        }

        return CreateSnapshot(pfxBytes, password);
    }

    private AgentTlsCertificateSnapshot CreateAndPersistCertificate()
    {
        var password = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
        var certificate = CreateSelfSignedCertificate();
        var pfxBytes = certificate.Export(X509ContentType.Pfx, password);

        Directory.CreateDirectory(_paths.Certificates);
        File.WriteAllBytes(_paths.TlsCertificatePath, pfxBytes);
        File.WriteAllText(_paths.TlsCertificatePasswordPath, password);

        return CreateSnapshot(pfxBytes, password);
    }

    private AgentTlsCertificateSnapshot CreateSnapshot(byte[] pfxBytes, string password)
    {
        var certificate = X509CertificateLoader.LoadPkcs12(
            pfxBytes,
            password,
            X509KeyStorageFlags.Exportable | X509KeyStorageFlags.EphemeralKeySet);
        var fingerprint = ComputeFingerprint(certificate);
        return new AgentTlsCertificateSnapshot(certificate, pfxBytes, password, fingerprint);
    }

    private X509Certificate2 CreateSelfSignedCertificate()
    {
        using var rsa = RSA.Create(2048);
        var request = new CertificateRequest(
            $"CN={Environment.MachineName}",
            rsa,
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);

        request.CertificateExtensions.Add(
            new X509BasicConstraintsExtension(false, false, 0, false));
        request.CertificateExtensions.Add(
            new X509KeyUsageExtension(
                X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment,
                critical: true));
        request.CertificateExtensions.Add(
            new X509EnhancedKeyUsageExtension(
                [new Oid("1.3.6.1.5.5.7.3.1")],
                critical: false));

        var sanBuilder = new SubjectAlternativeNameBuilder();
        foreach (var name in _subjectAlternativeNames)
        {
            if (IPAddress.TryParse(name, out var address))
            {
                sanBuilder.AddIpAddress(address);
                continue;
            }

            sanBuilder.AddDnsName(name);
        }

        request.CertificateExtensions.Add(sanBuilder.Build());
        request.CertificateExtensions.Add(
            new X509SubjectKeyIdentifierExtension(request.PublicKey, false));

        var notBefore = DateTimeOffset.UtcNow.AddDays(-1);
        var notAfter = notBefore.AddDays(Math.Max(1, _settings.ValidityDays));
        using var created = request.CreateSelfSigned(notBefore, notAfter);
        return X509CertificateLoader.LoadPkcs12(
            created.Export(X509ContentType.Pfx),
            string.Empty,
            X509KeyStorageFlags.Exportable | X509KeyStorageFlags.EphemeralKeySet);
    }

    private static string ComputeFingerprint(X509Certificate2 certificate)
    {
        var derBytes = certificate.Export(X509ContentType.Cert);
        return Convert.ToHexString(SHA256.HashData(derBytes));
    }

    private static string[] BuildSubjectAlternativeNames(IEnumerable<string>? additionalNames)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "localhost",
            "127.0.0.1"
        };

        if (additionalNames is not null)
        {
            foreach (var name in additionalNames)
            {
                if (!string.IsNullOrWhiteSpace(name))
                {
                    names.Add(name.Trim());
                }
            }
        }

        return names.OrderBy(static item => item, StringComparer.OrdinalIgnoreCase).ToArray();
    }
}
