const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

if (process.platform === 'win32') {
  const root = path.join(__dirname, '..');
  const project = path.join(root, 'windows', 'TypeSub.WinUI', 'TypeSub.WinUI.csproj');
  const config = path.join(root, 'windows', 'NuGet.Config');
  const output = path.join(root, 'windows', 'publish');

  // 使用專案附帶的 .NET SDK
  const localSdk = path.join(root, '.tools', 'dotnet', 'dotnet.exe');
  const dotnet = fs.existsSync(localSdk) ? localSdk : 'dotnet';

  // Visual Studio 2022 Build Tools 的 MSBuild
  const vsRoot = path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    '2022',
    'BuildTools',
    'MSBuild',
    'Current',
    'Bin'
  );

  const candidates = [
    path.join(vsRoot, 'amd64', 'MSBuild.exe'),
    path.join(vsRoot, 'MSBuild.exe')
  ];

  const msbuild = candidates.find(file => fs.existsSync(file));

  if (!msbuild) {
    console.error('找不到 Visual Studio 2022 Build Tools MSBuild.exe。');
    process.exit(1);
  }

  const env = { ...process.env };

  if (fs.existsSync(localSdk)) {
    env.DOTNET_CLI_HOME = path.join(root, '.tools');
    env.NUGET_PACKAGES = path.join(root, '.tools', 'nuget');
    env.DOTNET_ROOT = path.dirname(localSdk);
    env.PATH = `${env.DOTNET_ROOT}${path.delimiter}${env.PATH || ''}`;
  }

  // 第一步：還原 NuGet 套件
  console.log('Restoring NuGet packages...');

  const restore = spawnSync(dotnet, [
    'restore',
    project,
    '--configfile',
    config,
    '-r',
    'win-x64'
  ], {
    stdio: 'inherit',
    env
  });

  if (restore.error) {
    console.error(`Restore failed: ${restore.error.message}`);
    process.exit(1);
  }

  if (restore.status !== 0) {
    process.exit(restore.status ?? 1);
  }

  // 第二步：使用 Visual Studio MSBuild 發布 WinUI
  console.log(`Publishing with: ${msbuild}`);

  const publish = spawnSync(msbuild, [
    project,
    '/t:Publish',
    '/p:Configuration=Release',
    '/p:Platform=x64',
    '/p:RuntimeIdentifier=win-x64',
    '/p:SelfContained=true',
    '/p:WindowsAppSDKSelfContained=true',
    '/p:PublishReadyToRun=false',
    `/p:PublishDir=${output}${path.sep}`
  ], {
    stdio: 'inherit',
    env
  });

  if (publish.error) {
    console.error(`WinUI publish failed: ${publish.error.message}`);
  }

  process.exit(publish.status ?? 1);
}
