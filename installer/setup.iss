#ifndef Stage
  #error Stage debe apuntar al paquete preparado por package.ps1
#endif
#ifndef Version
  #define Version "1.0.4"
#endif
[Setup]
AppId={{AB05C0D5-4F3F-48CD-926F-A44659EB2AD7}
AppName=NEXO
AppVersion={#Version}
DefaultDirName={autopf}\NEXO
DefaultGroupName=NEXO
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir={#Stage}\..\..
OutputBaseFilename=NEXO-Setup-{#Version}-x64
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\bin\win\nexo-tray.exe
CloseApplications=no
RestartApplications=no
InfoBeforeFile=ANTES-DE-INSTALAR.txt
InfoAfterFile=PRIMER-INICIO.txt
[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
[Tasks]
Name: "autostart"; Description: "Iniciar NEXO automáticamente al iniciar sesión en Windows"
Name: "desktopicon"; Description: "Crear acceso directo en el escritorio"; Flags: unchecked
[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\NEXO"; Filename: "{app}\bin\win\nexo-tray.exe"; Parameters: "--panel"; WorkingDir: "{app}"
Name: "{group}\Primer inicio"; Filename: "{app}\PRIMER-INICIO.txt"
Name: "{autodesktop}\NEXO"; Filename: "{app}\bin\win\nexo-tray.exe"; Parameters: "--panel"; Tasks: desktopicon
[Run]
Filename: "{app}\bin\win\nexo-tray.exe"; Parameters: "--panel"; Description: "Abrir NEXO (configura tu contraseña en Ajustes)"; Flags: postinstall nowait skipifsilent runasoriginaluser
[UninstallDelete]
Type: files; Name: "{app}\runtime\ffmpeg\ffmpeg.exe"
Type: files; Name: "{app}\runtime\ffmpeg\LICENSE"
Type: files; Name: "{app}\runtime\ffmpeg\README.txt"
Type: dirifempty; Name: "{app}\runtime\ffmpeg"
Type: files; Name: "{app}\installer\install-owner.json"
[Code]
function GetUserNameEx(NameFormat: Integer; Buffer: String; var Size: LongWord): Boolean;
  external 'GetUserNameExW@secur32.dll stdcall';

function InitializeSetup(): Boolean;
var User: String; Size: LongWord; Code: Integer;
begin
  Result := False;
  Size := 512;
  User := StringOfChar(#0, Size);
  if not GetUserNameEx(2, User, Size) then exit;
  User := Copy(User, 1, Size);
  StringChangeEx(User, '''', '''''', True);
  // No configurar por accidente la cuenta que prestó credenciales en UAC.
  if not ExecAsOriginalUser(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -Command "if ([Security.Principal.WindowsIdentity]::GetCurrent().Name -ne ''' + User + ''') {exit 42}"',
    '', SW_HIDE, ewWaitUntilTerminated, Code) then exit;
  Result := Code = 0;
  if not Result then MsgBox('Instala desde la cuenta que usará NEXO, con permisos de administrador propios. No se puede usar otra cuenta para aceptar UAC.', mbError, MB_OK);
end;

function AutoStartValue(): String;
begin
  if WizardIsTaskSelected('autostart') then Result := '1' else Result := '0';
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer;
begin
  Result := '';
  // No terminar procesos ni sustituir una instalación de desarrollo en uso.
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -Command "if (Get-Process nexo-tray,nexo-agent,nexo-gpu-webrtc,nexo-super-bridge -ErrorAction SilentlyContinue) {exit 1}"',
    '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
    Result := 'NEXO está abierto. Elige Salir en su bandeja y cierra el ayudante de teclado antes de instalar.';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var Code: Integer;
begin
  if CurStep = ssPostInstall then begin
    if not Exec(ExpandConstant('{app}\runtime\pwsh\pwsh.exe'),
      '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\installer\configure.ps1') + '" -Autostart ' + AutoStartValue(),
      ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
      RaiseException('No se pudo configurar NEXO. Consulta %LOCALAPPDATA%\NEXO\logs\instalacion.log. Corrige el problema y vuelve a ejecutar este instalador.');
  end;
end;

function InitializeUninstall(): Boolean;
var Code: Integer;
begin
  Result := False;
  if MsgBox('Cierra NEXO usando Salir en su bandeja antes de continuar. Se conservarán tus contraseñas y dispositivos. ¿Continuar?', mbConfirmation, MB_YESNO) <> IDYES then exit;
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -Command "if (Get-Process nexo-tray,nexo-agent,nexo-gpu-webrtc,nexo-super-bridge -ErrorAction SilentlyContinue) {exit 1}"',
    '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then begin
    MsgBox('NEXO sigue abierto. Ciérralo y vuelve a desinstalar.', mbError, MB_OK); exit;
  end;
  Result := Exec(ExpandConstant('{app}\runtime\pwsh\pwsh.exe'),
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\installer\uninstall.ps1') + '"',
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code);
  Result := Result and (Code = 0);
end;
