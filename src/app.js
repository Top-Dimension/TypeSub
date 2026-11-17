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
  backgroundMode: 'green',
  textColor: '#ffffff',
  outlineColor: '#081019',
  backgroundColor: '#18d27b',
  outlineWidth: 3,
  minInterval: 45,
  cursorBlink: true,
  vad: true,
  preset: 'gaming'
};
const state = {
  settings: { ...DEFAULT_SETTINGS },
  components: {},
  recognizing: false,
  canvasVisible: true,
  text: '',
  typed: '',
  syllables: [],
  runtime: null
};

const $ = (id) => document.getElementById(id);
const q = (selector) => document.querySelector(selector);
const qa = (selector) => [...document.querySelectorAll(selector)];
const cameraCanvas = document.createElement('canvas');
cameraCanvas.width = 1280;
cameraCanvas.height = 720;
const cameraContext = cameraCanvas.getContext('2d', { willReadFrequently: true });
let cameraRenderQueued = false;

function queueCameraFrame() {
  if (!state.components['virtual-camera']?.installed || cameraRenderQueued) return;
  cameraRenderQueued = true;
  requestAnimationFrame(() => {
    cameraRenderQueued = false;
    renderCameraFrame();
  });
}

function renderCameraFrame() {
  if (!state.components['virtual-camera']?.installed) return;
  const ctx = cameraContext;
  const s = state.settings;
  const width = cameraCanvas.width;
  const height = cameraCanvas.height;
  ctx.fillStyle = s.backgroundMode === 'green' ? '#18d27b'
    : s.backgroundMode === 'black' ? '#060908' : s.backgroundColor;
  ctx.fillRect(0, 0, width, height);
  if (state.canvasVisible && state.typed) {
    const size = Math.max(32, Number(s.fontSize) || 64);
    const pinyinSize = Math.max(14, size * (Number(s.pinyinSize) || 55) / 100);
    const chars = [...state.typed];
    const glyphs = chars.map((char, index) => {
      ctx.font = `${size}px "${s.fontFamily}"`;
      const charWidth = ctx.measureText(char).width;
      const syllable = s.pinyin ? state.syllables[index] || '' : '';
      ctx.font = `${pinyinSize}px "${s.fontFamily}"`;
      return { char, syllable, width: Math.max(size, charWidth, ctx.measureText(syllable).width) + 4 };
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.fillStyle = s.textColor;
    ctx.strokeStyle = s.outlineColor;
    ctx.lineWidth = Math.max(0, Number(s.outlineWidth) || 0) * 2;
    const drawGlyph = (glyph, x, y) => {
      if (glyph.syllable) {
        ctx.font = `${pinyinSize}px "${s.fontFamily}"`;
        ctx.globalAlpha = .78;
        ctx.fillText(glyph.syllable, x, y - size * .72);
        ctx.globalAlpha = 1;
      }
      ctx.font = `${size}px "${s.fontFamily}"`;
      if (ctx.lineWidth) ctx.strokeText(glyph.char, x, y);
      ctx.fillText(glyph.char, x, y);
    };
    if (s.orientation === 'vertical') {
      const rowHeight = size + pinyinSize * .35 + 12;
      const rows = Math.max(1, Math.floor((height * .82) / rowHeight));
      const columns = Math.ceil(glyphs.length / rows);
      const columnWidth = Math.max(size * 1.7, ...glyphs.map((g) => g.width + pinyinSize));
      const startX = s.direction === 'left' ? width * .08
        : s.direction === 'right' ? width * .92
          : width / 2 + (columns - 1) * columnWidth / 2;
      glyphs.forEach((glyph, index) => {
        const col = Math.floor(index / rows);
        const row = index % rows;
        const rowCount = Math.min(rows, glyphs.length - col * rows);
        const startY = s.verticalAnchor === 'center' ? (height - rowCount * rowHeight) / 2
          : s.verticalAnchor === 'bottom' ? height * .9 - rowCount * rowHeight : height * .12;
        const x = startX + (s.direction === 'left' ? col : -col) * columnWidth;
        drawGlyph(glyph, x, startY + row * rowHeight + size / 2);
      });
    } else {
      const maxLineWidth = width * .88;
      const lines = [[]];
      let lineWidth = 0;
      for (const glyph of glyphs) {
        if (lineWidth + glyph.width > maxLineWidth && lines.at(-1).length) {
          lines.push([]);
          lineWidth = 0;
        }
        lines.at(-1).push(glyph);
        lineWidth += glyph.width;
      }
      const widths = lines.map((line) => line.reduce((sum, glyph) => sum + glyph.width, 0));
      const blockWidth = Math.max(...widths);
      const lineHeight = size + pinyinSize + 16;
      const firstY = Math.max(lineHeight, height * .86 - (lines.length - 1) * lineHeight);
      lines.forEach((line, lineIndex) => {
        const lineWidth = widths[lineIndex];
        let x = s.direction === 'left' ? width * .06
          : s.direction === 'right' ? width * .94 - lineWidth
            : s.centerMode === 'line' ? (width - lineWidth) / 2 : (width - blockWidth) / 2;
        for (const glyph of line) {
          drawGlyph(glyph, x + glyph.width / 2, firstY + lineIndex * lineHeight);
          x += glyph.width;
        }
      });
    }
  }
  window.typeSub.sendCameraFrame(cameraContext.getImageData(0, 0, width, height).data);
}

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
  const bg = s.backgroundMode === 'green' ? '#18d27b' : s.backgroundMode === 'black' ? '#060908' : s.backgroundColor;
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
  queueCameraFrame();
}

function setSettings(next) {
  state.settings = { ...state.settings, ...next };
  bindControlsFromState();
  renderCaption();
  window.typeSub?.saveConfig(state.settings);
  window.typeSub?.engineCommand('settings', `minInterval=${state.settings.minInterval};pinyin=${state.settings.pinyin ? 1 : 0};tone=${state.settings.tone ? 1 : 0}`);
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
  $('cursor-blink').checked = s.cursorBlink; $('vad-toggle').checked = s.vad;
  qa('#orientation-switch button').forEach((button) => button.classList.toggle('selected', button.dataset.value === s.orientation));
  qa('.layout-choice').forEach((button) => button.classList.toggle('selected', button.dataset.direction === s.direction));
}

function showView(name) {
  qa('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  qa('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${name}`));
  $('page-title').textContent = ({ studio: '字幕工作台', components: '组件管理', presets: '预设方案', diagnostics: '诊断与日志' })[name];
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

function updateComponentUI(id, data) {
  const installed = data?.installed ?? state.components[id]?.installed;
  const label = $(`state-${id}`);
  const buttons = qa(`[data-install="${id}"]`);
  const progress = $(`progress-${id}`);
  if (installed) {
    label.textContent = '已安装'; label.classList.add('ready');
    buttons.forEach((button) => {
      button.textContent = '重新安装';
      button.classList.add('ready');
    });
    progress.style.width = '100%';
  } else {
    label.textContent = '未安装'; label.classList.remove('ready');
    buttons.forEach((button) => {
      button.textContent = id === 'virtual-camera' ? '安装组件' : '检查安装';
      button.classList.remove('ready');
    });
    progress.style.width = '0%';
  }
  if (id === 'virtual-camera') {
    $('camera-value').textContent = installed ? '已就绪' : '未安装';
    $('camera-detail').textContent = installed ? 'TypeSub 字幕画面' : '未安装摄像头组件';
    $('onboard-camera').textContent = installed ? '已就绪' : '待安装';
  } else {
    $('onboard-model').textContent = installed ? '已就绪' : '待安装';
  }
}

async function installComponent(id) {
  const buttons = qa(`[data-install="${id}"]`);
  buttons.forEach((button) => { button.disabled = true; button.textContent = '检查中…'; });
  let result;
  try {
    result = await window.typeSub.installComponent(id);
  } catch (error) {
    result = { ok: false, message: error.message || '安装检查失败' };
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
    updateComponentUI(id, state.components[id]);
  }
  if (!result.ok) {
    const message = result.message || '组件暂不可用';
    $('install-feedback').textContent = message;
    $('onboard-feedback').textContent = message;
    showToast(message, 'error');
    return false;
  }
  state.components[id] = { ...result.manifest, installed: true };
  updateComponentUI(id, state.components[id]);
  if (id === 'virtual-camera') queueCameraFrame();
  $('install-feedback').textContent = '';
  $('onboard-feedback').textContent = '';
  showToast(id === 'virtual-camera' ? '虚拟摄像机已安装' : '语音识别模型已安装');
  return true;
}

function demoText() {
  const text = '欢迎来到 TypeSub，字幕正在逐个出现。';
  $('test-caption').value = text;
  state.text = text; state.typed = ''; state.syllables = []; state.recognizing = true;
  $('toggle-recognition').innerHTML = '<span class="play-icon">Ⅱ</span><span>暂停识别</span>';
  $('preview-state').textContent = '识别中';
  $('side-status').textContent = '识别中'; $('side-detail').textContent = '示例语音';
  window.typeSub?.engineCommand('settings', `minInterval=${state.settings.minInterval};pinyin=${state.settings.pinyin ? 1 : 0};tone=${state.settings.tone ? 1 : 0}`);
  window.typeSub?.engineCommand('start', text);
}

function manualCaption(replay = false) {
  const text = $('test-caption').value.trim();
  state.text = text;
  state.recognizing = false;
  $('toggle-recognition').innerHTML = '<span class="play-icon">▶</span><span>开始识别</span>';
  $('preview-state').textContent = text ? '手动测试' : '待机';
  $('side-status').textContent = text ? '手动测试' : '系统就绪';
  $('side-detail').textContent = text ? '字幕已发送至画布' : '等待识别';
  if (replay) {
    state.typed = '';
    state.syllables = [];
    renderCaption();
  }
  window.typeSub.engineCommand(text ? (replay ? 'start' : 'partial') : 'clear', text);
}

function toggleRecognition() {
  if (!state.recognizing && !state.components['asr-model']?.installed) {
    showToast('语音识别适配器尚未接入，可先使用「试一试」预览动画', 'error');
    return;
  }
  state.recognizing = !state.recognizing;
  if (state.recognizing) {
    $('toggle-recognition').innerHTML = '<span class="play-icon">Ⅱ</span><span>暂停识别</span>';
    $('preview-state').textContent = '监听中'; $('side-status').textContent = '监听中'; $('side-detail').textContent = '等待语音';
    showToast('已开始监听麦克风');
  } else {
    window.typeSub?.engineCommand('stop');
    $('toggle-recognition').innerHTML = '<span class="play-icon">▶</span><span>开始识别</span>';
    $('preview-state').textContent = '已暂停'; $('side-status').textContent = '已暂停'; $('side-detail').textContent = '识别已暂停';
  }
}

function clearCaption() {
  state.typed = ''; state.text = ''; state.syllables = [];
  window.typeSub?.engineCommand('clear');
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
  qa('.nav-item').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
  qa('[data-settings-tab]').forEach((button) => button.addEventListener('click', () => showSettingsTab(button.dataset.settingsTab)));
  $('toggle-recognition').addEventListener('click', toggleRecognition);
  $('try-demo').addEventListener('click', demoText);
  $('test-caption').addEventListener('input', () => manualCaption());
  $('replay-caption').addEventListener('click', () => manualCaption(true));
  $('clear-caption').addEventListener('click', clearCaption);
  $('toggle-canvas').addEventListener('click', () => {
    state.canvasVisible = !state.canvasVisible;
    $('caption-stage').style.opacity = state.canvasVisible ? '1' : '0';
    queueCameraFrame();
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
  $('vad-toggle').addEventListener('change', (e) => setSettings({ vad: e.target.checked }));
  qa('#orientation-switch button').forEach((button) => button.addEventListener('click', () => setSettings({ orientation: button.dataset.value })));
  qa('.layout-choice').forEach((button) => button.addEventListener('click', () => setSettings({ direction: button.dataset.direction })));
  qa('[data-install]').forEach((button) => button.addEventListener('click', () => installComponent(button.dataset.install)));
  qa('.preset-card').forEach((card) => card.addEventListener('click', () => applyPreset(card.dataset.preset)));
  $('apply-preset').addEventListener('click', () => { applyPreset(state.settings.preset); showToast('预设已应用'); });
  $('open-logs').addEventListener('click', () => window.typeSub.openPath('logs'));
  $('open-data').addEventListener('click', () => window.typeSub.openPath('data'));
  $('open-log-folder').addEventListener('click', () => window.typeSub.openPath('logs'));
  $('audio-device').addEventListener('change', (e) => setSettings({ audioDevice: e.target.value }));
  $('export-diagnostics').addEventListener('click', () => {
    const report = {
      generatedAt: new Date().toISOString(),
      app: 'TypeSub',
      version: '0.1.0',
      runtime: state.runtime ? { elevated: state.runtime.elevated, dataDir: state.runtime.dataDir } : {},
      components: state.components,
      settings: { ...state.settings, audioDevice: $('audio-device').value },
      privacy: '此诊断信息不包含音频和字幕内容'
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
  window.typeSub.onProgress(({ id, progress, label }) => {
    $(`progress-${id}`).style.width = `${Math.round(progress * 100)}%`;
    if (progress < 1) qa(`[data-install="${id}"]`).forEach((button) => {
      button.textContent = `${label} ${Math.round(progress * 100)}%`;
    });
  });
  window.typeSub.onCameraReady(() => queueCameraFrame());
  window.typeSub.onEngineFrame((frame) => {
    if (frame.event !== 'frame') return;
    $('caption-cursor').classList.toggle('hidden', !frame.cursor || !state.settings.cursorBlink);
    if (frame.typed === state.typed && JSON.stringify(frame.syllables) === JSON.stringify(state.syllables)) return;
    state.typed = frame.typed || '';
    state.syllables = frame.syllables || [];
    $('latency-value').textContent = '-- ms';
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
  state.runtime = runtime; state.components = runtime.components || {};
  state.settings = { ...DEFAULT_SETTINGS, ...(runtime.config?.settings || {}) };
  bindControlsFromState(); renderCaption();
  window.typeSub.engineCommand('settings', `minInterval=${state.settings.minInterval};pinyin=${state.settings.pinyin ? 1 : 0};tone=${state.settings.tone ? 1 : 0}`);
  if (runtime.config?.settings?.audioDevice) $('audio-device').value = runtime.config.settings.audioDevice;
  updateComponentUI('virtual-camera', state.components['virtual-camera']);
  queueCameraFrame();
  updateComponentUI('asr-model', state.components['asr-model']);
  updateElevationUI(runtime.elevated);
  $('data-path').textContent = runtime.dataDir; $('log-path').textContent = runtime.logPath;
  if (runtime.firstRun) $('onboarding').classList.remove('hidden');
  $('level-value').textContent = '--';
  $('level-bar').style.width = '0%';
  new ResizeObserver(() => renderCaption()).observe($('caption-stage'));
}
bootstrap();
