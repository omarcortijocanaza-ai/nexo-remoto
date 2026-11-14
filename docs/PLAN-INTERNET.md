# Plan «Internet»: vídeo remoto de calidad y dirección fija

Escrito el 2026-11-14 tras analizar el sistema en la PC del dueño. **Por decisión del dueño este
plan lo ejecuta Opus 5.5 directamente** (no hay ejecutor Argon ni prompt «R»): Opus hace el trabajo
y se revisa a sí mismo con las verificaciones de cada fase. Las reglas de `AGENTS.md` siguen
vigentes; las que más pesan aquí están repetidas en §0.

Rama: `windows-port`. Punto de partida: etiqueta `v1.0.5` (commit `6c67ce7`).

## 0. Reglas de este plan

1. **Una fase por sesión** (I1, I2, I3). Ninguna empieza sin la etiqueta `iN-ok` de la anterior.
2. **«Corrió sin error» no es «funciona».** Cada tarea trae su verificación; la salida real se copia
   en la bitácora (§7 de este archivo).
3. **Si algo no está aquí, no se inventa:** se anota como duda en la bitácora y se sigue.
4. **Linux debe quedar igual.** `index.html`, `server.js`, `launcher.js`, `lib/` y `gpu-webrtc/` son
   compartidos. Todo lo nuevo queda inerte si no hay ajuste que lo active. No tocar `gpu-stream.js`.
5. **La PC es el equipo diario del dueño:** sin teclear en su escritorio, sin UAC, sin capturas de
   su pantalla. Las pruebas de vídeo usan una fuente sintética (§2, V3).
6. **Nada nuevo escuchando en `0.0.0.0`:** las pruebas van por bucle local; un binario nuevo que
   escucha en la red deja reglas de firewall permanentes. El agente no toca el firewall.
7. **Nada de secretos en git** ni en este archivo: llaves SSH, tokens TURN y el token de NEXO viven
   en `%LOCALAPPDATA%\NEXO\state`. Antes de cada commit: `git status`.
8. **La VM de Oracle es producción** (5 servicios, 956 MB de RAM). No se toca sin el «sí» explícito
   del dueño en el chat de esa sesión, y sólo con el guion de I2 (respaldo y reversión).
9. Los `.exe` no se recompilan solos: tras tocar Go, `scripts\windows\build.ps1` con NEXO cerrado
   (pedir al dueño que elija «Salir» en la bandeja, o compilar a un `-OutputDir` y cambiar al final).
   El doctor avisa si la bandeja quedó vieja; el puente GPU no tiene ese aviso (se añade en I3).
10. Comentarios en español explicando el porqué. Commits `I1: …`, `I2: …`, `I3: …`.

## 1. Diagnóstico (medido el 2026-11-14)

| Qué | Resultado |
|---|---|
| NAT de la casa | Mapeo independiente del destino: mismo puerto público hacia 5 servidores STUN. La conexión directa es posible con clientes que no estén tras NAT simétrico. |
| TURN | Ninguno configurado (`.nexo-turn.json` ausente; el doctor dice «sólo STUN»). |
| Subida / bajada | ≈ 33 Mbps / ≥ 69 Mbps (una sola conexión TCP a Cloudflare). |
| Cloudflare | Nodo `LIM` a 9 ms. |
| VM de Oracle | `136.248.65.57`, ≈ 100 ms de conexión TCP, no responde a ping. |
| Pruebas | `node --test`: 131 de 131. |

Causas de la mala calidad por Internet, de mayor a menor peso:

- **C1 · Respaldo JPEG.** Sin TURN, cuando el cliente está tras NAT simétrico (datos móviles,
  oficinas) WebRTC no conecta y el cliente cae a `/live`: JPEG de 1280 px a 10 FPS por el túnel
  (`server.js` pide `fps: 30, quality: 48`, pero `jpegStreamArgs` convierte 30 → 10 FPS y descarta
  48 por estar fuera de 2–31 → `q=8`).
- **C2 · El cliente ignora el TURN en el vídeo GPU.** `index.html`, `startGpuRtc()` crea el
  `RTCPeerConnection` con `iceServers:[{urls:'stun:stun.cloudflare.com:3478'}]` fijo en vez de
  `await iceServers()` (que sí usa `startRtc()`).
- **C3 · Codificador pensado para LAN** (`platform/windows/ffmpeg.js`, `gpuEncoderArgs`):
  `-preset p1`, CBR a 10 000 / 7 000 / 4 500 kbps atado a la altura, `-g fps/2` (IDR cada 0,5 s) y
  `-bufsize bitrate/30` (un fotograma). El IDR no cabe en el búfer: la imagen «late» dos veces por
  segundo y el texto se emborrona.
- **C4 · Sin adaptación real.** El puente Pion (`gpu-webrtc/main.go`) no tiene control de
  congestión; la «calidad automática» del cliente (`sampleRtcStats`) usa la pérdida **acumulada**
  desde el inicio, sólo cambia altura/FPS (no bitrate), el perfil es global para todos los clientes
  y cada cambio reinicia ffmpeg.
- **C5 · A ciegas.** Ningún registro guarda qué transporte obtuvo cada sesión, así que no se puede
  confirmar si una queja fue C1 o C3/C4.

Fuera de alcance (no hacer): reemplazar ffmpeg por un codificador propio, IDR bajo demanda (el CLI
de ffmpeg no lo permite; el puente seguirá sólo contando PLI), control de congestión en Pion,
montar un TURN en la VM (a 100 ms empeoraría el vídeo).

## 2. Fase I1 · Vídeo por Internet

### V1 · El vídeo GPU usa el TURN configurado
- `index.html`, `startGpuRtc()`: `iceServers: await iceServers()`.
- En las dos conexiones (`startRtc`, `startGpuRtc`): si la URL trae `?ice=relay`, añadir
  `iceTransportPolicy:'relay'`. Sólo sirve para probar el TURN desde la LAN; no se anuncia en la UI.
- Prueba nueva en `test/` (junto a `client-input.test.js`): en `index.html` no queda ningún
  `new RTCPeerConnection({iceServers:[` literal; el único STUN literal está dentro de `iceServers()`.

### V2 · Registrar el transporte de cada sesión
- Cliente, `sampleRtcStats()`: del informe `candidate-pair` nominado obtener
  `currentRoundTripTime` y los `candidateType` local y remoto (`host`/`srflx`/`prflx`/`relay`).
  Guardarlos en `ruta` (p. ej. `srflx→relay`) y usar ese RTT cuando no hay pong del canal de control
  (hoy `rtt` sólo sale del canal de la conexión CPU).
- `clientDiagnostic()` añade `ruta`, `altura`, `kbpsPedido`.
- Servidor, `POST /diagnostics/client`: cuando cambia `transport` o `ruta` de un dispositivo (y
  como mucho una vez cada 30 s por dispositivo) añadir una línea a `nexo-access.log`:
  `{"at":…,"type":"transporte","label":…,"origen":"lan|remoto","transport":"gpu|rtc|fallback","ruta":"…","fps":…,"kbps":…,"perdida":…}`.
  `origen` sale de la misma lógica que `loginKey()`. Sin IP ni token en la línea.
- `nexo-doctor.ps1`, sección «Red y conexión»: resumen de las últimas 20 líneas `transporte`
  (cuántas `gpu`, `rtc`, `fallback`; AVISO si hay `fallback` remoto y no hay TURN).
- Verificación: prueba unitaria del limitador y del formato; abrir el cliente por
  `http://127.0.0.1:8765` en el navegador integrado y ver la línea `transporte` con `origen: lan`.

### V3 · Codificador para Internet
Cambios en `gpuEncoderArgs` (y sus pruebas en `test/ffmpeg-args.test.js`):

| Parámetro | Ahora | Nuevo |
|---|---|---|
| `-g` | `fps/2` | `fps*2` (IDR cada 2 s) |
| `-bufsize` | `bitrate/30` | `bitrate*0.15` (150 ms), mínimo 240 000 |
| `-preset` | `p1` | `p4` |
| `-spatial-aq` | — | `1` |
| resto (`-tune ull`, CBR, `-bf 0`, `-zerolatency 1`, …) | | igual |

Medir antes de dejarlo, **sin capturar el escritorio del dueño**. Fuente sintética: las capturas del
repositorio (`docs/capturas/sesion-pc.png`, `panel.png`) en bucle con desplazamiento lento
(`-loop 1 -i … -vf "scale=1920:-2,crop=1920:1080:0:'mod(t*60,ih-1080)'"`), 20 s a 45 FPS, a un
archivo sin pérdida en el scratchpad. Codificar esa fuente con los argumentos viejos y los nuevos a
4 000 y 10 000 kbps (salida a `.mp4` en vez de RTP) y comparar con el filtro `ssim` de ffmpeg:

- SSIM medio: el nuevo ≥ el viejo.
- SSIM mínimo por fotograma (`stats_file`): el nuevo claramente mayor (ése es el «latido»).
- Velocidad de codificación ≥ 2× tiempo real a 1080p45 (`-benchmark` o `speed=` de ffmpeg). Si
  `p4` no llega, probar `p3` y luego `p2`; anotar cuál queda y por qué.
- Tabla con los números en la bitácora. Si lo nuevo no gana en SSIM mínimo, **no se aplica** y se
  anota.

Después, prueba real por bucle local: cliente en `http://127.0.0.1:8765`, 60 s, y de
`/gpu-webrtc/stats` anotar `frames`, `nack`, `pli`. El arranque del vídeo puede tardar hasta 2 s
más (espera del primer IDR): es el coste aceptado.

### V4 · Bitrate separado de la resolución y perfil remoto
- Escalera de bitrate: `[1500, 2500, 4000, 6000, 8000, 10000]` kbps (constante exportada en
  `platform/windows/ffmpeg.js`).
- `.nexo-gpu-profile.json` admite `kbps` opcional (uno de la escalera). `POST /gpu-profile`
  (`server.js`) lo valida y guarda; sin `kbps` todo queda como hoy (compatibilidad con Linux y con
  clientes viejos en caché).
- `gpu-stream-windows.js`, `selectedProfile()`: `bitrate = profile.kbps ?? profileBitrateKbps(alto)`.
  El bucle de reconfiguración ya reinicia ffmpeg cuando cambia `mediaKey` (incluye el bitrate).
- Cliente: clasificar la red una vez al cargar. `lan` si `location.hostname` es `localhost`, una IP
  privada (10/8, 172.16/12, 192.168/16, 169.254/16) o termina en `.local`; si no, `remoto`.
  Preferencias separadas en `localStorage` (`nexoPerfilLan`, `nexoPerfilRemoto`), migrando las
  claves actuales a `lan`. Valores iniciales: LAN 1080p · 45 FPS · 10 000 (techo 10 000); remoto 1080p · 30 FPS ·
  4 000 (techo 6 000). Al activarse el vídeo GPU el cliente envía su perfil (hoy sólo lo envía al tocar un botón).
- UI: en el selector de calidad, una fila «Datos» con tres opciones — Ahorro (2 500), Normal
  (6 000) y Máxima (10 000) — que fija el **techo**; la adaptación se mueve
  por debajo. Respetar los temas (`ui/temas/*.css`); sin estilos nuevos por tema.
- Limitación conocida que se documenta y no se resuelve: la codificación es una sola para todos los
  clientes, así que manda el último que envió perfil.

### V5 · Calidad automática que reaccione bien
En `sampleRtcStats()` / `applyAdaptiveProfile()`:
- Pérdida **por ventana**: `Δlost / (Δreceived + Δlost)` entre muestras (cada 2,5 s), no acumulada.
- Congestión = pérdida de ventana > 3 % **o** RTT > 300 ms **o** jitter > 60 ms, en 2 muestras
  seguidas. Sano = pérdida < 0,5 %, RTT < 150 ms y jitter < 30 ms durante 12 muestras (30 s).
- Bajar: un peldaño de la escalera de kbps. Sólo en el peldaño más bajo (1 500) y si sigue
  congestionado, bajar altura (1080 → 900 → 720) y luego FPS a 30.
- Subir: primero altura/FPS hasta lo elegido por el usuario, luego kbps hasta el techo.
- Como mucho un cambio cada 20 s (cada cambio reinicia ffmpeg: corte de ≈ 0,5 s).
- La lógica de decisión se extrae a una función pura (en `ui/`, cargada por `index.html`, con el
  mismo patrón que `ui/control-tactil.js`) para probarla con `node --test`: secuencias de muestras
  → decisiones esperadas.

### V6 · Respaldo JPEG honesto y avisado
- `server.js` llama `startJpegStream({ fps: 12, quality: 7 })` y `jpegStreamArgs` deja de traducir
  a escondidas (`30 → 10`, calidad fuera de rango): valida y recorta, nada más. Ajustar
  `test/` en consecuencia. El ancho máximo sigue en 1280.
- Cliente: cuando `transport==='fallback'` más de 8 s con la red `remoto`, mostrar un aviso
  descartable: «Modo de respaldo: no hay conexión directa de vídeo. El dueño puede activar TURN en
  el panel de NEXO (Conexión)». Una vez por sesión.

### V7 · 👤 Clave TURN de Cloudflare (la crea el dueño)
Opus no crea cuentas ni claves. Pasos para el dueño, que se le dan al terminar V1–V6:
1. dash.cloudflare.com → Realtime → TURN → «Create TURN key».
2. Copiar «Key ID» y «API Token» en el panel de NEXO → Conexión → TURN → Cloudflare → Guardar.
3. `nexo-control turn-test` debe decir `relay` > 0.

Verificación del camino con TURN sin salir de casa: abrir el cliente con `?ice=relay` (V1); en
Diagnóstico la ruta debe ser `relay→…` y el transporte `gpu`. Si el dueño aún no creó la clave, I1
se cierra igual y esta verificación queda anotada como pendiente 👤.

### Cierre de I1
- `node --test` completo y `go test ./...` en `gpu-webrtc` y `native/tray` (si se tocaron).
- Probar el cliente en el navegador integrado por `http://127.0.0.1:8765`: vídeo GPU, cambio de
  «Datos», línea `transporte` en el registro.
- Bitácora, commit(s) `I1: …`, etiqueta `i1-ok`, push de rama y etiqueta.

## 3. Fase I2 · Dirección fija `nexo.nexussoftware.pe`

Cómo publican hoy las otras aplicaciones del dueño (verificado en `D:\NexusSoftwareWeb\nexus-software\docs\ORACLE.md`
y `scripts\subdominios-oracle.sh`): DNS en punto.pe con `A *.nexussoftware.pe → 136.248.65.57`,
Caddy en la VM con un bloque por subdominio delimitado por marcadores `# BEGIN …` / `# END …`,
respaldo del `Caddyfile`, validación y recarga. `nexo.nexussoftware.pe` **ya resuelve** a la VM: no
hay que tocar el DNS.

Decisión tomada: **túnel SSH inverso** de la PC a la VM + bloque de Caddy. Cloudflare con nombre
propio se descarta porque obligaría a mudar el DNS de las webs publicadas. TryCloudflare se
conserva como respaldo automático.

```
celular ──HTTPS──▶ Caddy (VM, nexo.nexussoftware.pe) ──▶ 127.0.0.1:5095 (VM)
                                                            ▲ túnel SSH inverso
                                         PC del dueño: ssh -R 127.0.0.1:5095:127.0.0.1:8765
```
El vídeo y el control siguen yendo por WebRTC (directo o TURN); por la VM sólo pasan la página, la
señalización y el respaldo.

### D1 · Guion de la VM (se escribe y se revisa; se ejecuta sólo con el «sí» del dueño)
`scripts/vm/nexo-dominio-vm.sh`, siguiendo el patrón de `subdominios-oracle.sh`:
- Comprobar que `127.0.0.1:5095` está libre (`ss -ltn`); si no, abortar y anotar (puertos usados:
  5081, 5082, 5083, 5086, 5087, 5090, 8000).
- Usuario de sistema `nexotunel` sin contraseña ni shell (`/usr/sbin/nologin`), con
  `~/.ssh/authorized_keys` que contiene **sólo** la llave pública del túnel con
  `restrict,port-forwarding,permitlisten="127.0.0.1:5095"`. No se toca `sshd_config` (el reenvío
  remoto a 127.0.0.1 funciona con los valores por defecto; si no, abortar y anotar).
- Bloque `# BEGIN nexo` / `# END nexo` al final del `Caddyfile`:
  ```
  nexo.nexussoftware.pe {
      encode zstd gzip
      header X-Content-Type-Options nosniff
      header Referrer-Policy no-referrer
      reverse_proxy 127.0.0.1:5095 {
          flush_interval -1
      }
  }
  ```
  `Referrer-Policy no-referrer` porque el enlace lleva `?token=`. Caddy ya añade
  `X-Forwarded-For` y `X-Forwarded-Proto`, que `server.js` usa (`loginKey`, `isSecureRequest`).
- Respaldo en `/var/backups/nexo/<fecha>/Caddyfile`, `caddy validate`, `systemctl reload caddy`,
  reversión automática con `trap` si algo falla. Idempotente. Imprime cómo deshacerlo.
- Guion inverso `scripts/vm/nexo-dominio-vm-quitar.sh`.
- Nada de esto consume memoria apreciable: no hay proceso nuevo en la VM.

Acceso de administración a la VM: el mismo que usan los despliegues de las otras aplicaciones (usuario
`ubuntu`; la orden exacta y la ubicación de la llave están en `D:\Sistema-Restaurantes\docs\DESPLIEGUE-VM.md`).
La llave es del dueño: se usa sólo para ejecutar este guion; no se copia ni se guarda en NEXO ni en git.

### D2 · Preparación en la PC
`scripts/windows/nexo-dominio.ps1` (sin privilegios):
- `preparar`: genera `ssh-keygen -t ed25519` en `%LOCALAPPDATA%\NEXO\state\tunel-vm\id_ed25519`
  (sin frase de paso, ACL de la carpeta de estado), guarda la huella del servidor con
  `ssh-keyscan` en `tunel-vm\known_hosts` y **muestra la huella para que el dueño la confirme**, y
  escribe en `.nexo-settings.json` el bloque de D3 con `activo: false`.
- `probar`: abre el túnel 20 s y pide `https://nexo.nexussoftware.pe/health`.
- `activar` / `desactivar`: cambian `activo`.

### D3 · Lanzador
- `lib/settings.js`: nuevo ajuste, ausente por defecto (Linux y las instalaciones actuales no cambian):
  ```json
  "dominioFijo": { "activo": true, "url": "https://nexo.nexussoftware.pe",
                   "ssh": { "host": "136.248.65.57", "usuario": "nexotunel", "puertoRemoto": 5095 } }
  ```
  Validar: `url` https, `host` nombre o IPv4, `usuario` `[a-z_][a-z0-9_-]{0,31}`, puerto 1024–65535.
- `lib/tunel-fijo.js` (nuevo, con pruebas): construye los argumentos de
  `C:\Windows\System32\OpenSSH\ssh.exe` — `-N -T -o BatchMode=yes -o ExitOnForwardFailure=yes
  -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile=<estado>\tunel-vm\known_hosts -o IdentitiesOnly=yes -i <llave>
  -R 127.0.0.1:<puertoRemoto>:127.0.0.1:<puerto NEXO> <usuario>@<host>` — y supervisa el proceso
  con reintento creciente 2 s → 60 s (mismo estilo que `startTunnel`).
- `launcher.js`: si `dominioFijo.activo` y hay llave, arranca el túnel fijo además de cloudflared.
  Comprueba `GET <url>/health` cada 30 s. El estado (`.nexo-state.json`) gana dos campos:
  `fixedUrl` (la del ajuste) y `fixedOk` (booleano). **`remoteUrl` pasa a ser la dirección que
  funciona ahora:** la fija si `fixedOk`, si no la de TryCloudflare. Así la bandeja, el panel, el
  QR y `nexo-avisar-enlace.ps1` siguen funcionando sin cambios de contrato.
- Condición de seguridad: con dirección fija el inicio de sesión es la única barrera. Si no hay
  credenciales configuradas (`.nexo-auth.json`) el lanzador **no** abre el túnel fijo y lo dice en
  el registro.
- `scripts/windows/nexo-avisar-enlace.ps1`: ya avisa sólo cuando `remoteUrl` cambia; comprobar que
  con la fija estable no manda nada en cada arranque y que sí avisa si se cae al respaldo.
- Pruebas: argumentos de ssh, validación del ajuste, elección de `remoteUrl` (función pura),
  y que sin el ajuste el lanzador no lanza nada nuevo (`test/launcher-windows.test.js`).

### D4 · Panel y doctor
- Panel (`native/tray/panel*.go`, `native/tray/panel/`), sección «Conexión»: tarjeta «Dirección
  fija» de sólo lectura — dirección, estado (activa / usando respaldo / desactivada) y el enlace
  principal. La configuración se hace con `nexo-dominio.ps1` (no se añade formulario).
  Leer `native/tray/panel/CONTRATO.md` antes de tocar.
- `nexo-doctor.ps1`: comprobaciones «dirección fija» (túnel vivo, `/health` responde por la URL) y
  AVISO si está activa sin credenciales.
- Recompilar `nexo-tray.exe`.

### D5 · 👤 Puesta en marcha (con el dueño presente en el chat)
1. Opus enseña el guion D1 y la llave pública, y **pide el «sí»** para tocar la VM.
2. Ejecuta el guion por SSH; copia la salida a la bitácora.
3. `nexo-dominio.ps1 probar` → `/health` 200 por `https://nexo.nexussoftware.pe`.
4. `activar`, reiniciar NEXO desde el panel, y comprobar desde el navegador integrado que
   `https://nexo.nexussoftware.pe` carga el cliente, pide inicio de sesión y conecta el vídeo.
5. Comprobar que las otras webs siguen respondiendo: `https://nexussoftware.pe/`,
   `https://restaurantes.nexussoftware.pe/`, `https://canazas.nexussoftware.pe/` → 200.

### Cierre de I2
Pruebas completas, bitácora, `README-WINDOWS.md` con una sección «Dirección fija», commits
`I2: …`, etiqueta `i2-ok`, push.

## 4. Fase I3 · Mejoras generales y versión 1.1.0

- **M1 · Una sola versión.** `package.json` dice `1.0.0` y el instalador `1.0.5`. La versión vive
  en `package.json`; `scripts/windows/package.ps1` la lee como valor por defecto y la pasa a
  `installer/setup.iss` (que ya acepta `/DVersion`). Subir a `1.1.0`.
- **M2 · Temporales huérfanos.** Hay un `.nexo-monitor.json.tmp-15936` en la carpeta de estado.
  `lib/safe.js`, `atomicWriteJson`: borrar el temporal si falla el `rename`; al arrancar el
  servidor, limpiar `*.tmp-<pid>` de más de una hora. Con prueba.
- **M3 · Doctor: binarios al día.** Igual que la comprobación de `nexo-tray.exe`, para
  `nexo-gpu-webrtc.exe` (`gpu-webrtc/*.go`) y `nexo-agent.exe` (`native/agent`).
- **M4 · Doctor: TURN.** Si hay proveedor configurado, llamar a la comprobación y decir si hay
  candidatos `relay`.
- **M5 · 👤 Firewall.** El doctor ve 6 reglas abiertas al perfil Público (node y el puente GPU). El
  agente no toca el firewall: recordárselo al dueño (panel → Conexión).
- **M6 · 👤 Micrófono.** VB-CABLE no está instalado: el micrófono del celular no funciona. Lo
  instala el dueño.
- **M7 · Versión 1.1.0.** `package.ps1`, verificar el paquete (sin rutas ni datos personales, la
  bandeja y el puente nuevos dentro), README con versión y SHA-256. **Publicar la release en GitHub
  sólo con el «sí» del dueño** en esa sesión.
- **Fase L pendiente** (no es de este plan, pero se recuerda): verificar en Linux antes de fusionar
  `windows-port` a `main`; I1–I3 tocan `index.html`, `server.js`, `launcher.js` y `lib/`.

Cierre: pruebas, bitácora, commits `I3: …`, etiqueta `i3-ok`, push.

## 5. Qué necesita Opus del dueño

| Cuándo | Qué |
|---|---|
| I1, al final | Crear la clave TURN de Cloudflare y pegarla en el panel (V7). |
| I1 e I2, al compilar | Cerrar NEXO con «Salir» en la bandeja para recompilar los `.exe`. |
| I2, D5 | El «sí» para ejecutar el guion en la VM y confirmar la huella SSH del servidor. |
| I3 | El «sí» para publicar la 1.1.0; cerrar las reglas públicas del firewall; instalar VB-CABLE. |

## 6. Cómo abrir cada sesión

Mensaje para Opus (cambiar el número de fase):

> Lee `AGENTS.md` y `docs/PLAN-INTERNET.md` enteros. Ejecuta la fase **I1** tal como está escrita,
> con sus verificaciones, y escribe la bitácora en §7 del plan. No empieces la siguiente fase.

## 7. Bitácora

(Opus añade aquí, por fase: qué hizo, salida real de cada verificación, dudas y pendientes 👤.)
