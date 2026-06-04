using Ceryx.Agent.Core;
using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Media;
using Ceryx.Agent.Storage;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class MediaPolicyTests
{
    [Fact]
    public async Task UploadImage_RejectsFileLargerThan20Mb()
    {
        var root = CreateTestRoot("upload-policy");
        Directory.CreateDirectory(root);

        try
        {
            var service = new UploadImageService(new LocalPaths(root));
            await using var stream = new MemoryStream(new byte[(20 * 1024 * 1024) + 1]);

            var result = await service.UploadImageAsync("large.png", stream);

            Assert.False(result.IsSuccess);
            Assert.Equal("E_UPLOAD_TOO_LARGE", result.Error?.Code);
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    [Fact]
    public async Task RecordingStart_RejectsWhenDiskIsLow()
    {
        var root = CreateTestRoot("recording-disk");
        Directory.CreateDirectory(root);

        try
        {
            var service = CreateRecordingService(root, 1024);
            var window = new CodexWindowSnapshot("found", "w1", "Codex", "codex", 1, DateTimeOffset.UtcNow);

            var result = await service.StartAsync(window);

            Assert.False(result.IsSuccess);
            Assert.Equal("E_DISK_LOW", result.Error?.Code);
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    [Fact]
    public async Task PerformancePolicy_RecordingStart_AllowsWhenDiskAtOneGbThreshold()
    {
        const long oneGb = 1024L * 1024 * 1024;
        var root = CreateTestRoot("recording-threshold");
        Directory.CreateDirectory(root);

        try
        {
            var encoder = new FakeRecordingMediaEncoder();
            var service = CreateRecordingService(root, oneGb, encoder: encoder);
            var window = new CodexWindowSnapshot("found", "w1", "Codex", "codex", 1, DateTimeOffset.UtcNow);

            var result = await service.StartAsync(window);

            Assert.True(result.IsSuccess);
            Assert.NotNull(result.Value);
            Assert.Equal("recording", result.Value!.Status);

            var stop = await service.StopAsync();
            Assert.True(stop.IsSuccess);
            Assert.NotNull(stop.Value);
            Assert.EndsWith(".mp4", stop.Value!.FileName, StringComparison.OrdinalIgnoreCase);
            Assert.Single(encoder.Requests);
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    [Fact]
    public async Task RecordingStart_RejectsDuplicateRequests()
    {
        var root = CreateTestRoot("recording-duplicate");
        Directory.CreateDirectory(root);

        try
        {
            var service = CreateRecordingService(root, long.MaxValue);
            var window = new CodexWindowSnapshot("focused", "w1", "Codex", "codex", 1, DateTimeOffset.UtcNow);

            var first = await service.StartAsync(window);
            var second = await service.StartAsync(window);

            Assert.True(first.IsSuccess);
            Assert.False(second.IsSuccess);
            Assert.Equal("E_RECORDING_BUSY", second.Error?.Code);

            var stop = await service.StopAsync();
            Assert.True(stop.IsSuccess);
            Assert.NotNull(stop.Value);
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    [Fact]
    public async Task RecordingStart_WithAudio_StartsAndStopsAudioCapture()
    {
        var root = CreateTestRoot("recording-audio");
        Directory.CreateDirectory(root);

        try
        {
            var audioCaptureService = new FakeAudioCaptureService();
            var encoder = new FakeRecordingMediaEncoder();
            var service = CreateRecordingService(
                root,
                long.MaxValue,
                audioCaptureService: audioCaptureService,
                encoder: encoder);
            var window = new CodexWindowSnapshot("focused", "w1", "Codex", "codex", 1, DateTimeOffset.UtcNow);

            var start = await service.StartAsync(
                window,
                new RecordingStartBody
                {
                    ConfirmHighRisk = true,
                    IncludeAudio = true,
                    AudioSource = "system",
                    MaxDurationMinutes = 10,
                    SegmentSizeMB = 256
                });

            Assert.True(start.IsSuccess);
            Assert.True(service.IsAudioActive);
            Assert.True(audioCaptureService.IsActive);

            var stop = await service.StopAsync();

            Assert.True(stop.IsSuccess);
            Assert.NotNull(stop.Value);
            Assert.True(stop.Value!.AudioEnabled);
            Assert.Equal("pcm_s16le", stop.Value.AudioFormat);
            Assert.False(service.IsAudioActive);
            Assert.False(audioCaptureService.IsActive);
            Assert.Single(encoder.Requests);
            Assert.NotNull(encoder.Requests[0].AudioPath);
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    private static string CreateTestRoot(string prefix)
    {
        return Path.Combine(Path.GetTempPath(), "ceryx-tests", "media", $"{prefix}-{Guid.NewGuid():N}");
    }

    private static RecordingService CreateRecordingService(
        string root,
        long availableBytes,
        IAudioCaptureService? audioCaptureService = null,
        IRecordingMediaEncoder? encoder = null)
    {
        return new RecordingService(
            new LocalPaths(root),
            new FixedDiskSpaceProvider(availableBytes),
            new FakeWindowImageCapture(),
            audioCaptureService ?? new FakeAudioCaptureService(),
            encoder ?? new FakeRecordingMediaEncoder());
    }

    private sealed class FixedDiskSpaceProvider : IDiskSpaceProvider
    {
        private readonly long _bytes;

        public FixedDiskSpaceProvider(long bytes)
        {
            _bytes = bytes;
        }

        public long GetAvailableBytes(string absolutePath)
        {
            return _bytes;
        }
    }

    private sealed class FakeAudioCaptureService : IAudioCaptureService
    {
        private string? _outputPath;
        private DateTimeOffset _startedAt;

        public bool IsActive { get; private set; }

        public Task<Result<RecordingAudioSession>> StartAsync(
            string outputPath,
            CancellationToken cancellationToken = default)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath) ?? ".");
            File.WriteAllBytes(outputPath, new byte[] { 0x52, 0x49, 0x46, 0x46 });
            _outputPath = outputPath;
            _startedAt = DateTimeOffset.UtcNow;
            IsActive = true;

            return Task.FromResult(Result<RecordingAudioSession>.Success(
                new RecordingAudioSession(outputPath, "pcm_s16le", _startedAt)));
        }

        public Task<Result<RecordingAudioStopResult>> StopAsync(CancellationToken cancellationToken = default)
        {
            if (!IsActive || _outputPath is null)
            {
                return Task.FromResult(Result<RecordingAudioStopResult>.Failure(new AgentError(
                    Code: "E_AUDIO_CAPTURE_FAILED",
                    Message: "Audio capture was not active.",
                    TraceId: Guid.NewGuid().ToString("N"))));
            }

            IsActive = false;
            var info = new FileInfo(_outputPath);
            return Task.FromResult(Result<RecordingAudioStopResult>.Success(new RecordingAudioStopResult(
                OutputPath: _outputPath,
                SizeBytes: info.Exists ? info.Length : 0,
                StartedAt: _startedAt,
                StoppedAt: DateTimeOffset.UtcNow,
                AudioFormat: "pcm_s16le")));
        }
    }

    private sealed class FakeRecordingMediaEncoder : IRecordingMediaEncoder
    {
        public List<RecordingEncodeRequest> Requests { get; } = new();

        public Task<Result<RecordingEncodeResult>> EncodeAsync(
            RecordingEncodeRequest request,
            CancellationToken cancellationToken = default)
        {
            Requests.Add(request);
            Directory.CreateDirectory(request.OutputDirectory);

            var outputPath = Path.Combine(request.OutputDirectory, $"{request.OutputBaseName}.mp4");
            File.WriteAllBytes(outputPath, new byte[] { 0x00, 0x00, 0x00, 0x18 });

            return Task.FromResult(Result<RecordingEncodeResult>.Success(
                new RecordingEncodeResult(new[] { outputPath }, new FileInfo(outputPath).Length)));
        }
    }
}
