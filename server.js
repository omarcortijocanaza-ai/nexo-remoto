#!/usr/bin/env node
'use strict';

const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { WebRtcHost } = require('./webrtc-host');
const { MicrofonoHost } = require('./microfono-host');
const { browserKeyCommand, keyCommand } = require('./keyboard-translation');
// Un mismo servicio atiende la pantalla de inicio de sesion (X11) y la sesion
// Hyprland ya iniciada (Wayland): `entorno.estado()` dice cual hay delante en
// cada momento y `entrada-x11` es el motor para la primera.
const { estado: estadoEntorno, entornoDe } = require('./entorno');
const entradaX11 = require('./entrada-x11');
const { DEFAULT_MAX_AGE_MS, SessionStore, authPath, loadAuth, verifyAuth } = require('./auth-manager');
const { DEFAULT_DEVICE_MAX_AGE_MS, DeviceStore, consumePairing } = require('./device-manager');

const host = process.env.REMOTE_KEYBOARD_HOST || '0.0.0.0';
const port = Number(process.env.REMOTE_KEYBOARD_PORT || 8765);
const gpuEnabled = process.env.NEXO_GPU !== '0';
const gpuBridgePort = Math.max(1024, Math.min(65535, Number(process.env.NEXO_GPU_WEBRTC_PORT) || 9090));
const sessionKind = process.env.NEXO_SESSION_KIND || 'shared';
const alternativeStatePath = process.env.NEXO_ALTERNATIVE_STATE || '/var/lib/nexo-session/.nexo-state.json';
const token = process.env.REMOTE_KEYBOARD_TOKEN || crypto.randomBytes(12).toString('base64url');
const page = fs.readFileSync(path.join(__dirname, 'index.html'));
const micPage = fs.readFileSync(path.join(__dirname, 'microfono.html'));
const micClient = fs.readFileSync(path.join(__dirname, 'microfono-cliente.js'));
// Audio de sostén: dos segundos en bucle a un LSB de amplitud. Inaudible en el
// celular, pero Android lo cuenta como reproducción y saca la notificación de
// medios que impide congelar la pestaña con la pantalla bloqueada. Silencio
// digital puro no sirve: algunos navegadores lo tratan como "no suena nada" y
// retiran la notificación. Se sirve desde aquí porque la CSP es 'self' y una
// URL `data:` quedaría bloqueada.
const micKeepAlive = (() => {
  const rate = 8000, seconds = 2, samples = rate * seconds, data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(i % 160 < 80 ? 1 : -1, i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
})();
const keyboardTranslation = fs.readFileSync(path.join(__dirname, 'keyboard-translation.js'));
const keyboardBackground = fs.readFileSync(path.join(__dirname, 'assets', 'viego-mist-keyboard.webp'));
const viegoWallpaper = fs.readFileSync(path.join(__dirname, 'assets', 'viego-wallpaper.webp'));
const windowsSuperBridge = path.join(__dirname, 'windows-helper', 'dist', 'nexo-super-bridge.exe');
const wlrctl = path.join(__dirname, 'bin', 'wlrctl');
const stateDir = process.env.NEXO_STATE_DIR || __dirname;
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
let queue = Promise.resolve();
const viewers = new Set();
const wsViewers = new Set();
const audioViewers = new Set();
// Los WebSocket del respaldo pueden quedar medio abiertos cuando un teléfono
// cambia de red o el sistema congela el navegador. Sin latido seguían contando
// como espectadores y mantenían grim/pw-record activos indefinidamente.
const websocketHeartbeat = setInterval(() => {
  for (const socket of [...wsViewers, ...audioViewers]) {
    if (socket.destroyed || socket.nexoAlive === false) {
      socket.destroy();
      continue;
    }
    socket.nexoAlive = false;
    try { socket.write(Buffer.from([0x89, 0x00])); } catch { socket.destroy(); }
  }
}, 30000);
websocketHeartbeat.unref();
let streaming = false;
let audioCapture = null;
let audioStarting = false;
let monitor = { name: 'DP-1', x: 0, y: 0, width: 1920, height: 1080 };
let monitors = [];
let selectedMonitorName = process.env.NEXO_MONITOR || '';
const monitorStatePath = process.env.NEXO_MONITOR_STATE || path.join(stateDir, '.nexo-monitor.json');
const gpuProfilePath = process.env.NEXO_GPU_PROFILE_STATE || path.join(stateDir, '.nexo-gpu-profile.json');
const authFile = authPath(stateDir, process.env.NEXO_AUTH_FILE);
const authRequired = sessionKind === 'shared' && process.env.NEXO_REQUIRE_LOGIN !== '0';
const authConfig = authRequired ? loadAuth(authFile) : null;
const authSessions = new SessionStore(Number(process.env.NEXO_SESSION_MAX_AGE_MS) || DEFAULT_MAX_AGE_MS);
setInterval(() => authSessions.prune(), 10 * 60 * 1000).unref();
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const authCookieName = 'nexo_session';
const deviceCookieName = 'nexo_device';
const devicesPath = process.env.NEXO_DEVICES_STATE || path.join(stateDir, '.nexo-devices.json');
const pairingPath = process.env.NEXO_PAIRING_STATE || path.join(stateDir, '.nexo-pairing.json');
const devices = new DeviceStore(devicesPath, Number(process.env.NEXO_DEVICE_MAX_AGE_MS) || DEFAULT_DEVICE_MAX_AGE_MS);
setInterval(() => devices.prune(), 60 * 60 * 1000).unref();
const accessLogPath = path.join(stateDir, 'nexo-access.log');
const filesDir = path.join(stateDir, '.nexo-files');
const maxUploadBytes = Number(process.env.NEXO_MAX_UPLOAD_BYTES) || 100 * 1024 * 1024;
fs.mkdirSync(filesDir, { recursive: true, mode: 0o700 });
if (!selectedMonitorName) {
  try { selectedMonitorName = JSON.parse(fs.readFileSync(monitorStatePath, 'utf8')).name || ''; } catch {}
}
let rtcHost;
let pointerBusy = false;
let pendingPointerMove = null;
const orderedPointerActions = [];
// Waybar, Rofi y otras superficies layer-shell no aparecen en `hyprctl clients`.
// Si el gesto comienza sobre una de ellas, se completa con el puntero virtual
// para que el clic llegue a la superficie bajo el cursor, no a activewindow.
const layerPointerButtons = new Set();
let scrollBusy = false;
let pendingScroll = null;
const startedAt = Date.now();
const diagnosticEvents = [];
let clientDiagnostic = null;
// La ruta del socket NO puede calcularse una vez al arrancar: como servicio,
// NEXO nace antes que la sesion y entonces no existe ninguna firma de Hyprland.
// Se pregunta en cada uso, que ademas sobrevive a cerrar y volver a iniciar
// sesion (la firma cambia).
function hyprSocketPath() {
  return estadoEntorno().socketHyprland || '';
}

function recordDiagnostic(type, status = 'ok', transport = 'http') {
  diagnosticEvents.push({ at: new Date().toISOString(), type, status, transport });
  if (diagnosticEvents.length > 100) diagnosticEvents.splice(0, diagnosticEvents.length - 100);
}

function auditAccess(type, status, label = '') {
  try {
    if (fs.existsSync(accessLogPath) && fs.statSync(accessLogPath).size > 256 * 1024) fs.renameSync(accessLogPath, `${accessLogPath}.1`);
    fs.appendFileSync(accessLogPath, JSON.stringify({ at: new Date().toISOString(), type, status, label: String(label).slice(0, 60) }) + '\n', { mode: 0o600 });
    fs.chmodSync(accessLogPath, 0o600);
  } catch {}
}

function sanitizeClientDiagnostic(value) {
  const allowedTransport = ['connecting', 'rtc', 'gpu', 'fallback'];
  const allowedKeyboard = ['not-requested', 'granted', 'unsupported', 'denied'];
  const allowedBrowser = ['Chrome', 'Edge', 'Firefox', 'Safari', 'Navegador desconocido'];
  return {
    browser: allowedBrowser.includes(value?.browser) ? value.browser : 'Navegador desconocido',
    transport: allowedTransport.includes(value?.transport) ? value.transport : 'connecting',
    fps: Math.max(0, Math.min(240, Number(value?.fps) || 0)),
    rtt: Math.max(0, Math.min(60000, Number(value?.rtt) || 0)),
    bitrateKbps: Math.max(0, Math.min(1000000, Number(value?.bitrateKbps) || 0)),
    packetLoss: Math.max(0, Math.min(100, Number(value?.packetLoss) || 0)),
    jitterMs: Math.max(0, Math.min(60000, Number(value?.jitterMs) || 0)),
    monitor: monitor.name,
    keyboardLock: allowedKeyboard.includes(value?.keyboardLock) ? value.keyboardLock : 'not-requested',
    audio: Boolean(value?.audio),
    updatedAt: new Date().toISOString()
  };
}

// El resumen iguala longitudes y evita que la comparación revele por tiempo
// cuántos caracteres del enlace acertó quien lo está adivinando.
const tokenDigest = crypto.createHash('sha256').update(token).digest();

function tokenMatches(value) {
  if (typeof value !== 'string' || !value) return false;
  return crypto.timingSafeEqual(tokenDigest, crypto.createHash('sha256').update(value).digest());
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req, maxBytes = 4096) {
  return new Promise((resolve, reject) => {
    let body = '', rejected = false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) { rejected = true; reject(new Error('Solicitud demasiado grande')); req.destroy(); }
    });
    req.on('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function cookieValue(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const item of cookies) {
    const [key, ...parts] = item.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

function requestSession(req) {
  if (!authRequired) return { id: 'independent', label: 'NEXO libre' };
  return authSessions.get(cookieValue(req, authCookieName));
}

function isSecureRequest(req) {
  return Boolean(req.socket.encrypted) || String(req.headers['x-forwarded-proto']).toLowerCase() === 'https';
}

function sessionCookie(req, value, maxAgeSeconds) {
  return `${authCookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${isSecureRequest(req) ? '; Secure' : ''}`;
}

// `Lax` y no `Strict`: la primera visita suele llegar desde un enlace pegado en
// otra aplicación, y con `Strict` el navegador no enviaría la cookie en esa
// navegación, mostrando la pantalla de emparejamiento a quien ya está
// emparejado. `Lax` sigue bloqueando peticiones cruzadas que cambien algo.
function deviceCookie(req, value, maxAgeSeconds) {
  return `${deviceCookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${isSecureRequest(req) ? '; Secure' : ''}`;
}

function addCookie(res, value) {
  const prior = res.getHeader('set-cookie');
  res.setHeader('set-cookie', prior ? [].concat(prior, value) : [value]);
}

// Sólo una etiqueta para que el dueño reconozca el aparato en la lista; el
// agente de usuario completo no se guarda en ninguna parte.
function describeClient(req) {
  const agent = String(req.headers['user-agent'] || '');
  const browser = /Edg\//.test(agent) ? 'Edge'
    : /Firefox\//.test(agent) ? 'Firefox'
    : /Chrome\//.test(agent) ? 'Chrome'
    : /Safari\//.test(agent) ? 'Safari'
    : 'Navegador';
  const shape = /Mobile|Android|iPhone|iPad/i.test(agent) ? 'móvil' : 'computadora';
  return `${browser} · ${shape}`;
}

// El registro debe sobrevivir entre intentos: al borrarlo en cuanto expiraba
// `blockedUntil` el contador volvía a uno en cada petición y el bloqueo tras
// cinco fallos nunca llegaba a activarse. Sólo caduca la ventana completa.
function loginBlocked(key) {
  const value = loginAttempts.get(key);
  if (!value) return 0;
  if (Date.now() - value.firstAt >= LOGIN_WINDOW_MS) { loginAttempts.delete(key); return 0; }
  return Math.max(0, value.blockedUntil - Date.now());
}

// El túnel entrega todo desde 127.0.0.1: con la dirección del socket como
// única clave, cinco fallos de un desconocido bloquearían también al dueño.
// La cabecera de origen sólo es creíble cuando llega por el bucle local, es
// decir desde cloudflared; en LAN la envía el propio cliente.
function loginKey(req) {
  const address = req.socket.remoteAddress || 'unknown';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return `lan:${address}`;
  const forwarded = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded ? `remoto:${forwarded.slice(0, 45)}` : `local:${address}`;
}

function registerLoginFailure(key) {
  const now = Date.now(), prior = loginAttempts.get(key);
  for (const [item, value] of loginAttempts) {
    if (now - value.firstAt >= LOGIN_WINDOW_MS) loginAttempts.delete(item);
  }
  const active = prior && now - prior.firstAt < LOGIN_WINDOW_MS;
  const count = active ? prior.count + 1 : 1;
  const blocked = count >= 5;
  loginAttempts.set(key, {
    count: blocked ? 0 : count,
    firstAt: blocked || !active ? now : prior.firstAt,
    blockedUntil: blocked ? now + LOGIN_WINDOW_MS : 0
  });
}

function healthAt(targetPort) {
  return new Promise(resolve => {
    const request = http.get({ host: '127.0.0.1', port: targetPort, path: '/health', timeout: 700 }, response => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
}

// NEXO no pide contraseña por diseño: es el escritorio aislado, y el segundo
// login se reserva para la sesión física. Lo que protege su enlace es la
// puerta común de dispositivos emparejados, que ya se cruzó antes de llegar
// aquí; un curioso sin emparejar no ve la dirección.
async function sessionOptions() {
  if (sessionKind !== 'shared') return { kind: sessionKind, chooser: false };
  let alternative = { available: false, name: 'NEXO', url: '' };
  try {
    const state = JSON.parse(fs.readFileSync(alternativeStatePath, 'utf8'));
    const alternativePort = Number(state.port || 8766);
    if (state.status === 'running' && state.remoteUrl && state.token && await healthAt(alternativePort)) {
      alternative = {
        available: true,
        name: 'NEXO',
        url: `${String(state.remoteUrl).replace(/\/$/, '')}/?token=${encodeURIComponent(state.token)}`
      };
    }
  } catch {}
  return { kind: 'shared', chooser: true, original: { name: 'Mi PC original' }, alternative };
}

function readGpuProfile() {
  try {
    const value = JSON.parse(fs.readFileSync(gpuProfilePath, 'utf8'));
    const fps = Number(value.fps), height = Number(value.height);
    if ([30, 45, 60].includes(fps) && [720, 900, 1080].includes(height)) return { fps, height };
  } catch {}
  return { fps: 60, height: 1080 };
}

function executeWtype(args) {
  // En el greeter no hay Wayland: la misma orden se traduce a XTEST.
  if (estadoEntorno().modo === 'x11') return entradaX11.escribirComoWtype(args);
  return new Promise((resolve, reject) => {
    const child = spawn('wtype', args, { stdio: ['ignore', 'ignore', 'pipe'], env: entornoDe() });
    let err = '';
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(err.trim() || `wtype terminó con ${code}`)));
  });
}

function enqueueInput(task) {
  const job = queue.then(task);
  queue = job.catch(() => {});
  return job;
}

function runWtype(args) {
  return enqueueInput(() => executeWtype(args));
}

function runCommand(command, args, maxBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: entornoDe() });
    const chunks = [];
    let size = 0;
    let err = '';
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0
      ? resolve(Buffer.concat(chunks))
      : reject(new Error(err.trim() || `${command} terminó con ${code}`)));
  });
}

function runCommandInput(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'], env: entornoDe() });
    let err = '';
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(err.trim() || `${command} terminó con ${code}`)));
    child.stdin.end(input);
  });
}

function startCommandInput(command, args, input, readyDelay = 25) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'], env: entornoDe() });
    let settled = false;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const fail = finish(reject);
    child.on('error', fail);
    child.stderr.on('data', chunk => {
      const message = chunk.toString().trim();
      if (message) fail(new Error(message));
    });
    child.stdin.on('error', fail);
    child.stdin.end(input);
    // A paste-once clipboard owner intentionally stays alive until Ctrl+V.
    // Do not wait for its stdin/close callback here: that would wait for the
    // very paste this queued job still has to emit.
    setTimeout(finish(resolve), readyDelay);
  });
}

// El nombre de la ventana no basta: Claude Desktop se anuncia como
// `com.anthropic.Claude` y es Electron puro, asi que caia en la ruta rapida y
// perdia el espacio. Cuando el nombre no delata nada se mira el ejecutable: un
// empaquetado Electron/Chromium siempre lleva estos ficheros al lado.
const MARCAS_ELECTRON = ['chrome_crashpad_handler', 'libffmpeg.so', 'resources.pak'];
const electronPorPid = new Map();

function procesoEsElectron(pid) {
  if (!pid) return false;
  if (electronPorPid.has(pid)) return electronPorPid.get(pid);
  let esElectron = false;
  try {
    const carpeta = path.dirname(fs.readlinkSync(`/proc/${pid}/exe`));
    esElectron = MARCAS_ELECTRON.some(marca => fs.existsSync(path.join(carpeta, marca)));
  } catch {}
  if (electronPorPid.size > 256) electronPorPid.clear();
  electronPorPid.set(pid, esElectron);
  return esElectron;
}

async function activeWindowIsChromium() {
  // En el greeter no hay ventanas que consultar, y ahi `xdotool type` entrega
  // el texto entero sin los problemas de Chromium bajo Wayland.
  if (estadoEntorno().modo !== 'wayland') return false;
  try {
    const active = JSON.parse(await hyprIpc('j/activewindow'));
    const identity = `${active.class || ''} ${active.initialClass || ''} ${active.title || ''}`;
    if (/brave|chrom(?:e|ium)|electron/i.test(identity)) return true;
    return procesoEsElectron(active.pid);
  } catch {
    return false;
  }
}

// Chromium/Brave under native Wayland currently discards an injected KEY_SPACE
// even though it accepts the surrounding keys. A clipboard owner plus Ctrl+V
// produces an actual U+0020 (unlike NBSP).
//
// Todo lo que toca el portapapeles —copiar, pegar y restaurar— va por la cola
// de entrada. Repartirlo en dos colas para ganar unos milisegundos fue lo que
// rompio el tecleo rapido: ver el comentario de `scheduleClipboardRestore`.
const clipboardArgs = ['--type', 'text/plain;charset=utf-8'];
// Texto que hemos dejado nosotros en el portapapeles; `undefined` = es del
// usuario y no se ha tocado.
let clipboardOwnedText;
let clipboardOriginal;
let clipboardRestoreTimer = null;

// La restauracion va en la MISMA cola que las entregas. Estaba en una cola
// aparte, y su `wl-copy` se colaba entre el copiado y el Ctrl+V de la tecla
// siguiente: se pegaba el contenido anterior. Escribiendo rapido en Chromium
// eso sacaba caracteres de hace varias teclas — «rápida, con» salia
// «rápidaácon». Ademas peor: si el `wl-paste` que guarda el original corria
// mientras la restauracion seguia en vuelo, guardaba NUESTRA propia letra como
// «original» y la dejaba pegada para siempre.
//
// El plazo tambien sube: 120 ms es menos de lo que se tarda entre dos teclas,
// asi que la restauracion saltaba constantemente en medio del tecleo. Ahora
// espera a que se deje de escribir.
const CLIPBOARD_RESTORE_MS = Math.max(300, Number(process.env.NEXO_CLIPBOARD_RESTORE_MS) || 1500);

function scheduleClipboardRestore() {
  clearTimeout(clipboardRestoreTimer);
  clipboardRestoreTimer = setTimeout(() => {
    clipboardRestoreTimer = null;
    enqueueInput(async () => {
      if (clipboardOwnedText === undefined) return;
      clipboardOwnedText = undefined;
      const previous = clipboardOriginal;
      clipboardOriginal = undefined;
      if (previous !== undefined) await startCommandInput('wl-copy', clipboardArgs, previous);
    }).catch(() => {});
  }, CLIPBOARD_RESTORE_MS);
}

// No es solo el espacio: dentro de Electron/Chromium tampoco llegaban la coma y
// otros caracteres, porque `wtype` reescribe el mapa de teclas en cada llamada y
// esas ventanas no lo aplican igual que el resto. El pegado no depende del mapa,
// asi que todo el texto que va a una ventana de ese tipo se entrega por aqui.
// Fuera de ellas no cambia nada: se sigue escribiendo con `wtype`, que es mas
// rapido y no toca el portapapeles.
// Letras y numeros sueltos si llegan bien por `wtype` en Chromium: su posicion
// en el mapa que genera wtype coincide con la del teclado real. Lo que se
// pierde son los espacios, las comas y los acentos, y solo para esos hace falta
// el portapapeles. Medido tecla a tecla en una ventana Chromium: «esto es una
// prueba rápida, con acentos: está escrito así» llegaba como
// «estoesunapruebarpidaconacentosestescritoas».
const SEGURO_POR_TECLADO = /^[A-Za-z0-9]$/;

function runChromiumAwareText(texto) {
  return enqueueInput(async () => {
    if (!await activeWindowIsChromium()) {
      return executeWtype(texto === ' ' ? ['-k', 'space'] : ['--', texto]);
    }

    if (SEGURO_POR_TECLADO.test(texto)) return executeWtype(['--', texto]);

    if (clipboardOwnedText === texto) {
      // El portapapeles ya contiene este texto: repetirlo cuesta un `wtype` y
      // nada más. Cada pulsación aplaza la restauración.
      await executeWtype(['-M', 'ctrl', '-k', 'v', '-m', 'ctrl']);
      return scheduleClipboardRestore();
    }

    if (clipboardOwnedText === undefined) {
      // Ya no hace falta esperar a `clipboardTail`: la restauracion corre en
      // esta misma cola, asi que aqui no puede haber una en vuelo.
      try {
        clipboardOriginal = await runCommand('wl-paste', ['--no-newline', '--type', 'text/plain'], 1024 * 1024);
      } catch { clipboardOriginal = undefined; }
    }

    await startCommandInput('wl-copy', clipboardArgs, texto);
    // `startCommandInput` solo espera un plazo fijo, no a que wl-copy sea dueño
    // del portapapeles de verdad. Escribiendo rapido eso hacia que el Ctrl+V
    // pegara el texto del turno anterior: salian letras cambiadas. Medido en una
    // ventana Chromium: «abcdefghij» llegaba como «á csbcdefghij». Se comprueba
    // antes de pegar.
    for (let intento = 0; intento < 3; intento++) {
      let actual;
      try {
        actual = (await runCommand('wl-paste', ['--no-newline', '--type', 'text/plain'], 1024 * 1024)).toString();
      } catch {}
      if (actual === texto) break;
      await new Promise(listo => setTimeout(listo, 15));
    }
    clipboardOwnedText = texto;
    await executeWtype(['-M', 'ctrl', '-k', 'v', '-m', 'ctrl']);
    scheduleClipboardRestore();
  });
}

// Agrupar el tecleo rapido en una sola entrega. Una tecla = un `wl-copy` + un
// Ctrl+V (o un `wtype`) era una carrera por caracter; juntando la rafaga se
// entrega una vez y llega intacta. El retardo es lo bastante corto para no
// notarse al escribir y lo bastante largo para juntar una rafaga real.
const TECLEO_AGRUPAR_MS = Math.max(0, Number(process.env.NEXO_AGRUPAR_MS) || 30);
let textoPendiente = '';
let textoTimer = null;

function encolarTexto(texto) {
  textoPendiente += texto;
  if (!textoTimer) {
    textoTimer = setTimeout(() => {
      vaciarTexto().catch(error => console.error(`Tecleo: ${error.message}`));
    }, TECLEO_AGRUPAR_MS);
  }
  return Promise.resolve();
}

// Cualquier entrada que no sea texto (Enter, flechas, atajos, raton) vacia
// primero lo pendiente, para que no se adelante a lo que ya se habia escrito.
function vaciarTexto() {
  if (textoTimer) {
    clearTimeout(textoTimer);
    textoTimer = null;
  }
  const texto = textoPendiente;
  textoPendiente = '';
  if (!texto) return Promise.resolve();
  // Traza de diagnostico: se enciende creando el archivo `.traza-teclado` en
  // esta carpeta y se apaga borrandolo, sin reiniciar el servidor ni cortar la
  // sesion remota. Sirve para comparar lo que el servidor entrega con lo que
  // acaba apareciendo en pantalla.
  if (fs.existsSync(path.join(__dirname, '.traza-teclado'))) {
    console.error(`Tecleo entrega: ${JSON.stringify(texto)}`);
  }
  return runChromiumAwareText(texto);
}

function runChromiumAwareSpace() {
  return runChromiumAwareText(' ');
}

// Si el servidor se detiene entre el pegado y la restauración, el portapapeles
// se quedaría con un espacio. `wl-copy` se bifurca al arrancar, así que esta
// llamada síncrona devuelve enseguida.
function restoreClipboardOnExit() {
  if (clipboardOwnedText === undefined || clipboardOriginal === undefined) return;
  clipboardOwnedText = undefined;
  try { spawnSync('wl-copy', clipboardArgs, { input: clipboardOriginal, timeout: 1000 }); } catch {}
}

function safeFileName(value) {
  const name = path.basename(String(value || 'archivo')).normalize('NFKC').replace(/[^\p{L}\p{N}_.() -]/gu, '_').slice(0, 120);
  return name && name !== '.' && name !== '..' ? name : `archivo-${Date.now()}`;
}

function listFiles() {
  return fs.readdirSync(filesDir, { withFileTypes: true }).filter(item => item.isFile()).map(item => {
    const stat = fs.statSync(path.join(filesDir, item.name));
    return { name: item.name, size: stat.size, updatedAt: stat.mtime.toISOString() };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function hyprIpc(command) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(hyprSocketPath(), () => socket.end(command));
    const chunks = [];
    socket.on('data', chunk => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString()));
    socket.on('error', reject);
  });
}

// Hyprland 0.55+ evaluates `dispatch` arguments as Lua dispatcher objects.
// The former `dispatch movecursor X Y` wire format is consequently parsed as
// invalid Lua and makes NEXO receive pointer events without applying them.
// JSON string literals are valid Lua literals too and keep selectors/commands
// quoted when they come from compositor state.
function luaString(value) {
  return JSON.stringify(String(value));
}

function luaDispatch(expression) {
  // `eval` is independent from the user's config format. In contrast,
  // `dispatch hl.dsp...` works with Lua configs but is treated as a legacy
  // dispatcher name when the compositor still loads a .conf file.
  return `eval hl.dispatch(${expression})`;
}

async function updateMonitor() {
  try {
    const data = JSON.parse(await hyprIpc('j/monitors')).filter(item => !item.disabled && item.dpmsStatus !== false);
    monitors = data.map(item => ({ name: item.name, description: item.description || item.model || item.name, width: item.width, height: item.height, x: item.x, y: item.y }));
    const selected = data.find(item => item.name === selectedMonitorName)
      || data.find(item => item.x === 0 && item.y === 0)
      || data.find(item => item.focused) || data[0];
    if (selected) {
      selectedMonitorName = selected.name;
      const next = { name: selected.name, x: selected.x, y: selected.y, width: selected.width, height: selected.height };
      const changed = Object.keys(next).some(key => next[key] !== monitor[key]);
      monitor = next;
      fs.writeFileSync(monitorStatePath, JSON.stringify({ name: monitor.name }) + '\n', { mode: 0o600 });
      if (changed) rtcHost?.monitorChanged();
    }
  } catch {}
}

async function selectMonitor(name) {
  await updateMonitor();
  if (!monitors.some(item => item.name === name)) throw new Error('Monitor no disponible');
  selectedMonitorName = name;
  await updateMonitor();
  return monitor;
}

async function streamFrames() {
  if (streaming) return;
  streaming = true;
  while (viewers.size || wsViewers.size) {
    try {
      const frame = await runCommand('grim', ['-o', monitor.name, '-t', 'jpeg', '-q', '48', '-']);
      const header = Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
      for (const res of viewers) {
        if (!res.destroyed && res.writableLength < 400 * 1024) { res.write(header); res.write(frame); res.write('\r\n'); }
      }
      const packet = websocketFrame(frame);
      for (const socket of wsViewers) {
        if (!socket.destroyed && socket.writableLength < 400 * 1024) socket.write(packet);
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  streaming = false;
}

function websocketFrame(payload) {
  let header;
  if (payload.length < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x82;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x82;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

async function startAudioCapture() {
  if (audioCapture || audioStarting || !audioViewers.size) return;
  audioStarting = true;
  let device;
  try { device = (await runCommand('pactl', ['get-default-sink'], 4096)).toString().trim() + '.monitor'; }
  catch { device = 'alsa_output.pci-0000_09_00.4.analog-stereo.monitor'; }
  audioStarting = false;
  if (!audioViewers.size) return;
  audioCapture = spawn('pw-record', [
    `--target=${device.replace(/\.monitor$/, '')}`,
    '--properties={ "stream.capture.sink": true, "media.name": "Nexo System Audio" }',
    '--format=s16', '--rate=48000', '--channels=2',
    '--latency=40ms', '--raw', '-'
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  audioCapture.stdout.on('data', pcm => {
    const packet = websocketFrame(pcm);
    for (const socket of audioViewers) if (!socket.destroyed && socket.writableLength < 128 * 1024) socket.write(packet);
  });
  audioCapture.on('close', () => { audioCapture = null; if (audioViewers.size) setTimeout(startAudioCapture, 250); });
  audioCapture.on('error', () => { audioCapture = null; });
}

function stopAudioIfUnused() {
  if (!audioViewers.size && audioCapture) { audioCapture.kill(); audioCapture = null; }
}

async function pointerAction(data) {
  const nx = Math.max(0, Math.min(1, Number(data.x)));
  const ny = Math.max(0, Math.min(1, Number(data.y)));
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new Error('Coordenadas inválidas');
  // En el greeter no hay monitores que consultarle a Hyprland ni ventanas bajo
  // el cursor: es una pantalla y basta con llevar el puntero al pixel.
  if (estadoEntorno().modo === 'x11') {
    // Las coordenadas van referidas a la region que se esta emitiendo (el
    // monitor primario), asi que hay que sumarle su posicion dentro del
    // display: sin el desplazamiento, los clics caen en la otra pantalla.
    const { ancho, alto, x: origenX, y: origenY } = await entradaX11.geometria();
    return entradaX11.puntero({
      ...data,
      x: origenX + Math.round(nx * Math.max(0, ancho - 1)),
      y: origenY + Math.round(ny * Math.max(0, alto - 1))
    });
  }
  const x = monitor.x + Math.round(nx * (monitor.width - 1));
  const y = monitor.y + Math.round(ny * (monitor.height - 1));
  const commands = [luaDispatch(`hl.dsp.cursor.move({ x = ${x}, y = ${y} })`)];
  const button = data.button === 'right' ? 273 : 272;
  const buttonName = data.button === 'right' ? 'right' : 'left';
  let targetAddress = '';
  // `activewindow` era la causa de que un clic remoto nunca cambiara de
  // terminal: el botón se enviaba a la ventana previamente activa, no a la
  // que estaba debajo del cursor. En down/tap enfocamos primero el cliente
  // que contiene las coordenadas; después Hyprland entrega el botón allí.
  if (data.action === 'tap' || data.action === 'down' || data.action === 'dragstart') {
    try {
      const [clients, monitorList, layers] = await Promise.all([
        hyprIpc('j/clients').then(JSON.parse),
        hyprIpc('j/monitors').then(JSON.parse),
        hyprIpc('j/layers').then(JSON.parse).catch(() => ({}))
      ]);
      const controlledMonitor = monitorList.find(item => item.name === monitor.name)
        || monitorList.find(item => item.focused)
        || monitorList[0];
      const visibleWorkspace = controlledMonitor?.activeWorkspace?.id;
      const containsPoint = surface => {
        const [sx, sy] = surface.at || [surface.x, surface.y];
        const [sw, sh] = surface.size || [surface.w, surface.h];
        return [sx, sy, sw, sh].every(Number.isFinite)
          && x >= sx && y >= sy && x < sx + sw && y < sy + sh;
      };
      const layerSurfaces = Object.values(layers).flatMap(output =>
        Object.values(output?.levels || {}).flatMap(level => Array.isArray(level) ? level : []));
      const rofiSurface = clients.find(client => /(^|\b)rofi(\b|$)/i.test(`${client.class || ''} ${client.initialClass || ''} ${client.title || ''}`))
        || layerSurfaces.find(layer => /rofi/i.test(`${layer.namespace || ''} ${layer.name || ''}`));
      // Rofi used to be a layer surface, so clicks outside went straight to
      // the application below without dismissing Start. Close it explicitly;
      // the same click can then continue to its intended window.
      if (rofiSurface && !containsPoint(rofiSurface)) {
        await hyprIpc(luaDispatch(`hl.dsp.exec_cmd(${luaString('pkill -x rofi')})`));
        await new Promise(resolve => setTimeout(resolve, 35));
      }
      const candidates = clients.filter(client => {
        const [cx, cy] = client.at || [], [cw, ch] = client.size || [];
        const visibleHere = client.pinned || client.workspace?.id === visibleWorkspace;
        return visibleHere && client.mapped !== false && !client.hidden
          && client !== rofiSurface
          && x >= cx && y >= cy && x < cx + cw && y < cy + ch;
      }).sort((a, b) => (a.focusHistoryID ?? 999999) - (b.focusHistoryID ?? 999999));
      if (rofiSurface && containsPoint(rofiSurface) && rofiSurface.address) candidates.unshift(rofiSurface);
      targetAddress = candidates[0]?.address || '';
      if (targetAddress) {
        commands.push(luaDispatch(`hl.dsp.focus({ window = ${luaString(`address:${targetAddress}`)} })`));
        // Hyprland may warp the cursor to the centre when focus changes.
        // Put it back on the requested pixel before delivering the button;
        // otherwise popups and small controls receive a click in the middle
        // of their parent window instead of where the user actually clicked.
        commands.push(luaDispatch(`hl.dsp.cursor.move({ x = ${x}, y = ${y} })`));
      }
    } catch (error) { console.error(`Foco bajo cursor: ${error.message}`); }
  }
  let virtualClick = false;
  if (data.action === 'tap') {
    // A compositor-level click follows the real surface under the cursor,
    // including xdg-popups (permission dialogs, menus and dropdowns). Sending
    // the button to `activewindow` bypasses those child surfaces in Chromium.
    virtualClick = true;
  }
  if (data.action === 'down' || data.action === 'dragstart') {
    if (targetAddress) commands.push(luaDispatch(`hl.dsp.send_key_state({ mods = "", key = ${luaString(`mouse:${button}`)}, state = "down", window = "activewindow" })`));
    else layerPointerButtons.add(button);
  }
  if (data.action === 'up') {
    if (layerPointerButtons.delete(button)) virtualClick = true;
    else commands.push(luaDispatch(`hl.dsp.send_key_state({ mods = "", key = ${luaString(`mouse:${button}`)}, state = "up", window = "activewindow" })`));
  }
  if (!['move', 'tap', 'down', 'up', 'dragstart'].includes(data.action)) throw new Error('Acción inválida');
  const response = await hyprIpc(`[[BATCH]]${commands.join(';')}`);
  if (response.split('\n').some(line => line && line !== 'ok')) throw new Error(response.trim());
  if (virtualClick) await runCommand(wlrctl, ['pointer', 'click', buttonName], 4096);
}

function enqueuePointer(data, lossy = false) {
  // Un clic cambia donde va a caer el texto: lo pendiente se entrega antes.
  // Los movimientos no, o no se agruparia nada mientras se mueve el raton.
  if (!lossy) vaciarTexto().catch(() => {});
  if (lossy) pendingPointerMove = data;
  else {
    // Preserve the final pointer position before click/up instead of allowing
    // an old lossy move to run afterwards and make the cursor feel delayed.
    if (pendingPointerMove) {
      orderedPointerActions.push(pendingPointerMove);
      pendingPointerMove = null;
    }
    orderedPointerActions.push(data);
  }
  pumpPointer();
}

async function pumpPointer() {
  if (pointerBusy) return;
  pointerBusy = true;
  try {
    while (orderedPointerActions.length || pendingPointerMove) {
      const data = orderedPointerActions.shift() || pendingPointerMove;
      if (data === pendingPointerMove) pendingPointerMove = null;
      try { await pointerAction(data); } catch (error) { console.error(`Entrada de puntero: ${error.message}`); }
    }
  } finally { pointerBusy = false; }
}

function enqueueScroll(data) {
  const dx = Math.max(-240, Math.min(240, Number(data.dx) || 0));
  const dy = Math.max(-240, Math.min(240, Number(data.dy) || 0));
  const x = Math.max(0, Math.min(1, Number(data.x)));
  const y = Math.max(0, Math.min(1, Number(data.y)));
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Scroll inválido');
  if (!pendingScroll) pendingScroll = { dx: 0, dy: 0, x, y };
  pendingScroll.dx = Math.max(-480, Math.min(480, pendingScroll.dx + dx));
  pendingScroll.dy = Math.max(-480, Math.min(480, pendingScroll.dy + dy));
  pendingScroll.x = x;
  pendingScroll.y = y;
  pumpScroll();
}

async function pumpScroll() {
  if (scrollBusy) return;
  scrollBusy = true;
  try {
    while (pendingScroll) {
      const data = pendingScroll;
      pendingScroll = null;
      await pointerAction({ action: 'move', x: data.x, y: data.y });
      const dx = Math.round(data.dx);
      const dy = Math.round(data.dy);
      if (dx || dy) {
        if (estadoEntorno().modo === 'x11') await entradaX11.scroll(dy, dx);
        else await runCommand(wlrctl, ['pointer', 'scroll', String(dy), String(dx)], 4096);
      }
    }
  } catch (error) { console.error(`Scroll remoto: ${error.message}`); }
  finally { scrollBusy = false; if (pendingScroll) pumpScroll(); }
}

// Atajos del rice publicados por mapa-atajos.py. Hacen falta porque con la
// config Lua de Hyprland los binds se publican como `__lua` + un id de callback
// que no se puede re-despachar, y el compositor tampoco atiende los atajos que
// llegan de un teclado virtual (`wtype -M logo -k a` no dispara nada, medido).
// Lo unico que acepta desde fuera es una expresion Lua, y para eso hay que
// saber que hace cada atajo: eso es lo que trae el mapa.
const mapaAtajosPath = path.join(__dirname, 'mapa-atajos.json');
const generadorAtajos = path.join(__dirname, 'mapa-atajos.py');
const keybindsRice = path.join(process.env.HOME || '', '.config/hypr/conf/keybinds.lua');
let mapaAtajos = null;
let mapaAtajosAt = 0;

function atajoDelRice(clave) {
  try {
    let publicado = 0;
    try { publicado = fs.statSync(mapaAtajosPath).mtimeMs; } catch {}
    // Si el rice cambio sus atajos, se regenera: el mapa nunca queda desfasado.
    if (fs.statSync(keybindsRice).mtimeMs > publicado) {
      spawnSync(process.env.NEXO_PYTHON || 'python3', [generadorAtajos], { timeout: 10000 });
      publicado = fs.statSync(mapaAtajosPath).mtimeMs;
    }
    if (!mapaAtajos || publicado > mapaAtajosAt) {
      mapaAtajos = JSON.parse(fs.readFileSync(mapaAtajosPath, 'utf8'));
      mapaAtajosAt = publicado;
    }
  } catch {
    if (!mapaAtajos) return null;
  }
  return mapaAtajos[clave] || null;
}

let bindCache = { at: 0, items: [] };
async function effectiveBinds() {
  if (Date.now() - bindCache.at < 2000) return bindCache.items;
  const text = (await runCommand('hyprctl', ['binds'], 1024 * 1024)).toString();
  const items = text.split(/\n(?=bind\n)/).map(block => {
    const value = name => block.match(new RegExp(`^\\s*${name}:\\s*(.*)$`, 'm'))?.[1]?.trim() || '';
    return { modmask: Number(value('modmask')), key: value('key'), dispatcher: value('dispatcher'), arg: value('arg') };
  }).filter(item => item.key && item.dispatcher && Number.isFinite(item.modmask));
  bindCache = { at: Date.now(), items };
  return items;
}

async function runHyprShortcut(event) {
  // En el greeter no hay atajos de compositor que resolver: la combinacion se
  // manda tal cual por XTEST, que es lo que espera el dialogo de inicio de
  // sesion (Ctrl+Alt+F2, Alt+F4, Tab entre campos...).
  if (estadoEntorno().modo === 'x11') {
    const combinacion = browserKeyCommand(event);
    if (!combinacion) throw new Error('Entrada inválida');
    return executeWtype(combinacion);
  }
  const keyNames = {
    ' ': 'SPACE', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down'
  };
  const key = keyNames[event.key] || event.key;
  const normalizedKey = String(key).toLowerCase();
  // Alt+Tab/F4 are recovery/window-management actions. Give them precedence
  // even if a browser reports a stale Ctrl/Super bit after fullscreen changes.
  const reservedAltShortcut = event.alt && ['tab', 'f4'].includes(normalizedKey);
  const otherModifiers = (event.shift ? 1 : 0) + (event.ctrl ? 4 : 0) +
    (event.alt ? 8 : 0);
  // El cliente usa `meta` como el modificador principal lógico de NEXO. La
  // sesión independiente conserva SUPER (64), mientras el escritorio físico
  // usa MOD5/AltGr (128). Consultar ambas máscaras permite ejecutar el atajo
  // real de cada compositor sin volver a inyectar AltGr ni Super físicamente.
  const requestedModmasks = reservedAltShortcut ? [8]
    : event.meta ? [otherModifiers + 64, otherModifiers + 128]
      : [otherModifiers];
  // Combinaciones que no se reenvian a la sesion. Una pulsacion mal
  // interpretada por la red apagaria el equipo o cerraria la sesion, y con
  // ella el tunel: no habria forma de volver a entrar. En el teclado fisico
  // siguen funcionando. Vaciar el Set devuelve el comportamiento literal.
  const BLOQUEADOS = new Set(['65:delete', '69:delete', '65:m']);
  if (BLOQUEADOS.has(`${otherModifiers + 64}:${normalizedKey}`)) {
    throw new Error(`Atajo no disponible en remoto: ${key}`);
  }

  const bindings = (await effectiveBinds()).filter(item =>
    requestedModmasks.includes(item.modmask) && item.key.toLowerCase() === normalizedKey);

  // Con config Lua (Hyprland 0.55+) los binds se publican como dispatcher
  // `__lua` mas un id interno, asi que reenviarlos llega al compositor como
  // `hl.dispatch(__lua 6)` -> error de sintaxis, y NINGUN atajo remoto
  // funcionaba. Ese id no se puede re-despachar por IPC, y el compositor
  // tampoco dispara sus atajos desde un teclado virtual. Para esos se usa el
  // mapa que publica el rice, que si trae la accion en Lua.
  const reenviables = bindings.filter(binding => binding.dispatcher !== '__lua');
  if (reenviables.length) {
    const commands = reenviables.map(binding =>
      `dispatch ${binding.dispatcher}${binding.arg ? ` ${binding.arg}` : ''}`);
    const response = await hyprIpc(`[[BATCH]]${commands.join(';')}`);
    if (response.split('\n').some(line => line && line !== 'ok')) throw new Error(response.trim());
    return;
  }
  // Se busca solo la familia SUPER aunque el bind exista tambien en MOD5: el
  // rice registra cada atajo con los dos modificadores y ejecutarlo por ambos
  // lo haria dos veces.
  const accionDelRice = bindings.length ? atajoDelRice(`${otherModifiers + 64}:${normalizedKey}`) : null;
  if (accionDelRice) {
    const response = await hyprIpc(luaDispatch(accionDelRice));
    if (response.trim() !== 'ok') throw new Error(response.trim());
    return;
  }

  // Compatibilidad para sesiones con configuraciones incompletas. Las
  // acciones explícitas sólo se usan cuando Hyprland no publicó un bind real.
  const modmask = reservedAltShortcut ? 8
    : (event.meta ? 64 : 0) + otherModifiers;
  const explicit = new Map([
    ['64:space', [`hl.dsp.exec_cmd(${luaString('/usr/local/lib/nexo/windows-start-menu')})`]],
    ['64:s', [`hl.dsp.exec_cmd(${luaString('/usr/local/lib/nexo/windows-start-menu')})`]],
    ['64:r', [`hl.dsp.exec_cmd(${luaString('/usr/local/lib/nexo/windows-start-menu')})`]],
    ['64:e', [`hl.dsp.exec_cmd(${luaString('dolphin')})`]],
    ['64:b', [`hl.dsp.exec_cmd(${luaString('firefox')})`]],
    ['64:q', [`hl.dsp.exec_cmd(${luaString('kitty')})`]],
    ['64:d', [`hl.dsp.exec_cmd(${luaString('/usr/local/lib/nexo/windows-show-desktop')})`]],
    ['64:m', [`hl.dsp.exec_cmd(${luaString('/usr/local/lib/nexo/windows-show-desktop')})`]],
    ['64:i', [`hl.dsp.exec_cmd(${luaString('/usr/local/lib/nexo/windows-quick-settings')})`]],
    ['64:n', [`hl.dsp.exec_cmd(${luaString('swaync-client -t -sw')})`]],
    ['64:up', ['hl.dsp.window.fullscreen({ mode = "fullscreen", action = "set" })']],
    ['64:down', ['hl.dsp.window.fullscreen({ mode = "fullscreen", action = "unset" })']],
    ['8:f4', ['hl.dsp.window.close({ window = "activewindow" })']],
    ['8:tab', ['hl.dsp.window.cycle_next({})', 'hl.dsp.window.alter_zorder({ mode = "top", window = "activewindow" })']]
  ]).get(`${modmask}:${normalizedKey}`);
  if (explicit) {
    const command = explicit.length > 1
      ? `[[BATCH]]${explicit.map(luaDispatch).join(';')}`
      : luaDispatch(explicit[0]);
    const response = await hyprIpc(command);
    if (response.split('\n').some(line => line && line !== 'ok')) throw new Error(response.trim());
    return;
  }
  throw new Error(`No existe atajo del compositor para ${key}`);
}

async function workspaceAction(workspace) {
  const target = typeof workspace === 'number' && Number.isInteger(workspace) && workspace >= 1 && workspace <= 10
    ? String(workspace)
    : ({ next: '+1', previous: '-1' })[workspace];
  if (!target) throw new Error('Escritorio inválido');
  const response = await hyprIpc(luaDispatch(`hl.dsp.focus({ workspace = ${luaString(target)} })`));
  if (response.trim() !== 'ok') throw new Error(response.trim());
}

// Respaldo para clientes antiguos. Las versiones anteriores del cliente no
// conocian AltGr: mandaban la tecla en crudo (`AltGraph`), que aqui no
// significaba nada y acababa en «Entrada inválida», y la tecla siguiente
// llegaba sin Super. Como la pagina se queda cargada en la pestaña durante
// dias, no basta con arreglar el cliente: el servidor arma Super al ver AltGr
// y se lo aplica a la pulsacion siguiente, igual que hace el cliente nuevo.
const ALTGR_VENTANA_MS = 3000;
let altGrArmadoHasta = 0;

function conSuperDeAltGr(valor) {
  // En latam AltGr+Q escribe «@»: el cliente viejo manda ese simbolo, no la
  // tecla. El codigo fisico sigue siendo el bueno.
  let key = valor.key;
  const code = valor.code || '';
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase();
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  // AltGr se expone como Ctrl+Alt en Windows: esos bits se retiran para que
  // llegue Super+tecla y nada mas.
  return { ...valor, key, ctrl: false, alt: false, meta: true };
}

async function inputAction(data) {
  let args;
  if (data.type === 'keyboard' && data.value?.key === 'AltGraph') {
    altGrArmadoHasta = Date.now() + ALTGR_VENTANA_MS;
    return;
  }
  if (data.type === 'keyboard' && data.value && !data.value.meta && Date.now() < altGrArmadoHasta) {
    altGrArmadoHasta = 0;
    data = { ...data, value: conSuperDeAltGr(data.value) };
  }
  if (data.type === 'text' && typeof data.value === 'string' && data.value.length <= 10000) {
    return encolarTexto(data.value);
  }
  if (data.type === 'keyboard' && data.value?.key === ' ' &&
      !data.value.ctrl && !data.value.alt && !data.value.meta) return encolarTexto(' ');
  if (data.type === 'keyboard' && !data.value?.meta && !data.value?.ctrl && !data.value?.alt) {
    // `['--', x]` es texto suelto sin modificadores: letras, la coma, los
    // acentos, los simbolos. Es lo que se agrupa por rafagas.
    const texto = browserKeyCommand(data.value);
    if (texto && texto.length === 2 && texto[0] === '--') return encolarTexto(texto[1]);
  }

  // A partir de aqui ya no es texto: se entrega lo pendiente antes de seguir,
  // para no adelantar un Enter o un atajo a lo que se estaba escribiendo.
  await vaciarTexto();

  if (data.type === 'key' && data.value === 'space') return runChromiumAwareSpace();
  if (data.type === 'key' && typeof data.value === 'string') args = keyCommand(data.value);
  if (data.type === 'keyboard' && (data.value?.meta ||
      (data.value?.alt && ['F4', 'Tab'].includes(data.value.key)))) {
    return runHyprShortcut(data.value);
  }
  if (data.type === 'keyboard') args = browserKeyCommand(data.value);
  // Un rechazo sin decir que tecla era no se puede diagnosticar: aparecian
  // «Entrada inválida» a mansalva mientras alguien escribia y no habia forma de
  // saber cual se estaba perdiendo.
  if (!args) {
    const v = data.value || {};
    throw new Error(`Entrada inválida (tipo=${data.type} key=${JSON.stringify(v.key)} code=${JSON.stringify(v.code)})`);
  }
  if (args.length === 2 && args[0] === '--') return runChromiumAwareText(args[1]);
  await runWtype(args);
}

rtcHost = new WebRtcHost({
  getMonitor: () => monitor,
  getAudioTarget: async () => (await runCommand('pactl', ['get-default-sink'], 4096)).toString().trim(),
  onRealtimeEvent: async data => {
    const eventTypes = ['pointer', 'scroll', 'workspace'];
    const inputTypes = ['text', 'key', 'keyboard'];
    const safeType = data.type === 'input'
      ? `input:${inputTypes.includes(data.inputType) ? data.inputType : 'unknown'}`
      : (eventTypes.includes(data.type) ? data.type : 'unknown');
    recordDiagnostic(safeType, 'received', 'webrtc');
    if (data.type === 'pointer') return enqueuePointer(data, data.action === 'move');
    if (data.type === 'scroll') return enqueueScroll(data);
    if (data.type === 'input') return inputAction({ type: data.inputType, value: data.value });
    if (data.type === 'workspace') return workspaceAction(data.workspace);
    throw new Error('Evento desconocido');
  },
  onLog: message => console.error(message)
});

// El micrófono del celular vive aparte del escritorio remoto: se enciende y se
// apaga solo, sobrevive a que se cierre la pantalla compartida y no toca la
// negociación de vídeo, que ya funciona y no conviene mover.
const micHost = new MicrofonoHost({ onLog: message => console.error(message) });

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/health') return json(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/assets/viego-mist-keyboard.webp') {
    res.writeHead(200, { 'content-type': 'image/webp', 'content-length': keyboardBackground.length, 'cache-control': 'public, max-age=86400' });
    return res.end(keyboardBackground);
  }
  if (req.method === 'GET' && url.pathname === '/assets/viego-wallpaper.webp') {
    res.writeHead(200, { 'content-type': 'image/webp', 'content-length': viegoWallpaper.length, 'cache-control': 'public, max-age=86400' });
    return res.end(viegoWallpaper);
  }
  if (req.method === 'GET' && (url.pathname === '/keyboard-translation.js' || url.pathname === '/keyboard-translation-v3.js')) {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-length': keyboardTranslation.length, 'cache-control': 'no-cache' });
    return res.end(keyboardTranslation);
  }
  if (req.method === 'GET' && url.pathname === '/microfono-cliente.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-length': micClient.length, 'cache-control': 'no-cache' });
    return res.end(micClient);
  }
  if (req.method === 'GET' && url.pathname === '/microfono/sostener.wav') {
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': micKeepAlive.length, 'cache-control': 'public, max-age=86400' });
    return res.end(micKeepAlive);
  }
  if (req.method === 'GET' && url.pathname === '/manifest.webmanifest') {
    return json(res, 200, { name: 'NEXO Control remoto', short_name: 'NEXO', start_url: '/', scope: '/', display: 'standalone', background_color: '#06100e', theme_color: '#07110f', icons: [{ src: '/assets/viego-wallpaper.webp', sizes: '512x512', type: 'image/webp', purpose: 'any maskable' }] });
  }
  if (req.method === 'GET' && url.pathname === '/sw.js') {
    const worker = "const CACHE='nexo-static-v3';const ASSETS=['/assets/viego-wallpaper.webp','/assets/viego-mist-keyboard.webp'];self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));self.addEventListener('fetch',e=>{if(e.request.method==='GET'&&ASSETS.some(a=>new URL(e.request.url).pathname===a))e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))})";
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'service-worker-allowed': '/' });
    return res.end(worker);
  }
  // El enlace con token sigue funcionando, pero deja de ser la credencial: se
  // canjea una vez por una cookie de dispositivo y desaparece de la barra de
  // direcciones. Quien no traiga ninguna de las dos sólo recibe la página, que
  // pedirá un código de emparejamiento.
  let device = devices.get(cookieValue(req, deviceCookieName));
  if (!device && (tokenMatches(url.searchParams.get('token')) || tokenMatches(req.headers['x-remote-token']))) {
    const created = devices.create(describeClient(req));
    device = created.device;
    addCookie(res, deviceCookie(req, created.secret, Math.floor(devices.maxAgeMs / 1000)));
    recordDiagnostic('device:link', 'ok');
    auditAccess('device-pair', 'ok', `enlace · ${created.device.label}`);
    if (req.method === 'GET' && url.pathname === '/' && url.searchParams.has('token')) {
      res.writeHead(302, { location: '/', 'cache-control': 'no-store' });
      return res.end();
    }
  }
  if (req.method === 'POST' && url.pathname === '/pair') {
    const attemptKey = loginKey(req);
    const remaining = loginBlocked(attemptKey);
    if (remaining) return json(res, 429, { error: 'Demasiados intentos; espera antes de reintentar', retryAfterMs: remaining });
    return readJson(req, 1024).then(body => {
      if (!consumePairing(pairingPath, body.code)) {
        registerLoginFailure(attemptKey);
        recordDiagnostic('pair', 'denied');
        auditAccess('pair', 'denied');
        return json(res, 401, { error: 'Código inválido, ya usado o caducado' });
      }
      loginAttempts.delete(attemptKey);
      const created = devices.create(describeClient(req));
      addCookie(res, deviceCookie(req, created.secret, Math.floor(devices.maxAgeMs / 1000)));
      recordDiagnostic('pair', 'ok');
      auditAccess('pair', 'ok', created.device.label);
      return json(res, 200, { ok: true });
    }).catch(error => json(res, 400, { error: error.message }));
  }
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'"
    });
    return res.end(page);
  }
  // La interfaz de micrófono se entrega igual que la principal, antes de exigir
  // dispositivo emparejado: sin la página no habría dónde escribir el código de
  // emparejamiento. Las rutas que mueven audio sí quedan detrás del candado.
  if (req.method === 'GET' && url.pathname === '/microfono') {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'self'; img-src 'self' blob:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'"
    });
    return res.end(micPage);
  }
  if (!device) return json(res, 403, { error: 'Empareja este dispositivo para continuar', pairing: true });
  if (req.method === 'GET' && url.pathname === '/auth/status') {
    const session = requestSession(req);
    return json(res, 200, { required: authRequired, configured: !authRequired || Boolean(authConfig), authenticated: Boolean(session), username: authConfig?.username || (authRequired ? '' : 'nexo') });
  }
  if (req.method === 'POST' && url.pathname === '/auth/login') {
    if (!authRequired) return json(res, 200, { ok: true, required: false });
    if (!authConfig) return json(res, 503, { error: 'Credenciales del equipo original no configuradas' });
    const attemptKey = loginKey(req);
    const remaining = loginBlocked(attemptKey);
    if (remaining) return json(res, 429, { error: 'Demasiados intentos; espera antes de reintentar', retryAfterMs: remaining });
    return readJson(req).then(credentials => {
      if (!verifyAuth(authConfig, credentials.username, credentials.password)) {
        registerLoginFailure(attemptKey);
        recordDiagnostic('auth:login', 'denied');
        auditAccess('login', 'denied');
        return json(res, 401, { error: 'Usuario o contraseña incorrectos' });
      }
      loginAttempts.delete(attemptKey);
      const session = authSessions.create(credentials.label || 'Navegador');
      addCookie(res, sessionCookie(req, session.token, Math.floor(authSessions.maxAgeMs / 1000)));
      recordDiagnostic('auth:login', 'ok');
      auditAccess('login', 'ok', session.label);
      return json(res, 200, { ok: true, username: authConfig.username });
    }).catch(error => json(res, 400, { error: error.message }));
  }
  if (req.method === 'POST' && url.pathname === '/auth/logout') {
    const value = cookieValue(req, authCookieName), session = authSessions.get(value);
    if (session) authSessions.revoke(session.id);
    addCookie(res, sessionCookie(req, '', 0));
    auditAccess('logout', 'ok', session?.label);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname === '/session-options') {
    sessionOptions().then(options => json(res, 200, options));
    return;
  }
  const currentSession = requestSession(req);
  if (authRequired && !currentSession) return json(res, 401, { error: 'Inicia sesión para controlar Mi PC original' });
  if (req.method === 'GET' && url.pathname === '/auth/sessions') {
    return json(res, 200, { currentId: currentSession.id, sessions: authSessions.list() });
  }
  if (req.method === 'GET' && url.pathname === '/devices') {
    return json(res, 200, { currentId: device.id, maxAgeMs: devices.maxAgeMs, devices: devices.list() });
  }
  if (req.method === 'POST' && url.pathname === '/devices/revoke-others') {
    devices.revokeAllExcept(device.id);
    recordDiagnostic('device:revoke', 'ok');
    auditAccess('device-revoke-others', 'ok', device.label);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/devices/')) {
    const id = decodeURIComponent(url.pathname.slice('/devices/'.length));
    // Revocarse a uno mismo cierra la sesión actual; se limpia la cookie para
    // que el navegador no siga presentando un secreto que ya no vale.
    const removed = devices.revoke(id);
    if (removed && id === device.id) addCookie(res, deviceCookie(req, '', 0));
    auditAccess('device-revoke', removed ? 'ok' : 'denied');
    return json(res, removed ? 200 : 404, removed ? { ok: true } : { error: 'Dispositivo no encontrado' });
  }
  if (req.method === 'POST' && url.pathname === '/auth/revoke-others') {
    authSessions.revokeAllExcept(currentSession.id);
    recordDiagnostic('auth:revoke', 'ok');
    auditAccess('revoke-others', 'ok', currentSession.label);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname === '/clipboard') {
    return runCommand('wl-paste', ['--no-newline', '--type', 'text/plain'], 1024 * 1024)
      .then(value => json(res, 200, { text: value.toString('utf8') }))
      .catch(error => json(res, 503, { error: `Portapapeles no disponible: ${error.message}` }));
  }
  if (req.method === 'POST' && url.pathname === '/clipboard') {
    return readJson(req, 1024 * 1024 + 1024).then(value => {
      if (typeof value.text !== 'string' || Buffer.byteLength(value.text) > 1024 * 1024) throw new Error('Texto de portapapeles inválido');
      return startCommandInput('wl-copy', ['--type', 'text/plain;charset=utf-8'], value.text);
    }).then(() => { recordDiagnostic('clipboard', 'ok'); json(res, 200, { ok: true }); })
      .catch(error => json(res, 400, { error: error.message }));
  }
  if (req.method === 'GET' && url.pathname === '/files') return json(res, 200, { files: listFiles(), maxUploadBytes });
  if (req.method === 'POST' && url.pathname === '/files') {
    let headerName = String(req.headers['x-nexo-filename'] || 'archivo');
    try { headerName = decodeURIComponent(headerName); } catch {}
    const requestedName = safeFileName(headerName);
    const finalName = fs.existsSync(path.join(filesDir, requestedName)) ? `${Date.now()}-${requestedName}` : requestedName;
    const target = path.join(filesDir, finalName), temporary = `${target}.upload-${process.pid}`;
    const output = fs.createWriteStream(temporary, { mode: 0o600, flags: 'wx' });
    let size = 0, tooLarge = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxUploadBytes && !tooLarge) { tooLarge = true; output.destroy(); }
      else if (!tooLarge) output.write(chunk);
    });
    req.on('end', () => {
      if (tooLarge) { fs.rmSync(temporary, { force: true }); return json(res, 413, { error: 'El archivo supera el límite permitido' }); }
      output.end(() => {
        try { fs.renameSync(temporary, target); auditAccess('file-upload', 'ok', finalName); json(res, 201, { ok: true, name: finalName, size }); }
        catch (error) { fs.rmSync(temporary, { force: true }); json(res, 500, { error: error.message }); }
      });
    });
    req.on('error', () => { output.destroy(); fs.rmSync(temporary, { force: true }); });
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
    const name = safeFileName(decodeURIComponent(url.pathname.slice('/files/'.length))), target = path.join(filesDir, name);
    try {
      const stat = fs.statSync(target);
      if (!stat.isFile()) throw new Error();
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': stat.size, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'cache-control': 'no-store' });
      return fs.createReadStream(target).pipe(res);
    } catch { return json(res, 404, { error: 'Archivo no encontrado' }); }
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/files/')) {
    const name = safeFileName(decodeURIComponent(url.pathname.slice('/files/'.length)));
    try { fs.unlinkSync(path.join(filesDir, name)); auditAccess('file-delete', 'ok', name); return json(res, 200, { ok: true }); }
    catch { return json(res, 404, { error: 'Archivo no encontrado' }); }
  }
  if (req.method === 'GET' && url.pathname === '/downloads/nexo-super-bridge.exe') {
    try {
      const stat = fs.statSync(windowsSuperBridge);
      res.writeHead(200, {
        'content-type': 'application/vnd.microsoft.portable-executable',
        'content-length': stat.size,
        'content-disposition': 'attachment; filename="nexo-super-bridge.exe"',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      });
      return fs.createReadStream(windowsSuperBridge).pipe(res);
    } catch {
      return json(res, 404, { error: 'Puente para Windows no instalado' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/info') {
    return json(res, 200, { width: monitor.width, height: monitor.height, name: monitor.name, monitors: monitors.map(item => ({ ...item, selected: item.name === monitor.name })), gpuProfile: readGpuProfile(), webrtc: true, rtc: rtcHost.stats() });
  }
  if (req.method === 'GET' && url.pathname === '/diagnostics') {
    return json(res, 200, {
      server: { uptimeMs: Date.now() - startedAt, sessionKind, gpuEnabled },
      monitor: { ...monitor },
      rtc: rtcHost.stats(),
      streams: { jpeg: viewers.size + wsViewers.size, audio: audioViewers.size },
      client: clientDiagnostic,
      lastEvent: diagnosticEvents.at(-1) || null,
      recentEvents: diagnosticEvents.slice(-20)
    });
  }
  if (req.method === 'GET' && url.pathname === '/diagnostics/export') {
    const report = {
      generatedAt: new Date().toISOString(),
      server: { uptimeMs: Date.now() - startedAt, sessionKind, gpuEnabled, node: process.version },
      monitor: { ...monitor }, rtc: rtcHost.stats(),
      streams: { jpeg: viewers.size + wsViewers.size, audio: audioViewers.size },
      recentEvents: diagnosticEvents.slice(-100), files: { count: listFiles().length },
      auth: { required: authRequired, configured: Boolean(authConfig), sessions: authSessions.list().length }
    };
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="nexo-diagnostico.json"', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(report, null, 2) + '\n');
  }
  if (req.method === 'POST' && url.pathname === '/diagnostics/client') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { if ((body += chunk).length > 4096) req.destroy(); });
    req.on('end', () => {
      try { clientDiagnostic = sanitizeClientDiagnostic(JSON.parse(body)); json(res, 200, { ok: true }); }
      catch { json(res, 400, { error: 'Diagnóstico inválido' }); }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/gpu-profile') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { if ((body += chunk).length > 2048) req.destroy(); });
    req.on('end', () => {
      try {
        const profile = JSON.parse(body);
        const fps = Number(profile.fps), height = Number(profile.height);
        if (![30, 45, 60].includes(fps) || ![720, 900, 1080].includes(height)) throw new Error('Perfil GPU inválido');
        const current = readGpuProfile();
        if (current.fps !== fps || current.height !== height) fs.writeFileSync(gpuProfilePath, JSON.stringify({ fps, height }) + '\n', { mode: 0o600 });
        json(res, 200, { ok: true, fps, height });
      } catch (error) { json(res, 400, { error: error.message }); }
    });
    return;
  }
  if (url.pathname.startsWith('/gpu-webrtc/')) {
    // Cada sesión usa su propio puente. Esto evita que NEXO independiente
    // muestre por error el monitor de la sesión física.
    if (!gpuEnabled) return json(res, 503, { error: 'GPU WebRTC desactivado para esta sesión' });
    const targetPath = url.pathname.replace(/^\/gpu-webrtc/, '');
    const headers = { ...req.headers, host: `127.0.0.1:${gpuBridgePort}` };
    const proxy = http.request({ host: '127.0.0.1', port: gpuBridgePort, method: req.method, path: targetPath, headers }, upstream => {
      res.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(res);
    });
    proxy.on('error', error => json(res, 502, { error: `GPU WebRTC: ${error.message}` }));
    req.pipe(proxy);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/monitor') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { if ((body += chunk).length > 2048) req.destroy(); });
    req.on('end', async () => {
      try { json(res, 200, { ok: true, monitor: await selectMonitor(JSON.parse(body).name) }); }
      catch (error) { json(res, 400, { error: error.message }); }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/webrtc/offer') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { if ((body += chunk).length > 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      try {
        const offer = JSON.parse(body);
        if (offer.type !== 'offer' || typeof offer.sdp !== 'string') throw new Error('Oferta inválida');
        json(res, 200, await rtcHost.acceptOffer(offer, offer.nexoVideo));
      } catch (error) { json(res, 500, { error: error.message || 'No se pudo iniciar WebRTC' }); }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/microfono/oferta') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { if ((body += chunk).length > 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      try {
        const oferta = JSON.parse(body);
        if (oferta.type !== 'offer' || typeof oferta.sdp !== 'string') throw new Error('Oferta inválida');
        const respuesta = await micHost.aceptarOferta(oferta, { etiqueta: oferta.etiqueta });
        recordDiagnostic('microfono:oferta', 'ok', 'webrtc');
        auditAccess('microfono-on', 'ok', device.label);
        json(res, 200, respuesta);
      } catch (error) {
        recordDiagnostic('microfono:oferta', 'error', 'webrtc');
        json(res, 500, { error: error.message || 'No se pudo abrir el micrófono' });
      }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/microfono/silencio') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { if ((body += chunk).length > 1024) req.destroy(); });
    req.on('end', () => {
      try { json(res, 200, { ok: true, silenciado: micHost.silenciar(JSON.parse(body).silenciado) }); }
      catch (error) { json(res, 400, { error: error.message }); }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/microfono/apagar') {
    micHost.cerrarPar('apagado desde el cliente');
    auditAccess('microfono-off', 'ok', device.label);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname === '/microfono/estado') return json(res, 200, micHost.estado());
  if (req.method === 'GET' && url.pathname === '/screen') {
    return runCommand('grim', ['-t', 'jpeg', '-q', '65', '-'])
      .then(image => {
        res.writeHead(200, {
          'content-type': 'image/jpeg', 'content-length': image.length,
          'cache-control': 'no-store, no-cache, must-revalidate'
        });
        res.end(image);
      })
      .catch(error => json(res, 500, { error: error.message }));
  }
  if (req.method === 'GET' && url.pathname === '/stream') {
    res.writeHead(200, {
      'content-type': 'multipart/x-mixed-replace; boundary=frame',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'connection': 'keep-alive'
    });
    viewers.add(res);
    req.on('close', () => viewers.delete(res));
    streamFrames();
    return;
  }
  if (req.method === 'POST' && url.pathname === '/pointer') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { if ((body += chunk).length > 2048) req.destroy(); });
    req.on('end', async () => {
      try { enqueuePointer(JSON.parse(body)); recordDiagnostic('pointer', 'received'); json(res, 200, { ok: true }); }
      catch (error) { json(res, 400, { error: error.message }); }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/scroll') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { if ((body += chunk).length > 2048) req.destroy(); });
    req.on('end', () => {
      try { enqueueScroll(JSON.parse(body)); recordDiagnostic('scroll', 'received'); json(res, 200, { ok: true }); }
      catch (error) { json(res, 400, { error: error.message }); }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/workspace') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { if ((body += chunk).length > 1024) req.destroy(); });
    req.on('end', async () => {
      try {
        const { workspace } = JSON.parse(body);
        await workspaceAction(workspace);
        recordDiagnostic('workspace');
        json(res, 200, { ok: true });
      } catch (error) {
        json(res, 500, { error: error.message || 'Error interno' });
      }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/input') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > 32768) req.destroy();
    });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        await inputAction(data);
        recordDiagnostic(`input:${data.type || 'unknown'}`);
        json(res, 200, { ok: true });
      } catch (error) {
        json(res, 500, { error: error.message || 'Error interno' });
      }
    });
    return;
  }
  json(res, 404, { error: 'No encontrado' });
});

server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const isVideo = url.pathname === '/live';
    const isAudio = url.pathname === '/audio-live';
    const paired = Boolean(devices.get(cookieValue(req, deviceCookieName))) || tokenMatches(url.searchParams.get('token'));
    if ((!isVideo && !isAudio) || !paired || req.headers.upgrade?.toLowerCase() !== 'websocket') return socket.destroy();
    if (authRequired && !requestSession(req)) return socket.destroy();
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket.setNoDelay(true);
    const group = isAudio ? audioViewers : wsViewers;
    socket.nexoAlive = true;
    socket.setKeepAlive(true, 30000);
    group.add(socket);
    const remove = () => { group.delete(socket); if (isAudio) stopAudioIfUnused(); };
    socket.on('data', chunk => {
      if (!chunk.length) return;
      const opcode = chunk[0] & 0x0f;
      if (opcode === 0x0a) socket.nexoAlive = true;
      if (opcode === 0x08) socket.end(Buffer.from([0x88, 0x00]));
    });
    socket.on('close', remove); socket.on('error', remove); socket.on('end', remove);
    if (isAudio) startAudioCapture(); else streamFrames();
  } catch { socket.destroy(); }
});

// Un puerto ocupado o denegado emitía un evento 'error' sin escuchar, lo que
// mataba el proceso y perdía todas las sesiones autenticadas. Reintentar aquí
// conserva la memoria del servidor y evita el ciclo de reinicios del lanzador.
let listenAttempts = 0;
let announced = false;
server.on('error', error => {
  const retryMs = Math.min(15000, 1000 * 2 ** listenAttempts++);
  console.error(`No se pudo escuchar en ${host}:${port} (${error.code || error.message}); reintentando en ${Math.round(retryMs / 1000)} s`);
  setTimeout(() => server.listen(port, host), retryMs);
});

server.listen(port, host, () => {
  listenAttempts = 0;
  if (!announced) {
    announced = true;
    updateMonitor();
    setInterval(updateMonitor, 10000).unref();
  }
  console.log(`Teclado remoto activo en el puerto ${port}`);
  console.log(`TOKEN=${token}`);
});

process.on('SIGTERM', () => {
  restoreClipboardOnExit();
  clearInterval(websocketHeartbeat);
  rtcHost.close();
  // Se corta el audio en curso, pero los módulos de PipeWire se quedan
  // cargados a propósito: si el micrófono virtual desapareciera en cada
  // reinicio de NEXO, Discord y OBS perderían la entrada que tenían elegida y
  // habría que volver a seleccionarla a mano cada vez.
  micHost.cerrar();
  server.close(() => process.exit(0));
  // `server.close()` espera a que terminen las conexiones abiertas, y un
  // cliente remoto mantiene la suya indefinidamente: el proceso se quedaba
  // colgado, el launcher no podia relevarlo y la sesion remota se caia hasta
  // que alguien lo mataba a mano. Con plazo se cierra igual. `unref` para no
  // retrasar la salida limpia cuando no hay nadie conectado.
  setTimeout(() => process.exit(0), 1500).unref();
});
process.on('exit', restoreClipboardOnExit);
