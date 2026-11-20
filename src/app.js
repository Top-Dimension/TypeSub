const DEFAULT_SETTINGS = {
  orientation: 'horizontal',
  direction: 'center',
  pinyin: true,
  tone: true,
  pinyinSize: 55,
  verticalAnchor: 'top',
  centerMode: 'block',
  fontFamily: 'Microsoft YaHei UI',
  fontSize: 64,
  backgroundMode: 'transparent',
  textColor: '#ffffff',
  outlineColor: '#081019',
  backgroundColor: '#18d27b',
  outlineWidth: 3,
  minInterval: 45,
  cursorBlink: true,
  microphoneId: '',
  preset: 'gaming'
};
const state = {
  settings: { ...DEFAULT_SETTINGS },
  recognition: 'idle',
  speechModel: null,
  microphones: [],
  refreshingMicrophones: false,
  canvasVisible: true,
  typed: '',
  syllables: [],
  runtime: null
};
let microphone;
let microphoneScan = 0;

const $ = (id) => document.getElementById(id);
const q = (selector) => document.querySelector(selector);
const qa = (selector) => [...document.querySelectorAll(selector)];
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  $('toast-stack').appendChild(toast);
  setTimeout(() => toast.remove(), 3400);
}

function renderCaption() {
  const s = state.settings;
  const lines = $('caption-lines');
  const stage = $('caption-stage');
  const glyphs = $('caption-glyphs');
  const hasText = Boolean(state.typed);
  $('empty-hint').classList.toggle('hidden', hasText);
  const chars = [...state.typed];
  const syllables = state.syllables;
  const fragment = document.createDocumentFragment();
  chars.forEach((char, index) => {
    const box = document.createElement('span');
    box.className = 'caption-glyph';
    box.style.fontFamily = s.fontFamily;
    const top = document.createElement('span');
    top.className = 'syllable';
    top.textContent = s.pinyin ? (syllables[index] || '') : '';
    top.style.display = s.pinyin ? '' : 'none';
    top.style.fontSize = `${Math.max(10, s.fontSize * s.pinyinSize / 100 * .25)}px`;
    const bottom = document.createElement('span');
    bottom.className = 'character';
    bottom.textContent = char;
    bottom.style.fontSize = `${Math.max(18, s.fontSize * .56)}px`;
    bottom.style.color = s.textColor;
    bottom.style.webkitTextStroke = `${s.outlineWidth}px ${s.outlineColor}`;
    box.append(top, bottom);
    fragment.append(box);
  });
  glyphs.replaceChildren(fragment);
  const bg = s.backgroundMode === 'green' ? '#18d27b' : s.backgroundMode === 'black' ? '#060908' : s.backgroundMode === 'custom' ? s.backgroundColor : 'transparent';
  stage.closest('.preview-frame').style.background = bg;
  lines.classList.toggle('vertical', s.orientation === 'vertical');
  if (s.orientation === 'vertical') {
    lines.style.left = s.direction === 'left' ? '6%' : 'auto';
    lines.style.right = s.direction === 'right' ? '6%' : 'auto';
    lines.style.top = s.verticalAnchor === 'center' ? '50%' : s.verticalAnchor === 'bottom' ? 'auto' : '14%';
    lines.style.bottom = s.verticalAnchor === 'bottom' ? '14%' : s.verticalAnchor === 'center' ? 'auto' : 'auto';
    lines.style.transform = s.verticalAnchor === 'center' ? 'translateY(-50%)' : 'none';
    if (s.direction === 'center') {
      lines.style.left = `${(stage.clientWidth - lines.offsetWidth) / 2}px`;
    }
  } else {
    lines.style.top = 'auto';
    lines.style.bottom = '16%';
    lines.style.transform = 'none';
    if (s.direction === 'center') {
      lines.style.left = `${(stage.clientWidth - lines.offsetWidth) / 2}px`;
      lines.style.right = 'auto';
    } else {
      lines.style.left = s.direction === 'left' ? '6%' : 'auto';
      lines.style.right = s.direction === 'right' ? '6%' : 'auto';
    }
  }
}

function setSettings(next) {
  state.settings = { ...state.settings, ...next };
  bindControlsFromState();
  renderCaption();
  window.typeSub?.saveConfig(state.settings);
}

function bindControlsFromState() {
  const s = state.settings;
  $('pinyin-toggle').value = s.pinyin ? 'on' : 'off';
  $('tone-toggle').value = s.tone ? 'on' : 'off';
  $('pinyin-size').value = s.pinyinSize; $('pinyin-size-value').textContent = `${s.pinyinSize}%`;
  $('vertical-anchor').value = s.verticalAnchor; $('center-mode').value = s.centerMode;
  $('font-family').value = s.fontFamily; $('font-size').value = s.fontSize;
  $('background-mode').value = s.backgroundMode; $('text-color').value = s.textColor;
  $('outline-color').value = s.outlineColor; $('background-color').value = s.backgroundColor;
  $('outline-width').value = s.outlineWidth; $('outline-value').textContent = `${s.outlineWidth}px`;
  $('min-interval').value = s.minInterval; $('interval-value').textContent = `${s.minInterval}ms`;
  $('cursor-blink').checked = s.cursorBlink;
  renderMicrophoneOptions();
  qa('#orientation-switch button').forEach((button) => button.classList.toggle('selected', button.dataset.value === s.orientation));
  qa('.layout-choice').forEach((button) => button.classList.toggle('selected', button.dataset.direction === s.direction));
}

function renderMicrophoneOptions() {
  const select = $('microphone-device');
  const selected = state.settings.microphoneId;
  const options = [new Option('系统默认麦克风', '')];
  for (const device of state.microphones) {
    options.push(new Option(device.label || `麦克风 ${options.length}`, device.deviceId));
  }
  if (selected && !state.microphones.some((device) => device.deviceId === selected)) {
    options.push(new Option('上次选择的麦克风（暂不可用）', selected));
  }
  select.replaceChildren(...options);
  select.value = selected;
  const switching = ['starting', 'stopping'].includes(state.recognition) || state.refreshingMicrophones;
  const busy = switching || state.recognition === 'listening';
  select.disabled = busy || !state.runtime;
  $('refresh-microphones').disabled = busy || !state.runtime;
  $('toggle-recognition').disabled = switching || !state.runtime;
  $('microphone-hint').textContent = state.refreshingMicrophones ? '正在读取麦克风列表…'
    : busy ? '暂停识别后可以切换麦克风。'
      : state.microphones.length ? '' : '如果列表只有系统默认，请点击「刷新设备」以读取设备名称。';
}

async function scanMicrophones() {
  const scan = ++microphoneScan;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = devices.filter((device) =>
    device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default');
  if (scan === microphoneScan) {
    state.microphones = microphones;
    renderMicrophoneOptions();
  }
  return microphones;
}

function openMicrophone(deviceId) {
  const audio = { channelCount: 1, autoGainControl: false };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return navigator.mediaDevices.getUserMedia({ audio });
}

function microphoneError(error) {
  switch (error.name) {
    case 'NotAllowedError':
      return '请在系统隐私设置中允许 TypeSub 使用麦克风。';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return '找不到所选麦克风。请重新连接，或在「输入」中改选其他设备。';
    case 'NotReadableError':
      return '无法打开麦克风。请检查连接，以及设备是否被其他程序占用。';
    default:
      return error.message || '无法读取麦克风。';
  }
}

async function refreshMicrophones() {
  state.refreshingMicrophones = true;
  renderMicrophoneOptions();
  let stream;
  try {
    const devices = await scanMicrophones();
    if (!devices.some((device) => device.label)) {
      // Read device names while the application has an active microphone track.
      stream = await openMicrophone('');
      await scanMicrophones();
    }
  } catch (error) {
    showToast(microphoneError(error), 'error');
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    state.refreshingMicrophones = false;
    renderMicrophoneOptions();
  }
}

function showView(name) {
  qa('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  qa('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${name}`));
  $('page-title').textContent = ({ studio: '字幕工作台', components: '组件管理', presets: '预设方案', diagnostics: '诊断与日志' })[name];
  q('.main-content').scrollTop = 0;
}

function showSettingsTab(name) {
  qa('[data-settings-tab]').forEach((button) => {
    const selected = button.dataset.settingsTab === name;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  qa('[data-settings-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== name;
  });
}

function updateElevationUI(elevated, message) {
  state.runtime = { ...state.runtime, elevated };
  $('permission-chip').innerHTML = `<span class="status-dot"></span>${elevated ? '管理员权限运行' : '普通权限运行'}`;
  $('admin-diagnostic').textContent = elevated ? '已授权' : '未提权';
  $('admin-feedback').textContent = message || (elevated ? '当前已以管理员权限运行。' : '普通权限运行；点击请求权限会弹出 Windows 授权窗口。');
  qa('[data-request-admin]').forEach((button) => {
    button.disabled = elevated;
    button.textContent = elevated ? '已是管理员' : '请求管理员权限';
  });
}

function renderSpeechModel() {
  const model = state.speechModel;
  if (!model) return;
  const progress = model.progress;
  const label = model.installed ? '已下载' : progress?.phase === 'extracting'
    ? '正在校验与解包…' : progress ? `下载中 ${progress.percent}%` : '未下载';
  $('state-asr-model').textContent = label;
  $('onboard-model').textContent = label;
  $('input-model-status').textContent = label;
  $('state-asr-model').classList.toggle('ready', model.installed);
  $('model-progress').value = progress?.percent ?? 0;
  $('model-progress').hidden = !progress;
  qa('[data-download-model]').forEach((button) => {
    button.hidden = model.installed;
    button.disabled = Boolean(progress);
  });
}

async function downloadSpeechModel() {
  const model = state.speechModel;
  if (!model || model.installed || model.progress) return;
  model.progress = { phase: 'downloading', percent: 0 };
  renderSpeechModel();
  try {
    const result = await window.typeSub.downloadSpeechModel();
    if (!result.ok) throw new Error(result.message);
    state.speechModel = result.model;
    showToast('语音模型已下载，可离线识别');
  } catch (error) {
    showToast(error.message || '模型下载失败，请重试', 'error');
  } finally {
    state.speechModel.progress = null;
    renderSpeechModel();
  }
}

function closeMicrophone() {
  const active = microphone;
  microphone = undefined;
  active?.stream?.getTracks().forEach((track) => track.stop());
  active?.context?.close().catch(() => {});
}

function setRecognition(status, label, detail) {
  state.recognition = status;
  const active = status === 'listening';
  const button = $('toggle-recognition');
  button.innerHTML = active
    ? '<span class="play-icon">Ⅱ</span><span>暂停识别</span>'
    : '<span class="play-icon">▶</span><span>开始识别</span>';
  $('preview-state').textContent = label;
  $('side-status').textContent = label;
  $('side-detail').textContent = detail;
  renderMicrophoneOptions();
  if (!active) {
    $('level-value').textContent = '--';
    $('level-bar').style.width = '0%';
  }
}

function demoText() {
  closeMicrophone();
  const text = t('欢迎来到 TypeSub，字幕正在逐个出现。');
  $('test-caption').value = text;
  setRecognition('demo', '示例字幕', '正在播放示例');
  window.typeSub.submitCaption(text);
}

function manualCaption(replay = false) {
  closeMicrophone();
  const text = $('test-caption').value.trim();
  const revise = state.recognition === 'manual' && !replay;
  setRecognition('manual', text ? '手动测试' : '待机', text ? '字幕已发送至画布' : '等待识别');
  if (replay) {
    state.typed = '';
    state.syllables = [];
    renderCaption();
  }
  window.typeSub.submitCaption(text, { revise, optimize: replay });
}

async function toggleRecognition() {
  if (state.refreshingMicrophones) return;
  if (['starting', 'stopping'].includes(state.recognition)) return;
  if (state.recognition === 'listening') {
    setRecognition('stopping', '正在暂停', '正在关闭麦克风');
    closeMicrophone();
    await window.typeSub.stopRecognition();
    if (state.recognition === 'stopping') setRecognition('idle', '已暂停', '识别已暂停');
    return;
  }
  if (!state.speechModel?.installed) {
    showSettingsTab('input');
    showToast('请先下载语音模型', 'error');
    return;
  }
  setRecognition('starting', '正在启动', '正在打开麦克风');
  const active = {};
  microphone = active;
  try {
    active.stream = await openMicrophone(state.settings.microphoneId);
    if (microphone !== active) {
      active.stream.getTracks().forEach((track) => track.stop());
      return;
    }
    active.stream.getAudioTracks()[0].addEventListener('ended', () => {
      if (microphone !== active) return;
      closeMicrophone();
      window.typeSub.stopRecognition();
      setRecognition('idle', '识别已停止', '麦克风已断开，可在「输入」中切换');
      scanMicrophones().catch(() => {});
    });
    scanMicrophones().catch(() => {});
    const context = new AudioContext({ sampleRate: 16000 });
    active.context = context;
    await context.audioWorklet.addModule('./microphone-worklet.js');
    if (microphone !== active) return;
    const source = context.createMediaStreamSource(active.stream);
    const worklet = new AudioWorkletNode(context, 'typesub-microphone', {
      numberOfOutputs: 0,
      processorOptions: { chunkSize: Math.round(context.sampleRate / 10) }
    });
    worklet.port.onmessage = ({ data }) => {
      if (microphone !== active || state.recognition !== 'listening' || !active.id) return;
      window.typeSub.sendSpeechAudio(active.id, data);
      const rms = Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length);
      const level = Math.min(100, Math.round(rms * 300));
      $('level-value').textContent = `${level}%`;
      $('level-bar').style.width = `${level}%`;
    };
    source.connect(worklet);
    await context.resume();
    if (microphone !== active) return;
    const result = await window.typeSub.startRecognition(context.sampleRate);
    if (microphone !== active) {
      if (result.ok) window.typeSub.stopRecognition(result.id);
      return;
    }
    if (!result.ok) throw new Error(result.message);
    active.id = result.id;
  } catch (error) {
    if (microphone !== active) return;
    closeMicrophone();
    setRecognition('idle', '待机', '等待识别');
    showToast(microphoneError(error), 'error');
  }
}

function clearCaption() {
  state.typed = ''; state.syllables = [];
  window.typeSub.submitCaption('', { clear: true });
  renderCaption(); showToast('字幕画布已清空');
}

function applyPreset(name) {
  const presets = {
    gaming: { direction: 'center', orientation: 'horizontal', fontSize: 64, outlineWidth: 3, backgroundMode: 'green', pinyin: true },
    voice: { direction: 'left', orientation: 'horizontal', fontSize: 56, outlineWidth: 2, backgroundMode: 'green', pinyin: false },
    teaching: { direction: 'right', orientation: 'vertical', fontSize: 58, outlineWidth: 3, backgroundMode: 'black', pinyin: true }
  };
  setSettings({ ...presets[name], preset: name });
  qa('.preset-card').forEach((card) => card.classList.toggle('selected', card.dataset.preset === name));
  const names = { gaming: ['游戏娱乐', '居中展开的双轨字幕，适合游戏、闲聊和短句互动。'], voice: ['语音房', '左起横排字幕，关闭拼音轨，适合连续聊天和连麦。'], teaching: ['教学竖排', '右起竖排字幕，保留拼音轨，适合知识讲解与板书。'] };
  $('preset-name').textContent = names[name][0]; $('preset-description').textContent = names[name][1];
}

function wireEvents() {
  qa('[data-language-select]').forEach((select) => select.addEventListener('change', async (event) => {
    setLanguage(event.target.value);
    await window.typeSub.saveLanguage(event.target.value);
  }));
  $('copy-obs-url').addEventListener('click', () => {
    window.typeSub.copyText($('obs-url').value);
    showToast('OBS URL 已复制');
  });
  const saveAi = async (clearKey) => {
    const result = await window.typeSub.saveAiConfig(clearKey ? { apiKey: '' } : {
      apiKey: $('ai-api-key').value || undefined,
      baseUrl: $('ai-base-url').value,
      model: $('ai-model').value
    });
    if (!result.ok) {
      showToast(result.message, 'error');
      return;
    }
    $('ai-api-key').value = '';
    $('ai-api-key').placeholder = result.hasKey ? '已保存；留空保持不变' : '未设置时直接使用原文';
    $('ai-status').textContent = result.hasKey && result.model ? '已启用' : '未设置，使用原文';
    showToast(clearKey ? 'API Key 已清除' : 'AI 设置已保存');
  };
  $('save-ai').addEventListener('click', () => saveAi(false));
  $('clear-ai-key').addEventListener('click', () => saveAi(true));
  qa('.nav-item').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
  qa('[data-settings-tab]').forEach((button) => button.addEventListener('click', () => showSettingsTab(button.dataset.settingsTab)));
  $('microphone-device').addEventListener('change', (event) => setSettings({ microphoneId: event.target.value }));
  $('refresh-microphones').addEventListener('click', refreshMicrophones);
  navigator.mediaDevices?.addEventListener('devicechange', () => scanMicrophones().catch(() => {}));
  $('toggle-recognition').addEventListener('click', toggleRecognition);
  $('try-demo').addEventListener('click', demoText);
  $('test-caption').addEventListener('input', () => manualCaption());
  $('replay-caption').addEventListener('click', () => manualCaption(true));
  $('clear-caption').addEventListener('click', clearCaption);
  $('toggle-canvas').addEventListener('click', () => {
    state.canvasVisible = !state.canvasVisible;
    $('caption-stage').style.opacity = state.canvasVisible ? '1' : '0';
    window.typeSub.setCaptionVisible(state.canvasVisible);
    showToast(state.canvasVisible ? '字幕画布已显示' : '字幕画布已隐藏');
  });
  $('reset-settings').addEventListener('click', () => { setSettings(DEFAULT_SETTINGS); showToast('已恢复默认参数'); });
  $('pinyin-toggle').addEventListener('change', (e) => setSettings({ pinyin: e.target.value === 'on' }));
  $('tone-toggle').addEventListener('change', (e) => setSettings({ tone: e.target.value === 'on' }));
  $('pinyin-size').addEventListener('input', (e) => setSettings({ pinyinSize: +e.target.value }));
  $('vertical-anchor').addEventListener('change', (e) => setSettings({ verticalAnchor: e.target.value }));
  $('center-mode').addEventListener('change', (e) => setSettings({ centerMode: e.target.value }));
  $('font-family').addEventListener('change', (e) => setSettings({ fontFamily: e.target.value }));
  $('font-size').addEventListener('input', (e) => setSettings({ fontSize: +e.target.value }));
  $('background-mode').addEventListener('change', (e) => setSettings({ backgroundMode: e.target.value }));
  $('text-color').addEventListener('input', (e) => setSettings({ textColor: e.target.value }));
  $('outline-color').addEventListener('input', (e) => setSettings({ outlineColor: e.target.value }));
  $('background-color').addEventListener('input', (e) => setSettings({ backgroundColor: e.target.value }));
  $('outline-width').addEventListener('input', (e) => setSettings({ outlineWidth: +e.target.value }));
  $('min-interval').addEventListener('input', (e) => setSettings({ minInterval: +e.target.value }));
  $('cursor-blink').addEventListener('change', (e) => setSettings({ cursorBlink: e.target.checked }));
  qa('#orientation-switch button').forEach((button) => button.addEventListener('click', () => setSettings({ orientation: button.dataset.value })));
  qa('.layout-choice').forEach((button) => button.addEventListener('click', () => setSettings({ direction: button.dataset.direction })));
  qa('[data-download-model]').forEach((button) => button.addEventListener('click', downloadSpeechModel));
  qa('.preset-card').forEach((card) => card.addEventListener('click', () => applyPreset(card.dataset.preset)));
  $('apply-preset').addEventListener('click', () => { applyPreset(state.settings.preset); showToast('预设已应用'); });
  $('open-logs').addEventListener('click', () => window.typeSub.openPath('logs'));
  $('open-data').addEventListener('click', () => window.typeSub.openPath('data'));
  $('open-log-folder').addEventListener('click', () => window.typeSub.openPath('logs'));
  $('export-diagnostics').addEventListener('click', () => {
    const report = {
      generatedAt: new Date().toISOString(),
      app: 'TypeSub',
      version: state.runtime?.version,
      runtime: state.runtime ? { elevated: state.runtime.elevated, dataDir: state.runtime.dataDir } : {},
      speechModel: state.speechModel,
      settings: { ...state.settings, microphoneId: undefined },
      privacy: t('此诊断信息不包含音频和字幕内容')
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `typesub-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    link.click(); URL.revokeObjectURL(url);
    showToast('诊断信息已导出');
  });
  qa('[data-request-admin]').forEach((button) => button.addEventListener('click', async () => {
    qa('[data-request-admin]').forEach((item) => { item.disabled = true; item.textContent = '等待系统授权…'; });
    $('admin-feedback').textContent = '正在等待 Windows 管理员授权窗口…';
    try {
      const result = await window.typeSub.requestAdmin();
      if (result.alreadyElevated) {
        updateElevationUI(true);
        showToast('当前已以管理员权限运行');
      } else if (result.relaunched) {
        $('admin-feedback').textContent = '授权成功，正在以管理员权限重新启动…';
      } else {
        updateElevationUI(false, result.message);
        showToast(result.message || '管理员权限请求未完成', 'error');
      }
    } catch (error) {
      updateElevationUI(false, error.message || '管理员权限请求失败');
      showToast(error.message || '管理员权限请求失败', 'error');
    }
  }));
  $('skip-onboarding').addEventListener('click', () => { $('onboarding').classList.add('hidden'); window.typeSub.saveConfig(state.settings); });
  window.typeSub.onSpeech((event) => {
    if (event.type === 'download' && state.speechModel) {
      state.speechModel.progress = event.progress;
      renderSpeechModel();
    } else if (event.type === 'status' && event.status === 'listening' && microphone && state.recognition === 'starting') {
      microphone.id = event.id;
      setRecognition('listening', '监听中', '等待语音');
    } else if (event.type === 'status' && event.status === 'error') {
      closeMicrophone();
      setRecognition('idle', '识别已停止', '请检查语音输入');
      showToast(event.message, 'error');
    }
  });
  window.typeSub.onEngineFrame((frame) => {
    if (frame.event !== 'frame') return;
    $('caption-cursor').classList.toggle('hidden', !frame.cursor || !state.settings.cursorBlink);
    if (frame.typed === state.typed && JSON.stringify(frame.syllables) === JSON.stringify(state.syllables)) return;
    state.typed = frame.typed || '';
    state.syllables = frame.syllables || [];
    renderCaption();
  });
  window.typeSub.onHotkey((action) => {
    if (action === 'toggleCanvas') $('toggle-canvas').click();
    if (action === 'toggleRecognition') toggleRecognition();
    if (action === 'clear') clearCaption();
  });
  window.typeSub.onElevationResult((result) => {
    if (!result.ok) {
      updateElevationUI(false, result.message);
      showToast(result.message || '管理员权限请求未完成', 'error');
    }
  });
}

async function bootstrap() {
  wireEvents();
  bindControlsFromState();
  renderCaption();
  const runtime = await window.typeSub.getRuntime();
  setLanguage(runtime.config?.language);
  state.runtime = runtime;
  state.settings = { ...DEFAULT_SETTINGS, ...(runtime.config?.settings || {}) };
  $('obs-url').value = runtime.overlayUrl || '';
  $('copy-obs-url').disabled = !runtime.overlayUrl;
  $('source-value').textContent = runtime.overlayUrl ? '已就绪' : '不可用';
  $('version-label').textContent = `v${runtime.version} · Electron`;
  $('ai-base-url').value = runtime.config?.ai?.baseUrl || '';
  $('ai-model').value = runtime.config?.ai?.model || '';
  $('ai-api-key').placeholder = runtime.config?.ai?.hasKey ? '已保存；留空保持不变' : '未设置时直接使用原文';
  $('ai-status').textContent = runtime.config?.ai?.hasKey && runtime.config?.ai?.model ? '已启用' : '未设置，使用原文';
  bindControlsFromState(); renderCaption();
  state.speechModel = runtime.speechModel;
  renderSpeechModel();
  if (!runtime.isWindows) qa('[data-windows-only], [data-request-admin], #permission-chip').forEach((item) => { item.hidden = true; });
  setRecognition('idle', '待机', '等待识别');
  scanMicrophones().catch(() => {});
  updateElevationUI(runtime.elevated);
  $('data-path').textContent = runtime.dataDir; $('log-path').textContent = runtime.logPath;
  if (runtime.firstRun) $('onboarding').classList.remove('hidden');
  $('level-value').textContent = '--';
  $('level-bar').style.width = '0%';
  new ResizeObserver(() => renderCaption()).observe($('caption-stage'));
}
bootstrap();
