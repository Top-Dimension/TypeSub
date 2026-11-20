const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { MODEL, FILES, RELEASE } = require('../electron/speech-model.cjs');
const { version } = require('../package.json');

const root = path.resolve(__dirname, '..');
const cache = path.join(root, '.tools', 'setup');
const output = path.join(root, 'release');
const programFiles = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

function run(file, args) {
  return execFileSync(file, args, { cwd: root, stdio: 'inherit', windowsHide: true });
}

function download(name, url) {
  const file = path.join(cache, name);
  if (!fs.existsSync(file)) {
    const partial = `${file}.part`;
    run('curl.exe', ['--fail', '--location', '--retry', '2', '--silent', '--show-error', url, '-o', partial]);
    fs.renameSync(partial, file);
  }
  return file;
}

function findCrt() {
  const vswhere = path.join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const vs = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' }).trim();
  const redist = path.join(vs, 'VC', 'Redist', 'MSVC');
  const folders = fs.readdirSync(redist).filter(folder => /^\d+(\.\d+)+$/.test(folder))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  const crt = folders.map(folder => path.join(redist, folder, 'x64', 'Microsoft.VC143.CRT'))
    .find(folder => fs.existsSync(path.join(folder, 'vcruntime140.dll')));
  if (!crt) throw new Error('Install the Visual Studio 2022 C++ x64 build tools to obtain the app-local runtime.');
  return crt;
}

function stageModel(runtime) {
  const name = `${MODEL.id}.tar.bz2`;
  const archive = download(name, RELEASE + name);
  if (fs.statSync(archive).size !== MODEL.bytes ||
      createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== MODEL.sha256) {
    throw new Error(`Speech model verification failed. Remove ${archive} and build again.`);
  }
  const models = path.join(runtime, 'models');
  fs.mkdirSync(models, { recursive: true });
  run('tar.exe', ['-xf', archive, '-C', models, ...[...FILES, 'README.md'].map(file => `${MODEL.id}/${file}`)]);
}

function copy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

function build() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build the installer with x64 Node.js on Windows.');
  const publish = path.join(root, 'windows', 'publish');
  if (!fs.existsSync(path.join(publish, 'TypeSub.WinUI.pri'))) {
    throw new Error('WinUI publish is missing TypeSub.WinUI.pri. Run npm run build:ui before building the installer.');
  }
  const compiler = [process.env.ISCC,
    path.join(cache, 'Inno Setup 6', 'ISCC.exe'),
    path.join(programFiles, 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.LOCALAPPDATA, 'Programs', 'Inno Setup 6', 'ISCC.exe')]
    .find(file => file && fs.existsSync(file));
  if (!compiler) throw new Error('Install Inno Setup 6 or set ISCC to its ISCC.exe path.');
  const crt = findCrt();
  fs.mkdirSync(cache, { recursive: true });
  const stage = fs.mkdtempSync(path.join(cache, 'stage-'));
  try {
    console.log('Staging TypeSub WinUI, runtime, and offline speech model...');
    copy(publish, stage);
    const runtime = path.join(stage, 'runtime');
    for (const exe of ['typesub-engine.exe', 'typesub-elevate.exe']) {
      copy(path.join(root, 'rust', 'target', 'release', exe), path.join(stage, exe));
    }
    for (const dll of fs.readdirSync(crt).filter(name => name.endsWith('.dll'))) {
      copy(path.join(crt, dll), path.join(stage, dll));
      copy(path.join(crt, dll), path.join(runtime, dll));
    }
    copy(process.execPath, path.join(runtime, 'node.exe'));
    copy(path.join(root, 'package.json'), path.join(runtime, 'package.json'));
    for (const file of ['windows-service.cjs', 'native-bridge.cjs', 'overlay-server.cjs', 'caption-pipeline.cjs', 'ai-caption.cjs', 'speech-model.cjs', 'speech-worker.cjs']) {
      copy(path.join(root, 'electron', file), path.join(runtime, 'electron', file));
    }
    for (const file of ['overlay.html', 'overlay.css', 'overlay.js']) {
      copy(path.join(root, 'src', file), path.join(runtime, 'src', file));
    }
    for (const name of ['@primno/dpapi', 'node-gyp-build', 'sherpa-onnx-node', 'sherpa-onnx-win-x64']) {
      copy(path.join(root, 'node_modules', name), path.join(runtime, 'node_modules', name));
    }
    stageModel(runtime);
    copy(path.join(root, 'LICENSE'), path.join(stage, 'licenses', 'TypeSub.txt'));
    copy(download(`node-${process.version}-LICENSE.txt`, `https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`), path.join(stage, 'licenses', 'Node.js.txt'));
    copy(download('sherpa-onnx-LICENSE.txt', 'https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/LICENSE'), path.join(stage, 'licenses', 'sherpa-onnx.txt'));
    copy(download('x-asr-LICENSE.txt', 'https://raw.githubusercontent.com/Gilgamesh-J/X-ASR/main/LICENSE'), path.join(stage, 'licenses', 'X-ASR.txt'));

    const webView = download('MicrosoftEdgeWebView2RuntimeInstallerX64.exe', 'https://go.microsoft.com/fwlink/?linkid=2124701');
    const signatureEnv = { ...process.env, TYPESUB_WEBVIEW_INSTALLER: webView };
    // Let Windows PowerShell use its own modules when launched from PowerShell 7.
    delete signatureEnv.PSModulePath;
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "$ErrorActionPreference = 'Stop'; $s = Get-AuthenticodeSignature -LiteralPath $env:TYPESUB_WEBVIEW_INSTALLER; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'CN=Microsoft Corporation,') { throw 'The WebView2 installer must have a valid Microsoft signature.' }"] ,
    { env: signatureEnv, windowsHide: true });
    fs.mkdirSync(output, { recursive: true });
    run(compiler, ['/Qp', `/DVersion=${version}`, `/DStageDir=${stage}`, `/DOutputDir=${output}`, `/DWebViewInstaller=${webView}`, path.join(root, 'packaging', 'windows', 'TypeSub.iss')]);
    console.log(`Installer: ${path.join(output, `TypeSub-Setup-${version}-x64.exe`)}`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

try {
  build();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
