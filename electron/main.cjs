const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const camera = require('./camera-component.cjs');

const isWindows = process.platform === 'win32';
const dataDir = path.join(app.getPath('appData'), 'TypeSub');
const componentDir = path.join(dataDir, 'components');
const configPath = path.join(dataDir, 'config.json');
const logPath = path.join(dataDir, 'typesub.log');
let mainWindow;
let tray;
let engineProcess;
let cameraProcess;
let cameraBackpressure = false;
let pendingCameraFrame;
let elevationRequest;

function ensureDirs() {
  fs.mkdirSync(componentDir, { recursive: true });
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ version: 1, installed: {}, settings: {} }, null, 2), 'utf8');
  }
}

function readConfig() {
  ensureDirs();
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return { version: 1, installed: {}, settings: {} };
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

function componentManifest(id) {
  return path.join(componentDir, id, 'manifest.json');
}

function componentState(id) {
  if (id === 'virtual-camera') return { installed: camera.isOwnCamera(componentDir) };
  const manifest = componentManifest(id);
  if (!fs.existsSync(manifest)) return { installed: false };
  try {
    const record = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    return { ...record, installed: record.verified === true };
  } catch {
    return { installed: false };
  }
}

function cameraBinaryPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'typesub-camera.exe'),
    path.join(__dirname, '..', 'rust', 'target', 'release', 'typesub-camera.exe'),
    path.join(__dirname, '..', 'rust', 'target', 'debug', 'typesub-camera.exe')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function startCamera() {
  if (cameraProcess || !camera.isOwnCamera(componentDir)) return;
  const binary = cameraBinaryPath();
  if (!binary) {
    log('Rust camera sender missing', 'ERROR');
    return;
  }
  cameraProcess = spawn(binary, [], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  cameraProcess.stderr.on('data', (chunk) => log(`camera: ${chunk.toString().trim()}`, 'WARN'));
  cameraProcess.on('error', (error) => { log(`camera sender failed: ${error.message}`, 'ERROR'); cameraProcess = null; });
  cameraProcess.on('exit', () => { cameraProcess = null; cameraBackpressure = false; pendingCameraFrame = null; });
}

function sendCameraFrame(pixels) {
  if (!cameraProcess?.stdin?.writable || !ArrayBuffer.isView(pixels) || pixels.byteLength !== 1280 * 720 * 4) return;
  const frame = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  if (cameraBackpressure) {
    pendingCameraFrame = frame;
    return;
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(frame.length);
  cameraBackpressure = !cameraProcess.stdin.write(Buffer.concat([header, frame]));
  if (cameraBackpressure) cameraProcess.stdin.once('drain', () => {
    cameraBackpressure = false;
    if (pendingCameraFrame) {
      const latest = pendingCameraFrame;
      pendingCameraFrame = null;
      sendCameraFrame(latest);
    }
  });
}

function stopCamera() {
  pendingCameraFrame = null;
  if (!cameraProcess) return;
  cameraProcess.stdin.end();
  const child = cameraProcess;
  setTimeout(() => { if (!child.killed) child.kill(); }, 500).unref();
  cameraProcess = null;
}

function engineBinaryPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'typesub-engine.exe'),
    path.join(__dirname, '..', 'rust', 'target', 'release', 'typesub-engine.exe'),
    path.join(__dirname, '..', 'rust', 'target', 'debug', 'typesub-engine.exe')
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
  engineProcess.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        mainWindow?.webContents.send('engine-frame', message);
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
  const { width: availableWidth, height: availableHeight } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1020, availableWidth),
    height: Math.min(680, availableHeight),
    minWidth: Math.min(760, availableWidth),
    minHeight: Math.min(560, availableHeight),
    backgroundColor: '#101519',
    title: 'TypeSub',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  await mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
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
  await createWindow();
  createTray();
  startEngine();
  startCamera();
});

app.on('before-quit', () => {
  stopCamera();
  stopEngine();
  log('application stopped');
});

ipcMain.handle('runtime-info', async () => {
  const config = readConfig();
  return {
    elevated: await isElevated(),
    firstRun: !config.onboarded,
    dataDir,
    logPath,
    config,
    components: {
      'virtual-camera': componentState('virtual-camera'),
      'asr-model': componentState('asr-model')
    }
  };
});

ipcMain.handle('install-component', async (_event, id) => {
  if (!['virtual-camera', 'asr-model'].includes(id)) return { ok: false, message: '未知组件' };
  if (id === 'virtual-camera') {
    try {
      const manifest = await camera.install(componentDir, elevationHelperPath(), (progress) => {
        mainWindow?.webContents.send('component-progress', { id, progress, label: progress < .93 ? '下载中' : '安装中' });
      });
      startCamera();
      mainWindow?.webContents.send('camera-ready');
      return { ok: true, manifest };
    } catch (error) {
      log(`camera installation failed: ${error.message}`, 'ERROR');
      return { ok: false, message: error.message };
    }
  }
  return {
    ok: false,
    message: '仓库尚未提供可运行的 ASR 推理适配器及已校验模型包；当前无法启用语音识别'
  };
});

ipcMain.handle('uninstall-component', async (_event, id) => {
  if (!['virtual-camera', 'asr-model'].includes(id)) throw new Error('未知组件');
  if (id === 'virtual-camera') {
    stopCamera();
    await camera.uninstall(componentDir, elevationHelperPath());
    return { ok: true };
  }
  const target = path.join(componentDir, id);
  fs.rmSync(target, { recursive: true, force: true });
  const config = readConfig();
  if (config.installed) delete config.installed[id];
  writeConfig(config);
  log(`component uninstalled: ${id}`);
  return { ok: true };
});

ipcMain.handle('set-config', (_event, settings) => {
  const config = readConfig();
  config.settings = settings;
  config.onboarded = true;
  writeConfig(config);
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

ipcMain.handle('engine-command', (_event, { command, payload = '' }) => ({
  ok: engineCommand(command, payload)
}));

ipcMain.on('camera-frame', (_event, pixels) => sendCameraFrame(pixels));

