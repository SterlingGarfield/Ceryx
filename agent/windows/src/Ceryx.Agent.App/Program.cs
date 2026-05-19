using Microsoft.AspNetCore.Http.HttpResults;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/api/v1/health", HealthHandler);
app.MapGet("/api/v1/agent/status", AgentStatusHandler);

app.Run();

static Ok<object> HealthHandler()
{
    return TypedResults.Ok(new
    {
        ok = true,
        service = "ceryx-agent",
        version = "0.3.0"
    });
}

static Ok<object> AgentStatusHandler()
{
    return TypedResults.Ok(new
    {
        agentVersion = "0.3.0",
        deviceName = "Local Windows PC",
        platform = "windows",
        status = "running",
        httpPort = 41527,
        supportsWebRTC = false,
        supportsDesktopClient = true,
        codexStatus = "not_found"
    });
}

public partial class Program;
