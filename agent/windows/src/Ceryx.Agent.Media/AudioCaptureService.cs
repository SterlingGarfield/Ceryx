using System.Runtime.InteropServices;
using Ceryx.Agent.Core;

namespace Ceryx.Agent.Media;

public sealed class WasapiLoopbackAudioCaptureService : IAudioCaptureService
{
    private const int ClsctxAll = 23;
    private const int AudclntStreamflagsLoopback = 0x00020000;
    private const ushort WaveFormatPcm = 1;
    private const ushort WaveFormatIeeeFloat = 3;
    private const ushort WaveFormatExtensible = 0xFFFE;
    private static readonly Guid IAudioClientGuid = new("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2");
    private static readonly Guid IAudioCaptureClientGuid = new("C8ADBD64-E71E-48A0-A4DE-185C395CD317");
    private static readonly Guid MMDeviceEnumeratorGuid = new("A95664D2-9614-4F35-A746-DE8DB63617E6");
    private static readonly Guid IMMDeviceGuid = new("D666063F-1587-4E43-81F1-B948E807363F");

    private readonly object _sync = new();
    private ActiveAudioCapture? _active;

    public bool IsActive
    {
        get
        {
            lock (_sync)
            {
                return _active is not null;
            }
        }
    }

    public Task<Result<RecordingAudioSession>> StartAsync(
        string outputPath,
        CancellationToken cancellationToken = default)
    {
        if (!OperatingSystem.IsWindows())
        {
            return Task.FromResult(Result<RecordingAudioSession>.Failure(new AgentError(
                Code: "E_AUDIO_CAPTURE_UNAVAILABLE",
                Message: "WASAPI loopback capture is only available on Windows.",
                TraceId: "trace_audio_platform")));
        }

        lock (_sync)
        {
            if (_active is not null)
            {
                return Task.FromResult(Result<RecordingAudioSession>.Failure(new AgentError(
                    Code: "E_RECORDING_BUSY",
                    Message: "Audio capture is already active.",
                    TraceId: "trace_audio_busy")));
            }
        }

        var directory = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        try
        {
            var audio = InitializeAudioClient(outputPath);
            var session = new RecordingAudioSession(
                OutputPath: outputPath,
                AudioFormat: audio.FormatName,
                StartedAt: DateTimeOffset.UtcNow);

            lock (_sync)
            {
                _active = audio;
            }

            return Task.FromResult(Result<RecordingAudioSession>.Success(session));
        }
        catch (Exception ex)
        {
            return Task.FromResult(Result<RecordingAudioSession>.Failure(new AgentError(
                Code: "E_AUDIO_CAPTURE_FAILED",
                Message: $"Failed to start loopback audio capture. {ex.Message}",
                TraceId: "trace_audio_start")));
        }
    }

    public async Task<Result<RecordingAudioStopResult>> StopAsync(
        CancellationToken cancellationToken = default)
    {
        ActiveAudioCapture? active;
        lock (_sync)
        {
            active = _active;
            _active = null;
        }

        if (active is null)
        {
            return Result<RecordingAudioStopResult>.Failure(new AgentError(
                Code: "E_RECORDING_BUSY",
                Message: "No active audio capture.",
                TraceId: "trace_audio_none"));
        }

        active.CancellationTokenSource.Cancel();

        try
        {
            await active.CaptureTask.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            active.LoopException ??= ex;
        }

        try
        {
            active.AudioClient.Stop();
        }
        catch
        {
        }

        active.Writer.Dispose();
        ReleaseComObject(active.CaptureClient);
        ReleaseComObject(active.AudioClient);
        ReleaseComObject(active.Device);
        ReleaseComObject(active.DeviceEnumerator);

        if (active.LoopException is not null)
        {
            return Result<RecordingAudioStopResult>.Failure(new AgentError(
                Code: "E_AUDIO_CAPTURE_FAILED",
                Message: $"Audio capture loop failed. {active.LoopException.Message}",
                TraceId: "trace_audio_loop"));
        }

        if (!File.Exists(active.OutputPath))
        {
            return Result<RecordingAudioStopResult>.Failure(new AgentError(
                Code: "E_AUDIO_CAPTURE_FAILED",
                Message: "Audio capture output was not created.",
                TraceId: "trace_audio_output"));
        }

        var sizeBytes = new FileInfo(active.OutputPath).Length;
        return Result<RecordingAudioStopResult>.Success(new RecordingAudioStopResult(
            OutputPath: active.OutputPath,
            SizeBytes: sizeBytes,
            StartedAt: active.StartedAt,
            StoppedAt: DateTimeOffset.UtcNow,
            AudioFormat: active.FormatName));
    }

    private ActiveAudioCapture InitializeAudioClient(string outputPath)
    {
        var deviceEnumerator = (IMMDeviceEnumerator)(object)new MMDeviceEnumeratorComObject();
        var hr = deviceEnumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eConsole, out var device);
        ThrowIfFailed(hr, "Unable to resolve default render device.");

        object? audioClientObject = null;
        var audioClientGuid = IAudioClientGuid;
        hr = device.Activate(ref audioClientGuid, ClsctxAll, IntPtr.Zero, out audioClientObject);
        ThrowIfFailed(hr, "Unable to activate audio client.");
        var audioClient = (IAudioClient)audioClientObject!;

        var mixFormatPtr = IntPtr.Zero;
        hr = audioClient.GetMixFormat(out mixFormatPtr);
        ThrowIfFailed(hr, "Unable to retrieve audio mix format.");

        try
        {
            var waveFormat = Marshal.PtrToStructure<WaveFormatEx>(mixFormatPtr);
            var formatTag = ResolveFormatTag(waveFormat);
            var bitsPerSample = ResolveBitsPerSample(waveFormat);
            var blockAlign = ResolveBlockAlign(waveFormat);
            var channels = Math.Max(1, (int)waveFormat.nChannels);
            var sampleRate = Math.Max(1, (int)waveFormat.nSamplesPerSec);
            var isFloat = formatTag == WaveFormatIeeeFloat;
            if (bitsPerSample is not 16 and not 32)
            {
                throw new NotSupportedException($"Unsupported WASAPI sample depth: {bitsPerSample}.");
            }

            var audioSessionGuid = Guid.Empty;
            hr = audioClient.Initialize(
                AUDCLNT_SHAREMODE.AUDCLNT_SHAREMODE_SHARED,
                AudclntStreamflagsLoopback,
                0,
                0,
                mixFormatPtr,
                ref audioSessionGuid);
            ThrowIfFailed(hr, "Unable to initialize audio client.");

            hr = audioClient.Start();
            ThrowIfFailed(hr, "Unable to start audio client.");

            object? captureClientObject = null;
            var captureClientGuid = IAudioCaptureClientGuid;
            hr = audioClient.GetService(ref captureClientGuid, out captureClientObject);
            ThrowIfFailed(hr, "Unable to obtain capture client.");
            var captureClient = (IAudioCaptureClient)captureClientObject!;

            var writer = new RiffWaveWriter(
                outputPath,
                sampleRate,
                channels,
                bitsPerSample,
                formatTag);

            var cts = new CancellationTokenSource();
            var active = new ActiveAudioCapture(
                DeviceEnumerator: deviceEnumerator,
                Device: device,
                AudioClient: audioClient,
                CaptureClient: captureClient,
                Writer: writer,
                OutputPath: outputPath,
                FormatName: isFloat ? "pcm_f32le" : "pcm_s16le",
                StartedAt: DateTimeOffset.UtcNow,
                CancellationTokenSource: cts,
                FrameBlockAlign: blockAlign);
            active.CaptureTask = Task.Run(() => CaptureLoopAsync(active), CancellationToken.None);
            return active;
        }
        catch
        {
            ReleaseComObject(audioClientObject);
            ReleaseComObject(device);
            ReleaseComObject(deviceEnumerator);
            throw;
        }
        finally
        {
            Marshal.FreeCoTaskMem(mixFormatPtr);
        }
    }

    private async Task CaptureLoopAsync(ActiveAudioCapture active)
    {
        var pollDelay = TimeSpan.FromMilliseconds(10);
        while (!active.CancellationTokenSource.IsCancellationRequested)
        {
            try
            {
                var hr = active.CaptureClient.GetNextPacketSize(out var packetLength);
                ThrowIfFailed(hr, "Unable to query audio packet size.");

                if (packetLength == 0)
                {
                    await Task.Delay(pollDelay, active.CancellationTokenSource.Token).ConfigureAwait(false);
                    continue;
                }

                while (packetLength > 0 && !active.CancellationTokenSource.IsCancellationRequested)
                {
                    hr = active.CaptureClient.GetBuffer(
                        out var data,
                        out var numFramesToRead,
                        out var flags,
                        out _,
                        out _);
                    ThrowIfFailed(hr, "Unable to read audio buffer.");

                    try
                    {
                        var bytesToWrite = checked((int)(numFramesToRead * (uint)active.FrameBlockAlign));
                        if (bytesToWrite > 0)
                        {
                            if ((flags & AudioClientBufferFlags.AUDCLNT_BUFFERFLAGS_SILENT) != 0)
                            {
                                active.Writer.WriteSilence(bytesToWrite);
                            }
                            else
                            {
                                var buffer = new byte[bytesToWrite];
                                Marshal.Copy(data, buffer, 0, bytesToWrite);
                                active.Writer.Write(buffer, 0, bytesToWrite);
                            }
                        }
                    }
                    finally
                    {
                        hr = active.CaptureClient.ReleaseBuffer(numFramesToRead);
                        ThrowIfFailed(hr, "Unable to release audio buffer.");
                    }

                    hr = active.CaptureClient.GetNextPacketSize(out packetLength);
                    ThrowIfFailed(hr, "Unable to query next audio packet.");
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                active.LoopException ??= ex;
                break;
            }
        }
    }

    private static int ResolveBitsPerSample(WaveFormatEx waveFormat)
    {
        if (waveFormat.wBitsPerSample is 16 or 32)
        {
            return waveFormat.wBitsPerSample;
        }

        if (waveFormat.wFormatTag == WaveFormatExtensible && waveFormat.cbSize >= 22)
        {
            return waveFormat.wBitsPerSample;
        }

        throw new NotSupportedException($"Unsupported mix format bits per sample: {waveFormat.wBitsPerSample}.");
    }

    private static ushort ResolveFormatTag(WaveFormatEx waveFormat)
    {
        return waveFormat.wBitsPerSample == 32 ? WaveFormatIeeeFloat : WaveFormatPcm;
    }

    private static int ResolveBlockAlign(WaveFormatEx waveFormat)
    {
        if (waveFormat.nBlockAlign > 0)
        {
            return waveFormat.nBlockAlign;
        }

        return waveFormat.nChannels * (waveFormat.wBitsPerSample / 8);
    }

    private static void ThrowIfFailed(int hr, string message)
    {
        if (hr < 0)
        {
            Marshal.ThrowExceptionForHR(hr, new IntPtr(-1));
        }
    }

    private static void ReleaseComObject(object? value)
    {
        if (value is null)
        {
            return;
        }

        try
        {
            Marshal.ReleaseComObject(value);
        }
        catch
        {
        }
    }

    [ComImport]
    [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private sealed class MMDeviceEnumeratorComObject
    {
    }

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(EDataFlow dataFlow, int dwStateMask, out object ppDevices);
        int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppEndpoint);
        int GetDevice(string pwstrId, out IMMDevice ppDevice);
        int RegisterEndpointNotificationCallback(object pClient);
        int UnregisterEndpointNotificationCallback(object pClient);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        int OpenPropertyStore(int stgmAccess, out object ppProperties);
        int GetId(out string ppstrId);
        int GetState(out int pdwState);
    }

    [ComImport]
    [Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioClient
    {
        int Initialize(
            AUDCLNT_SHAREMODE shareMode,
            int streamFlags,
            long hnsBufferDuration,
            long hnsPeriodicity,
            IntPtr pFormat,
            ref Guid audioSessionGuid);

        int GetBufferSize(out uint pNumBufferFrames);
        int GetStreamLatency(out long phnsLatency);
        int GetCurrentPadding(out uint pNumPaddingFrames);
        int IsFormatSupported(AUDCLNT_SHAREMODE shareMode, IntPtr pFormat, out IntPtr ppClosestMatch);
        int GetMixFormat(out IntPtr ppDeviceFormat);
        int GetDevicePeriod(out long phnsDefaultDevicePeriod, out long phnsMinimumDevicePeriod);
        int Start();
        int Stop();
        int Reset();
        int SetEventHandle(IntPtr eventHandle);
        int GetService(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);
    }

    [ComImport]
    [Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioCaptureClient
    {
        int GetBuffer(
            out IntPtr ppData,
            out uint pNumFramesToRead,
            out AudioClientBufferFlags pdwFlags,
            out ulong pu64DevicePosition,
            out ulong pu64QPCPosition);

        int ReleaseBuffer(uint numFramesWritten);
        int GetNextPacketSize(out uint pNumFramesInNextPacket);
    }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    private struct WaveFormatEx
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [Flags]
    private enum AudioClientBufferFlags
    {
        AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY = 0x1,
        AUDCLNT_BUFFERFLAGS_SILENT = 0x2,
        AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR = 0x4
    }

    private enum EDataFlow
    {
        eRender = 0,
        eCapture = 1,
        eAll = 2
    }

    private enum ERole
    {
        eConsole = 0,
        eMultimedia = 1,
        eCommunications = 2
    }

    private enum AUDCLNT_SHAREMODE
    {
        AUDCLNT_SHAREMODE_SHARED = 0,
        AUDCLNT_SHAREMODE_EXCLUSIVE = 1
    }

    private sealed class ActiveAudioCapture
    {
        public ActiveAudioCapture(
            IMMDeviceEnumerator DeviceEnumerator,
            IMMDevice Device,
            IAudioClient AudioClient,
            IAudioCaptureClient CaptureClient,
            RiffWaveWriter Writer,
            string OutputPath,
            string FormatName,
            DateTimeOffset StartedAt,
            CancellationTokenSource CancellationTokenSource,
            int FrameBlockAlign)
        {
            this.DeviceEnumerator = DeviceEnumerator;
            this.Device = Device;
            this.AudioClient = AudioClient;
            this.CaptureClient = CaptureClient;
            this.Writer = Writer;
            this.OutputPath = OutputPath;
            this.FormatName = FormatName;
            this.StartedAt = StartedAt;
            this.CancellationTokenSource = CancellationTokenSource;
            this.FrameBlockAlign = FrameBlockAlign;
        }

        public IMMDeviceEnumerator DeviceEnumerator { get; }

        public IMMDevice Device { get; }

        public IAudioClient AudioClient { get; }

        public IAudioCaptureClient CaptureClient { get; }

        public RiffWaveWriter Writer { get; }

        public string OutputPath { get; }

        public string FormatName { get; }

        public DateTimeOffset StartedAt { get; }

        public CancellationTokenSource CancellationTokenSource { get; }

        public int FrameBlockAlign { get; }

        public Task CaptureTask { get; set; } = Task.CompletedTask;

        public Exception? LoopException { get; set; }
    }

    private sealed class RiffWaveWriter : IDisposable
    {
        private readonly FileStream _stream;
        private long _riffSizePosition;
        private long _dataSizePosition;
        private readonly ushort _channels;
        private readonly ushort _bitsPerSample;
        private readonly ushort _formatTag;
        private long _dataBytesWritten;
        private bool _disposed;

        public RiffWaveWriter(
            string outputPath,
            int sampleRate,
            int channels,
            int bitsPerSample,
            ushort formatTag)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath) ?? ".");
            _stream = new FileStream(outputPath, FileMode.Create, FileAccess.Write, FileShare.Read);
            _channels = checked((ushort)channels);
            _bitsPerSample = checked((ushort)bitsPerSample);
            _formatTag = formatTag;
            WriteHeader(sampleRate);
        }

        public void Write(byte[] buffer, int offset, int count)
        {
            ThrowIfDisposed();
            _stream.Write(buffer, offset, count);
            _dataBytesWritten += count;
        }

        public void WriteSilence(int bytes)
        {
            ThrowIfDisposed();
            if (bytes <= 0)
            {
                return;
            }

            Span<byte> silence = stackalloc byte[Math.Min(bytes, 4096)];
            var remaining = bytes;
            while (remaining > 0)
            {
                var chunk = Math.Min(remaining, silence.Length);
                _stream.Write(silence.Slice(0, chunk));
                _dataBytesWritten += chunk;
                remaining -= chunk;
            }
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            PatchHeader();
            _stream.Dispose();
        }

        private void WriteHeader(int sampleRate)
        {
            var blockAlign = (ushort)(_channels * (_bitsPerSample / 8));
            var byteRate = sampleRate * blockAlign;

            using var writer = new BinaryWriter(_stream, System.Text.Encoding.UTF8, leaveOpen: true);
            writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));
            _riffSizePosition = _stream.Position;
            writer.Write(0);
            writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVE"));
            writer.Write(System.Text.Encoding.ASCII.GetBytes("fmt "));
            writer.Write(16);
            writer.Write(_formatTag);
            writer.Write(_channels);
            writer.Write(sampleRate);
            writer.Write(byteRate);
            writer.Write(blockAlign);
            writer.Write(_bitsPerSample);
            writer.Write(System.Text.Encoding.ASCII.GetBytes("data"));
            _dataSizePosition = _stream.Position;
            writer.Write(0);
        }

        private void PatchHeader()
        {
            var riffSize = checked((int)(_stream.Length - 8));
            var dataSize = checked((int)_dataBytesWritten);

            _stream.Position = _riffSizePosition;
            using (var writer = new BinaryWriter(_stream, System.Text.Encoding.UTF8, leaveOpen: true))
            {
                writer.Write(riffSize);
                _stream.Position = _dataSizePosition;
                writer.Write(dataSize);
            }
        }

        private void ThrowIfDisposed()
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(nameof(RiffWaveWriter));
            }
        }
    }
}
