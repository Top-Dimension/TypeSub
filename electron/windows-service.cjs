const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn, fork, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createOverlayServer } = require('./overlay-server.cjs');
const { completionUrl } = require('./ai-caption.cjs');
const { createCaptionPipeline } = require('./caption-pipeline.cjs');
const { createSpeechModel } = require('./speech-model.cjs');
const { createNativeBridge } = require('./native-bridge.cjs');

const root = process.env.TYPESUB_ROOT || path.resolve(__dirname, '..');
const dataDir = process.env.TYPESUB_DATA_DIR || path.join(process.env.APPDATA || os.homedir(), 'TypeSub');
const configPath = path.join(dataDir, 'config.json');
const logPath = path.join(dataDir, 'typesub.log');
const nodePath = process.execPath;
const enginePath = process.env.TYPESUB_ENGINE || path.join(root, 'rust', 'target', 'release', 'typesub-engine.exe');
const elevationPath = process.env.TYPESUB_ELEVATE || path.join(root, 'rust', 'target', 'release', 'typesub-elevate.exe');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const dpapi = require('@primno/dpapi');
const speechModel = createSpeechModel(path.join(dataDir, 'models'), globalThis.fetch, process.env.TYPESUB_LEGACY_MODELS);
const runFile = promisify(execFile);
let engineProcess;
let recognition;
let overlay;
let overlayUrl = '';
let nativeBridge;
let captionVisible = true;
let elevationRequest;

function ensureDirs() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, JSON.stringify({ version: 1, settings: {} }, null, 2));
}

function readConfig() {
  ensureDirs();
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch { return { version: 1, settings: {} }; }
}

function writeConfig(config) {
  ensureDirs();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

function log(message, level = 'INFO') {
  ensureDirs();
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] [${level}] ${message}\n`, 'utf8');
}

function getAiConfig() {
  const ai = readConfig().ai || {};
  try {
    const apiKey = ai.encryptedKey
      ? dpapi.Dpapi.unprotectData(Buffer.from(ai.encryptedKey, 'base64'), null, 'CurrentUser').toString('utf8')
      : ai.apiKey || '';
    return { ...ai, apiKey };
  } catch { return { ...ai, apiKey: '' }; }
}

function isElevated() {
  return new Promise((resolve) => {
    if (!fs.existsSync(elevationPath)) return execFile('net', ['session'], { windowsHide: true }, (error) => resolve(!error));
    execFile(elevationPath, ['--check'], { windowsHide: true }, (error) => resolve(!error));
  });
}

function speechStatus(status, data = {}) {
  nativeBridge?.publish('speech', { status, ...data });
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

function engineCommand(command, payload = '') {
  if (!engineProcess?.stdin?.writable) return false;
  const safePayload = String(payload).replace(/[\r\n\t]/g, ' ');
  engineProcess.stdin.write(`${command}${payload ? `\t${safePayload}` : ''}\n`);
  return true;
}

const captions = createCaptionPipeline({
  command: engineCommand,
  aiConfig: getAiConfig,
  onAiError: (error) => log(`AI caption fallback: ${error.message}`, 'WARN')
});

function startEngine() {
  if (engineProcess) return;
  if (!fs.existsSync(enginePath)) throw new Error(`Rust caption engine is missing: ${enginePath}`);
  engineProcess = spawn(enginePath, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  engineProcess.stdout.setEncoding('utf8').on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.event === 'frame') overlay?.publish({
          typed: event.typed || '', syllables: event.syllables || [], cursor: Boolean(event.cursor)
        });
        nativeBridge?.publish('frame', event);
      } catch { log(`Rust engine output ignored: ${line}`, 'WARN'); }
    }
  });
  engineProcess.stderr.setEncoding('utf8').on('data', (chunk) => log(`Rust engine: ${chunk.trim()}`, 'WARN'));
  engineProcess.on('error', (error) => { log(`Rust engine unavailable: ${error.message}`, 'ERROR'); engineProcess = null; });
  engineProcess.on('exit', (code) => { engineProcess = null; if (code) log(`Rust engine exited (${code})`, 'WARN'); });
  engineCommand('settings', engineSettings(readConfig().settings || {}));
}

function engineSettings(settings) {
  return `minInterval=${settings.minInterval ?? 45};pinyin=${settings.pinyin === false ? 0 : 1};tone=${settings.tone === false ? 0 : 1}`;
}

function applyCaptionSettings(settings) {
  engineCommand('settings', engineSettings(settings));
  const fields = [
    'orientation', 'direction', 'pinyin', 'pinyinSize', 'verticalAnchor', 'centerMode',
    'fontFamily', 'fontSize', 'backgroundMode', 'textColor', 'outlineColor', 'backgroundColor',
    'outlineWidth', 'cursorBlink'
  ];
  overlay?.publish({ settings: Object.fromEntries(fields.map((field) => [field, settings[field]])) });
}

async function startRecognition(sampleRate) {
  if (!engineProcess?.stdin?.writable) return { ok: false, message: '字幕引擎未启动，请重新启动 TypeSub。' };
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) return { ok: false, message: '麦克风采样率不受支持。' };
  const modelDirectory = await speechModel.installedDirectory();
  if (!modelDirectory) return { ok: false, message: '请先下载语音模型。' };
  if (recognition) return { ok: false, message: '语音识别已在运行。' };
  const nativeDir = path.dirname(require.resolve('sherpa-onnx-win-x64/package.json'));
  const env = { ...process.env, PATH: [nativeDir, process.env.PATH].filter(Boolean).join(path.delimiter) };
  const child = fork(path.join(__dirname, 'speech-worker.cjs'), [modelDirectory], {
    execPath: nodePath,
    env,
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    windowsHide: true
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
    } else if (event.type === 'drain') session.pending--;
    else if (event.type === 'partial' || event.type === 'final') {
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

function sendSpeechAudio(id, samples) {
  const session = recognition;
  if (!session?.ready || id !== session.id || !(samples instanceof Float32Array) || samples.length !== Math.round(session.sampleRate / 10)) return;
  if (session.pending >= 12) {
    stopRecognition({ clear: false });
    speechStatus('error', { message: '本地识别无法跟上当前音频，请关闭占用 CPU 的程序后重新开始。' });
    return;
  }
  session.pending++;
  session.child.send({ samples, sampleRate: session.sampleRate });
}

function stopEngine() {
  if (!engineProcess) return;
  const child = engineProcess;
  engineProcess = null;
  try { child.stdin.end('shutdown\n'); } catch {}
  setTimeout(() => { if (child.exitCode === null) child.kill(); }, 500).unref();
}

async function runtimeInfo() {
  const config = readConfig();
  const ai = getAiConfig();
  const [elevated, model] = await Promise.all([isElevated(), speechModel.status()]);
  return {
    elevated,
    isWindows: true,
    version,
    firstRun: !config.onboarded,
    dataDir,
    logPath,
    overlayUrl,
    config: {
      language: config.language || (Intl.DateTimeFormat().resolvedOptions().locale.startsWith('zh') ? 'zh-CN' : 'en'),
      settings: config.settings || {},
      ai: { baseUrl: ai.baseUrl || '', model: ai.model || '', hasKey: Boolean(ai.apiKey) }
    },
    speechModel: model
  };
}

async function downloadModel() {
  try {
    await speechModel.download((progress) => nativeBridge?.publish('download', progress));
    return { ok: true, model: await speechModel.status() };
  } catch (error) {
    log(`Speech model installation failed: ${error.message}`, 'WARN');
    return { ok: false, message: error.message };
  }
}

function saveSettings(settings) {
  const config = readConfig();
  config.settings = settings;
  config.onboarded = true;
  writeConfig(config);
  applyCaptionSettings(settings);
  return { ok: true };
}

function saveLanguage(language) {
  const config = readConfig();
  config.language = language === 'en' ? 'en' : 'zh-CN';
  writeConfig(config);
  return { ok: true };
}

function saveAiConfig(next) {
  const config = readConfig();
  const baseUrl = String(next.baseUrl ?? config.ai?.baseUrl ?? '').trim();
  const model = String(next.model ?? config.ai?.model ?? '').trim();
  const key = next.apiKey === undefined ? undefined : String(next.apiKey).trim();
  try {
    if (next.baseUrl !== undefined && baseUrl) completionUrl(baseUrl);
    config.ai = { ...config.ai, baseUrl, model };
    if (key !== undefined) {
      delete config.ai.apiKey;
      if (key) config.ai.encryptedKey = dpapi.Dpapi.protectData(Buffer.from(key), null, 'CurrentUser').toString('base64');
      else delete config.ai.encryptedKey;
    }
    writeConfig(config);
    captions.cancelCorrection();
    return { ok: true, hasKey: Boolean(getAiConfig().apiKey), model };
  } catch (error) { return { ok: false, message: error.message }; }
}

function submitCaption({ text, revise = false, optimize = false, clear = false }) {
  if (clear) {
    captions.clear();
    if (recognition) recognition.hasPartial = false;
    return { ok: true };
  }
  stopRecognition({ clear: false });
  return { ok: captions.submit(String(text || ''), { revise, optimize }) };
}

function setCaptionVisible(visible) {
  captionVisible = Boolean(visible);
  overlay?.publish({ visible: captionVisible });
  return { ok: true };
}

function openPath(target) {
  const folder = target === 'data' ? dataDir : path.dirname(logPath);
  spawn('explorer.exe', [folder], { windowsHide: true, stdio: 'ignore' }).unref();
  return '';
}

async function requestAdmin() {
  if (await isElevated()) return { ok: true, alreadyElevated: true };
  if (!fs.existsSync(elevationPath)) return { ok: false, message: '缺少管理员权限助手。' };
  return new Promise((resolve) => {
    const executable = process.env.TYPESUB_UI || path.join(root, 'windows', 'publish', 'TypeSub.WinUI.exe');
    execFile(elevationPath, [executable, `--wait-for-pid=${process.ppid}`], { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) return resolve({ ok: false, message: `管理员权限请求未完成：${stderr?.trim() || error.message}` });
      resolve({ ok: true, relaunched: true });
    });
  });
}

async function start() {
  ensureDirs();
  const config = readConfig();
  if (!/^[a-f\d]{48}$/.test(config.overlayToken || '')) config.overlayToken = crypto.randomBytes(24).toString('hex');
  overlay = createOverlayServer({ token: config.overlayToken, port: config.overlayPort });
  try {
    overlayUrl = await overlay.start();
    config.overlayPort = Number(new URL(overlayUrl).port);
  } catch (error) {
    log(`OBS browser source could not start: ${error.message}`, 'ERROR');
  }
  writeConfig(config);
  startEngine();
  applyCaptionSettings(config.settings || {});
  nativeBridge = createNativeBridge({
    runtime: runtimeInfo,
    download: downloadModel,
    start: startRecognition,
    stop: (id) => { if (id === undefined || recognition?.id === id) stopRecognition(); return { ok: true }; },
    settings: saveSettings,
    language: saveLanguage,
    ai: saveAiConfig,
    caption: submitCaption,
    visible: setCaptionVisible,
    open: openPath,
    admin: requestAdmin,
    audio: (id, base64) => {
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length > 40000 || buffer.length % 4) return { ok: false };
      const samples = new Float32Array(buffer.length / 4);
      for (let i = 0; i < samples.length; i++) samples[i] = buffer.readFloatLE(i * 4);
      sendSpeechAudio(id, samples);
      return { ok: true };
    },
    focus: () => ({ ok: true }),
    state: () => ({ recognition: Boolean(recognition), visible: captionVisible }),
    quit: () => { shutdown(); return { ok: true }; }
  });
  const endpoint = await nativeBridge.start();
  process.stdout.write(`${JSON.stringify({ type: 'ready', ...endpoint })}\n`);
  log('Windows native service started');
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopRecognition();
  overlay?.close();
  nativeBridge?.close();
  stopEngine();
  log('Windows native service stopped');
  setTimeout(() => process.exit(0), 100).unref();
}

let shuttingDown = false;
if (process.env.TYPESUB_UI) process.stdin.resume().on('end', shutdown);
process.on('uncaughtException', (error) => { log(`Unhandled service error: ${error.stack || error}`, 'ERROR'); });
process.on('unhandledRejection', (error) => { log(`Unhandled service rejection: ${error?.stack || error}`, 'ERROR'); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
start().catch((error) => {
  log(`Windows native service failed to start: ${error.stack || error}`, 'ERROR');
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
