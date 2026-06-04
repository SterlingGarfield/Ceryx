using Ceryx.Agent.App.Tray;
using Ceryx.Agent.Capture;
using Ceryx.Agent.Codex.Clipboard;
using Ceryx.Agent.Codex.ImageBridge;
using Ceryx.Agent.Codex.Input;
using Ceryx.Agent.Codex.SessionLock;
using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;
using Ceryx.Agent.Media;
using Ceryx.Agent.Network;
using Ceryx.Agent.Network.Discovery;
using Ceryx.Agent.Project;
using Ceryx.Agent.Security.Devices;
using Ceryx.Agent.Security.Pairing;
using Ceryx.Agent.Security.Tokens;
using Ceryx.Agent.Storage;
using Ceryx.Agent.Storage.Audit;
using Ceryx.Agent.Storage.Devices;
using Ceryx.Agent.Storage.Notifications;
using Ceryx.Agent.Storage.Settings;
using Ceryx.Agent.Storage.Sqlite;
using Serilog;
using Serilog.Events;
using System.Net;

const int AgentHttpPort = 41527;

var agentRootOverride = Environment.GetEnvironmentVariable("CERYX_AGENT_ROOT_OVERRIDE");
var localPaths = !string.IsNullOrWhiteSpace(agentRootOverride)
    ? new LocalPaths(Path.GetFullPath(agentRootOverride))
    : LocalPaths.CreateDefault();
localPaths.EnsureDirectories();

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
    .Enrich.FromLogContext()
    .WriteTo.File(
        Path.Combine(localPaths.Logs, "agent-.log"),
        rollingInterval: RollingInterval.Day,
        retainedFileCountLimit: 14,
        shared: true)
    .CreateLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);
    var bindingUrls = AgentNetworkBindingResolver.ResolveUrls(AgentHttpPort);
    builder.Host.UseSerilog();
    builder.WebHost.UseUrls(bindingUrls.ToArray());
    builder.Services.AddSingleton(localPaths);
    builder.Services.AddSingleton<AgentRuntimeState>();
    builder.Services.AddSingleton<IPairingRateLimiter, InMemoryPairingRateLimiter>();
    builder.Services.AddSingleton<AgentDiscoveryMetadataFactory>();
    builder.Services.AddSingleton<IAgentDiscoveryPublisher, MdnsAgentDiscoveryPublisher>();
    builder.Services.AddHostedService<AgentDiscoveryHostedService>();
    builder.Services.AddSingleton<IPairingClock, SystemPairingClock>();
    builder.Services.AddSingleton<IPairingCodeGenerator, RandomPairingCodeGenerator>();
    builder.Services.AddSingleton<IPairingAuditSink, NoOpPairingAuditSink>();
    builder.Services.AddSingleton(new WakeOnLanSettings(
        Enabled: ReadWakeOnLanEnabled(),
        Port: ReadWakeOnLanPort()));
    builder.Services.AddSingleton<IWakeOnLanInfoProvider, SystemWakeOnLanInfoProvider>();
    builder.Services.AddSingleton<PairingStateMachine>();
    builder.Services.AddSingleton<SqliteConnectionFactory>();
    builder.Services.AddSingleton<ITrustedDeviceStore, SqliteTrustedDeviceStore>();
    builder.Services.AddSingleton<IAuditLogStore, SqliteAuditLogStore>();
    builder.Services.AddSingleton<IAgentSettingsStore, SqliteAgentSettingsStore>();
    builder.Services.AddSingleton<IDeviceTokenGenerator, DeviceTokenGenerator>();
    builder.Services.AddSingleton<IDeviceTokenHasher, DeviceTokenHasher>();
    builder.Services.AddSingleton<IDefaultPermissionPolicy, DefaultPermissionPolicy>();
    builder.Services.AddSingleton<PairingCompletionService>();
    builder.Services.AddSingleton<ICodexWindowProbe, ProcessCodexWindowProbe>();
    builder.Services.AddSingleton<ICodexWindowLocator, CodexWindowLocator>();
    builder.Services.AddSingleton<ISessionLockService, InMemorySessionLockService>();
    builder.Services.AddSingleton<IInputCommandMapper, DefaultInputCommandMapper>();
    builder.Services.AddSingleton<IInputBridge, NoOpInputBridge>();
    builder.Services.AddSingleton<IClipboardService, WindowsClipboardService>();
    builder.Services.AddSingleton<IPromptBridgeService, PromptBridgeService>();
    builder.Services.AddSingleton<IImagePasteService, NoOpImagePasteService>();
    builder.Services.AddSingleton<InMemoryCaptureLifecycleService>();
    builder.Services.AddSingleton<ICaptureLifecycleService>(serviceProvider =>
        serviceProvider.GetRequiredService<InMemoryCaptureLifecycleService>());
    builder.Services.AddSingleton<ICaptureSignalClock, SystemCaptureSignalClock>();
    builder.Services.AddSingleton<CaptureSignalService>();
    builder.Services.AddSingleton<ICaptureSignalService>(serviceProvider =>
        serviceProvider.GetRequiredService<CaptureSignalService>());
    builder.Services.AddSingleton<ICaptureConnectionStatsProvider>(serviceProvider =>
        serviceProvider.GetRequiredService<CaptureSignalService>());
    builder.Services.AddSingleton<IDiskSpaceProvider, DriveDiskSpaceProvider>();
    builder.Services.AddSingleton<WindowImageCapture>();
    builder.Services.AddSingleton<IWindowImageCapture>(serviceProvider =>
        serviceProvider.GetRequiredService<WindowImageCapture>());
    builder.Services.AddSingleton<IWindowCaptureBackendInfo>(serviceProvider =>
        serviceProvider.GetRequiredService<WindowImageCapture>());
    builder.Services.AddSingleton<IWebRtcFrameSource, WindowWebRtcFrameSource>();
    builder.Services.AddSingleton<IFramePreviewService, FramePreviewService>();
    builder.Services.AddSingleton<IAudioCaptureService, WasapiLoopbackAudioCaptureService>();
    builder.Services.AddSingleton<IRecordingMediaEncoder, FfmpegRecordingMediaEncoder>();
    builder.Services.AddSingleton<IRecordingCatalogService, RecordingCatalogService>();
    builder.Services.AddSingleton<IFileTransferService, FileTransferService>();
    builder.Services.AddSingleton<IUploadImageService, UploadImageService>();
    builder.Services.AddSingleton<IScreenshotService, ScreenshotService>();
    builder.Services.AddSingleton<IRecordingService, RecordingService>();
    builder.Services.AddSingleton<IProjectConfigRepository, SqliteProjectConfigRepository>();
    builder.Services.AddSingleton<IGitCommandService, GitCommandService>();
    builder.Services.AddSingleton<IGitDiffService, GitDiffService>();
    builder.Services.AddSingleton<IProjectFileIndexService, ProjectFileIndexService>();
    builder.Services.AddSingleton<INotificationStateStore, SqliteNotificationStateStore>();
    builder.Services.AddSingleton<IAgentTrayShell, AgentTrayShell>();
    builder.Services.AddCors(options =>
    {
        options.AddPolicy("CeryxLocalClients", policy =>
        {
            policy
                .SetIsOriginAllowed(IsAllowedCorsOrigin)
                .AllowAnyMethod()
                .AllowAnyHeader();
        });
    });

    var app = builder.Build();
    app.Lifetime.ApplicationStarted.Register(() =>
        app.Logger.LogInformation("Agent host started. urls={Urls}", string.Join(", ", app.Urls)));
    app.Lifetime.ApplicationStopping.Register(() =>
        app.Logger.LogInformation("Agent host stopping."));
    app.Lifetime.ApplicationStopped.Register(() =>
        app.Logger.LogInformation("Agent host stopped."));

    app.Logger.LogInformation("Initializing storage. database={DatabasePath}", localPaths.Database);
    var storageBootstrapper = new StorageBootstrapper(localPaths);
    await storageBootstrapper.InitializeAsync();
    app.Logger.LogInformation("Storage initialization completed.");

    var trayShell = app.Services.GetRequiredService<IAgentTrayShell>();
    app.Logger.LogInformation(
        "Tray shell initialized with commands: {CommandIds}",
        string.Join(", ", trayShell.Commands.Select(static command => command.Id)));

    app.UseAgentRequestTracing();
    app.UseCors("CeryxLocalClients");
    app.UseAgentAuthorization();
    app.MapAgentRoutes(localPaths);

    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Agent host terminated unexpectedly.");
    throw;
}
finally
{
    Log.CloseAndFlush();
}

static bool IsAllowedCorsOrigin(string origin)
{
    if (string.IsNullOrWhiteSpace(origin))
    {
        return false;
    }

    var configuredAllowedOrigins = Environment.GetEnvironmentVariable("CERYX_ALLOWED_ORIGINS")?
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) ?? [];
    if (configuredAllowedOrigins.Any(item =>
            string.Equals(item, origin, StringComparison.OrdinalIgnoreCase)))
    {
        return true;
    }

    if (!Uri.TryCreate(origin, UriKind.Absolute, out var originUri))
    {
        return false;
    }

    if (!string.Equals(originUri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) &&
        !string.Equals(originUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
    {
        return false;
    }

    if (string.Equals(originUri.Host, "localhost", StringComparison.OrdinalIgnoreCase))
    {
        return true;
    }

    return IPAddress.TryParse(originUri.Host, out var originIp) &&
           AgentNetworkBindingResolver.IsLanOrLoopback(originIp);
}

static bool ReadWakeOnLanEnabled()
{
    var value = Environment.GetEnvironmentVariable("CERYX_WOL_ENABLED");
    if (string.IsNullOrWhiteSpace(value))
    {
        return true;
    }

    return !string.Equals(value, "false", StringComparison.OrdinalIgnoreCase) &&
           !string.Equals(value, "0", StringComparison.OrdinalIgnoreCase);
}

static int ReadWakeOnLanPort()
{
    var value = Environment.GetEnvironmentVariable("CERYX_WOL_PORT");
    return int.TryParse(value, out var port) && port is > 0 and <= 65535 ? port : 9;
}

public partial class Program;
