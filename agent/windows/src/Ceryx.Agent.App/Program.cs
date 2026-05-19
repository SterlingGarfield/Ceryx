using Ceryx.Agent.App.Tray;
using Ceryx.Agent.Core;
using Ceryx.Agent.Network;
using Ceryx.Agent.Storage;
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
