#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Transform, pipeline } = require('stream');
const { WebSocketServer } = require('ws');
const { WebRtcHost } = require('./webrtc-host');
const { MicrofonoHost } = require('./microfono-host');
const { browserKeyCommand } = require('./keyboard-translation');
const platform = require('./platform');
const { defaultStateDir } = require('./lib/paths');
const { crearProveedorIce, cabeceraParaPuente } = require('./lib/ice');
const tlsLan = require('./lib/tls-lan');
const aparienciaCliente = require('./lib/apariencia');
const { crearEstaticos, crearPlantilla } = require('./lib/estaticos');
const { atomicWriteJson, cookieValue, safeDecode } = require('./lib/safe');
const { DEFAULT_MAX_AGE_MS, SessionStore, authPath, loadAuth, verifyAuthAsync } = require('./auth-manager');
const { DEFAULT_DEVICE_MAX_AGE_MS, DeviceStore, consumePairingAsync } = require('./device-manager');

const host = process.env.REMOTE_KEYBOARD_HOST || '0.0.0.0';
const port = Number(process.env.REMOTE_KEYBOARD_PORT || 8765);
const gpuEnabled = process.env.NEXO_GPU !== '0';
const gpuBridgePort = Math.max(1024, Math.min(65535, Number(process.env.NEXO_GPU_WEBRTC_PORT) || 9090));
const sessionKind = process.env.NEXO_SESSION_KIND || 'shared';
const alternativeStatePath = process.env.NEXO_ALTERNATIVE_STATE || '/var/lib/nexo-session/.nexo-state.json';
const token = process.env.REMOTE_KEYBOARD_TOKEN || crypto.randomBytes(12).toString('base64url');
// Las dos páginas se leen de nuevo si el archivo cambia, y cada petición les inyecta la
// apariencia vigente (tema y modo elegidos en el panel), sin reiniciar NEXO.
const page = crearPlantilla(path.join(__dirname, 'index.html'));
const micPage = crearPlantilla(path.join(__dirname, 'microfono.html'));
const estaticos = crearEstaticos({ raiz: __dirname });
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
const stateDir = defaultStateDir(__dirname);
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const lectorApariencia = aparienciaCliente.crearLector(stateDir);
const viewers = new Set();
const wsViewers = new Set();
const audioViewers = new Set();
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
// Los WebSocket del respaldo pueden quedar medio abiertos cuando un teléfono
// cambia de red o el sistema congela el navegador. Sin latido seguían contando
// como espectadores y mantenían grim/pw-record activos indefinidamente.
const websocketHeartbeat = setInterval(() => {
  for (const socket of [...wsViewers, ...audioViewers]) {
    if (socket.readyState !== 1 || socket.nexoAlive === false) {
      socket.terminate();
      continue;
    }
    socket.nexoAlive = false;
    try { socket.ping(); } catch { socket.terminate(); }
  }
}, 15000);
websocketHeartbeat.unref();
let jpegStream = null;
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
let scrollBusy = false;
let pendingScroll = null;
const startedAt = Date.now();
const diagnosticEvents = [];
let clientDiagnostic = null;

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

function sanitizeLogError(error) {
  let msg = String(error?.message || error || 'Error interno');
  if (token) msg = msg.split(token).join('***');
  msg = msg.replace(/(nexo_(?:device|session)=)[^;\s]+/gi, '$1***');
  return msg;
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
  if (!platform.capabilities.independentSession) {
    return {
      kind: 'shared',
      chooser: true,
      original: { name: 'Mi PC', host: os.hostname() },
      alternative: { available: false, supported: false, name: 'NEXO', url: '' }
    };
  }
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
  return { kind: 'shared', chooser: true, original: { name: 'Mi PC original', host: os.hostname() }, alternative };
}

function readGpuProfile() {
  try {
    const value = JSON.parse(fs.readFileSync(gpuProfilePath, 'utf8'));
    const fps = Number(value.fps), height = Number(value.height);
    if ([30, 45, 60].includes(fps) && [720, 900, 1080].includes(height)) return { fps, height };
  } catch {}
  return { fps: 60, height: 1080 };
}

// Agrupar el tecleo rapido en una sola entrega. Una tecla = un `wl-copy` + un
// Ctrl+V (o un `wtype`) era una carrera por caracter; juntando la rafaga se
// entrega una vez y llega intacta. El retardo es lo bastante corto para no
// notarse al escribir y lo bastante largo para juntar una rafaga real.
const TECLEO_AGRUPAR_MS = process.env.NEXO_AGRUPAR_MS !== undefined
  ? Math.max(0, Number(process.env.NEXO_AGRUPAR_MS) || 0)
  : platform.capabilities.textBatchMs;
let textoPendiente = '';
let textoTimer = null;

function encolarTexto(texto) {
  textoPendiente += texto;
  if (TECLEO_AGRUPAR_MS <= 0) {
    return vaciarTexto();
  }
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
  return platform.text(texto);
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

async function updateMonitor() {
  try {
    const data = await platform.listMonitors();
    monitors = data.map(item => ({ name: item.name, description: item.description || item.model || item.name, width: item.width, height: item.height, x: item.x, y: item.y, index: item.index ?? 0, primary: Boolean(item.primary) }));
    const selected = data.find(item => item.name === selectedMonitorName)
      || data.find(item => item.primary || (item.x === 0 && item.y === 0))
      || data.find(item => item.focused) || data[0];
    if (selected) {
      selectedMonitorName = selected.name;
      const next = { name: selected.name, x: selected.x, y: selected.y, width: selected.width, height: selected.height, index: selected.index ?? 0 };
      const changed = Object.keys(next).some(key => next[key] !== monitor[key]);
      monitor = next;
      atomicWriteJson(monitorStatePath, { name: monitor.name }, 0o600);
      if (changed) {
        rtcHost?.monitorChanged();
        if (jpegStream) { jpegStream.stop(); jpegStream = null; streamFrames(); }
      }
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

let keepAwakeActive = false;
let keepAwakeTimer = null;
let currentSecureDesktop = false;

function hasAnyClient() {
  return Boolean(viewers.size || wsViewers.size || audioViewers.size || rtcHost?.peers?.size);
}

function syncKeepAwake() {
  if (hasAnyClient()) {
    if (keepAwakeTimer) {
      clearTimeout(keepAwakeTimer);
      keepAwakeTimer = null;
    }
    if (!keepAwakeActive) {
      keepAwakeActive = true;
      platform.keepAwake(true);
    }
  } else if (keepAwakeActive && !keepAwakeTimer) {
    keepAwakeTimer = setTimeout(() => {
      keepAwakeTimer = null;
      if (!hasAnyClient() && keepAwakeActive) {
        keepAwakeActive = false;
        platform.keepAwake(false);
      }
    }, 60000);
    keepAwakeTimer.unref();
  }
}

setInterval(syncKeepAwake, 2000).unref();

platform.on('desktop-state', state => {
  currentSecureDesktop = state === 'secure';
  const payload = { type: 'secure-desktop', active: currentSecureDesktop };
  rtcHost?.notify(payload);
  const textMsg = JSON.stringify(payload);
  for (const socket of wsViewers) {
    if (socket.readyState === 1) {
      try { socket.send(textMsg); } catch {}
    }
  }
});

platform.on('displays-changed', () => {
  updateMonitor();
});

function stopJpegIfUnused() {
  syncKeepAwake();
  if (!viewers.size && !wsViewers.size && jpegStream) {
    jpegStream.stop();
    jpegStream = null;
  }
}

function streamFrames() {
  syncKeepAwake();
  if (jpegStream || (!viewers.size && !wsViewers.size)) return;
  try {
    jpegStream = platform.startJpegStream({
      monitor,
      fps: 30,
      quality: 48,
      onFrame: frame => {
        if (!viewers.size && !wsViewers.size) {
          stopJpegIfUnused();
          return;
        }
        const header = Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
        for (const res of viewers) {
          if (!res.destroyed && res.writableLength < 400 * 1024) { res.write(header); res.write(frame); res.write('\r\n'); }
        }
        for (const socket of wsViewers) {
          if (socket.readyState === 1 && socket.bufferedAmount < 400 * 1024) {
            socket.send(frame, { binary: true });
          }
        }
      }
    });
  } catch (error) {
    console.error(`Captura JPEG: ${error.message}`);
    jpegStream = null;
  }
}

async function startAudioCapture() {
  syncKeepAwake();
  if (audioCapture || audioStarting || !audioViewers.size) return;
  audioStarting = true;
  let device;
  try { device = (await platform.defaultAudioTarget()) + '.monitor'; }
  catch { device = 'alsa_output.pci-0000_09_00.4.analog-stereo.monitor'; }
  audioStarting = false;
  if (!audioViewers.size) return;
  try {
    audioCapture = platform.spawnSystemAudio({ target: device, latencyMs: 40 });
  } catch (error) {
    console.error(`Audio del sistema: ${error.message}`);
    audioCapture = null;
    return;
  }
  audioCapture.stdout.on('data', pcm => {
    for (const socket of audioViewers) {
      if (socket.readyState === 1 && socket.bufferedAmount < 128 * 1024) {
        socket.send(pcm, { binary: true });
      }
    }
  });
  audioCapture.on('close', () => { audioCapture = null; if (audioViewers.size) setTimeout(startAudioCapture, 250); });
  audioCapture.on('error', () => { audioCapture = null; });
}

function stopAudioIfUnused() {
  syncKeepAwake();
  if (!audioViewers.size && audioCapture) { audioCapture.kill(); audioCapture = null; }
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
      try {
        const nx = Math.max(0, Math.min(1, Number(data.x)));
        const ny = Math.max(0, Math.min(1, Number(data.y)));
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new Error('Coordenadas inválidas');
        await platform.pointer({ ...data, x: nx, y: ny }, monitor);
      } catch (error) { console.error(`Entrada de puntero: ${error.message}`); }
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
      await platform.scroll(data, monitor);
    }
  } catch (error) { console.error(`Scroll remoto: ${error.message}`); }
  finally { scrollBusy = false; if (pendingScroll) pumpScroll(); }
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

  if (data.type === 'key' && data.value === 'space') return platform.text(' ');
  if (data.type === 'key' && typeof data.value === 'string') return platform.namedKey(data.value);
  if (data.type === 'keyboard' && (data.value?.meta ||
      (data.value?.alt && ['F4', 'Tab'].includes(data.value.key)))) {
    return platform.shortcut(data.value);
  }
  if (data.type === 'keyboard') return platform.keyEvent(data.value);
  // Un rechazo sin decir que tecla era no se puede diagnosticar: aparecian
  // «Entrada inválida» a mansalva mientras alguien escribia y no habia forma de
  // saber cual se estaba perdiendo.
  const v = data.value || {};
  throw new Error(`Entrada inválida (tipo=${data.type} key=${JSON.stringify(v.key)} code=${JSON.stringify(v.code)})`);
}

// STUN + TURN (si el dueño configuró uno en el panel); se comparte con el micrófono y con el puente GPU.
const iceProveedor = crearProveedorIce({ stateDir, log: message => console.error(message) });

rtcHost = new WebRtcHost({
  obtenerIce: () => iceProveedor.obtener(),
  getMonitor: () => monitor,
  getAudioTarget: () => platform.defaultAudioTarget(),
  spawnRawVideo: opts => platform.spawnRawVideo(opts),
  spawnSystemAudio: opts => platform.spawnSystemAudio(opts),
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
    if (data.type === 'workspace') return platform.workspace(data.workspace);
    throw new Error('Evento desconocido');
  },
  onLog: message => console.error(message)
});

// El micrófono del celular vive aparte del escritorio remoto: se enciende y se
// apaga solo, sobrevive a que se cierre la pantalla compartida y no toca la
// negociación de vídeo, que ya funciona y no conviene mover.
const micHost = new MicrofonoHost({ onLog: message => console.error(message), obtenerIce: () => iceProveedor.obtener() });

// El mismo manejador atiende HTTP (siempre) y HTTPS en la LAN (si el dueño lo activó en el panel).
function manejarPeticion(req, res) {
  try {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      return json(res, 400, { error: 'URL inválida' });
    }
    if (url.pathname === '/health') return json(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/nexo-lan.cer') {
      const publico = tlsLan.leerCertificadoPublico(stateDir);
      if (!publico) return json(res, 404, { error: 'El HTTPS de la LAN no está activado' });
      res.writeHead(200, { 'content-type': 'application/x-x509-ca-cert', 'content-length': publico.length, 'content-disposition': 'attachment; filename="nexo-lan.cer"', 'cache-control': 'no-store' });
      return res.end(publico);
    }
    // CSS, fuentes y arte del cliente: lista blanca, sin secretos y antes del candado de
    // dispositivos, porque la pantalla de emparejar también necesita verse bien.
    if (estaticos.servir(req, res, url)) return;
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
      const fondoApp = aparienciaCliente.colorDeFondo(lectorApariencia.obtener());
      return json(res, 200, { name: 'NEXO Control remoto', short_name: 'NEXO', start_url: '/', scope: '/', display: 'standalone', background_color: fondoApp, theme_color: fondoApp, icons: [{ src: '/assets/viego-wallpaper.webp', sizes: '512x512', type: 'image/webp', purpose: 'any maskable' }] });
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
    const deviceSecret = cookieValue(req, deviceCookieName);
    let device = devices.get(deviceSecret);
    if (device?.renewed) {
      addCookie(res, deviceCookie(req, deviceSecret, Math.floor(devices.maxAgeMs / 1000)));
    }
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
      return readJson(req, 1024).then(async body => {
        if (!(await consumePairingAsync(pairingPath, body.code))) {
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
      const html = aparienciaCliente.inyectar(page.texto(), lectorApariencia.obtener(), { version: estaticos.version });
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'"
      });
      return res.end(html);
    }
    // La interfaz de micrófono se entrega igual que la principal, antes de exigir
    // dispositivo emparejado: sin la página no habría dónde escribir el código de
    // emparejamiento. Las rutas que mueven audio sí quedan detrás del candado.
    if (req.method === 'GET' && url.pathname === '/microfono') {
      const html = aparienciaCliente.inyectar(micPage.texto(), lectorApariencia.obtener(), { version: estaticos.version });
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; img-src 'self' blob:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'"
      });
      return res.end(html);
    }
    if (!device) return json(res, 403, { error: 'Empareja este dispositivo para continuar', pairing: true });
    // Tema y modo que el dueño eligió en el panel; el cliente lo consulta de vez en cuando
    // para cambiar de apariencia sin recargar la sesión.
    if (req.method === 'GET' && url.pathname === '/apariencia') {
      return json(res, 200, { ...lectorApariencia.obtener(), temas: aparienciaCliente.TEMAS });
    }
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
      return readJson(req).then(async credentials => {
        if (!(await verifyAuthAsync(authConfig, credentials.username, credentials.password))) {
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
      const id = safeDecode(url.pathname.slice('/devices/'.length));
      if (id === null) return json(res, 400, { error: 'Ruta inválida' });
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
      return platform.clipboardGet()
        .then(text => json(res, 200, { text }))
        .catch(error => json(res, 503, { error: `Portapapeles no disponible: ${error.message}` }));
    }
    if (req.method === 'POST' && url.pathname === '/clipboard') {
      return readJson(req, 1024 * 1024 + 1024).then(value => {
        if (typeof value.text !== 'string' || Buffer.byteLength(value.text) > 1024 * 1024) throw new Error('Texto de portapapeles inválido');
        return platform.clipboardSet(value.text);
      }).then(() => { recordDiagnostic('clipboard', 'ok'); json(res, 200, { ok: true }); })
        .catch(error => json(res, 400, { error: error.message }));
    }
    if (req.method === 'GET' && url.pathname === '/files') return json(res, 200, { files: listFiles(), maxUploadBytes });
    if (req.method === 'POST' && url.pathname === '/files') {
      let headerName = String(req.headers['x-nexo-filename'] || 'archivo');
      const decodedHeader = safeDecode(headerName);
      if (decodedHeader !== null) headerName = decodedHeader;
      const requestedName = safeFileName(headerName);
      const finalName = fs.existsSync(path.join(filesDir, requestedName)) ? `${Date.now()}-${requestedName}` : requestedName;
      const target = path.join(filesDir, finalName), temporary = `${target}.upload-${process.pid}`;
      let size = 0;
      const limitStream = new Transform({
        transform(chunk, _encoding, callback) {
          size += chunk.length;
          if (size > maxUploadBytes) {
            const err = new Error('El archivo supera el límite permitido');
            err.tooLarge = true;
            return callback(err);
          }
          callback(null, chunk);
        }
      });
      const output = fs.createWriteStream(temporary, { mode: 0o600, flags: 'wx' });
      pipeline(req, limitStream, output, error => {
        if (error) {
          try { fs.rmSync(temporary, { force: true }); } catch {}
          if (!res.headersSent) {
            if (error.tooLarge) json(res, 413, { error: 'El archivo supera el límite permitido' });
            else json(res, 500, { error: 'No se pudo guardar el archivo' });
          }
          return;
        }
        try {
          fs.renameSync(temporary, target);
          auditAccess('file-upload', 'ok', finalName);
          json(res, 201, { ok: true, name: finalName, size });
        } catch (renameError) {
          try { fs.rmSync(temporary, { force: true }); } catch {}
          if (!res.headersSent) json(res, 500, { error: renameError.message });
        }
      });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
      const rawName = safeDecode(url.pathname.slice('/files/'.length));
      if (rawName === null) return json(res, 400, { error: 'Ruta inválida' });
      const name = safeFileName(rawName), target = path.join(filesDir, name);
      try {
        const stat = fs.statSync(target);
        if (!stat.isFile()) throw new Error();
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': stat.size, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'cache-control': 'no-store' });
        return fs.createReadStream(target).pipe(res);
      } catch { return json(res, 404, { error: 'Archivo no encontrado' }); }
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/files/')) {
      const rawName = safeDecode(url.pathname.slice('/files/'.length));
      if (rawName === null) return json(res, 400, { error: 'Ruta inválida' });
      const name = safeFileName(rawName);
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
        server: { uptimeMs: Date.now() - startedAt, sessionKind, gpuEnabled, platform: platform.name },
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
        server: { uptimeMs: Date.now() - startedAt, sessionKind, gpuEnabled, node: process.version, platform: platform.name },
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
          if (current.fps !== fps || current.height !== height) atomicWriteJson(gpuProfilePath, { fps, height }, 0o600);
          json(res, 200, { ok: true, fps, height });
        } catch (error) { json(res, 400, { error: error.message }); }
      });
      return;
    }
    if (url.pathname.startsWith('/gpu-webrtc/')) {
      const allowedGpuRoute =
        (req.method === 'POST' && url.pathname === '/gpu-webrtc/offer') ||
        (req.method === 'GET' && (url.pathname === '/gpu-webrtc/health' || url.pathname === '/gpu-webrtc/stats'));
      if (!allowedGpuRoute) return json(res, 404, { error: 'No encontrado' });
      // Cada sesión usa su propio puente. Esto evita que NEXO independiente
      // muestre por error el monitor de la sesión física.
      if (!gpuEnabled) return json(res, 503, { error: 'GPU WebRTC desactivado para esta sesión' });
      const targetPath = url.pathname.replace(/^\/gpu-webrtc/, '');
      const reenviar = cabeceraIce => {
        const headers = { host: `127.0.0.1:${gpuBridgePort}` };
        if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
        if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];
        // Sólo se reenvían cabeceras elegidas a mano: un cliente no puede colar su propia X-Nexo-Ice.
        if (cabeceraIce) headers['x-nexo-ice'] = cabeceraIce;
        const proxy = http.request({ host: '127.0.0.1', port: gpuBridgePort, method: req.method, path: targetPath, headers }, upstream => {
          res.writeHead(upstream.statusCode || 502, upstream.headers);
          upstream.pipe(res);
        });
        proxy.on('error', error => json(res, 502, { error: `GPU WebRTC: ${error.message}` }));
        req.pipe(proxy);
      };
      // El puente vive días y las credenciales TURN caducan: cada oferta lleva las vigentes.
      if (req.method === 'POST') iceProveedor.obtener().then(servidores => reenviar(cabeceraParaPuente(servidores)), () => reenviar(null));
      else reenviar(null);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/ice') {
      iceProveedor.obtener().then(iceServers => json(res, 200, { iceServers }), error => json(res, 500, { error: error.message }));
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
          const answer = await rtcHost.acceptOffer(offer, offer.nexoVideo);
          syncKeepAwake();
          json(res, 200, answer);
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
      return platform.screenshotJpeg({ monitor, quality: 65 })
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
      req.on('close', () => { viewers.delete(res); stopJpegIfUnused(); });
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
          await platform.workspace(workspace);
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
  } catch (error) {
    console.error(`Error en petición: ${sanitizeLogError(error)}`);
    if (!res.headersSent) json(res, 500, { error: 'Error interno' });
    else res.destroy();
  }
}
const server = http.createServer(manejarPeticion);

function manejarUpgrade(req, socket, head) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const isVideo = url.pathname === '/live';
    const isAudio = url.pathname === '/audio-live';
    const paired = Boolean(devices.get(cookieValue(req, deviceCookieName))) || tokenMatches(url.searchParams.get('token'));
    if ((!isVideo && !isAudio) || !paired || req.headers.upgrade?.toLowerCase() !== 'websocket') return socket.destroy();
    if (authRequired && !requestSession(req)) return socket.destroy();
    wss.handleUpgrade(req, socket, head, ws => {
      const group = isAudio ? audioViewers : wsViewers;
      ws.nexoAlive = true;
      group.add(ws);
      const remove = () => { group.delete(ws); if (isAudio) stopAudioIfUnused(); else stopJpegIfUnused(); };
      ws.on('pong', () => { ws.nexoAlive = true; });
      ws.on('close', remove);
      ws.on('error', remove);
      if (isVideo && currentSecureDesktop) {
        try { ws.send(JSON.stringify({ type: 'secure-desktop', active: true })); } catch {}
      }
      if (isAudio) startAudioCapture(); else streamFrames();
    });
  } catch { socket.destroy(); }
}
server.on('upgrade', manejarUpgrade);

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

// HTTPS en la LAN (O2): puerto NEXO_TLS_PORT, sólo si el lanzador lo pidió y el equipo escucha en la red.
// Cualquier fallo se anota y NEXO sigue por HTTP: el HTTPS es una mejora, no una dependencia.
let servidorTls = null;
async function iniciarTls() {
  const puertoTls = Number(process.env.NEXO_TLS_PORT) || 0;
  if (!puertoTls) return;
  if (['127.0.0.1', 'localhost', '::1'].includes(host)) {
    console.error('HTTPS LAN omitido: NEXO sólo escucha en esta PC (modo sólo Internet).');
    return;
  }
  const registrar = message => console.error(message);
  try {
    const cert = await tlsLan.asegurarCertificado({ stateDir, log: registrar });
    servidorTls = https.createServer({ pfx: cert.pfx, passphrase: cert.passphrase, minVersion: 'TLSv1.2' }, manejarPeticion);
    servidorTls.on('upgrade', manejarUpgrade);
    servidorTls.on('error', error => registrar(`HTTPS LAN: ${error.code || error.message}`));
    servidorTls.listen(puertoTls, host, () => console.log(`HTTPS en la LAN activo en el puerto ${puertoTls}`));
    // Si la PC cambia de red, el certificado deja de cubrir su IP: se rehace y se cambia en caliente.
    setInterval(async () => {
      try {
        const nuevo = await tlsLan.asegurarCertificado({ stateDir, log: registrar });
        if (nuevo.regenerado) servidorTls.setSecureContext({ pfx: nuevo.pfx, passphrase: nuevo.passphrase });
      } catch (error) { registrar(`HTTPS LAN: no se pudo renovar el certificado (${error.message})`); }
    }, 5 * 60 * 1000).unref();
  } catch (error) {
    registrar(`HTTPS LAN no disponible: ${error.message}`);
  }
}

(async () => {
  await platform.init({ log: message => console.error(message), stateDir });
  await updateMonitor();
  server.listen(port, host, () => {
    listenAttempts = 0;
    if (!announced) {
      announced = true;
      updateMonitor();
      setInterval(updateMonitor, 10000).unref();
    }
    console.log(`Teclado remoto activo en el puerto ${port}`);
    iniciarTls();
  });
})().catch(error => {
  console.error(`Error al iniciar el servidor: ${error.message}`);
  process.exit(1);
});

function shutdownServer() {
  platform.close();
  clearInterval(websocketHeartbeat);
  stopJpegIfUnused();
  rtcHost.close();
  // Se corta el audio en curso, pero los módulos de PipeWire se quedan
  // cargados a propósito: si el micrófono virtual desapareciera en cada
  // reinicio de NEXO, Discord y OBS perderían la entrada que tenían elegida y
  // habría que volver a seleccionarla a mano cada vez.
  micHost.cerrar();
  servidorTls?.close();
  server.close(() => process.exit(0));
  // `server.close()` espera a que terminen las conexiones abiertas, y un
  // cliente remoto mantiene la suya indefinidamente: el proceso se quedaba
  // colgado, el launcher no podia relevarlo y la sesion remota se caia hasta
  // que alguien lo mataba a mano. Con plazo se cierra igual. `unref` para no
  // retrasar la salida limpia cuando no hay nadie conectado.
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGTERM', shutdownServer);
process.on('SIGINT', shutdownServer);
// Windows no tiene SIGTERM: el lanzador pide el apagado por el canal IPC y, si el
// lanzador muere a lo bruto, el canal se cierra y el servidor no se queda huérfano
// ocupando el puerto. En Linux no hay canal IPC: ninguno de los dos eventos ocurre.
process.on('message', mensaje => { if (mensaje && mensaje.type === 'shutdown') shutdownServer(); });
process.on('disconnect', shutdownServer);
process.on('exit', () => platform.close());
