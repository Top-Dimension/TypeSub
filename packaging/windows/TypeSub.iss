[Setup]
AppId=com.typesub.winui
AppName=TypeSub
AppVersion={#Version}
AppPublisher=TypeSub
DefaultDirName={localappdata}\Programs\TypeSub
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
AppMutex=TypeSub.WinUI.Setup
UninstallDisplayIcon={app}\TypeSub.WinUI.exe
OutputDir={#OutputDir}
OutputBaseFilename=TypeSub-Setup-{#Version}-x64
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern

[Tasks]
Name: desktopicon; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Excludes: "*.pdb"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#WebViewInstaller}"; Flags: dontcopy nocompression

[Icons]
Name: "{userprograms}\TypeSub"; Filename: "{app}\TypeSub.WinUI.exe"
Name: "{userdesktop}\TypeSub"; Filename: "{app}\TypeSub.WinUI.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\TypeSub.WinUI.exe"; Description: "{cm:LaunchProgram,TypeSub}"; Flags: nowait postinstall skipifsilent

[Code]
const
  WebViewClient = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function HasWebViewInRegistry(RootKey: Integer): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(RootKey, WebViewClient, 'pv', Version) and
    (Version <> '') and (Version <> '0.0.0.0');
end;

function HasWebView(): Boolean;
begin
  Result := HasWebViewInRegistry(HKLM32) or HasWebViewInRegistry(HKCU32) or
    HasWebViewInRegistry(HKLM64) or HasWebViewInRegistry(HKCU64);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Result := '';
  if HasWebView() then exit;
  WizardForm.PreparingLabel.Caption := 'Installing Microsoft Edge WebView2 Runtime…';
  ExtractTemporaryFile('MicrosoftEdgeWebView2RuntimeInstallerX64.exe');
  if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe'),
    '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, Code) then
    Result := 'Could not start the bundled WebView2 installer. Error ' + IntToStr(Code) + '.'
  else if not HasWebView() then
    Result := 'The bundled WebView2 installation did not complete. Exit code ' + IntToStr(Code) + '.';
end;
