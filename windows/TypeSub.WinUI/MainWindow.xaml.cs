using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using NAudio.Wave;
using Windows.ApplicationModel.DataTransfer;
using Forms = System.Windows.Forms;

namespace TypeSub.WinUI;

public sealed partial class MainWindow : Window
{
    private readonly BridgeClient _bridge;
    private readonly MicrophoneCapture _microphone;
    private readonly SemaphoreSlim _saveLock = new(1, 1);
    private readonly TaskCompletionSource<bool> _bridgeReady = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private JsonObject _settings = DefaultSettings();
    private JsonNode? _runtime;
    private CancellationTokenSource? _saveDelay;
    private CancellationTokenSource? _captionDelay;
    private readonly SemaphoreSlim _captionLock = new(1, 1);
    private TaskCompletionSource<string>? _ready;
    private string? _session;
    private string _page = "studio";
    private string _statusEnglish = "Idle";
    private string _statusChinese = "待机";
    private string _overlayUrl = "";
    private bool _english = true;
    private bool _loading = true;
    private bool _busy;
    private bool _downloading;
    private bool _modelInstalled;
    private bool _manualActive;
    private bool _exiting;
    private readonly Forms.NotifyIcon _tray;
    private readonly Forms.ToolStripMenuItem _openStudio = new();
    private readonly Forms.ToolStripMenuItem _toggleCanvas = new();
    private readonly Forms.ToolStripMenuItem _toggleRecognition = new();
    private readonly Forms.ToolStripMenuItem _exitApp = new();

    public MainWindow(BridgeClient bridge)
    {
        InitializeComponent();
        _bridge = bridge;
        _microphone = new MicrophoneCapture(bridge);
        _microphone.LevelChanged += level => DispatcherQueue.TryEnqueue(() => MicLevelBar.Value = level);
        _microphone.Failed += message => DispatcherQueue.TryEnqueue(() => _ = StopRecognitionAsync(message));
        _bridge.EventReceived += (type, data) => DispatcherQueue.TryEnqueue(() => HandleEvent(type, data));
        AppWindow.Resize(new Windows.Graphics.SizeInt32(1120, 760));
        _tray = new Forms.NotifyIcon
        {
            Icon = System.Drawing.SystemIcons.Application,
            Text = "TypeSub",
            ContextMenuStrip = new Forms.ContextMenuStrip(),
            Visible = true
        };
        _tray.ContextMenuStrip.Items.AddRange([_openStudio, _toggleCanvas, _toggleRecognition, new Forms.ToolStripSeparator(), _exitApp]);
        _tray.DoubleClick += (_, _) => OpenStudio();
        _openStudio.Click += (_, _) => OpenStudio();
        _toggleCanvas.Click += (_, _) => DispatcherQueue.TryEnqueue(() => CanvasButton.IsChecked = CanvasButton.IsChecked != true);
        _toggleRecognition.Click += (_, _) => DispatcherQueue.TryEnqueue(() => _ = _session is null ? StartRecognitionAsync() : StopRecognitionAsync());
        _exitApp.Click += (_, _) => DispatcherQueue.TryEnqueue(() => _ = ExitAsync());
        UpdateTrayLanguage();
        AppWindow.Closing += (_, args) => { args.Cancel = true; AppWindow.Hide(); };
        WireEvents();
        Navigation.SelectedItem = StudioNav;
        _ = InitializeAsync();
    }

    private void OpenStudio() => DispatcherQueue.TryEnqueue(() =>
    {
        AppWindow.Show();
        Activate();
    });

    private void UpdateTrayLanguage()
    {
        _openStudio.Text = L("Open studio", "打开字幕工作台");
        _toggleCanvas.Text = L("Show/hide captions", "显示或隐藏字幕");
        _toggleRecognition.Text = L("Pause/resume recognition", "暂停或恢复识别");
        _exitApp.Text = L("Quit TypeSub", "退出 TypeSub");
    }

    public void DisposeTray()
    {
        _tray.ContextMenuStrip?.Dispose();
        _tray.Dispose();
    }

    private static JsonObject DefaultSettings() => new()
    {
        ["orientation"] = "horizontal", ["direction"] = "center", ["pinyin"] = true,
        ["tone"] = true, ["pinyinSize"] = 55, ["verticalAnchor"] = "top",
        ["centerMode"] = "block", ["fontFamily"] = "Microsoft YaHei UI",
        ["fontSize"] = 64, ["backgroundMode"] = "transparent",
        ["textColor"] = "#ffffff", ["outlineColor"] = "#081019",
        ["backgroundColor"] = "#18d27b", ["outlineWidth"] = 3,
        ["minInterval"] = 45, ["cursorBlink"] = true,
        ["microphoneId"] = "", ["preset"] = "gaming"
    };

    private string L(string english, string chinese) => _english ? english : chinese;
    private static string Value(JsonNode? node, string fallback = "") => node?.ToString() ?? fallback;
    private string Setting(string name, string fallback = "") => Value(_settings[name], fallback);
    private int SettingInt(string name, int fallback) => int.TryParse(Setting(name), out var value) ? value : fallback;
    private bool SettingBool(string name, bool fallback) => bool.TryParse(Setting(name), out var value) ? value : fallback;
    private static string SelectedTag(ComboBox combo) => (combo.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "";

    private static void SelectTag(ComboBox combo, string tag)
    {
        combo.SelectedItem = combo.Items.OfType<ComboBoxItem>().FirstOrDefault(item => item.Tag?.ToString() == tag);
    }

    private void WireEvents()
    {
        Navigation.SelectionChanged += (_, args) => ShowPage((args.SelectedItem as NavigationViewItem)?.Tag?.ToString() ?? "studio");
        LanguageChoice.SelectionChanged += async (_, _) =>
        {
            if (_loading) return;
            _english = SelectedTag(LanguageChoice) == "en";
            ApplyLanguage();
            await RunAsync(() => _bridge.CallAsync("language", _english ? "en" : "zh-CN"));
        };
        OpenLogsButton.Click += async (_, _) => await RunAsync(() => _bridge.CallAsync("open", "logs"));
        ClearButton.Click += async (_, _) => await ClearCaptionAsync();
        CopyUrlButton.Click += (_, _) =>
        {
            var package = new DataPackage();
            package.SetText(_overlayUrl);
            Clipboard.SetContent(package);
            SetStatus("OBS URL copied", "OBS URL 已复制");
        };
        RecognitionButton.Click += async (_, _) =>
        {
            if (_session is null) await StartRecognitionAsync();
            else await StopRecognitionAsync();
        };
        TryButton.Click += async (_, _) =>
        {
            _loading = true;
            TestCaptionBox.Text = L("Welcome to TypeSub. Captions appear one character at a time.", "欢迎来到 TypeSub，字幕正在逐个出现。");
            _loading = false;
            await ManualCaptionAsync(false);
        };
        CanvasButton.Checked += async (_, _) => await SetCanvasVisibleAsync(true);
        CanvasButton.Unchecked += async (_, _) => await SetCanvasVisibleAsync(false);
        TestCaptionBox.TextChanged += async (_, _) =>
        {
            if (_loading) return;
            _captionDelay?.Cancel();
            _captionDelay = new CancellationTokenSource();
            try
            {
                await Task.Delay(120, _captionDelay.Token);
                await ManualCaptionAsync(false);
            }
            catch (OperationCanceledException) { }
        };
        ReplayButton.Click += async (_, _) =>
        {
            _captionDelay?.Cancel();
            await ManualCaptionAsync(true);
        };
        ResetButton.Click += async (_, _) =>
        {
            _settings = DefaultSettings();
            ApplySettings();
            await SaveSettingsAsync();
            SetStatus("Default settings restored", "已恢复默认参数");
        };
        RefreshMicrophonesButton.Click += (_, _) => RefreshMicrophones();
        MicrophoneChoice.SelectionChanged += (_, _) => ChangeSetting("microphoneId", SelectedTag(MicrophoneChoice));
        DownloadModelButton.Click += async (_, _) => await DownloadModelAsync();
        ComponentsDownloadButton.Click += async (_, _) => await DownloadModelAsync();
        PinyinToggle.Toggled += (_, _) => ChangeSetting("pinyin", PinyinToggle.IsOn);
        ToneToggle.Toggled += (_, _) => ChangeSetting("tone", ToneToggle.IsOn);
        PinyinSizeSlider.ValueChanged += (_, _) => ChangeSetting("pinyinSize", (int)PinyinSizeSlider.Value);
        OrientationChoice.SelectionChanged += (_, _) => ChangeSetting("orientation", SelectedTag(OrientationChoice));
        DirectionChoice.SelectionChanged += (_, _) => ChangeSetting("direction", SelectedTag(DirectionChoice));
        VerticalAnchorChoice.SelectionChanged += (_, _) => ChangeSetting("verticalAnchor", SelectedTag(VerticalAnchorChoice));
        CenterModeChoice.SelectionChanged += (_, _) => ChangeSetting("centerMode", SelectedTag(CenterModeChoice));
        FontChoice.SelectionChanged += (_, _) => ChangeSetting("fontFamily", (FontChoice.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "Microsoft YaHei UI");
        FontSizeBox.ValueChanged += (_, _) => ChangeNumber("fontSize", FontSizeBox.Value, 24, 200);
        BackgroundChoice.SelectionChanged += (_, _) => ChangeSetting("backgroundMode", SelectedTag(BackgroundChoice));
        OutlineWidthBox.ValueChanged += (_, _) => ChangeNumber("outlineWidth", OutlineWidthBox.Value, 0, 10);
        IntervalBox.ValueChanged += (_, _) => ChangeNumber("minInterval", IntervalBox.Value, 20, 200);
        CursorToggle.Toggled += (_, _) => ChangeSetting("cursorBlink", CursorToggle.IsOn);
        TextColorPicker.ColorChanged += (_, _) => ChangeSetting("textColor", ToHex(TextColorPicker.Color));
        OutlineColorPicker.ColorChanged += (_, _) => ChangeSetting("outlineColor", ToHex(OutlineColorPicker.Color));
        BackgroundColorPicker.ColorChanged += (_, _) => ChangeSetting("backgroundColor", ToHex(BackgroundColorPicker.Color));
        SaveAiButton.Click += async (_, _) => await SaveAiAsync(false);
        ClearAiButton.Click += async (_, _) => await SaveAiAsync(true);
        GamingPreset.Click += async (_, _) => await ApplyPresetAsync("gaming");
        VoicePreset.Click += async (_, _) => await ApplyPresetAsync("voice");
        TeachingPreset.Click += async (_, _) => await ApplyPresetAsync("teaching");
        AdminButton.Click += async (_, _) => await RequestAdminAsync();
        OpenDataButton.Click += async (_, _) => await RunAsync(() => _bridge.CallAsync("open", "data"));
        OpenLogFolderButton.Click += async (_, _) => await RunAsync(() => _bridge.CallAsync("open", "logs"));
        ExportButton.Click += (_, _) => ExportDiagnostics();
    }

    private async Task InitializeAsync()
    {
        try
        {
            _runtime = await _bridge.CallAsync("runtime");
            var config = _runtime?["config"];
            _english = Value(config?["language"], "en") == "en";
            _settings = config?["settings"]?.DeepClone() as JsonObject ?? new JsonObject();
            foreach (var setting in DefaultSettings())
                if (!_settings.ContainsKey(setting.Key)) _settings[setting.Key] = setting.Value?.DeepClone();
            _overlayUrl = Value(_runtime?["overlayUrl"]);
            ObsUrlBox.Text = _overlayUrl;
            CopyUrlButton.IsEnabled = _overlayUrl.Length > 0;
            SourceStatus.Text = _overlayUrl.Length > 0 ? L("Ready", "已就绪") : L("Unavailable", "不可用");
            if (_overlayUrl.Length > 0) PreviewWebView.Source = new Uri(_overlayUrl);
            VersionText.Text = $"TypeSub v{Value(_runtime?["version"])} · WinUI 3";
            DataPathText.Text = Value(_runtime?["dataDir"]);
            LogPathText.Text = Value(_runtime?["logPath"]);
            BaseUrlBox.Text = Value(config?["ai"]?["baseUrl"]);
            ModelBox.Text = Value(config?["ai"]?["model"]);
            var hasKey = IsTrue(config?["ai"]?["hasKey"]);
            AiStatus.Text = hasKey && ModelBox.Text.Length > 0 ? L("Enabled", "已启用") : L("Not configured; using raw captions", "未设置，使用原文");
            _modelInstalled = IsTrue(_runtime?["speechModel"]?["installed"]);
            _loading = true;
            SelectTag(LanguageChoice, _english ? "en" : "zh-CN");
            RefreshMicrophones();
            ApplySettings();
            ApplyLanguage();
            UpdateModelStatus();
            _loading = false;
            _ = _bridge.ListenAsync();
            await _bridgeReady.Task.WaitAsync(TimeSpan.FromSeconds(5));
            var state = await _bridge.CallAsync("state");
            CanvasButton.IsChecked = !IsFalse(state?["visible"]);
            if (IsTrue(state?["recognition"]))
                await _bridge.CallAsync("stop");
        }
        catch (Exception error)
        {
            _loading = false;
            SetStatus(error.Message, error.Message);
            RecognitionButton.IsEnabled = false;
        }
    }

    private static bool IsTrue(JsonNode? node) => node?.ToJsonString() == "true";
    private static bool IsFalse(JsonNode? node) => node?.ToJsonString() == "false";

    private void ShowPage(string page)
    {
        _page = page;
        StudioPage.Visibility = page == "studio" ? Visibility.Visible : Visibility.Collapsed;
        ComponentsPage.Visibility = page == "components" ? Visibility.Visible : Visibility.Collapsed;
        PresetsPage.Visibility = page == "presets" ? Visibility.Visible : Visibility.Collapsed;
        DiagnosticsPage.Visibility = page == "diagnostics" ? Visibility.Visible : Visibility.Collapsed;
        PageTitle.Text = page switch
        {
            "components" => L("Components", "组件管理"),
            "presets" => L("Presets", "预设方案"),
            "diagnostics" => L("Diagnostics & logs", "诊断与日志"),
            _ => L("Caption studio", "字幕工作台")
        };
    }

    private void ApplyLanguage()
    {
        UpdateTrayLanguage();
        StudioNav.Content = L("Caption studio", "字幕工作台");
        ComponentsNav.Content = L("Components", "组件管理");
        PresetsNav.Content = L("Presets", "预设方案");
        DiagnosticsNav.Content = L("Diagnostics & logs", "诊断与日志");
        PreviewTitle.Text = L("Live preview", "实时预览");
        ClearButton.Content = L("Clear", "清屏");
        SourceLabel.Text = L("OBS Browser Source URL", "OBS 浏览器来源 URL");
        CopyUrlButton.Content = L("Copy URL", "复制 URL");
        TryButton.Content = L("Try it", "试一试");
        CanvasButton.Content = L("Caption canvas", "字幕画布");
        TestLabel.Text = L("Test caption", "测试字幕");
        TestCaptionBox.PlaceholderText = L("Type a caption to show it live in OBS", "在这里输入文字，直播软件中实时显示");
        ReplayButton.Content = L("Replay", "重播");
        MicLevelLabel.Text = L("Mic level", "麦克风电平");
        SourceStatusLabel.Text = L("Browser source", "浏览器来源");
        SourceStatus.Text = _overlayUrl.Length > 0 ? L("Ready", "已就绪") : L("Unavailable", "不可用");
        SettingsTitle.Text = L("Caption settings", "字幕参数");
        ResetButton.Content = L("Reset defaults", "恢复默认");
        InputTab.Header = L("Input", "输入");
        LayoutTab.Header = L("Layout", "排版");
        StyleTab.Header = L("Style", "样式");
        AnimationTab.Header = L("Animation", "动画");
        AiTab.Header = L("AI correction", "AI 优化");
        MicrophoneLabel.Text = L("Microphone", "麦克风");
        RefreshMicrophonesButton.Content = L("Refresh devices", "刷新设备");
        MicrophoneHint.Text = L("Pause recognition to change microphones.", "暂停识别后可以切换麦克风。");
        DownloadModelButton.Content = ComponentsDownloadButton.Content = L("Download model (134 MB)", "下载模型（134 MB）");
        PinyinLabel.Text = L("Pinyin", "拼音轨道");
        PinyinToggle.Header = L("Show pinyin", "显示拼音");
        ToneToggle.Header = L("With tones", "带声调");
        PinyinSizeLabel.Text = L("Pinyin size", "拼音字号比例");
        OrientationLabel.Text = L("Text direction", "排版方向");
        AlignmentLabel.Text = L("Alignment", "对齐方式");
        VerticalPositionLabel.Text = L("Vertical position", "纵向锚点");
        LineAlignmentLabel.Text = L("Line alignment", "折行策略");
        SetComboLabels(OrientationChoice, ("Horizontal", "横排"), ("Vertical", "竖排"));
        SetComboLabels(DirectionChoice, ("Left", "左起"), ("Center", "居中"), ("Right", "右起"));
        SetComboLabels(VerticalAnchorChoice, ("Top", "顶部"), ("Center", "居中"), ("Bottom", "底部"));
        SetComboLabels(CenterModeChoice, ("Center as a block", "整块居中"), ("Center each line", "逐行居中"));
        FontLabel.Text = L("Font", "字体");
        FontSizeBox.Header = L("Font size", "字号");
        BackgroundLabel.Text = L("Background", "背景");
        SetComboLabels(BackgroundChoice, ("Transparent", "透明"), ("Chroma green", "纯绿抠像"), ("Black", "纯黑"), ("Custom color", "自定义颜色"));
        OutlineWidthBox.Header = L("Outline width", "描边宽度");
        TextColorExpander.Header = L("Text color", "文字颜色");
        OutlineColorExpander.Header = L("Outline color", "描边颜色");
        BackgroundColorExpander.Header = L("Background color", "背景色");
        IntervalBox.Header = L("Minimum character interval (ms)", "最小字间隔（毫秒）");
        CursorToggle.Header = L("Blinking cursor", "光标闪烁");
        ApiKeyBox.Header = L("API key", "API Key");
        ApiKeyBox.PlaceholderText = L("Uses raw captions until configured", "未设置时直接使用原文");
        ModelBox.Header = L("Model name", "模型名称");
        AiHint.Text = L("Supports Chat Completions-compatible APIs. Completed utterances go only to your configured service.", "支持兼容 Chat Completions 的 API。只将已辨识文字发送到你设置的服务。");
        SaveAiButton.Content = L("Save AI settings", "保存 AI 设置");
        ClearAiButton.Content = L("Clear key", "清除 Key");
        ComponentsIntro.Text = L("The speech model runs offline on this device.", "语音模型在本机离线运行。");
        ComponentName.Text = L("TypeSub speech model", "TypeSub 语音模型");
        ComponentDetail.Text = L("Mandarin and English · Zipformer", "普通话和英语 · Zipformer");
        AdminLabel.Text = L("Administrator access", "管理员权限");
        AdminButton.Content = L("Request administrator access", "请求管理员权限");
        PresetsIntro.Text = L("Choose a layout and style for your stream.", "根据直播场景快速切换排版与样式。");
        GamingPreset.Content = L("Gaming & chat · centered, high contrast", "游戏娱乐 · 居中 · 高对比");
        VoicePreset.Content = L("Voice chat · left aligned, light outline", "语音房 · 左起 · 轻描边");
        TeachingPreset.Content = L("Vertical teaching · right aligned, pinyin", "教学竖排 · 右起 · 带拼音");
        DiagnosticsIntro.Text = L("Check audio devices, components, and output. Exported diagnostics contain no audio or caption content.", "用于排查音频设备、组件和输出状态。诊断信息不包含音频和字幕内容。");
        DataPathLabel.Text = L("Configuration folder", "配置目录");
        LogPathLabel.Text = L("Log file", "日志文件");
        OpenDataButton.Content = OpenLogFolderButton.Content = L("Open", "打开");
        ExportButton.Content = L("Export diagnostics", "导出诊断信息");
        StatusText.Text = L(_statusEnglish, _statusChinese);
        UpdateRecognitionButton();
        UpdateModelStatus();
        UpdateAdminStatus();
        RefreshMicrophones();
        ShowPage(_page);
    }

    private void SetComboLabels(ComboBox combo, params (string English, string Chinese)[] labels)
    {
        for (var i = 0; i < labels.Length; i++)
            ((ComboBoxItem)combo.Items[i]).Content = L(labels[i].English, labels[i].Chinese);
    }

    private void ApplySettings()
    {
        _loading = true;
        SelectTag(OrientationChoice, Setting("orientation", "horizontal"));
        SelectTag(DirectionChoice, Setting("direction", "center"));
        SelectTag(VerticalAnchorChoice, Setting("verticalAnchor", "top"));
        SelectTag(CenterModeChoice, Setting("centerMode", "block"));
        SelectTag(BackgroundChoice, Setting("backgroundMode", "transparent"));
        FontChoice.SelectedItem = FontChoice.Items.OfType<ComboBoxItem>().FirstOrDefault(item => item.Content?.ToString() == Setting("fontFamily"));
        PinyinToggle.IsOn = SettingBool("pinyin", true);
        ToneToggle.IsOn = SettingBool("tone", true);
        PinyinSizeSlider.Value = SettingInt("pinyinSize", 55);
        FontSizeBox.Value = SettingInt("fontSize", 64);
        OutlineWidthBox.Value = SettingInt("outlineWidth", 3);
        IntervalBox.Value = SettingInt("minInterval", 45);
        CursorToggle.IsOn = SettingBool("cursorBlink", true);
        TextColorPicker.Color = FromHex(Setting("textColor", "#ffffff"));
        OutlineColorPicker.Color = FromHex(Setting("outlineColor", "#081019"));
        BackgroundColorPicker.Color = FromHex(Setting("backgroundColor", "#18d27b"));
        SelectTag(MicrophoneChoice, Setting("microphoneId"));
        _loading = false;
    }

    private static Windows.UI.Color FromHex(string hex)
    {
        try
        {
            return new Windows.UI.Color
            {
                A = 255,
                R = Convert.ToByte(hex.Substring(1, 2), 16),
                G = Convert.ToByte(hex.Substring(3, 2), 16),
                B = Convert.ToByte(hex.Substring(5, 2), 16)
            };
        }
        catch { return new Windows.UI.Color { A = 255, R = 255, G = 255, B = 255 }; }
    }

    private static string ToHex(Windows.UI.Color color) => $"#{color.R:x2}{color.G:x2}{color.B:x2}";

    private void ChangeNumber(string key, double value, int minimum, int maximum)
    {
        if (double.IsFinite(value)) ChangeSetting(key, (int)Math.Clamp(value, minimum, maximum));
    }

    private void ChangeSetting<T>(string key, T value)
    {
        if (_loading) return;
        _settings[key] = JsonValue.Create(value);
        _saveDelay?.Cancel();
        _saveDelay = new CancellationTokenSource();
        _ = SaveAfterDelayAsync(_saveDelay.Token);
    }

    private async Task SaveAfterDelayAsync(CancellationToken token)
    {
        try
        {
            await Task.Delay(150, token);
            await SaveSettingsAsync();
        }
        catch (OperationCanceledException) { }
    }

    private async Task SaveSettingsAsync()
    {
        await _saveLock.WaitAsync();
        try { await _bridge.CallAsync("settings", _settings.DeepClone()); }
        catch (Exception error) { SetStatus(error.Message, error.Message); }
        finally { _saveLock.Release(); }
    }

    private void RefreshMicrophones()
    {
        if (_runtime is null) return;
        var selected = Setting("microphoneId");
        var wasLoading = _loading;
        _loading = true;
        MicrophoneChoice.Items.Clear();
        MicrophoneChoice.Items.Add(new ComboBoxItem { Content = L("System default microphone", "系统默认麦克风"), Tag = "" });
        try
        {
            foreach (var (number, name) in MicrophoneCapture.Devices())
                MicrophoneChoice.Items.Add(new ComboBoxItem { Content = name, Tag = number.ToString(CultureInfo.InvariantCulture) });
        }
        catch (Exception error) { MicrophoneHint.Text = error.Message; }
        SelectTag(MicrophoneChoice, selected);
        if (MicrophoneChoice.SelectedItem is null) MicrophoneChoice.SelectedIndex = 0;
        _loading = wasLoading;
    }

    private async Task DownloadModelAsync()
    {
        if (_downloading || _modelInstalled) return;
        _downloading = true;
        UpdateModelStatus();
        try
        {
            var result = await _bridge.CallAsync("download");
            if (!IsTrue(result?["ok"])) throw new InvalidOperationException(Value(result?["message"], "Model download failed."));
            _modelInstalled = true;
            SetStatus("Speech model installed. Offline recognition is ready.", "语音模型已下载，可离线识别");
        }
        catch (Exception error) { SetStatus(error.Message, error.Message); }
        finally
        {
            _downloading = false;
            UpdateModelStatus();
        }
    }

    private void UpdateModelStatus(int? progress = null)
    {
        var text = _modelInstalled ? L("Installed", "已安装") : progress is not null
            ? L($"Downloading {progress}%", $"下载中 {progress}%")
            : _downloading ? L("Verifying and extracting…", "正在校验与解包…") : L("Not installed", "未下载");
        ModelStatus.Text = ComponentStatus.Text = text;
        DownloadModelButton.Visibility = ComponentsDownloadButton.Visibility = _modelInstalled ? Visibility.Collapsed : Visibility.Visible;
        DownloadModelButton.IsEnabled = ComponentsDownloadButton.IsEnabled = !_downloading;
        DownloadProgress.Visibility = ComponentProgress.Visibility = progress is null ? Visibility.Collapsed : Visibility.Visible;
        if (progress is not null) DownloadProgress.Value = ComponentProgress.Value = progress.Value;
    }

    private async Task StartRecognitionAsync()
    {
        if (_busy) return;
        if (!_modelInstalled)
        {
            SettingsTabs.SelectedItem = InputTab;
            SetStatus("Download the speech model first.", "请先下载语音模型。");
            return;
        }
        _busy = true;
        _manualActive = false;
        _ready = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        UpdateRecognitionButton();
        SetStatus("Starting recognition…", "正在启动识别…");
        try
        {
            var result = await _bridge.CallAsync("start", 16000);
            if (!IsTrue(result?["ok"])) throw new InvalidOperationException(Value(result?["message"], "Recognition could not start."));
            var id = Value(result?["id"]);
            var readyId = await _ready.Task.WaitAsync(TimeSpan.FromSeconds(35));
            if (id != readyId) throw new InvalidOperationException("Recognition session changed unexpectedly.");
            var device = int.TryParse(SelectedTag(MicrophoneChoice), out var number) ? number : -1;
            _microphone.Start(device, id);
            _session = id;
            SetStatus("Listening", "监听中");
        }
        catch (Exception error)
        {
            _microphone.Stop();
            await RunAsync(() => _bridge.CallAsync("stop"));
            _session = null;
            SetStatus(error.Message, error.Message);
        }
        finally
        {
            _ready = null;
            _busy = false;
            UpdateRecognitionButton();
        }
    }

    private async Task StopRecognitionAsync(string? error = null)
    {
        if (_busy && _session is null) return;
        _busy = true;
        UpdateRecognitionButton();
        _microphone.Stop();
        var id = _session;
        _session = null;
        await RunAsync(() => _bridge.CallAsync("stop", id));
        SetStatus(error ?? "Recognition paused", error ?? "识别已暂停");
        _busy = false;
        UpdateRecognitionButton();
    }

    private void UpdateRecognitionButton()
    {
        RecognitionButton.IsEnabled = !_busy && _runtime is not null;
        RecognitionButton.Content = _session is null ? L("Start recognition", "开始识别") : L("Pause recognition", "暂停识别");
        MicrophoneChoice.IsEnabled = !_busy && _session is null;
        RefreshMicrophonesButton.IsEnabled = !_busy && _session is null;
    }

    private async Task ManualCaptionAsync(bool replay)
    {
        if (_loading) return;
        await _captionLock.WaitAsync();
        try
        {
            _microphone.Stop();
            _session = null;
            UpdateRecognitionButton();
            var text = TestCaptionBox.Text.Trim();
            var revise = _manualActive && !replay;
            _manualActive = text.Length > 0;
            await RunAsync(() => _bridge.CallAsync("caption", new { text, revise, optimize = replay }));
            SetStatus(text.Length > 0 ? "Test caption sent" : "Idle", text.Length > 0 ? "测试字幕已发送" : "待机");
        }
        finally { _captionLock.Release(); }
    }

    private async Task ClearCaptionAsync()
    {
        _manualActive = false;
        await RunAsync(() => _bridge.CallAsync("caption", new { text = "", clear = true }));
        SetStatus("Caption canvas cleared", "字幕画布已清空");
    }

    private async Task SetCanvasVisibleAsync(bool visible)
    {
        if (_loading) return;
        await RunAsync(() => _bridge.CallAsync("visible", visible));
        SetStatus(visible ? "Caption canvas shown" : "Caption canvas hidden", visible ? "字幕画布已显示" : "字幕画布已隐藏");
    }

    private async Task ApplyPresetAsync(string name)
    {
        _settings["preset"] = name;
        _settings["orientation"] = name == "teaching" ? "vertical" : "horizontal";
        _settings["direction"] = name == "gaming" ? "center" : name == "voice" ? "left" : "right";
        _settings["fontSize"] = name == "gaming" ? 64 : name == "voice" ? 56 : 58;
        _settings["outlineWidth"] = name == "voice" ? 2 : 3;
        _settings["backgroundMode"] = name == "teaching" ? "black" : "green";
        _settings["pinyin"] = name != "voice";
        ApplySettings();
        await SaveSettingsAsync();
        PresetStatus.Text = name switch
        {
            "voice" => L("Voice chat preset applied", "已应用语音房预设"),
            "teaching" => L("Vertical teaching preset applied", "已应用教学竖排预设"),
            _ => L("Gaming & chat preset applied", "已应用游戏娱乐预设")
        };
    }

    private async Task SaveAiAsync(bool clear)
    {
        try
        {
            object payload = clear
                ? new { apiKey = "" }
                : new { apiKey = ApiKeyBox.Password.Length > 0 ? ApiKeyBox.Password : null, baseUrl = BaseUrlBox.Text, model = ModelBox.Text };
            var result = await _bridge.CallAsync("ai", payload);
            if (!IsTrue(result?["ok"])) throw new InvalidOperationException(Value(result?["message"]));
            ApiKeyBox.Password = "";
            AiStatus.Text = clear ? L("API key cleared", "API Key 已清除") : L("AI settings saved", "AI 设置已保存");
        }
        catch (Exception error) { SetStatus(error.Message, error.Message); }
    }

    private async Task RequestAdminAsync()
    {
        AdminButton.IsEnabled = false;
        SetStatus("Waiting for the Windows administrator prompt…", "正在等待 Windows 管理员授权窗口…");
        try
        {
            var result = await _bridge.CallAsync("admin");
            if (!IsTrue(result?["ok"])) throw new InvalidOperationException(Value(result?["message"]));
            if (IsTrue(result?["relaunched"]))
            {
                await ExitAsync();
                return;
            }
            if (IsTrue(result?["alreadyElevated"]))
                _runtime!["elevated"] = true;
            UpdateAdminStatus();
        }
        catch (Exception error) { SetStatus(error.Message, error.Message); }
        finally { AdminButton.IsEnabled = true; }
    }

    private void UpdateAdminStatus()
    {
        var elevated = IsTrue(_runtime?["elevated"]);
        AdminStatus.Text = elevated ? L("Running with administrator access", "当前已以管理员权限运行") : L("Running with standard access", "当前以普通权限运行");
        DiagnosticsAdmin.Text = AdminStatus.Text;
        AdminButton.IsEnabled = !elevated;
    }

    private void ExportDiagnostics()
    {
        try
        {
            var folder = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            if (!Directory.Exists(folder)) folder = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            var file = Path.Combine(folder, $"typesub-diagnostics-{DateTime.Now:yyyy-MM-dd}.json");
            var report = new
            {
                generatedAt = DateTimeOffset.UtcNow,
                app = "TypeSub",
                version = Value(_runtime?["version"]),
                runtime = new { elevated = Value(_runtime?["elevated"]), dataDir = Value(_runtime?["dataDir"]) },
                speechModel = new { installed = _modelInstalled },
                settings = _settings,
                privacy = "No audio or caption content is included."
            };
            File.WriteAllText(file, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
            SetStatus($"Diagnostics saved to {file}", $"诊断信息已导出至 {file}");
        }
        catch (Exception error) { SetStatus(error.Message, error.Message); }
    }

    private void HandleEvent(string type, JsonNode? data)
    {
        if (type == "connected") { _bridgeReady.TrySetResult(true); return; }
        if (type == "activate") { Activate(); return; }
        if (type == "hotkey")
        {
            var action = Value(data);
            if (action == "toggleCanvas") CanvasButton.IsChecked = CanvasButton.IsChecked != true;
            if (action == "toggleRecognition") _ = _session is null ? StartRecognitionAsync() : StopRecognitionAsync();
            return;
        }
        if (type == "download")
        {
            var percent = int.TryParse(Value(data?["percent"]), out var value) ? value : 0;
            UpdateModelStatus(Value(data?["phase"]) == "extracting" ? null : percent);
            return;
        }
        if (type != "speech") return;
        if (Value(data?["status"]) == "listening")
        {
            _ready?.TrySetResult(Value(data?["id"]));
        }
        else if (Value(data?["status"]) == "error")
        {
            var message = Value(data?["message"], "Recognition stopped.");
            _ready?.TrySetException(new InvalidOperationException(message));
            _microphone.Stop();
            _session = null;
            UpdateRecognitionButton();
            SetStatus(message, message);
        }
    }

    private void SetStatus(string english, string chinese)
    {
        _statusEnglish = english;
        _statusChinese = chinese;
        StatusText.Text = L(english, chinese);
    }

    private async Task RunAsync(Func<Task> action)
    {
        try { await action(); }
        catch (Exception error) { SetStatus(error.Message, error.Message); }
    }

    private async Task ExitAsync()
    {
        if (_exiting) return;
        _exiting = true;
        _saveDelay?.Cancel();
        _captionDelay?.Cancel();
        _microphone.Dispose();
        try { await _bridge.CallAsync("quit").WaitAsync(TimeSpan.FromSeconds(3)); } catch { }
        _bridge.Dispose();
        DisposeTray();
        Application.Current.Exit();
    }
}
