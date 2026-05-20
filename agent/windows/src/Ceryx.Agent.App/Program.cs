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
using Ceryx.Agent.Security.Devices;
using Ceryx.Agent.Security.Pairing;
using Ceryx.Agent.Security.Tokens;
using Ceryx.Agent.Storage;
using Ceryx.Agent.Storage.Audit;
using Ceryx.Agent.Storage.Devices;
using Ceryx.Agent.Storage.Sqlite;
using Serilog;
using Serilog.Events;

var localPaths = LocalPaths.CreateDefault();
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
    builder.Host.UseSerilog();
    builder.WebHost.UseUrls("http://127.0.0.1:41527");
    builder.Services.AddSingleton(localPaths);
    builder.Services.AddSingleton<AgentRuntimeState>();
    builder.Services.AddSingleton<AgentDiscoveryMetadataFactory>();
    builder.Services.AddSingleton<IAgentDiscoveryPublisher, MdnsAgentDiscoveryPublisher>();
    builder.Services.AddHostedService<AgentDiscoveryHostedService>();
    builder.Services.AddSingleton<IPairingClock, SystemPairingClock>();
    builder.Services.AddSingleton<IPairingCodeGenerator, RandomPairingCodeGenerator>();
    builder.Services.AddSingleton<IPairingAuditSink, NoOpPairingAuditSink>();
    builder.Services.AddSingleton<PairingStateMachine>();
    builder.Services.AddSingleton<SqliteConnectionFactory>();
    builder.Services.AddSingleton<ITrustedDeviceStore, SqliteTrustedDeviceStore>();
    builder.Services.AddSingleton<IAuditLogStore, SqliteAuditLogStore>();
    builder.Services.AddSingleton<IDeviceTokenGenerator, DeviceTokenGenerator>();
    builder.Services.AddSingleton<IDeviceTokenHasher, DeviceTokenHasher>();
    builder.Services.AddSingleton<IDefaultPermissionPolicy, DefaultPermissionPolicy>();
    builder.Services.AddSingleton<PairingCompletionService>();
    builder.Services.AddSingleton<ICodexWindowProbe, ProcessCodexWindowProbe>();
    builder.Services.AddSingleton<ICodexWindowLocator, CodexWindowLocator>();
    builder.Services.AddSingleton<ISessionLockService, InMemorySessionLockService>();
    builder.Services.AddSingleton<IInputCommandMapper, DefaultInputCommandMapper>();
    builder.Services.AddSingleton<IInputBridge, NoOpInputBridge>();
    builder.Services.AddSingleton<IClipboardService, MemoryClipboardService>();
    builder.Services.AddSingleton<IPromptBridgeService, PromptBridgeService>();
    builder.Services.AddSingleton<IImagePasteService, NoOpImagePasteService>();
    builder.Services.AddSingleton<ICaptureLifecycleService, InMemoryCaptureLifecycleService>();
    builder.Services.AddSingleton<ICaptureSignalService, NoOpCaptureSignalService>();
    builder.Services.AddSingleton<IDiskSpaceProvider, DriveDiskSpaceProvider>();
    builder.Services.AddSingleton<IUploadImageService, UploadImageService>();
    builder.Services.AddSingleton<IScreenshotService, ScreenshotService>();
    builder.Services.AddSingleton<IRecordingService, RecordingService>();
    builder.Services.AddSingleton<IAgentTrayShell, AgentTrayShell>();

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

public partial class Program;
