using System.Threading.Channels;
using NAudio.Wave;

namespace TypeSub.WinUI;

public sealed class MicrophoneCapture : IDisposable
{
    private const int SampleRate = 16000;
    private const int SamplesPerChunk = SampleRate / 10;
    private readonly BridgeClient _bridge;
    private readonly byte[] _pending = new byte[SamplesPerChunk * sizeof(short)];
    private WaveInEvent? _input;
    private Channel<float[]>? _chunks;
    private CancellationTokenSource? _stop;
    private Task? _sender;
    private string? _session;
    private int _pendingCount;

    public event Action<double>? LevelChanged;
    public event Action<string>? Failed;

    public MicrophoneCapture(BridgeClient bridge) => _bridge = bridge;

    public static IReadOnlyList<(int Number, string Name)> Devices()
    {
        var devices = new List<(int, string)>();
        for (var index = 0; index < WaveIn.DeviceCount; index++)
            devices.Add((index, WaveIn.GetCapabilities(index).ProductName));
        return devices;
    }

    public void Start(int deviceNumber, string session)
    {
        Stop();
        _session = session;
        _pendingCount = 0;
        _stop = new CancellationTokenSource();
        _chunks = Channel.CreateBounded<float[]>(new BoundedChannelOptions(8)
        {
            SingleReader = true,
            SingleWriter = true,
            FullMode = BoundedChannelFullMode.Wait
        });
        _input = new WaveInEvent
        {
            DeviceNumber = deviceNumber,
            WaveFormat = new WaveFormat(SampleRate, 16, 1),
            BufferMilliseconds = 100,
            NumberOfBuffers = 3
        };
        _input.DataAvailable += OnDataAvailable;
        _input.RecordingStopped += OnRecordingStopped;
        _sender = SendAsync(_chunks.Reader, session, _stop.Token);
        try { _input.StartRecording(); }
        catch { Stop(); throw; }
    }

    private void OnDataAvailable(object? sender, WaveInEventArgs args)
    {
        if (_chunks is null) return;
        var offset = 0;
        while (offset < args.BytesRecorded)
        {
            var length = Math.Min(_pending.Length - _pendingCount, args.BytesRecorded - offset);
            Buffer.BlockCopy(args.Buffer, offset, _pending, _pendingCount, length);
            offset += length;
            _pendingCount += length;
            if (_pendingCount != _pending.Length) continue;

            var samples = new float[SamplesPerChunk];
            double sum = 0;
            for (var i = 0; i < samples.Length; i++)
            {
                var sample = BitConverter.ToInt16(_pending, i * sizeof(short)) / 32768f;
                samples[i] = sample;
                sum += sample * sample;
            }
            _pendingCount = 0;
            LevelChanged?.Invoke(Math.Min(100, Math.Sqrt(sum / samples.Length) * 300));
            if (!_chunks.Writer.TryWrite(samples))
            {
                Failed?.Invoke("Audio capture cannot keep up with recognition.");
                return;
            }
        }
    }

    private async Task SendAsync(ChannelReader<float[]> chunks, string session, CancellationToken stop)
    {
        try
        {
            await foreach (var samples in chunks.ReadAllAsync(stop))
            {
                var bytes = new byte[samples.Length * sizeof(float)];
                Buffer.BlockCopy(samples, 0, bytes, 0, bytes.Length);
                await _bridge.CallAsync("audio", session, Convert.ToBase64String(bytes));
            }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
        catch (Exception error) { Failed?.Invoke(error.Message); }
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs args)
    {
        if (args.Exception is not null && _session is not null)
            Failed?.Invoke(args.Exception.Message);
    }

    public void Stop()
    {
        _session = null;
        var input = _input;
        _input = null;
        if (input is not null)
        {
            input.DataAvailable -= OnDataAvailable;
            input.RecordingStopped -= OnRecordingStopped;
            try { input.StopRecording(); } catch { }
            input.Dispose();
        }
        _stop?.Cancel();
        _chunks?.Writer.TryComplete();
        _stop = null;
        _chunks = null;
        _sender = null;
        _pendingCount = 0;
        LevelChanged?.Invoke(0);
    }

    public void Dispose() => Stop();
}
