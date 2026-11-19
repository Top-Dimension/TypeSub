const { app, BrowserWindow, ipcMain, net, safeStorage, shell, Tray, Menu, nativeImage, screen, utilityProcess } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { createOverlayServer } = require('./overlay-server.cjs');
const { completionUrl } = require('./ai-caption.cjs');
const { createCaptionPipeline } = require('./caption-pipeline.cjs');
const { createSpeechModel } = require('./speech-model.cjs');

const isWindows = process.platform === 'win32';
const dataDir = path.join(app.getPath('appData'), 'TypeSub');
const configPath = path.join(dataDir, 'config.json');
const logPath = path.join(dataDir, 'typesub.log');
let mainWindow;
let tray;
let engineProcess;
let elevationRequest;
let overlay;
let overlayUrl;
let recognition;
const speechModel = createSpeechModel(path.join(dataDir, 'models'), (url, options) => net.fetch(url, options));
const captions = createCaptionPipeline({
  command: engineCommand,
  aiConfig: getAiConfig,
  onAiError: (error) => log(`AI caption fallback: ${error.message}`, 'WARN')
});

function ensureDirs() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ version: 1, settings: {} }, null, 2), 'utf8');
  }
}

function readConfig() {
  ensureDirs();
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return { version: 1, settings: {} };
  }
}

function writeConfig(next) {
  ensureDirs();
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8');
}

function log(message, level = 'INFO') {
  ensureDirs();
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  fs.appendFileSync(logPath, line, 'utf8');
}

function getAiConfig() {
  const ai = readConfig().ai || {};
  try {
    const apiKey = ai.encryptedKey ? safeStorage.decryptString(Buffer.from(ai.encryptedKey, 'base64')) : ai.apiKey;
    return { ...ai, apiKey };
  } catch {
    return { ...ai, apiKey: '' };
  }
}

function migrateAiKey(config) {
  if (!config.ai?.apiKey || !safeStorage.isEncryptionAvailable()) return;
  config.ai.encryptedKey = safeStorage.encryptString(config.ai.apiKey).toString('base64');
  delete config.ai.apiKey;
}

function isElevated() {
  if (!isWindows) return process.getuid?.() === 0;
  const helper = elevationHelperPath();
  if (helper) {
    return new Promise((resolve) => {
      execFile(helper, ['--check'], { windowsHide: true }, (error) => resolve(!error));
    });
  }
  return new Promise((resolve) => {
    execFile('net', ['session'], { windowsHide: true }, (error) => resolve(!error));
  });
}

function elevationHelperPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'typesub-elevate.exe'),
    path.join(__dirname, '..', 'rust', 'target', 'release', 'typesub-elevate.exe'),
    path.join(__dirname, '..', 'rust', 'target', 'debug', 'typesub-elevate.exe')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function requestElevation() {
  if (!isWindows) return { ok: false, message: '管理员提权只支持 Windows' };
  if (await isElevated()) return { ok: true, alreadyElevated: true };
  const helper = elevationHelperPath();
  if (!helper) return { ok: false, message: '缺少 Rust 提权助手；请先运行 npm run build:engine' };
  const args = [
    process.execPath,
    ...(!app.isPackaged ? [app.getAppPath()] : []),
    '--typesub-elevated'
  ];
  return new Promise((resolve) => {
    execFile(helper, args, { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) {
        log(`UAC cancelled or failed: ${stderr?.trim() || error.message}`, 'WARN');
        resolve({ ok: false, message: `管理员权限请求未完成：${stderr?.trim() || error.message}` });
      } else {
        resolve({ ok: true, relaunched: true });
      }
    });
  });
}

function requestElevationOnce() {
  if (!elevationRequest) {
    elevationRequest = requestElevation().finally(() => { elevationRequest = null; });
  }
  return elevationRequest;
}

function speechStatus(status, data = {}) {
  mainWindow?.webContents.send('speech-event', { type: 'status', status, ...data });
}

function stopRecognition({ clear = true } = {}) {
  if (recognition) {
    clearTimeout(recognition.timeout);
    recognition.child.kill();
    recognition = undefined;
  }
  if (clear) captions.clear();
  else captions.cancelCorrection();
}

async function startRecognition(sampleRate) {
  if (!engineProcess?.stdin?.writable) return { ok: false, message: '字幕引擎未启动，请重新启动 TypeSub。' };
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
    return { ok: false, message: '麦克风采样率不受支持。' };
  }
  if (!await speechModel.installed()) return { ok: false, message: '请先下载语音模型。' };
  if (recognition) return { ok: false, message: '语音识别已在运行。' };
  const platform = isWindows ? 'win' : process.platform;
  let nativeDir;
  try {
    nativeDir = path.dirname(require.resolve(`sherpa-onnx-${platform}-${process.arch}/package.json`))
      .replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');
  } catch {
    return { ok: false, message: '当前安装包不包含此系统架构的语音引擎。' };
  }
  const env = { ...process.env };
  const libraryPath = isWindows ? 'PATH' : process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
  env[libraryPath] = [nativeDir, env[libraryPath]].filter(Boolean).join(path.delimiter);
  const child = utilityProcess.fork(path.join(__dirname, 'speech-worker.cjs'), [speechModel.directory], {
    env, serviceName: 'TypeSub Speech Recognition', stdio: 'pipe'
  });
  captions.clear();
  const session = { id: crypto.randomUUID(), child, sampleRate, hasPartial: false, pending: 0, ready: false };
  recognition = session;
  let diagnostic = '';
  child.stderr?.setEncoding('utf8').on('data', (chunk) => { diagnostic = (diagnostic + chunk).slice(-2500); });
  child.on('message', (event) => {
    if (session !== recognition) return;
    if (event.type === 'ready') {
      clearTimeout(session.timeout);
      session.ready = true;
      speechStatus('listening', { id: session.id });
    } else if (event.type === 'drain') {
      session.pending--;
    } else if (event.type === 'partial' || event.type === 'final') {
      const final = event.type === 'final';
      captions.submit(event.text, { revise: session.hasPartial, optimize: final });
      session.hasPartial = !final;
    } else if (event.type === 'rejected' && session.hasPartial) {
      captions.clear();
      session.hasPartial = false;
    }
  });
  child.once('exit', (code) => {
    if (session !== recognition) return;
    clearTimeout(session.timeout);
    recognition = undefined;
    captions.cancelCorrection();
    log(`Speech recognizer exited (${code}): ${diagnostic.trim()}`, 'WARN');
    speechStatus('error', { message: '本地语音引擎已退出，请查看日志后重新开始。' });
  });
  session.timeout = setTimeout(() => {
    stopRecognition();
    speechStatus('error', { message: '本地模型加载超时，请重新开始。' });
  }, 30000);
  return { ok: true, id: session.id };
}

function engineBinaryPath() {
  const binary = isWindows ? 'typesub-engine.exe' : 'typesub-engine';
  const candidates = [
    path.join(process.resourcesPath || '', binary),
    path.join(__dirname, '..', 'rust', 'target', 'release', binary),
    path.join(__dirname, '..', 'rust', 'target', 'debug', binary)
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function startEngine() {
  if (engineProcess) return;
  const binary = engineBinaryPath();
  if (!binary) {
    log('Rust engine binary missing; run npm run build:engine', 'ERROR');
    return;
  }
  engineProcess = spawn(binary, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  engineProcess.stdout.setEncoding('utf8').on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        mainWindow?.webContents.send('engine-frame', message);
        if (message.event === 'frame') overlay?.publish({
          typed: message.typed || '', syllables: message.syllables || [], cursor: Boolean(message.cursor)
        });
      } catch {
        log(`engine output ignored: ${line}`, 'WARN');
      }
    }
  });
  engineProcess.stderr.on('data', (chunk) => log(`engine: ${chunk.toString().trim()}`, 'WARN'));
  engineProcess.on('error', (error) => {
    log(`engine unavailable: ${error.message}`, 'ERROR');
    engineProcess = null;
  });
  engineProcess.on('exit', () => { engineProcess = null; });
  engineProcess.stdin.on('error', (error) => log(`engine input unavailable: ${error.message}`, 'WARN'));
  applyCaptionSettings(readConfig().settings || {});
}

function applyCaptionSettings(settings) {
  engineCommand('settings', `minInterval=${settings.minInterval ?? 45};pinyin=${settings.pinyin === false ? 0 : 1};tone=${settings.tone === false ? 0 : 1}`);
  const fields = [
    'orientation', 'direction', 'pinyin', 'pinyinSize', 'verticalAnchor', 'centerMode',
    'fontFamily', 'fontSize', 'backgroundMode', 'textColor', 'outlineColor', 'backgroundColor',
    'outlineWidth', 'cursorBlink'
  ];
  overlay?.publish({ settings: Object.fromEntries(fields.map((field) => [field, settings[field]])) });
}

function engineCommand(command, payload = '') {
  if (!engineProcess?.stdin?.writable) return false;
  const safePayload = payload.replace(/[\r\n\t]/g, ' ');
  engineProcess.stdin.write(`${command}${payload ? `\t${safePayload}` : ''}\n`);
  return true;
}

function stopEngine() {
  if (!engineProcess) return;
  const child = engineProcess;
  try { child.stdin.write('shutdown\n'); } catch {}
  setTimeout(() => { if (!child.killed) child.kill(); }, 500).unref();
  engineProcess = null;
}

async function createWindow() {
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.min(1120, workArea.width);
  const height = Math.min(780, workArea.height);
  mainWindow = new BrowserWindow({
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + Math.floor((workArea.height - height) / 2),
    width,
    height,
    minWidth: Math.min(680, width),
    minHeight: Math.min(440, height),
    backgroundColor: '#101519',
    title: 'TypeSub',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      sandbox: false
    }
  });
  const webContents = mainWindow.webContents;
  const sameWindow = (contents) => contents === webContents && contents.getURL().startsWith('file:');
  webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) =>
    sameWindow(contents) && permission === 'media' && details.mediaType === 'audio');
  webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(sameWindow(contents) && permission === 'media' &&
      details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio');
  });
  webContents.on('render-process-gone', () => stopRecognition());
  await mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  mainWindow.on('close', (event) => {
    if (tray && !app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  );
  tray = new Tray(icon);
  tray.setToolTip('TypeSub');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开控制台', click: () => mainWindow?.show() },
    { label: '显示/隐藏字幕', click: () => mainWindow?.webContents.send('hotkey', 'toggleCanvas') },
    { label: '暂停/恢复识别', click: () => mainWindow?.webContents.send('hotkey', 'toggleRecognition') },
    { type: 'separator' },
    { label: '退出 TypeSub', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => mainWindow?.show());
}

app.whenReady().then(async () => {
  ensureDirs();
  const config = readConfig();
  if (!/^[a-f\d]{48}$/.test(config.overlayToken || '')) config.overlayToken = crypto.randomBytes(24).toString('hex');
  try { migrateAiKey(config); } catch { log('Unable to migrate AI API key to OS storage', 'WARN'); }
  overlay = createOverlayServer({ token: config.overlayToken, port: config.overlayPort });
  try {
    overlayUrl = await overlay.start();
    config.overlayPort = Number(new URL(overlayUrl).port);
  } catch (error) {
    log(`OBS browser source could not start: ${error.message}`, 'ERROR');
    overlay = undefined;
  }
  writeConfig(config);
  applyCaptionSettings(config.settings || {});
  startEngine();
  await createWindow();
  try { createTray(); } catch (error) { log(`System tray unavailable: ${error.message}`, 'WARN'); }
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
  else createWindow();
});
app.on('window-all-closed', () => app.quit());

app.on('before-quit', (event) => {
  const download = speechModel.cancel();
  if (download) {
    event.preventDefault();
    download.catch(() => {}).finally(() => app.quit());
    return;
  }
  app.isQuitting = true;
  stopRecognition();
  overlay?.close();
  stopEngine();
  log('application stopped');
});

ipcMain.handle('runtime-info', async () => {
  const config = readConfig();
  const ai = getAiConfig();
  const [elevated, model] = await Promise.all([isElevated(), speechModel.status()]);
  return {
    elevated,
    isWindows,
    version: app.getVersion(),
    firstRun: !config.onboarded,
    dataDir,
    logPath,
    overlayUrl,
    config: {
      settings: config.settings || {},
      ai: { baseUrl: ai.baseUrl || '', model: ai.model || '', hasKey: Boolean(ai.apiKey) }
    },
    speechModel: model
  };
});

ipcMain.handle('speech-model-download', async () => {
  try {
    await speechModel.download((progress) => {
      mainWindow?.webContents.send('speech-event', { type: 'download', progress });
    });
    return { ok: true, model: await speechModel.status() };
  } catch (error) {
    log(`Speech model installation failed: ${error.message}`, 'WARN');
    return { ok: false, message: error.message };
  }
});
ipcMain.handle('speech-start', async (_event, sampleRate) => {
  try { return await startRecognition(sampleRate); }
  catch (error) {
    log(`Speech startup failed: ${error.message}`, 'WARN');
    return { ok: false, message: '无法启动本地语音引擎，请查看日志。' };
  }
});
ipcMain.on('speech-audio', (event, id, samples) => {
  const session = recognition;
  if (event.sender !== mainWindow?.webContents || !session?.ready || id !== session.id ||
      !(samples instanceof Float32Array) || samples.length !== Math.round(session.sampleRate / 10)) return;
  if (session.pending >= 12) {
    stopRecognition({ clear: false });
    speechStatus('error', { message: '本地识别无法跟上当前音频，请关闭占用 CPU 的程序后重新开始。' });
    return;
  }
  session.pending++;
  session.child.postMessage({ samples, sampleRate: session.sampleRate });
});
ipcMain.handle('speech-stop', (_event, id) => {
  if (id === undefined || recognition?.id === id) stopRecognition();
  return { ok: true };
});

ipcMain.handle('set-config', (_event, settings) => {
  const config = readConfig();
  config.settings = settings;
  config.onboarded = true;
  writeConfig(config);
  applyCaptionSettings(settings);
  return { ok: true };
});

ipcMain.handle('set-ai-config', (_event, next) => {
  const config = readConfig();
  const baseUrl = String(next.baseUrl ?? config.ai?.baseUrl ?? '').trim();
  const model = String(next.model ?? config.ai?.model ?? '').trim();
  const key = next.apiKey === undefined ? undefined : String(next.apiKey).trim();
  try {
    if (next.baseUrl !== undefined && baseUrl) completionUrl(baseUrl);
    if (key && !safeStorage.isEncryptionAvailable()) throw new Error('系统加密存储不可用，无法保存 API Key。');
    config.ai = { ...config.ai, baseUrl, model };
    if (key !== undefined) {
      delete config.ai.apiKey;
      if (key) config.ai.encryptedKey = safeStorage.encryptString(key).toString('base64');
      else delete config.ai.encryptedKey;
    }
    writeConfig(config);
    captions.cancelCorrection();
    return { ok: true, hasKey: Boolean(getAiConfig().apiKey), model };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle('submit-caption', (_event, { text, revise = false, optimize = false, clear = false }) => {
  if (clear) {
    captions.clear();
    if (recognition) recognition.hasPartial = false;
    return { ok: true };
  }
  stopRecognition({ clear: false });
  return { ok: captions.submit(String(text || ''), { revise, optimize }) };
});

ipcMain.handle('set-caption-visible', (_event, visible) => {
  overlay?.publish({ visible: Boolean(visible) });
  return { ok: true };
});

ipcMain.handle('open-path', (_event, target) => {
  if (target === 'logs') return shell.openPath(path.dirname(logPath));
  if (target === 'data') return shell.openPath(dataDir);
  return '';
});

ipcMain.handle('request-admin', async () => {
  const result = await requestElevationOnce();
  if (result.relaunched) {
    setTimeout(() => {
      app.isQuitting = true;
      app.quit();
    }, 150);
  }
  return result;
});
