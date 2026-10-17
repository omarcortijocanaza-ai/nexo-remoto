'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const { RotatingLog, maskSecrets } = require('../lib/runtime-log');
const lifecycle = require('../lib/lifecycle');

const ES_WINDOWS = process.platform === 'win32';
const RAIZ = path.resolve(__dirname, '..');

function carpetaTemporal(prefijo) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefijo));
}

test('maskSecrets enmascara el token en enlaces, JSON, cabeceras y cookies', () => {
  assert.equal(maskSecrets('LOCAL http://192.168.1.2:8765/?token=abc123XYZ_-'), 'LOCAL http://192.168.1.2:8765/?token=***');
  assert.equal(maskSecrets('https://x.trycloudflare.com/?token=abc&otro=1'), 'https://x.trycloudflare.com/?token=***&otro=1');
  assert.equal(maskSecrets('{"token":"secreto","port":8765}'), '{"token":"***","port":8765}');
  assert.equal(maskSecrets('x-remote-token: secreto'), 'x-remote-token: ***');
  assert.equal(maskSecrets('Cookie: nexo_device=abcdef; otra=1'), 'Cookie: nexo_device=***; otra=1');
  assert.equal(maskSecrets('sin secretos'), 'sin secretos');
  // El patrón del plan: ningún «token=» sin enmascarar.
  assert.doesNotMatch(maskSecrets('a token=uno b token=dos'), /token=(?!\*\*\*)/);
});

test('RotatingLog rota a 5 MiB × 3 archivos y enmascara al escribir', () => {
  const dir = carpetaTemporal('nexo-log-');
  try {
    const archivo = path.join(dir, 'nexo-runtime.log');
    const registro = new RotatingLog({ file: archivo, maxBytes: 100, keep: 3 });
    registro.write('enlace ?token=secreto-1\n');
    assert.match(fs.readFileSync(archivo, 'utf8'), /token=\*\*\*/);
    assert.doesNotMatch(fs.readFileSync(archivo, 'utf8'), /secreto-1/);
    for (let i = 0; i < 12; i++) registro.write(`linea ${i} `.padEnd(40, 'x') + '\n');
    const archivos = fs.readdirSync(dir).sort();
    assert.deepEqual(archivos, ['nexo-runtime.log', 'nexo-runtime.log.1', 'nexo-runtime.log.2']);
    for (const nombre of archivos) assert.ok(fs.statSync(path.join(dir, nombre)).size <= 140, nombre);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('planSweep sólo mata lo que es de NEXO: mismo nombre y misma hora, no sólo el PID', () => {
  const ahora = Date.now();
  const raiz = 'D:\\nexo-remoto';
  const proc = (pid, ppid, name, cmd = '', exe = '', created = ahora - 60000) => ({ pid, ppid, name, cmd, exe, created });
  const procesos = [
    proc(10, 1, 'node.exe', 'node.exe launcher.js'),                                   // lanzador anterior
    proc(11, 10, 'node.exe', 'node.exe server.js'),                                    // servidor anterior
    proc(20, 1, 'cloudflared.exe', 'cloudflared.exe tunnel', 'C:\\cf\\cloudflared.exe'),
    proc(30, 999, 'nexo-agent.exe', 'nexo-agent.exe serve', `${raiz}\\bin\\win\\nexo-agent.exe`), // padre muerto
    proc(31, 11, 'nexo-agent.exe', 'nexo-agent.exe serve', `${raiz}\\bin\\win\\nexo-agent.exe`),  // hijo de un objetivo
    proc(32, 999, 'nexo-agent.exe', 'nexo-agent.exe serve', 'C:\\Otra\\nexo-agent.exe'),         // fuera del repo
    proc(40, 999, 'ffmpeg.exe', 'ffmpeg -hide_banner -nostdin -f lavfi -i ddagrab=output_idx=0 -f rtp rtp://x'), // de NEXO, huérfano
    proc(41, 999, 'ffmpeg.exe', 'ffmpeg -f lavfi -i ddagrab=output_idx=0 grabacion.mp4'),       // grabación del usuario: sin -nostdin
    proc(42, 4, 'ffmpeg.exe', 'ffmpeg -nostdin -f lavfi -i ddagrab=0 x.mp4'),                  // padre vivo ajeno
    proc(4, 1, 'explorer.exe'),
    proc(50, 1, 'chrome.exe', 'chrome.exe'),                                                   // PID reutilizado por otro programa
    proc(51, 1, 'node.exe', 'node.exe otra-app.js', '', ahora - 1000)                          // otro node, hora distinta
  ];
  const pids = {
    launcher: { pid: 10, t: ahora - 60000 }, server: { pid: 11, t: ahora - 60000 },
    gpu: { pid: 50, t: ahora - 60000 },        // ahora es chrome.exe: no es node.exe → intocable
    tunnel: { pid: 20, t: ahora - 60000 }
  };
  const plan = lifecycle.planSweep({ processes: procesos, pids, selfPid: 77, root: raiz });
  assert.deepEqual(plan.map(item => item.pid).sort((a, b) => a - b), [10, 11, 20, 30, 31, 40]);

  // La hora de creación manda: mismo nombre pero otra hora = otro proceso (PID reutilizado).
  const reutilizado = lifecycle.planSweep({
    processes: [proc(10, 1, 'node.exe', 'node.exe servidor-ajeno.js', '', ahora - 1000)],
    pids: { launcher: { pid: 10, t: ahora - 3600000 } }, selfPid: 77, root: raiz
  });
  assert.deepEqual(reutilizado, []);
  // Nunca se mata a sí mismo.
  assert.deepEqual(lifecycle.planSweep({ processes: [proc(77, 1, 'node.exe', 'node.exe launcher.js')], pids: { launcher: { pid: 77, t: ahora } }, selfPid: 77, root: raiz }), []);
});

test('tomarBloqueo: instancia única; un bloqueo de un cierre sucio se reemplaza', async () => {
  const dir = carpetaTemporal('nexo-lock-');
  try {
    const bloqueo = path.join(dir, '.nexo-launcher.lock');
    const primero = await lifecycle.tomarBloqueo(dir, { vivo: async () => false });
    assert.equal(primero.adquirido, true);
    assert.equal(fs.readFileSync(bloqueo, 'utf8'), String(process.pid));
    // Otro lanzador sin el PID vivo → es un bloqueo muerto.
    fs.writeFileSync(bloqueo, '999999');
    assert.equal((await lifecycle.tomarBloqueo(dir, { vivo: async () => false })).adquirido, true);
    // Con el PID vivo → «ya está activo».
    fs.writeFileSync(bloqueo, '999999');
    const ocupado = await lifecycle.tomarBloqueo(dir, { vivo: async pid => pid === 999999 });
    assert.deepEqual(ocupado, { adquirido: false, pid: 999999 });
    assert.equal(fs.readFileSync(bloqueo, 'utf8'), '999999');
    lifecycle.soltarBloqueo(dir); // no es suyo: no lo borra
    assert.ok(fs.existsSync(bloqueo));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('registrarPid guarda {pid, t} por rol y lo quita con pid vacío', () => {
  const dir = carpetaTemporal('nexo-pids-');
  try {
    lifecycle.registrarPid(dir, 'server', 123);
    lifecycle.registrarPid(dir, 'gpu', 456);
    assert.equal(lifecycle.leerPids(dir).server.pid, 123);
    assert.ok(Math.abs(lifecycle.leerPids(dir).gpu.t - Date.now()) < 5000);
    lifecycle.registrarPid(dir, 'server', 0);
    assert.equal(lifecycle.leerPids(dir).server, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const HAY_AGENTE = ES_WINDOWS && fs.existsSync(path.join(RAIZ, 'bin', 'win', 'nexo-agent.exe'));

test('el lanzador de Windows: arranca, es de instancia única, no escribe el token y se detiene con --stop sin huérfanos',
  { skip: !HAY_AGENTE && 'sólo Windows con bin\\win\\nexo-agent.exe compilado', timeout: 90000 }, async () => {
    const estado = carpetaTemporal('nexo-lanzador-estado-');
    const registros = carpetaTemporal('nexo-lanzador-logs-');
    const puerto = 18000 + Math.floor(Math.random() * 1000);
    const entorno = {
      ...process.env,
      NEXO_STATE_DIR: estado, NEXO_LOGS_DIR: registros, NEXO_MODE: 'local', NEXO_GPU: '0', NEXO_MICROFONO: '0',
      REMOTE_KEYBOARD_PORT: String(puerto), REMOTE_KEYBOARD_HOST: '127.0.0.1', REMOTE_KEYBOARD_TOKEN: 'token-de-prueba-lanzador'
    };
    const salud = () => new Promise(resolve => {
      http.get({ host: '127.0.0.1', port: puerto, path: '/health', timeout: 800 }, res => { res.resume(); resolve(res.statusCode === 200); })
        .on('error', () => resolve(false)).on('timeout', function () { this.destroy(); resolve(false); });
    });
    const esperar = async (condicion, ms) => { for (let t = 0; t < ms && !(await condicion()); t += 250) await new Promise(r => setTimeout(r, 250)); };
    const lanzador = spawn(process.execPath, ['launcher.js'], { cwd: RAIZ, env: entorno, stdio: 'ignore', windowsHide: true });
    try {
      await esperar(salud, 20000);
      assert.equal(await salud(), true, 'el servidor no arrancó');
      assert.equal(fs.readFileSync(path.join(estado, '.nexo-launcher.lock'), 'utf8'), String(lanzador.pid));

      // Segundo lanzador: «NEXO ya está activo», código 0 y el primero intacto.
      const segundo = spawn(process.execPath, ['launcher.js'], { cwd: RAIZ, env: entorno, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let salida = '';
      segundo.stdout.on('data', d => { salida += d; });
      const codigo = await new Promise(resolve => segundo.on('close', resolve));
      assert.equal(codigo, 0);
      assert.match(salida, /NEXO ya está activo/);
      assert.equal(await salud(), true);
      assert.ok(fs.existsSync(path.join(estado, '.nexo-pids.json')), 'el segundo no debe borrar el archivo de PIDs');

      // Registro: existe y no lleva el token.
      const log = fs.readFileSync(path.join(registros, 'nexo-runtime.log'), 'utf8');
      assert.match(log, /Teclado remoto activo/);
      assert.doesNotMatch(log, /token-de-prueba-lanzador/);

      // --stop: parada ordenada y limpieza.
      const parada = spawn(process.execPath, ['launcher.js', '--stop'], { cwd: RAIZ, env: entorno, stdio: 'ignore', windowsHide: true });
      assert.equal(await new Promise(resolve => parada.on('close', resolve)), 0);
      await esperar(async () => !(await salud()), 8000);
      assert.equal(await salud(), false, 'el servidor sigue vivo tras --stop');
      assert.equal(fs.existsSync(path.join(estado, '.nexo-launcher.lock')), false);
      // La bandeja no debe relanzar NEXO tras una parada deliberada.
      assert.equal(fs.existsSync(path.join(estado, '.nexo-stopped')), true, '--stop debe dejar .nexo-stopped');
      // Ningún proceso del árbol del lanzador sobrevive a --stop.
      const restos = await lifecycle.listProcesses();
      assert.deepEqual(restos.filter(p => p.ppid === lanzador.pid).map(p => p.name), [], 'quedaron hijos del lanzador');
    } finally {
      try { process.kill(lanzador.pid); } catch {}
      fs.rmSync(estado, { recursive: true, force: true });
      fs.rmSync(registros, { recursive: true, force: true });
    }
  });
