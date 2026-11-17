const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');

const CAMERA_COMMIT = '3ed54c325e0ad71afcf4f246c07e5e17b3d7f2d2';
const CAMERA_CLSID = '{1E864CAC-B8E3-4688-A51D-72A058533210}';
const CAMERA_NAME = 'TypeSub Virtual Camera';

function cameraDll(componentDir) {
  return path.join(componentDir, 'virtual-camera', 'UnityCaptureFilter64.dll');
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function bundledDll() {
  const candidates = [
    path.join(process.resourcesPath || '', 'TypeSubVCam.dll'),
    path.join(__dirname, '..', 'camera-filter', 'prebuilt', 'TypeSubVCam.dll')
  ];
  return candidates.find((file) => {
    if (!fs.existsSync(file) || !fs.existsSync(`${file}.sha256`)) return false;
    const expected = fs.readFileSync(`${file}.sha256`, 'utf8').trim();
    return /^[a-f0-9]{64}$/.test(expected) && hashFile(file) === expected;
  });
}

function expectedHash() {
  const source = bundledDll();
  return source ? fs.readFileSync(`${source}.sha256`, 'utf8').trim() : null;
}

function registeredPath() {
  if (process.platform !== 'win32') return null;
  try {
    const output = execFileSync('reg.exe', ['query', `HKCR\\CLSID\\${CAMERA_CLSID}\\InprocServer32`, '/ve'], {
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return output.match(/REG_SZ\s+([^\r\n]+)/)?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function isOwnCamera(componentDir) {
  const dll = cameraDll(componentDir);
  const registered = registeredPath();
  return Boolean(registered
    && path.normalize(registered).toLowerCase() === path.normalize(dll).toLowerCase()
    && fs.existsSync(dll)
    && hashFile(dll) === expectedHash());
}

function runHelper(helper, action, dll) {
  return new Promise((resolve, reject) => {
    execFile(helper, [action, dll], { windowsHide: true, timeout: 120000 }, (error, _out, stderr) => {
      if (error) reject(new Error(stderr?.trim() || error.message));
      else resolve();
    });
  });
}

async function install(componentDir, helper, progress) {
  if (process.platform !== 'win32') throw new Error('虚拟摄像头仅支持 Windows');
  if (!helper) throw new Error('缺少 Rust 安装助手，请先编译引擎');
  const dll = cameraDll(componentDir);
  const current = registeredPath();
  if (current && path.normalize(current).toLowerCase() !== path.normalize(dll).toLowerCase()) {
    throw new Error(`检测到其他设备占用 TypeSub 的注册 ID，拒绝覆盖：${current}`);
  }
  const source = bundledDll();
  if (!source) throw new Error('缺少已校验的 TypeSub 虚拟摄像头组件；请检查 camera-filter/prebuilt 文件');
  fs.mkdirSync(path.dirname(dll), { recursive: true });
  const hash = expectedHash();
  if (!fs.existsSync(dll) || hashFile(dll) !== hash) {
    progress(.45);
    fs.copyFileSync(source, dll);
    if (hashFile(dll) !== hash) throw new Error('组件 SHA-256 校验失败');
  }
  progress(.93);
  await runHelper(helper, '--install-camera', dll);
  if (!isOwnCamera(componentDir)) throw new Error('注册后未检测到 TypeSub 摄像头，安装未完成');
  progress(1);
  return { installed: true, verified: true, version: CAMERA_COMMIT, name: CAMERA_NAME };
}

async function uninstall(componentDir, helper) {
  const dll = cameraDll(componentDir);
  if (!isOwnCamera(componentDir)) throw new Error('未检测到 TypeSub 自己注册的摄像头，未执行卸载');
  if (!helper) throw new Error('缺少 Rust 安装助手');
  await runHelper(helper, '--uninstall-camera', dll);
  if (registeredPath()) throw new Error('设备仍在系统中，未删除组件文件');
  fs.rmSync(path.dirname(dll), { recursive: true, force: true });
}

module.exports = { CAMERA_NAME, cameraDll, isOwnCamera, install, uninstall };
