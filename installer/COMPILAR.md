# Construir el instalador de Windows

Sólo el desarrollador necesita Go, Node y PowerShell 7.4+. El destinatario ejecuta
`dist/NEXO-Setup-1.0.4-x64.exe`; no necesita el repositorio ni herramientas de desarrollo.

Desde la raíz del repositorio:

```powershell
pwsh -NoProfile -File scripts/windows/prepare-package.ps1 -InstallCompiler
pwsh -NoProfile -File scripts/windows/package.ps1
```

La primera orden descarga versiones fijas desde sus editores y valida SHA-256.
`-InstallCompiler` instala Inno Setup por usuario en `dist/tools/inno` (con su entrada
de desinstalación); no instala NEXO. Inno Setup requiere licencia para uso comercial:
consulta https://jrsoftware.org/isdl.php antes de generar distribuciones comerciales.

La segunda reconstruye las dependencias con `npm ci --omit=dev --ignore-scripts`,
compila los cuatro binarios en una carpeta nueva `dist/stage-*/app`, genera un
manifiesto SHA-256 de cada archivo y ejecuta ISCC. Nunca reemplaza `bin/win`.
Antes de ISCC ejecuta obligatoriamente la verificación de integridad y una prueba
HTTP de `server.js` desde el paquete: salud, cliente, dos imágenes de fondo, CSS,
JavaScript y fuente deben responder 200. Sólo el adaptador de escritorio se simula;
no se captura pantalla ni se lanzan agentes. Un archivo omitido impide generar el instalador.
El instalador resultante y su `.sha256` quedan en `dist/`.

Node, PowerShell y cloudflared se incluyen con sus licencias. FFmpeg se descarga
directamente desde Gyan **en la PC de destino**, con URL y hashes de archivo y
binario fijados en `dependencies.json`; no se redistribuye dentro del ejecutable.
Por ello la instalación necesita Internet (aproximadamente 110 MB adicionales).
Si el distribuidor retira esa versión hay que revisar y actualizar las huellas;
no se permite saltarse la verificación. VB-CABLE no se incluye ni instala.

El instalador exige que la cuenta destinataria tenga permisos propios de
administrador. Rechaza elevar mediante una cuenta diferente, para no crear estado
y autoarranque en el perfil equivocado. El autoarranque es al iniciar sesión.

Al actualizar, el usuario debe elegir **Salir** en la bandeja. La instalación
rechaza sustituir ejecutables activos. Una tarea NEXO de otra carpeta debe
desinstalarse antes de migrar. Los datos privados no se empaquetan y se conservan
al desinstalar; no se copian credenciales desde la PC del desarrollador.

Comprobaciones del paquete preparado:

```powershell
node scripts/windows/verify-package.js dist/stage-XXXXXXXX/app
node scripts/windows/smoke-package.js dist/stage-XXXXXXXX/app
pwsh -NoProfile -File installer/test-configure.ps1 -App dist/stage-XXXXXXXX/app -FFmpeg dist/cache/ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe
```

Falta aceptar esta primera entrega en una PC limpia: instalación, contraseña,
reinicio con autoarranque, Wi-Fi/datos móviles, vídeo/audio/micrófono,
actualización y desinstalación. Compilar y verificar el paquete no sustituye esa prueba.

`test-configure.ps1` necesita el ZIP de FFmpeg descomprimido en la ruta indicada
(puedes usar `Expand-Archive`). Usa perfiles ficticios en `dist/` y enlaces de
directorio al runtime del paquete. Simula las órdenes de tareas y el instalador
de firewall; no modifica esos ajustes reales. Comprueba alta nueva con NVENC,
fallo del codificador y elección de CPU, conservación de ajustes previos y que
desactivar autoarranque sólo deshabilita el disparador, conservando apertura manual.

