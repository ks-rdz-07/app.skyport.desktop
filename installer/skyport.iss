; SkyPort installer (Inno Setup 6). Build: ISCC.exe installer\skyport.iss
; Per-user install (no administrator rights). The choices made here are handed to SkyPort through
; HKCU\Software\Skyport; SkyPort applies them once at first launch and then deletes them.

#define AppName "SkyPort"
#define AppVersion "0.1.0"
#define AppExe "SkyPort.exe"
#ifndef BuildDir
  #define BuildDir "..\src-tauri\target\release"
#endif

[Setup]
AppId={{3F0B8E52-6C1D-4B7A-9C2E-8D5A41F7B630}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppName}
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
SetupIconFile=..\src-tauri\icons\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
OutputDir={#BuildDir}\bundle\inno
OutputBaseFilename={#AppName}_{#AppVersion}_x64-inno-setup
Compression=lzma2/max
SolidCompression=yes
CloseApplications=yes
RestartApplications=no

[Messages]
WelcomeLabel2=This will install [name/ver] on your computer.%n%nSkyPort shows your OneDrive as a drive letter in File Explorer. There are no SkyPort servers: your files go straight between this PC and your cloud, and everything else stays on this PC, encrypted.

[Tasks]
Name: "startup"; Description: "Start SkyPort when I sign in to Windows (reconnects your drives)"; GroupDescription: "Startup:"
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked
Name: "themesystem"; Description: "Match Windows"; GroupDescription: "Appearance:"; Flags: exclusive
Name: "themelight"; Description: "Light"; GroupDescription: "Appearance:"; Flags: exclusive unchecked
Name: "themedark"; Description: "Dark"; GroupDescription: "Appearance:"; Flags: exclusive unchecked

[Files]
Source: "{#BuildDir}\skyport.exe"; DestDir: "{app}"; DestName: "{#AppExe}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
; first-run choices (read once by SkyPort, then removed)
Root: HKCU; Subkey: "Software\Skyport"; ValueType: string; ValueName: "InstallAutostart"; ValueData: "1"; Tasks: startup
Root: HKCU; Subkey: "Software\Skyport"; ValueType: string; ValueName: "InstallAutostart"; ValueData: "0"; Tasks: not startup
Root: HKCU; Subkey: "Software\Skyport"; ValueType: string; ValueName: "InstallTheme"; ValueData: "system"; Tasks: themesystem
Root: HKCU; Subkey: "Software\Skyport"; ValueType: string; ValueName: "InstallTheme"; ValueData: "light"; Tasks: themelight
Root: HKCU; Subkey: "Software\Skyport"; ValueType: string; ValueName: "InstallTheme"; ValueData: "dark"; Tasks: themedark
; removed on uninstall: SkyPort's own key and its "start with Windows" entry
Root: HKCU; Subkey: "Software\Skyport"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "{#AppName}"; Flags: uninsdeletevalue dontcreatekey

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch SkyPort now"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; quit a running SkyPort first; unfinished uploads stay in the cache and resume if it is installed again
Filename: "{sys}\taskkill.exe"; Parameters: "/IM {#AppExe} /T /F"; Flags: runhidden; RunOnceId: "StopSkyPort"

[UninstallDelete]
; encrypted database, its key, logs and window data
Type: filesandordirs; Name: "{localappdata}\app.skyport.desktop"
Type: filesandordirs; Name: "{userappdata}\app.skyport.desktop"

[Code]
var
  CacheDir: string;

function InitializeUninstall(): Boolean;
begin
  { read the cache location before the registry key is removed }
  if not RegQueryStringValue(HKCU, 'Software\Skyport', 'CacheDir', CacheDir) then
    CacheDir := '';
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  { the cache can hold edits not yet uploaded, so ask (default: keep it) }
  if (CurUninstallStep = usPostUninstall) and (CacheDir <> '') and DirExists(CacheDir) then
    if SuppressibleMsgBox('Also delete SkyPort''s local cache?' + #13#10#13#10 + CacheDir + #13#10#13#10 +
        'Any changes that haven''t finished uploading to OneDrive will be lost.',
        mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDNO) = IDYES then
      DelTree(CacheDir, True, True, True);
end;
