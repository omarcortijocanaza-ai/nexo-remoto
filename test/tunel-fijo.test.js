'use strict';

// Dirección fija por la VM (plan «Internet», I2): configuración, argumentos de ssh, elección del
// enlace publicado y supervisión del túnel con un ssh y un reloj falsos.

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const test = require('node:test');
const T = require('../lib/tunel-fijo');
const { planSweep } = require('../lib/lifecycle');

const BUENA = { activo: true, url: 'https://nexo.nexussoftware.pe', ssh: { host: '136.248.65.57', usuario: 'nexotunel', puertoRemoto: 5095 } };

test('dominio: acepta la configuración buena y rechaza entera la dudosa', () => {
  assert.deepEqual(T.normalizarDominio(BUENA), BUENA);
  assert.equal(T.normalizarDominio({ ...BUENA, activo: 'sí' }).activo, false);
  assert.deepEqual(T.normalizarDominio({ ...BUENA, url: 'https://nexo.nexussoftware.pe/' }).url, 'https://nexo.nexussoftware.pe');
  for (const malo of [
    { ...BUENA, url: 'http://nexo.nexussoftware.pe' },
    { ...BUENA, url: 'https://nexo.nexussoftware.pe/ruta' },
    { ...BUENA, url: 'https://usuario@nexo.nexussoftware.pe' },
    { ...BUENA, ssh: { ...BUENA.ssh, host: '136.248.65.999' } },
    { ...BUENA, ssh: { ...BUENA.ssh, host: 'vm; rm -rf /' } },
    { ...BUENA, ssh: { ...BUENA.ssh, usuario: 'root -o ProxyCommand=x' } },
    { ...BUENA, ssh: { ...BUENA.ssh, puertoRemoto: 22 } },
    null, 'texto'
  ]) assert.equal(T.normalizarDominio(malo), null, JSON.stringify(malo));
  assert.equal(T.normalizarDominio({ ...BUENA, ssh: { ...BUENA.ssh, host: 'vm.nexussoftware.pe' } }).ssh.host, 'vm.nexussoftware.pe');
});

test('dominio: ssh sólo reenvía 127.0.0.1 de la VM a NEXO, con la huella fijada y sin preguntar', () => {
  const estado = path.join('C:', 'estado');
  const args = T.argumentosSsh({ config: BUENA, stateDir: estado, puertoLocal: 8765 });
  assert.equal(args.at(-1), 'nexotunel@136.248.65.57');
  assert.deepEqual(args.slice(args.indexOf('-R'), args.indexOf('-R') + 2), ['-R', '127.0.0.1:5095:127.0.0.1:8765']);
  for (const opcion of ['BatchMode=yes', 'StrictHostKeyChecking=yes', 'ExitOnForwardFailure=yes', 'IdentitiesOnly=yes']) assert.ok(args.includes(opcion), opcion);
  assert.ok(args.includes(`UserKnownHostsFile=${path.join(estado, 'tunel-vm', 'known_hosts')}`));
  assert.equal(args[args.indexOf('-i') + 1], path.join(estado, 'tunel-vm', 'id_ed25519'));
  assert.ok(args.includes('-N'));
  assert.match(T.rutaSsh('win32', { SystemRoot: 'C:\\Windows' }), /System32[\\/]OpenSSH[\\/]ssh\.exe$/);
});

test('dominio: el enlace publicado es el fijo sólo mientras responde', () => {
  assert.equal(T.elegirUrlRemota({ fija: 'https://nexo.nexussoftware.pe', fijaOk: true, tryCloudflare: 'https://a.trycloudflare.com' }), 'https://nexo.nexussoftware.pe');
  assert.equal(T.elegirUrlRemota({ fija: 'https://nexo.nexussoftware.pe', fijaOk: false, tryCloudflare: 'https://a.trycloudflare.com' }), 'https://a.trycloudflare.com');
  assert.equal(T.elegirUrlRemota({ fija: '', fijaOk: true, tryCloudflare: 'https://a.trycloudflare.com' }), 'https://a.trycloudflare.com');
  assert.equal(T.elegirUrlRemota({}), '');
});

test('dominio: no se abre sin llave, sin huella o sin contraseña de «Mi PC»', () => {
  const estado = path.join('C:', 'estado');
  const hay = (...faltan) => ruta => !faltan.some(nombre => ruta.endsWith(nombre));
  assert.equal(T.motivoParaNoAbrir({ config: null, stateDir: estado }), 'desactivada');
  assert.equal(T.motivoParaNoAbrir({ config: { ...BUENA, activo: false }, stateDir: estado }), 'desactivada');
  assert.match(T.motivoParaNoAbrir({ config: BUENA, stateDir: estado, existe: hay('id_ed25519') }), /llave/);
  assert.match(T.motivoParaNoAbrir({ config: BUENA, stateDir: estado, existe: hay('known_hosts') }), /huella/);
  assert.match(T.motivoParaNoAbrir({ config: BUENA, stateDir: estado, existe: hay('.nexo-auth.json') }), /contraseña/);
  assert.equal(T.motivoParaNoAbrir({ config: BUENA, stateDir: estado, existe: () => true }), null);
});

function relojFalso() {
  const tareas = [];
  return {
    tareas,
    setTimeout(fn, ms) { const t = { fn, ms }; tareas.push(t); return t; },
    clearTimeout(t) { const i = tareas.indexOf(t); if (i >= 0) tareas.splice(i, 1); },
    setInterval(fn, ms) { return { fn, ms, intervalo: true }; },
    clearInterval() {},
    // Ejecuta la siguiente espera de `ms` milisegundos.
    async correr(ms) { const i = tareas.findIndex(t => t.ms === ms); assert.ok(i >= 0, `no hay espera de ${ms} ms`); const [t] = tareas.splice(i, 1); await t.fn(); }
  };
}

function sshFalso() {
  const lanzados = [];
  const lanzar = (exe, args) => {
    const hijo = new EventEmitter();
    hijo.pid = 1000 + lanzados.length;
    hijo.stderr = new EventEmitter();
    hijo.kill = () => hijo.emit('close', 0);
    lanzados.push({ exe, args, hijo });
    return hijo;
  };
  return { lanzados, lanzar };
}

test('dominio: el túnel se reabre con espera creciente y avisa al responder y al caer', async () => {
  const reloj = relojFalso(), ssh = sshFalso(), cambios = [], pids = [];
  let responde = true;
  const tunel = T.crearTunelFijo({
    config: BUENA, stateDir: 'C:\\estado', puertoLocal: 8765, lanzar: ssh.lanzar,
    registrarPid: pid => pids.push(pid), alCambiar: ok => cambios.push(ok),
    salud: async () => responde, temporizador: reloj
  });
  assert.equal(ssh.lanzados.length, 1);
  await reloj.correr(4000); // primera comprobación
  assert.equal(tunel.ok, true);
  assert.deepEqual(cambios, [true]);
  // Se cae: deja de estar bien y se reintenta a los 2 s, luego 4 s…
  ssh.lanzados[0].hijo.stderr.emit('data', 'Connection reset by peer\n');
  ssh.lanzados[0].hijo.emit('close', 255);
  assert.equal(tunel.ok, false);
  assert.deepEqual(cambios, [true, false]);
  await reloj.correr(2000);
  assert.equal(ssh.lanzados.length, 2);
  ssh.lanzados[1].hijo.emit('close', 255);
  await reloj.correr(4000 + 0); // la espera ya es de 4 s (hay también una comprobación de 4 s pendiente)
  assert.ok(ssh.lanzados.length >= 2);
  // Al parar se mata el ssh vivo y no se reabre.
  const antes = ssh.lanzados.length;
  tunel.parar();
  assert.equal(reloj.tareas.filter(t => t.ms === 8000).length, 0);
  assert.equal(ssh.lanzados.length, antes);
  assert.ok(pids.includes(1000) && pids.includes(0));
});

test('dominio: la limpieza tras un cierre sucio reconoce el ssh del túnel por su -R y su hora', () => {
  const t = Date.now();
  const procesos = [
    { pid: 50, ppid: 1, name: 'ssh.exe', exe: 'C:\\Windows\\System32\\OpenSSH\\ssh.exe', cmd: 'ssh -N -T -R 127.0.0.1:5095:127.0.0.1:8765 nexotunel@136.248.65.57', created: t },
    { pid: 51, ppid: 1, name: 'ssh.exe', exe: 'C:\\Windows\\System32\\OpenSSH\\ssh.exe', cmd: 'ssh usuario@otra-maquina', created: t }
  ];
  const plan = planSweep({ processes: procesos, pids: { 'tunel-fijo': { pid: 50, t } }, selfPid: 1, root: 'D:\\nexo-remoto' });
  assert.deepEqual(plan.map(p => p.pid), [50]);
  // Un PID reutilizado por otro ssh (sin -R y con otra hora) no se toca.
  const otro = planSweep({ processes: procesos, pids: { 'tunel-fijo': { pid: 51, t: t - 60000 } }, selfPid: 1, root: 'D:\\nexo-remoto' });
  assert.deepEqual(otro, []);
});

test('dominio: el lanzador sólo abre el túnel fijo con la configuración activa y deja intacto el resto', () => {
  const fs = require('node:fs');
  const lanzador = fs.readFileSync(path.join(__dirname, '../launcher.js'), 'utf8');
  // Sin `.nexo-dominio.json` activo no se lanza nada nuevo.
  assert.match(lanzador, /function startTunelFijo\(\) \{\n  if \(tunelFijo \|\| stopping \|\| !dominio\?\.activo\) return;/);
  assert.match(lanzador, /if \(mode !== 'local'\) \{ startTunnel\(\); startTunelFijo\(\); \}/);
  // El vigilante de TryCloudflare comprueba su propia dirección, no la publicada (que puede ser la fija).
  assert.match(lanzador, /const url = new URL\('\/health', urlCloudflare\);/);
  // Los campos nuevos del estado sólo aparecen con la dirección fija activada.
  assert.match(lanzador, /const fija = dominio\?\.activo \? \{ fixedUrl/);
});
