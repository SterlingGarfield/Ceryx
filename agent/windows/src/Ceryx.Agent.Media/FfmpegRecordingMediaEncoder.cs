using System.Diagnostics;
using Ceryx.Agent.Core;

namespace Ceryx.Agent.Media;

public sealed class FfmpegRecordingMediaEncoder : IRecordingMediaEncoder
{
    private const int SegmentDurationSeconds = 30 * 60;
    private const string FfmpegEnvVar = "CERYX_FFMPEG_PATH";
    private static readonly string[] CommonFfmpegNames = ["ffmpeg.exe", "ffmpeg"];
    private static string? _cachedFfmpegPath;

    public async Task<Result<RecordingEncodeResult>> EncodeAsync(
        RecordingEncodeRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var ffmpegPath = ResolveFfmpegPath();
        if (ffmpegPath is null)
        {
            return Result<RecordingEncodeResult>.Failure(new AgentError(
                Code: "E_FFMPEG_NOT_FOUND",
                Message: "Unable to locate ffmpeg.exe for recording encoding.",
                TraceId: "trace_ffmpeg_missing",
                Hint: "Set CERYX_FFMPEG_PATH to a working ffmpeg.exe or install ffmpeg."));
        }

        Directory.CreateDirectory(request.OutputDirectory);

        var hasAudio = !string.IsNullOrWhiteSpace(request.AudioPath) && File.Exists(request.AudioPath);
        var segmenting = request.Duration.TotalSeconds > SegmentDurationSeconds;
        var outputPattern = segmenting
            ? Path.Combine(request.OutputDirectory, $"{request.OutputBaseName}_%03d.mp4")
            : Path.Combine(request.OutputDirectory, $"{request.OutputBaseName}.mp4");

        var startNumber = 1;
        var framePattern = Path.Combine(request.FramesDirectory, "frame_%06d.jpg");
        var arguments = BuildArguments(
            framePattern,
            request.FrameRate,
            request.AudioPath,
            hasAudio,
            outputPattern,
            segmenting,
            startNumber);

        var startInfo = new ProcessStartInfo
        {
            FileName = ffmpegPath,
            Arguments = arguments,
            WorkingDirectory = request.OutputDirectory,
            UseShellExecute = false,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            CreateNoWindow = true
        };

        using var process = new Process { StartInfo = startInfo };
        if (!process.Start())
        {
            return Result<RecordingEncodeResult>.Failure(new AgentError(
                Code: "E_RECORDING_FAILED",
                Message: "Failed to start ffmpeg encoding process.",
                TraceId: "trace_ffmpeg_start"));
        }

        var stdErrTask = process.StandardError.ReadToEndAsync();
        var stdOutTask = process.StandardOutput.ReadToEndAsync();
        await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
        var stdErr = await stdErrTask.ConfigureAwait(false);
        _ = await stdOutTask.ConfigureAwait(false);

        if (process.ExitCode != 0)
        {
            return Result<RecordingEncodeResult>.Failure(new AgentError(
                Code: "E_RECORDING_FAILED",
                Message: $"ffmpeg encoding failed with exit code {process.ExitCode}. {TrimError(stdErr)}",
                TraceId: "trace_ffmpeg_encode"));
        }

        var outputPaths = EnumerateOutputs(request.OutputDirectory, request.OutputBaseName, segmenting).ToArray();
        if (outputPaths.Length == 0 && File.Exists(outputPattern))
        {
            outputPaths = [outputPattern];
        }

        if (outputPaths.Length == 0)
        {
            return Result<RecordingEncodeResult>.Failure(new AgentError(
                Code: "E_RECORDING_FAILED",
                Message: "ffmpeg completed successfully but no output file was created.",
                TraceId: "trace_ffmpeg_no_output"));
        }

        var sizeBytes = outputPaths
            .Where(File.Exists)
            .Select(path => new FileInfo(path).Length)
            .Sum();

        return Result<RecordingEncodeResult>.Success(new RecordingEncodeResult(outputPaths, sizeBytes));
    }

    private static string BuildArguments(
        string framePattern,
        int frameRate,
        string? audioPath,
        bool hasAudio,
        string outputPattern,
        bool segmenting,
        int startNumber)
    {
        var parts = new List<string>
        {
            "-y",
            "-hide_banner",
            "-loglevel", "error",
            "-framerate", frameRate.ToString(System.Globalization.CultureInfo.InvariantCulture),
            "-start_number", startNumber.ToString(System.Globalization.CultureInfo.InvariantCulture),
            "-i", framePattern
        };

        if (hasAudio && audioPath is not null)
        {
            parts.Add("-i");
            parts.Add(audioPath);
            parts.Add("-map");
            parts.Add("0:v:0");
            parts.Add("-map");
            parts.Add("1:a:0");
        }

        parts.Add("-vf");
        parts.Add("pad=ceil(iw/2)*2:ceil(ih/2)*2");

        parts.Add("-c:v");
        parts.Add("libx264");
        parts.Add("-preset");
        parts.Add("veryfast");
        parts.Add("-crf");
        parts.Add("20");
        parts.Add("-pix_fmt");
        parts.Add("yuv420p");

        if (hasAudio)
        {
            parts.Add("-c:a");
            parts.Add("aac");
            parts.Add("-b:a");
            parts.Add("192k");
        }
        else
        {
            parts.Add("-an");
        }

        if (segmenting)
        {
            parts.Add("-f");
            parts.Add("segment");
            parts.Add("-segment_time");
            parts.Add(SegmentDurationSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture));
            parts.Add("-reset_timestamps");
            parts.Add("1");
            parts.Add("-segment_format");
            parts.Add("mp4");
        }
        else if (hasAudio)
        {
            parts.Add("-shortest");
        }

        parts.Add(outputPattern);
        return string.Join(" ", parts.Select(EscapeArgument));
    }

    private static string EscapeArgument(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "\"\"";
        }

        return value.Contains(' ') || value.Contains('\t') || value.Contains('"')
            ? $"\"{value.Replace("\"", "\\\"")}\""
            : value;
    }

    private static IEnumerable<string> EnumerateOutputs(string outputDirectory, string outputBaseName, bool segmenting)
    {
        if (!Directory.Exists(outputDirectory))
        {
            yield break;
        }

        if (!segmenting)
        {
            var file = Path.Combine(outputDirectory, $"{outputBaseName}.mp4");
            if (File.Exists(file))
            {
                yield return file;
            }

            yield break;
        }

        foreach (var file in Directory.EnumerateFiles(outputDirectory, $"{outputBaseName}_*.mp4"))
        {
            yield return file;
        }
    }

    private static string TrimError(string error)
    {
        var trimmed = error.Trim();
        if (trimmed.Length <= 600)
        {
            return trimmed;
        }

        return trimmed[..600] + "...";
    }

    private static string? ResolveFfmpegPath()
    {
        lock (typeof(FfmpegRecordingMediaEncoder))
        {
            if (!string.IsNullOrWhiteSpace(_cachedFfmpegPath) && File.Exists(_cachedFfmpegPath))
            {
                return _cachedFfmpegPath;
            }

            var envPath = Environment.GetEnvironmentVariable(FfmpegEnvVar);
            if (!string.IsNullOrWhiteSpace(envPath) && File.Exists(envPath))
            {
                _cachedFfmpegPath = Path.GetFullPath(envPath);
                return _cachedFfmpegPath;
            }

            var pathDirs = (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
                .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            foreach (var directory in pathDirs)
            {
                foreach (var name in CommonFfmpegNames)
                {
                    var candidate = Path.Combine(directory, name);
                    if (File.Exists(candidate))
                    {
                        _cachedFfmpegPath = candidate;
                        return candidate;
                    }
                }
            }

            var roots = new[]
            {
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
            };

            foreach (var root in roots.Where(root => !string.IsNullOrWhiteSpace(root)))
            {
                var candidate = SearchForFfmpeg(root);
                if (candidate is not null)
                {
                    _cachedFfmpegPath = candidate;
                    return candidate;
                }
            }

            return null;
        }
    }

    private static string? SearchForFfmpeg(string root)
    {
        try
        {
            foreach (var file in Directory.EnumerateFiles(root, "ffmpeg.exe", SearchOption.AllDirectories))
            {
                return file;
            }

            foreach (var file in Directory.EnumerateFiles(root, "ffmpeg", SearchOption.AllDirectories))
            {
                return file;
            }
        }
        catch
        {
        }

        return null;
    }
}
