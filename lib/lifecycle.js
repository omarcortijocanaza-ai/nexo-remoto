'use strict';

// Ciclo de vida del lanzador en Windows: instancia única, archivo de PIDs,
// limpieza de huérfanos y petición de parada.
//
// Por qué hace falta (trampas 8 y C12): Windows no tiene SIGTERM, `child.kill()`
// es TerminateProcess y no mata a los nietos. Si el lanzador muere a lo bruto,
// ffmpeg, el puente Pion, el agente y cloudflared quedan vivos ocupando
// puertos y la sesión NVENC, y el siguiente arranque falla con EADDRINUSE.
// Todo lo que aquí se mata se identifica por nombre de imagen *y* por línea de
// órdenes, hora de creación o ruta: los PID se reutilizan y matar uno ajeno
// sería peor que dejar un huérfano.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { atomicWriteJson, readJsonSafe } = require('./safe');
const { killTree } = require('./proc');

const ARCHIVO_PIDS = '.nexo-pids.json';
const ARCHIVO_BLOQUEO = '.nexo-launcher.lock';
const ARCHIVO_PARADA = '.nexo-stop';
// Lo deja `--stop` y lo borra el siguiente arranque: dice a la bandeja que NEXO se
// detuvo a propósito y que no debe relanzarlo (sin él, `nexo-control stop` se
// deshacía solo a los 15 s con la bandeja abierta).
const ARCHIVO_DETENIDO = '.nexo-stopped';

// Imagen que debe tener cada rol registrado en el archivo de PIDs.
const IMAGEN_ESPERADA = { launcher: 'node.exe', server: 'node.exe', gpu: 'node.exe', tunnel: 'cloudflared.exe' };
// Imágenes propias de NEXO que se buscan por ruta del repositorio.
const IMAGENES_PROPIAS = new Set(['nexo-agent.exe', 'nexo-gpu-webrtc.exe']);
const TOLERANCIA_HORA_MS = 5000;

const rutas = stateDir => ({
  pids: path.join(stateDir, ARCHIVO_PIDS),
  bloqueo: path.join(stateDir, ARCHIVO_BLOQUEO),
  parada: path.join(stateDir, ARCHIVO_PARADA),
  detenido: path.join(stateDir, ARCHIVO_DETENIDO)
});

const minus = valor => String(valor || '').toLowerCase();

// Lista los procesos con lo imprescindible para identificarlos. Se usa CIM
// (Win32_Process) porque `tasklist` no da la línea de órdenes ni el padre.
function listProcesses() {
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
    'Get-CimInstance Win32_Process | ForEach-Object {',
    '  [pscustomobject]@{ pid=[int]$_.ProcessId; ppid=[int]$_.ParentProcessId; name=[string]$_.Name; cmd=[string]$_.CommandLine; exe=[string]$_.ExecutablePath;',
    "    created=$(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' }) }",
    '} | ConvertTo-Json -Compress'
  ].join('\n');
  const codificado = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise(resolve => {
    let salida = '';
    let terminado = false;
    const terminar = valor => { if (!terminado) { terminado = true; resolve(valor); } };
    const hijo = spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', codificado], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const limite = setTimeout(() => { try { hijo.kill(); } catch {} terminar([]); }, 20000);
    hijo.stdout.on('data', trozo => { salida += trozo; });
    hijo.on('error', () => { clearTimeout(limite); terminar([]); });
    hijo.on('close', () => {
      clearTimeout(limite);
      try {
        const datos = JSON.parse(salida.trim() || '[]');
        const lista = Array.isArray(datos) ? datos : [datos];
        terminar(lista.map(proceso => ({
          pid: proceso.pid, ppid: proceso.ppid, name: proceso.name, cmd: proceso.cmd, exe: proceso.exe,
          created: proceso.created ? Date.parse(proceso.created) : 0
        })));
      } catch { terminar([]); }
    });
  });
}

function leerPids(stateDir) {
  const datos = readJsonSafe(rutas(stateDir).pids, {});
  return datos && typeof datos === 'object' ? datos : {};
}

function registrarPid(stateDir, rol, pid) {
  const actual = leerPids(stateDir);
  if (pid) actual[rol] = { pid, t: Date.now() };
  else delete actual[rol];
  try { atomicWriteJson(rutas(stateDir).pids, actual, 0o600); } catch {}
}

// Decide qué matar, sin tocar nada: pura, para probarla con listas inventadas.
//  1) Lo registrado en el archivo de PIDs, si el PID sigue siendo *lo mismo*:
//     misma imagen y (hora de creación ≈ hora registrada, o, sin ella, la línea
//     de órdenes nombra el script esperado).
//  2) nexo-agent.exe y nexo-gpu-webrtc.exe cuyo ejecutable está dentro del
//     repositorio y cuyo padre ya no existe (o se va a matar).
//  3) ffmpeg.exe lanzado por NEXO (`-nostdin` + ddagrab/gdigrab) en la misma
//     situación. Una grabación del usuario con ddagrab no lleva `-nostdin` o
//     tiene un padre vivo, así que no se toca.
function planSweep({ processes, pids = {}, selfPid, root }) {
  const porPid = new Map(processes.map(proceso => [proceso.pid, proceso]));
  const objetivos = new Map();
  const raiz = minus(root);

  for (const [rol, entrada] of Object.entries(pids)) {
    const pid = Number(entrada && typeof entrada === 'object' ? entrada.pid : entrada);
    const registrada = entrada && typeof entrada === 'object' ? Number(entrada.t) || 0 : 0;
    if (!pid || pid === selfPid) continue;
    const proceso = porPid.get(pid);
    if (!proceso || minus(proceso.name) !== IMAGEN_ESPERADA[rol]) continue;
    const horaCoincide = registrada && proceso.created && Math.abs(proceso.created - registrada) <= TOLERANCIA_HORA_MS;
    const guion = rol === 'tunnel' ? /cloudflared/i : /(launcher|server|gpu-stream-windows)\.js/i;
    if (horaCoincide || (!registrada && guion.test(proceso.cmd || '')) || (!proceso.created && guion.test(proceso.cmd || ''))) {
      objetivos.set(pid, `${rol} de la ejecución anterior`);
    }
  }

  const padreMuerto = proceso => !porPid.has(proceso.ppid) || objetivos.has(proceso.ppid);
  for (const proceso of processes) {
    if (proceso.pid === selfPid || objetivos.has(proceso.pid)) continue;
    const nombre = minus(proceso.name);
    if (IMAGENES_PROPIAS.has(nombre) && raiz && minus(proceso.exe).startsWith(raiz) && padreMuerto(proceso)) {
      objetivos.set(proceso.pid, `${proceso.name} huérfano`);
    } else if (nombre === 'ffmpeg.exe' && /-nostdin/.test(proceso.cmd || '') && /(ddagrab=|gdigrab)/.test(proceso.cmd || '') && padreMuerto(proceso)) {
      objetivos.set(proceso.pid, 'ffmpeg de NEXO huérfano');
    }
  }
  return [...objetivos].map(([pid, razon]) => ({ pid, razon }));
}

async function barrerHuerfanos({ stateDir, root, log = () => {}, listar = listProcesses, matar = killTree }) {
  const pids = leerPids(stateDir);
  const plan = planSweep({ processes: await listar(), pids, selfPid: process.pid, root });
  for (const { pid, razon } of plan) {
    log(`Limpieza: matando ${razon} (PID ${pid})`);
    await matar(pid, 0);
  }
  return plan;
}

// ¿Es `pid` un lanzador de NEXO vivo? Imagen node.exe y línea de órdenes con launcher.js.
async function esLanzadorVivo(pid, listar = listProcesses) {
  const proceso = (await listar()).find(item => item.pid === pid);
  return Boolean(proceso && minus(proceso.name) === 'node.exe' && /launcher\.js/i.test(proceso.cmd || ''));
}

// Instancia única. `wx` falla si el archivo existe; si el PID que contiene ya no
// es un lanzador vivo, el archivo es de un cierre sucio y se reemplaza.
async function tomarBloqueo(stateDir, { vivo = esLanzadorVivo } = {}) {
  const { bloqueo } = rutas(stateDir);
  fs.mkdirSync(stateDir, { recursive: true });
  for (let intento = 0; intento < 2; intento++) {
    try {
      const fd = fs.openSync(bloqueo, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return { adquirido: true };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(String(fs.readFileSync(bloqueo, 'utf8')).trim());
      if (pid && pid !== process.pid && await vivo(pid)) return { adquirido: false, pid };
      fs.rmSync(bloqueo, { force: true });
    }
  }
  return { adquirido: false, pid: 0 };
}

function soltarBloqueo(stateDir) {
  const { bloqueo } = rutas(stateDir);
  try {
    if (Number(String(fs.readFileSync(bloqueo, 'utf8')).trim()) === process.pid) fs.rmSync(bloqueo, { force: true });
  } catch {}
}

function procesoVivo(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

// Parada ordenada desde fuera (nexo-control stop, bandeja): se deja un archivo
// que el lanzador vigila cada segundo —Windows no entrega SIGTERM a un proceso
// sin consola— y si no obedece a tiempo se mata el árbol. Después se barren los
// huérfanos, de modo que `stop` también limpia tras un cierre sucio.
async function pedirParada({ stateDir, root, esperaMs = 15000, log = () => {}, listar = listProcesses }) {
  const archivos = rutas(stateDir);
  let pid = 0;
  try { pid = Number(String(fs.readFileSync(archivos.bloqueo, 'utf8')).trim()); } catch {}
  let forzada = false;
  if (pid && procesoVivo(pid) && await esLanzadorVivo(pid, listar)) {
    fs.writeFileSync(archivos.parada, String(Date.now()));
    const limite = Date.now() + esperaMs;
    while (procesoVivo(pid) && Date.now() < limite) await new Promise(resolve => setTimeout(resolve, 200));
    if (procesoVivo(pid)) {
      log('El lanzador no respondió a tiempo; se fuerza su cierre');
      forzada = true;
      await killTree(pid, 0);
    }
  }
  const limpiados = await barrerHuerfanos({ stateDir, root, log, listar });
  for (const archivo of [archivos.bloqueo, archivos.parada, archivos.pids]) fs.rmSync(archivo, { force: true });
  try { fs.writeFileSync(archivos.detenido, new Date().toISOString()); } catch {}
  return { habiaLanzador: Boolean(pid), forzada, limpiados: limpiados.length };
}

module.exports = {
  ARCHIVO_PIDS, ARCHIVO_BLOQUEO, ARCHIVO_PARADA, ARCHIVO_DETENIDO,
  barrerHuerfanos, esLanzadorVivo, leerPids, listProcesses, pedirParada, planSweep,
  registrarPid, rutas, soltarBloqueo, tomarBloqueo
};
