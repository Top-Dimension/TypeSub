$ErrorActionPreference = 'Stop'
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) { throw 'Visual Studio Build Tools 2022 is required' }
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw 'MSVC x64 build tools are missing' }
$msbuild = Join-Path $installation 'MSBuild\Current\Bin\MSBuild.exe'
& $msbuild (Join-Path $PSScriptRoot 'UnityCaptureFilter.vcxproj') /p:Configuration=Release /p:Platform=x64 /p:PlatformToolset=v143 /m:1 /verbosity:minimal
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$dll = Join-Path $PSScriptRoot 'Build\Release-UnityCaptureFilter64\UnityCaptureFilter64.dll'
$sha = [Security.Cryptography.SHA256]::Create()
try {
  $stream = [IO.File]::OpenRead($dll)
  try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose() }
}
finally { $sha.Dispose() }
[IO.File]::WriteAllText("$dll.sha256", $hash + [Environment]::NewLine)
$prebuilt = Join-Path $PSScriptRoot 'prebuilt'
New-Item -ItemType Directory -Path $prebuilt -Force | Out-Null
Copy-Item -LiteralPath $dll -Destination (Join-Path $prebuilt 'TypeSubVCam.dll') -Force
Copy-Item -LiteralPath "$dll.sha256" -Destination (Join-Path $prebuilt 'TypeSubVCam.dll.sha256') -Force
