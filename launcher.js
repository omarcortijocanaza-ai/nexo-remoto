#!/usr/bin/env node
'use strict';

const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const { defaultStateDir, logsDir } = require('./lib/paths');
const { killTree } = require('./lib/proc');
const { atomicWriteJson } = require('./lib/safe');
const { RotatingLog, maskSecrets } = require('./lib/runtime-log');
const lifecycle = require('./lib/lifecycle');

const esWindows = process.platform === 'win32';
const root = __dirname;
const stateDir = defaultStateDir(root);
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const mode = (process.env.NEXO_MODE || 'both').toLowerCase();
if (!['local', 'remote', 'both'].includes(mode)) throw new Error('NEXO_MODE debe ser local, remote o both');

const statePath = process.env.NEXO_STATE_FILE || path.join(stateDir, '.nexo-state.json');
const stateMode = Number.parseInt(process.env.NEXO_STATE_MODE || '600', 8);
let prior = {};
try { prior = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}
const token = process.env.REMOTE_KEYBOARD_TOKEN || prior.token || crypto.randomBytes(18).toString('base64url');
const port = Number(process.env.REMOTE_KEYBOARD_PORT || 8765);
const children = new Set();
let serverReady = false;
let tunnel = null;
let gpu = null;
let gpuWindowsNoticed = false;
let remoteUrl = '';
let stopping = false;
let tunnelFailures = 0;
let watchdog = null;
let stopWatcher = null;
// Sólo quien tomó el bloqueo limpia archivos al salir: un segundo lanzador que se
// va con «NEXO ya está activo» no debe borrar el archivo de PIDs del que sí corre.
let duenoDelBloqueo = false;
// Un fallo persistente reintentaba cada segundo sin fin y llenaba el registro.
// La espera crece hasta medio minuto y vuelve a cero cuando el hijo arranca.
let serverBackoff = 1000;
let gpuBackoff = 1500;

// En Windows el lanzador escribe su propio registro (no hay `>>` de shell que
// lo haga por él) y siempre enmascarado; en Linux el archivo lo crea nexo-control.
const runtimeLog = esWindows
  ? new RotatingLog({ file: path.join(logsDir(root), 'nexo-runtime.log'), maxBytes: 5 * 1024 * 1024, keep: 3 })
  : null;

// Una consola interactiva muestra los enlaces completos (es lo que el dueño
// necesita ver al arrancar a mano); cualquier otra salida —archivo, tubería,
// servicio— los recibe con el token enmascarado. El archivo de registro, siempre.
function emit(texto, esError = false, aConsola = false) {
  const destino = esError ? process.stderr : process.stdout;
  // En Windows, sin consola interactiva (bandeja, nexo-control) nadie lee la
  // salida estándar y el registro de archivo ya lo tiene todo: no se duplica.
  if (destino.isTTY || !esWindows || aConsola) {
    try { destino.write(destino.isTTY ? texto : maskSecrets(texto)); } catch {}
  }
  if (runtimeLog) runtimeLog.write(texto);
}
const linea = texto => emit(`${texto}\n`);
const lineaError = texto => emit(`${texto}\n`, true);
// Respuestas directas a quien invocó el comando (instancia ya activa, --stop): van a
// la salida estándar aunque no sea una consola, porque alguien las está esperando.
const respuesta = texto => emit(`${texto}\n`, false, true);

function cloudflaredPath() {
  if (process.env.CLOUDFLARED_PATH) return process.env.CLOUDFLARED_PATH;
  if (!esWindows) return path.join(root, 'bin', 'cloudflared');
  const buscado = spawnSync('where.exe', ['cloudflared'], { encoding: 'utf8', windowsHide: true, timeout: 4000 });
  const primera = buscado.status === 0 ? String(buscado.stdout).split(/\r?\n/).map(texto => texto.trim()).find(Boolean) : '';
  return primera || path.join(root, 'bin', 'win', 'cloudflared.exe');
}
const cloudflared = cloudflaredPath();

function saveState(extra = {}) {
  const state = { token, mode, port, localUrl: localUrl(), remoteUrl, updatedAt: new Date().toISOString(), ...extra };
  atomicWriteJson(statePath, state, stateMode);
}

function localIp() {
  try {
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const address of addresses || []) if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  } catch {}
  return '127.0.0.1';
}

function localUrl() { return `http://${localIp()}:${port}/?token=${token}`; }
function remoteAccessUrl() { return remoteUrl ? `${remoteUrl}/?token=${token}` : ''; }

function printAccess() {
  emit('\n╭─ NEXO · ACCESOS ─────────────────────────────────────────\n');
  if (mode !== 'remote') emit(`│ LOCAL    ${localUrl()}\n`);
  if (remoteUrl) emit(`│ INTERNET ${remoteAccessUrl()}\n`);
  else if (mode !== 'local') emit('│ INTERNET conectando…\n');
  emit('╰───────────────────────────────────────────────────────────\n\n');
}

// Windows: los hijos de Node llevan canal IPC para el apagado ordenado
// ({type:'shutdown'}), porque child.kill() es TerminateProcess y no limpia.
function spawnNode(script, env) {
  return spawn(process.execPath, [script], {
    cwd: root,
    env,
    stdio: esWindows ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
}

function registrar(rol, hijo) {
  if (!esWindows || !hijo?.pid) return;
  lifecycle.registrarPid(stateDir, rol, hijo.pid);
}

function startServer() {
  const child = spawnNode('server.js', {
    ...process.env,
    REMOTE_KEYBOARD_TOKEN: token,
    REMOTE_KEYBOARD_PORT: String(port),
    REMOTE_KEYBOARD_HOST: mode === 'remote' ? '127.0.0.1' : '0.0.0.0'
  });
  children.add(child);
  registrar('server', child);
  const output = data => {
    const value = data.toString();
    emit(`[servidor] ${value}`);
    if (!serverReady && value.includes('Teclado remoto activo')) {
      serverReady = true;
      serverBackoff = 1000;
      saveState({ status: 'running' });
      printAccess();
      startGpu();
      if (mode !== 'local') startTunnel();
    }
  };
  child.stdout.on('data', output);
  child.stderr.on('data', data => emit(`[servidor] ${data}`, true));
  child.on('close', code => {
    children.delete(child);
    serverReady = false;
    if (!stopping) {
      const delay = serverBackoff;
      serverBackoff = Math.min(30000, serverBackoff * 2);
      lineaError(`Servidor detenido (${code}); reintentando en ${Math.round(delay / 1000)} s…`);
      setTimeout(startServer, delay);
    }
  });
}

function startGpu() {
  if (gpu || stopping || process.env.NEXO_GPU === '0') return;
  let gpuScript = 'gpu-stream.js';
  if (esWindows) {
    gpuScript = 'gpu-stream-windows.js';
    if (!fs.existsSync(path.join(root, gpuScript))) {
      if (!gpuWindowsNoticed) {
        gpuWindowsNoticed = true;
        linea('Vídeo GPU de Windows todavía no disponible');
      }
      return;
    }
  }
  gpu = spawnNode(gpuScript, process.env);
  const actual = gpu;
  children.add(actual);
  registrar('gpu', actual);
  actual.stdout.on('data', data => { gpuBackoff = 1500; emit(`[gpu] ${data}`); });
  actual.stderr.on('data', data => emit(`[gpu] ${data}`, true));
  actual.on('close', code => {
    children.delete(actual);
    gpu = null;
    if (!stopping) {
      const delay = gpuBackoff;
      gpuBackoff = Math.min(30000, gpuBackoff * 2);
      lineaError(`GPU detenido (${code}); reintentando en ${Math.round(delay / 1000)} s…`);
      setTimeout(startGpu, delay);
    }
  });
}

function startTunnel() {
  if (tunnel || stopping) return;
  if (!fs.existsSync(cloudflared)) {
    // Sin túnel NEXO sigue sirviendo en la red local; tumbarlo todo por esto
    // dejaría al dueño sin acceso alguno. En Linux se conserva el comportamiento.
    const mensaje = `No se encontró cloudflared en ${cloudflared}`;
    if (!esWindows) throw new Error(mensaje);
    lineaError(`${mensaje}. Instálalo con «winget install --id Cloudflare.cloudflared -e»; NEXO sigue sólo en la red local.`);
    return;
  }
  const managedToken = process.env.NEXO_TUNNEL_TOKEN;
  const args = managedToken
    ? ['tunnel', '--no-autoupdate', '--protocol', 'http2', 'run', '--token', managedToken]
    : ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`];
  const actual = spawn(cloudflared, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  tunnel = actual;
  children.add(actual);
  registrar('tunnel', actual);
  const inspect = data => {
    const value = data.toString();
    const found = value.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (found && found[0] !== remoteUrl) {
      remoteUrl = found[0];
      tunnelFailures = 0;
      saveState({ status: 'running' });
      printAccess();
      if (process.env.NEXO_RECREATE_TUNNEL === '1') startWatchdog();
    }
    if (/ERR|error/i.test(value)) emit(`[túnel] ${value}`, true);
  };
  actual.stdout.on('data', inspect);
  actual.stderr.on('data', inspect);
  actual.on('error', error => lineaError(`[túnel] ${error.message}`));
  actual.on('close', code => {
    children.delete(actual);
    tunnel = null;
    remoteUrl = '';
    saveState({ status: stopping ? 'stopped' : 'reconnecting' });
    if (!stopping) { lineaError(`Túnel detenido (${code}); reintentando…`); setTimeout(startTunnel, 1500); }
  });
}

// El vigilante comprobaba el túnel contra una IP de Cloudflare fija: si esa IP
// cambiaba, recreaba un túnel sano en bucle. Ahora usa el DNS del sistema; sólo
// si se define NEXO_WATCHDOG_IP se fuerza esa dirección.
function startWatchdog() {
  if (watchdog) return;
  watchdog = setInterval(() => {
    if (!remoteUrl || !tunnel) return;
    const url = new URL('/health', remoteUrl);
    const opciones = { timeout: 8000 };
    const fija = process.env.NEXO_WATCHDOG_IP;
    if (fija) {
      opciones.lookup = (_hostname, options, callback) => options?.all
        ? callback(null, [{ address: fija, family: 4 }])
        : callback(null, fija, 4);
    }
    const req = https.get(url, opciones, res => {
      res.resume();
      if (res.statusCode === 200) tunnelFailures = 0;
      else tunnelFailures++;
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => {
      if (++tunnelFailures >= 2 && tunnel) {
        lineaError('El acceso externo no responde; recreando el túnel…');
        if (esWindows) killTree(tunnel.pid, 0).catch(() => {});
        else tunnel.kill('SIGTERM');
      }
    });
  }, 30000);
  watchdog.unref();
}

function limpiarAlSalir() {
  clearInterval(stopWatcher);
  if (esWindows && duenoDelBloqueo) {
    lifecycle.soltarBloqueo(stateDir);
    try { fs.rmSync(lifecycle.rutas(stateDir).pids, { force: true }); } catch {}
  }
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  saveState({ status: 'stopped' });
  if (!esWindows) {
    for (const child of children) child.kill('SIGTERM');
    setTimeout(() => process.exit(0), 1200).unref();
    return;
  }
  // Windows: aviso ordenado por IPC a los hijos de Node; el túnel no guarda
  // estado y se corta ya. Quien siga vivo a los 1,5 s cae con taskkill /T /F.
  for (const child of children) {
    if (child === tunnel) continue;
    try { if (child.connected) child.send({ type: 'shutdown' }); } catch {}
  }
  if (tunnel?.pid) killTree(tunnel.pid, 0).catch(() => {});
  const terminar = async () => {
    for (const child of children) if (child.pid) await killTree(child.pid, 0);
    limpiarAlSalir();
    process.exit(0);
  };
  const fin = setInterval(() => { if (!children.size) { clearInterval(fin); clearTimeout(limite); terminar(); } }, 100);
  const limite = setTimeout(() => { clearInterval(fin); terminar(); }, 1500);
}

// Parada desde fuera (nexo-control stop, bandeja). Windows no entrega SIGTERM a
// un proceso sin consola; se deja un archivo y el lanzador lo vigila.
function vigilarParada() {
  const archivo = lifecycle.rutas(stateDir).parada;
  fs.rmSync(archivo, { force: true });
  stopWatcher = setInterval(() => {
    if (fs.existsSync(archivo)) {
      fs.rmSync(archivo, { force: true });
      linea('Parada solicitada; cerrando NEXO…');
      shutdown();
    }
  }, 1000);
  stopWatcher.unref();
}

async function iniciarEnWindows() {
  const bloqueo = await lifecycle.tomarBloqueo(stateDir);
  if (!bloqueo.adquirido) {
    respuesta('NEXO ya está activo');
    process.exit(0);
  }
  duenoDelBloqueo = true;
  // Un cierre sucio anterior pudo dejar ffmpeg, el agente, el puente o
  // cloudflared vivos ocupando los puertos.
  const limpiados = await lifecycle.barrerHuerfanos({ stateDir, root, log: linea });
  if (limpiados.length) linea(`Limpieza de la ejecución anterior: ${limpiados.length} proceso(s)`);
  lifecycle.registrarPid(stateDir, 'launcher', process.pid);
  vigilarParada();
}

async function detenerDesdeFuera() {
  const resultado = await lifecycle.pedirParada({ stateDir, root, log: linea });
  respuesta(resultado.habiaLanzador
    ? `NEXO detenido${resultado.forzada ? ' (a la fuerza)' : ''}${resultado.limpiados ? `; huérfanos limpiados: ${resultado.limpiados}` : ''}`
    : `NEXO no estaba activo${resultado.limpiados ? `; huérfanos limpiados: ${resultado.limpiados}` : ''}`);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
if (esWindows) {
  // Cerrar la ventana de consola o Ctrl+Pausa.
  process.on('SIGBREAK', shutdown);
  process.on('SIGHUP', shutdown);
  process.on('exit', limpiarAlSalir);
}
process.on('uncaughtException', error => { lineaError(error.stack || String(error)); shutdown(); });

if (process.argv.includes('--stop')) {
  if (!esWindows) { lineaError('--stop sólo existe en Windows; en Linux usa nexo-control stop'); process.exit(2); }
  detenerDesdeFuera();
} else if (esWindows) {
  iniciarEnWindows().then(startServer).catch(error => { lineaError(error.stack || String(error)); process.exit(1); });
} else {
  startServer();
}
