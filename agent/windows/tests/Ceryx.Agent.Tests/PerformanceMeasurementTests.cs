using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;
using Ceryx.Agent.Project;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;
using Xunit.Abstractions;

namespace Ceryx.Agent.Tests;

public sealed class PerformanceMeasurementTests :
    IClassFixture<WebApplicationFactory<Program>>,
    IClassFixture<RemoteControlTransportFactory>
{
    private const int DesktopConnectTargetMs = 1000;
    private const int IpadConnectTargetMs = 3000;
    private const int InputLatencyP95TargetMs = 80;
    private const int DiffTargetMs = 1000;
    private const double IdleCpuTargetPercent = 3;
    private const double CaptureCpuTargetPercent = 25;

    private readonly WebApplicationFactory<Program> _factory;
    private readonly RemoteControlTransportFactory _remoteFactory;
    private readonly ITestOutputHelper _output;

    public PerformanceMeasurementTests(
        WebApplicationFactory<Program> factory,
        RemoteControlTransportFactory remoteFactory,
        ITestOutputHelper output)
    {
        _factory = factory;
        _remoteFactory = remoteFactory;
        _output = output;
    }

    [Fact]
    [Trait("Category", "W7PerformanceMeasurement")]
    public async Task PerformanceMeasurement_W7Targets_GenerateReport()
    {
        var desktopConnect = await MeasureDesktopConnectAsync();
        var ipadConnect = await MeasureIpadConnectAsync();
        var inputLatency = await MeasureInputLatencyAsync();
        var diffLatency = MeasureDiffLatency5000Lines();
        var idleCpuPercent = await MeasureCpuUsagePercentAsync(
            duration: TimeSpan.FromSeconds(5),
            workload: static async cancellationToken =>
            {
                await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken);
            });
        var captureCpuPercent = await MeasureCaptureCpuUsagePercentAsync();

        WriteConsoleSummary(desktopConnect, ipadConnect, inputLatency, diffLatency, idleCpuPercent, captureCpuPercent);
        await WriteMarkdownReportAsync(
            desktopConnect,
            ipadConnect,
            inputLatency,
            diffLatency,
            idleCpuPercent,
            captureCpuPercent);

        Assert.True(
            desktopConnect.P95Milliseconds <= DesktopConnectTargetMs,
            $"Desktop connect P95 exceeded target. value={desktopConnect.P95Milliseconds:0.00}ms target<={DesktopConnectTargetMs}ms");
        Assert.True(
            ipadConnect.P95Milliseconds <= IpadConnectTargetMs,
            $"iPad connect P95 exceeded target. value={ipadConnect.P95Milliseconds:0.00}ms target<={IpadConnectTargetMs}ms");
        Assert.True(
            inputLatency.P95Milliseconds <= InputLatencyP95TargetMs,
            $"Input latency P95 exceeded target. value={inputLatency.P95Milliseconds:0.00}ms target<={InputLatencyP95TargetMs}ms");
        Assert.True(
            diffLatency.P95Milliseconds <= DiffTargetMs,
            $"Diff latency P95 exceeded target. value={diffLatency.P95Milliseconds:0.00}ms target<={DiffTargetMs}ms");
        Assert.True(
            idleCpuPercent < IdleCpuTargetPercent,
            $"Idle CPU exceeded target. value={idleCpuPercent:0.00}% target<{IdleCpuTargetPercent}%");
        Assert.True(
            captureCpuPercent < CaptureCpuTargetPercent,
            $"Capture CPU exceeded target. value={captureCpuPercent:0.00}% target<{CaptureCpuTargetPercent}%");
    }

    private async Task<LatencyStats> MeasureDesktopConnectAsync()
    {
        var client = _factory.CreateClient();
        return await MeasureEndpointLatencyAsync(
            operation: () => client.GetAsync("/api/v1/health"),
            warmupSamples: 8,
            measurementSamples: 40);
    }

    private async Task<LatencyStats> MeasureIpadConnectAsync()
    {
        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Permission.ViewWindow],
            clientType: "ipad",
            platform: "ios");

        return await MeasureEndpointLatencyAsync(
            operation: () => client.GetAsync("/api/v1/agent/status"),
            warmupSamples: 8,
            measurementSamples: 40);
    }

    private async Task<LatencyStats> MeasureInputLatencyAsync()
    {
        _remoteFactory.Locator.SetSnapshot(new CodexWindowSnapshot(
            Status: "found",
            WindowId: "w-perf-input",
            Title: "Codex",
            ProcessName: "codex",
            CandidateCount: 1,
            LastUpdatedAt: DateTimeOffset.UtcNow));

        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _remoteFactory,
            permissions: [Permission.ControlInput]);

        return await MeasureEndpointLatencyAsync(
            operation: () => client.PostAsync(
                "/api/v1/input/text",
                new StringContent(
                    JsonSerializer.Serialize(new InputTextBody("performance probe")),
                    Encoding.UTF8,
                    "application/json")),
            warmupSamples: 8,
            measurementSamples: 60);
    }

    private static LatencyStats MeasureDiffLatency5000Lines()
    {
        var fakeGit = new FakeGitCommandService();
        fakeGit.SetResponse(
            ["diff", "--name-status", "--no-renames", "--"],
            "M\tsrc/main.ts\n");
        fakeGit.SetResponse(
            ["diff", "--numstat", "--no-renames", "--"],
            "5000\t0\tsrc/main.ts\n");
        fakeGit.SetResponse(
            ["diff", "--no-color", "--", "src/main.ts"],
            BuildDiffPayload(5000));

        var service = new GitDiffService(fakeGit);
        var project = new ProjectConfigRecord(
            Id: "workspace-default",
            ProjectName: "CeryxProject",
            ProjectRoot: ResolveRepoRoot(),
            UpdatedAt: DateTimeOffset.UtcNow);

        var samples = new List<double>(8);
        for (var warmup = 0; warmup < 3; warmup++)
        {
            _ = service.GetFileDiffAsync(project, "src/main.ts", lineLimit: 5000).GetAwaiter().GetResult();
        }

        for (var index = 0; index < 8; index++)
        {
            var sw = Stopwatch.StartNew();
            var result = service.GetFileDiffAsync(project, "src/main.ts", lineLimit: 5000).GetAwaiter().GetResult();
            sw.Stop();

            if (!result.IsSuccess || result.Value is null)
            {
                var code = result.Error?.Code ?? "unknown";
                throw new InvalidOperationException($"Diff measurement failed. code={code}");
            }

            _ = result.Value.DiffText.Length;
            samples.Add(sw.Elapsed.TotalMilliseconds);
        }

        return LatencyStats.FromSamples(samples);
    }

    private async Task<double> MeasureCaptureCpuUsagePercentAsync()
    {
        _remoteFactory.Locator.SetSnapshot(new CodexWindowSnapshot(
            Status: "focused",
            WindowId: "w-perf-capture",
            Title: "Codex",
            ProcessName: "codex",
            CandidateCount: 1,
            LastUpdatedAt: DateTimeOffset.UtcNow));

        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _remoteFactory,
            permissions: [Permission.ViewWindow]);

        using (var startResponse = await client.PostAsync(
                   "/api/v1/capture/start",
                   new StringContent(
                       JsonSerializer.Serialize(new CaptureStartBody(Mode: "balanced", Target: "codex_window")),
                       Encoding.UTF8,
                       "application/json")))
        {
            if (startResponse.StatusCode != HttpStatusCode.OK)
            {
                throw new InvalidOperationException(
                    $"Unable to start capture measurement. status={(int)startResponse.StatusCode}");
            }
        }

        try
        {
            return await MeasureCpuUsagePercentAsync(
                duration: TimeSpan.FromSeconds(5),
                workload: async cancellationToken =>
                {
                    while (!cancellationToken.IsCancellationRequested)
                    {
                        using var signalResponse = await client.PostAsync(
                            "/api/v1/capture/webrtc/signal",
                            new StringContent(
                                JsonSerializer.Serialize(new CaptureSignalBody(
                                    SessionId: "perf-session",
                                    Type: "performance",
                                    Payload: "{\"cpuUsagePercent\":35,\"networkJitterMs\":12,\"hasActiveViewer\":true}",
                                    Sdp: null,
                                    Candidate: null)),
                                Encoding.UTF8,
                                "application/json"),
                            cancellationToken);

                        signalResponse.EnsureSuccessStatusCode();
                        await Task.Delay(33, cancellationToken);
                    }
                });
        }
        finally
        {
            _ = await client.PostAsync("/api/v1/capture/stop", content: null);
        }
    }

    private static async Task<LatencyStats> MeasureEndpointLatencyAsync(
        Func<Task<HttpResponseMessage>> operation,
        int warmupSamples,
        int measurementSamples)
    {
        for (var warmup = 0; warmup < warmupSamples; warmup++)
        {
            using var warmupResponse = await operation();
            warmupResponse.EnsureSuccessStatusCode();
            _ = await warmupResponse.Content.ReadAsStringAsync();
        }

        var samples = new List<double>(measurementSamples);
        for (var sample = 0; sample < measurementSamples; sample++)
        {
            var sw = Stopwatch.StartNew();
            using var response = await operation();
            sw.Stop();

            response.EnsureSuccessStatusCode();
            _ = await response.Content.ReadAsStringAsync();
            samples.Add(sw.Elapsed.TotalMilliseconds);
        }

        return LatencyStats.FromSamples(samples);
    }

    private static async Task<double> MeasureCpuUsagePercentAsync(
        TimeSpan duration,
        Func<CancellationToken, Task> workload)
    {
        using var cts = new CancellationTokenSource(duration);
        var token = cts.Token;

        var process = Process.GetCurrentProcess();
        process.Refresh();
        var cpuStart = process.TotalProcessorTime;
        var wallClock = Stopwatch.StartNew();

        try
        {
            await workload(token);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested)
        {
        }

        wallClock.Stop();
        process.Refresh();
        var cpuEnd = process.TotalProcessorTime;

        var wallMs = Math.Max(1, wallClock.Elapsed.TotalMilliseconds);
        var cpuMs = Math.Max(0, (cpuEnd - cpuStart).TotalMilliseconds);
        var denominator = wallMs * Math.Max(1, Environment.ProcessorCount);
        return cpuMs / denominator * 100;
    }

    private async Task WriteMarkdownReportAsync(
        LatencyStats desktopConnect,
        LatencyStats ipadConnect,
        LatencyStats inputLatency,
        LatencyStats diffLatency,
        double idleCpuPercent,
        double captureCpuPercent)
    {
        var repoRoot = ResolveRepoRoot();
        var reportDirectory = Path.Combine(repoRoot, "docs", "qa");
        Directory.CreateDirectory(reportDirectory);
        var reportPath = Path.Combine(reportDirectory, "performance-results.md");

        var generatedAt = DateTimeOffset.Now;
        var machine = Environment.MachineName;
        var os = Environment.OSVersion.VersionString;
        var cpuCores = Environment.ProcessorCount;

        var rows = new[]
        {
            BuildRow("Desktop local connect", "<= 1000 ms", $"{desktopConnect.P95Milliseconds:0.00} ms (P95)", desktopConnect.P95Milliseconds <= DesktopConnectTargetMs),
            BuildRow("Paired iPad connect", "<= 3000 ms", $"{ipadConnect.P95Milliseconds:0.00} ms (P95)", ipadConnect.P95Milliseconds <= IpadConnectTargetMs),
            BuildRow("Input latency", "<= 80 ms", $"{inputLatency.P95Milliseconds:0.00} ms (P95)", inputLatency.P95Milliseconds <= InputLatencyP95TargetMs),
            BuildRow("Diff (5000 lines)", "<= 1000 ms", $"{diffLatency.P95Milliseconds:0.00} ms (P95)", diffLatency.P95Milliseconds <= DiffTargetMs),
            BuildRow("Agent idle CPU", "< 3%", $"{idleCpuPercent:0.00}%", idleCpuPercent < IdleCpuTargetPercent),
            BuildRow("Agent capture CPU", "< 25%", $"{captureCpuPercent:0.00}%", captureCpuPercent < CaptureCpuTargetPercent)
        };

        var markdown = new StringBuilder();
        markdown.AppendLine("# Ceryx v0.3 W7 Task6 Performance Results");
        markdown.AppendLine();
        markdown.AppendLine("## Context");
        markdown.AppendLine();
        markdown.AppendLine($"- Generated at: {generatedAt:yyyy-MM-dd HH:mm:ss zzz}");
        markdown.AppendLine($"- Machine: {machine}");
        markdown.AppendLine($"- OS: {os}");
        markdown.AppendLine($"- Logical processors: {cpuCores}");
        markdown.AppendLine($"- Runtime: .NET {Environment.Version}");
        markdown.AppendLine($"- Repo root: `{repoRoot}`");
        markdown.AppendLine($"- Test command: `dotnet test .\\agent\\windows\\Ceryx.Agent.Windows.sln --filter Category=W7PerformanceMeasurement`");
        markdown.AppendLine();
        markdown.AppendLine("## Results");
        markdown.AppendLine();
        markdown.AppendLine("| Metric | Target | Measured | Result |");
        markdown.AppendLine("| --- | --- | --- | --- |");
        foreach (var row in rows)
        {
            markdown.AppendLine($"| {row.Metric} | {row.Target} | {row.Measured} | {row.Result} |");
        }

        markdown.AppendLine();
        markdown.AppendLine("## Method");
        markdown.AppendLine();
        markdown.AppendLine("- Desktop local connect: repeated `GET /api/v1/health` latency over in-process Agent host (40 samples, 8 warmups).");
        markdown.AppendLine("- Paired iPad connect: repeated token-authenticated `GET /api/v1/agent/status` latency with iPad device identity (40 samples, 8 warmups).");
        markdown.AppendLine("- Input latency: repeated token-authenticated `POST /api/v1/input/text` latency with focused Codex snapshot (60 samples, 8 warmups).");
        markdown.AppendLine("- Diff latency: `GitDiffService.GetFileDiffAsync` for synthetic 5000-line diff payload (8 samples, 3 warmups).");
        markdown.AppendLine("- CPU idle/capture: process CPU usage from `TotalProcessorTime` over 5-second windows; capture workload sends 30Hz performance signals during active capture.");
        markdown.AppendLine();
        markdown.AppendLine("## Notes");
        markdown.AppendLine();
        markdown.AppendLine("- Measurements are deterministic integration benchmarks inside test host and are intended for regression comparison across W7/W8.");
        markdown.AppendLine("- If any target fails, capture the host logs and rerun under the same load profile before release acceptance.");

        await File.WriteAllTextAsync(reportPath, markdown.ToString(), Encoding.UTF8);
    }

    private void WriteConsoleSummary(
        LatencyStats desktopConnect,
        LatencyStats ipadConnect,
        LatencyStats inputLatency,
        LatencyStats diffLatency,
        double idleCpuPercent,
        double captureCpuPercent)
    {
        _output.WriteLine($"PERF desktop_connect_p95_ms={desktopConnect.P95Milliseconds:0.00}");
        _output.WriteLine($"PERF ipad_connect_p95_ms={ipadConnect.P95Milliseconds:0.00}");
        _output.WriteLine($"PERF input_latency_p95_ms={inputLatency.P95Milliseconds:0.00}");
        _output.WriteLine($"PERF diff_5000lines_p95_ms={diffLatency.P95Milliseconds:0.00}");
        _output.WriteLine($"PERF idle_cpu_percent={idleCpuPercent:0.00}");
        _output.WriteLine($"PERF capture_cpu_percent={captureCpuPercent:0.00}");
    }

    private static string ResolveRepoRoot()
    {
        var repoRoot = Environment.GetEnvironmentVariable("CERYX_REPO_ROOT");
        if (!string.IsNullOrWhiteSpace(repoRoot))
        {
            return Path.GetFullPath(repoRoot);
        }

        var current = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (current is not null)
        {
            var packageJson = Path.Combine(current.FullName, "package.json");
            var workspaceFile = Path.Combine(current.FullName, "pnpm-workspace.yaml");
            if (File.Exists(packageJson) && File.Exists(workspaceFile))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        throw new InvalidOperationException("Unable to resolve repository root for performance report generation.");
    }

    private static string BuildDiffPayload(int lines)
    {
        var sb = new StringBuilder(lines * 20);
        for (var index = 1; index <= lines; index++)
        {
            sb.Append("+line-");
            sb.Append(index);
            sb.Append('\n');
        }

        return sb.ToString();
    }

    private static (string Metric, string Target, string Measured, string Result) BuildRow(
        string metric,
        string target,
        string measured,
        bool passed)
    {
        return (metric, target, measured, passed ? "PASS" : "FAIL");
    }

    private sealed record LatencyStats(double MeanMilliseconds, double P95Milliseconds, double MaxMilliseconds)
    {
        public static LatencyStats FromSamples(IReadOnlyList<double> samples)
        {
            if (samples.Count == 0)
            {
                return new LatencyStats(0, 0, 0);
            }

            var ordered = samples.OrderBy(static value => value).ToArray();
            var mean = samples.Average();
            var max = ordered[^1];
            var p95 = Percentile(ordered, 0.95);
            return new LatencyStats(mean, p95, max);
        }

        private static double Percentile(IReadOnlyList<double> orderedValues, double percentile)
        {
            if (orderedValues.Count == 0)
            {
                return 0;
            }

            var rank = (int)Math.Ceiling(percentile * orderedValues.Count) - 1;
            rank = Math.Max(0, Math.Min(rank, orderedValues.Count - 1));
            return orderedValues[rank];
        }
    }

    private sealed class FakeGitCommandService : IGitCommandService
    {
        private readonly Dictionary<string, string> _responses = new(StringComparer.Ordinal);

        public void SetResponse(IReadOnlyList<string> args, string output)
        {
            _responses[ToKey(args)] = output;
        }

        public Task<Ceryx.Agent.Core.Result<string>> RunAsync(
            string workingDirectory,
            IReadOnlyList<string> arguments,
            CancellationToken cancellationToken = default)
        {
            if (_responses.TryGetValue(ToKey(arguments), out var output))
            {
                return Task.FromResult(Ceryx.Agent.Core.Result<string>.Success(output));
            }

            return Task.FromResult(Ceryx.Agent.Core.Result<string>.Failure(new Ceryx.Agent.Core.AgentError(
                Code: "E_PROJECT_GIT_FAILED",
                Message: $"Unexpected git command: {string.Join(' ', arguments)}",
                TraceId: Guid.NewGuid().ToString("N"))));
        }

        private static string ToKey(IReadOnlyList<string> args)
        {
            return string.Join("||", args);
        }
    }
}
