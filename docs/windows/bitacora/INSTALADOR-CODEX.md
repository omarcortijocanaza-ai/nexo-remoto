# Instalador para otra PC · 2026-10-17

Solicitud del dueño: generar un instalador sencillo para otra PC y aclarar sesiones
simultáneas y pendientes. Se preservó todo el trabajo previo sin commits ni etiquetas.

## Entrega

- `dist/NEXO-Setup-1.0.0-x64.exe` y archivo SHA-256 adjunto.
- Inno Setup 6.7.3, asistente español, accesos directos, elección de autoarranque
  y desinstalación que conserva el estado privado y sólo retira reglas propias.
- Node 24.15.0, PowerShell 7.6.7, cloudflared 2026.7.1 y cuatro binarios Go incluidos.
  Runtime propio antes de consultar tareas o lanzar hijos; no requiere PATH global.
- FFmpeg 9.0.2 essentials se descarga de Gyan en el destino, verificando SHA-256
  de ZIP y ejecutable. Primera instalación requiere Internet. No se redistribuye
  FFmpeg ni se instala VB-CABLE dentro del paquete.
- Fuentes OFL, licencias Go, dependencias npm y licencias de runtimes incluidas.
- Lista positiva de archivos y manifiesto con tamaño/hash; no incluye estado,
  tokens, contraseñas, certificados personales, `.git`, `.claude` ni registros.
- Se exige instalar desde la cuenta destinataria con permisos de administrador;
  se rechaza elevar con identidad diferente para evitar configurar otro perfil.
- Un proceso NEXO activo impide instalar/desinstalar: no se mata silenciosamente.
- Detección sintética de NVENC sin capturar escritorio; fallo → CPU en ajustes nuevos.
  Los ajustes existentes se conservan. Desactivar autoarranque desactiva sólo su
  disparador; la tarea sigue disponible para abrir manualmente el panel elevado.
- Corregido primer inicio: creación de state antes de escribir ajustes; contraseña
  del panel alineada a mínimo 10 y máximo 200; texto identifica credenciales de
  NEXO y no las de Windows.

## Evidencia ejecutada

Salida de compilación, `dist/package-final.log`:

```text
Successful compile (26.063 sec). Resulting Setup program filename is:
D:\nexo-remoto\dist\NEXO-Setup-1.0.0-x64.exe
```

Salida de `node scripts/windows/verify-package.js <stage>/app`:

```text
OK: 2671 archivos íntegros, sin estado privado; Node/WebRTC/PowerShell/túnel/ICO con PATH mínimo.
```

Prueba `installer/test-configure.ps1`, perfiles ficticios y comandos de tarea/firewall simulados:

```text
OK: gpu, ruta con espacios, estado nuevo/conservado y autoarranque desactivable.
OK: cpu, ruta con espacios, estado nuevo/conservado y autoarranque desactivable.
OK: conservar, ruta con espacios, estado nuevo/conservado y autoarranque desactivable.
```

FFmpeg descargado realmente incluye `ddagrab`, `scale_cuda`, `scale_d3d11`,
`h264_nvenc`; codificación de un cuadro sintético 640×360/30 retorna código 0.

`npm test`, `dist/tests-release.log`: 110 tests, 110 pass, 0 fail, 0 skipped.
`go test ./...` y `go vet ./...`, `native/tray`: OK, también después del ajuste de contraseña.
Sintaxis PowerShell y `node --check scripts/windows/verify-package.js`: OK.

La primera ejecución de pruebas dentro del sandbox rechazó renombrados atómicos
y lecturas de red. Se repitió fuera de esa restricción, con perfiles temporales;
no se corrigió código de producción para acomodar esa limitación artificial.

## Aceptación pendiente y alcance real

No se ejecutó el instalador contra la instalación real del dueño. No se cambió su
autoarranque, firewall, estado privado ni `bin/win`, ni se capturó su escritorio.
Se instaló el compilador Inno Setup por usuario en dist/tools/inno para producir
el artefacto; no es parte de NEXO en el destino.

Falta una segunda PC limpia: instalar, crear contraseña, vídeo/entrada/audio,
micrófono con cable compatible, reiniciar y comprobar autoarranque y su cambio
desde el panel, actualizar y desinstalar. Sin firma de código ni actualización automática.

El diseño O3 sigue en investigación: varios clientes comparten el mismo escritorio;
sesiones aisladas en Windows no están implementadas. La opción estudiada es una VM;
queda decidirla, implementarla y medir captura/aceleración y audio en el invitado.
Un monitor virtual no separa usuarios, teclado ni mouse. Ver `O3-segunda-sesion.md`.

También siguen pendientes la aceptación prolongada en móvil/red externa, TURN con
servidor/credenciales cuando sea necesario, confianza del certificado HTTPS LAN
y fase L real en Arch/Hyprland antes de fusionar a main.
