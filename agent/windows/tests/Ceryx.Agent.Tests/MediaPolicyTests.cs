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
            var service = new RecordingService(new LocalPaths(root), new FixedDiskSpaceProvider(1024));
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
            var service = new RecordingService(new LocalPaths(root), new FixedDiskSpaceProvider(oneGb));
            var window = new CodexWindowSnapshot("found", "w1", "Codex", "codex", 1, DateTimeOffset.UtcNow);

            var result = await service.StartAsync(window);

            Assert.True(result.IsSuccess);
            Assert.NotNull(result.Value);
            Assert.Equal("recording", result.Value!.Status);
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
            var service = new RecordingService(new LocalPaths(root), new FixedDiskSpaceProvider(long.MaxValue));
            var window = new CodexWindowSnapshot("focused", "w1", "Codex", "codex", 1, DateTimeOffset.UtcNow);

            var first = await service.StartAsync(window);
            var second = await service.StartAsync(window);

            Assert.True(first.IsSuccess);
            Assert.False(second.IsSuccess);
            Assert.Equal("E_RECORDING_BUSY", second.Error?.Code);
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
        return Path.Combine(Directory.GetCurrentDirectory(), ".workspace-data", "test-temp", $"{prefix}-{Guid.NewGuid():N}");
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
}
