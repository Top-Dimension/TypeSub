using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;

namespace TypeSub.WinUI;

public partial class App : Application
{
    private MainWindow? _window;
    private Process? _service;
    private DispatcherQueue? _dispatcher;
    private Mutex? _installMutex;

    public App() => InitializeComponent();

    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        try
        {
            var wait = Environment.GetCommandLineArgs().FirstOrDefault(arg => arg.StartsWith("--wait-for-pid=", StringComparison.Ordinal));
            if (wait is not null && int.TryParse(wait[15..], out var pid))
            {
                try
                {
                    using var previous = Process.GetProcessById(pid);
                    await previous.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10));
                }
                catch (ArgumentException) { }
            }
            var appRoot = FindAppRoot();
            var bundledRuntime = appRoot == Path.Combine(AppContext.BaseDirectory, "runtime");
            if (bundledRuntime) _installMutex = new Mutex(false, "TypeSub.WinUI.Setup");
            Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TypeSub", "WebView2"));
            var node = Path.Combine(appRoot, "node.exe");
            if (!bundledRuntime && !File.Exists(node)) node = "node.exe";
            var serviceScript = Path.Combine(appRoot, "electron", "windows-service.cjs");
            if (!File.Exists(serviceScript)) throw new FileNotFoundException("TypeSub's Windows service is missing.", serviceScript);

            var start = new ProcessStartInfo(node, $"\"{serviceScript}\"")
            {
                WorkingDirectory = appRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            start.Environment["TYPESUB_ROOT"] = appRoot;
            if (bundledRuntime) start.Environment["TYPESUB_BUNDLED_MODELS"] = Path.Combine(appRoot, "models");
            var engine = Path.Combine(AppContext.BaseDirectory, "typesub-engine.exe");
            if (!File.Exists(engine)) engine = Path.Combine(appRoot, "rust", "target", "release", "typesub-engine.exe");
            start.Environment["TYPESUB_ENGINE"] = engine;
            var elevate = Path.Combine(AppContext.BaseDirectory, "typesub-elevate.exe");
            if (!File.Exists(elevate)) elevate = Path.Combine(appRoot, "rust", "target", "release", "typesub-elevate.exe");
            start.Environment["TYPESUB_ELEVATE"] = elevate;
            start.Environment["TYPESUB_UI"] = Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "TypeSub.WinUI.exe");

            _service = Process.Start(start) ?? throw new InvalidOperationException("Could not start the TypeSub Windows service.");
            var stderr = _service.StandardError.ReadToEndAsync();
            var ready = _service.StandardOutput.ReadLineAsync();
            if (await Task.WhenAny(ready, Task.Delay(TimeSpan.FromSeconds(20))) != ready)
                throw new TimeoutException("The TypeSub Windows service did not become ready within 20 seconds.");
            var line = await ready ?? throw new InvalidOperationException(await stderr);
            using var payload = JsonDocument.Parse(line);
            var endpoint = payload.RootElement.GetProperty("url").GetString();
            var token = payload.RootElement.GetProperty("token").GetString();
            if (string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(token))
                throw new InvalidOperationException("The TypeSub Windows service returned an invalid endpoint.");

            _window = new MainWindow(new BridgeClient(endpoint, token));
            _dispatcher = _window.DispatcherQueue;
            _service.Exited += (_, _) => _dispatcher?.TryEnqueue(() =>
            {
                _window?.DisposeTray();
                _installMutex?.Dispose();
                Exit();
            });
            _service.EnableRaisingEvents = true;
            _window.Activate();
        }
        catch (Exception error)
        {
            var xamlDetails = error.GetType().GetProperties()
                .Where(property => property.Name.Contains("Line", StringComparison.OrdinalIgnoreCase) || property.Name.Contains("Position", StringComparison.OrdinalIgnoreCase))
                .Select(property => $"{property.Name}: {property.GetValue(error)}");
            ShowError($"TypeSub could not start.\n\n{error}\nHRESULT: 0x{error.HResult:X8}\n{string.Join("\n", xamlDetails)}");
            try { if (_service is { HasExited: false }) _service.Kill(true); } catch { }
            Exit();
        }
    }

    private static string FindAppRoot()
    {
        var bundledRuntime = Path.Combine(AppContext.BaseDirectory, "runtime");
        if (IsAppRoot(bundledRuntime)) return bundledRuntime;
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (IsAppRoot(directory.FullName)) return directory.FullName;
        }
        throw new DirectoryNotFoundException("TypeSub's application files could not be located.");
    }

    private static bool IsAppRoot(string directory) =>
        File.Exists(Path.Combine(directory, "electron", "windows-service.cjs")) &&
        File.Exists(Path.Combine(directory, "package.json"));

    private static void ShowError(string message)
    {
        MessageBoxW(IntPtr.Zero, message, "TypeSub", 0x10);
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr window, string text, string caption, uint type);
}
