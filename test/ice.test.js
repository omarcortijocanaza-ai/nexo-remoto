'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const ice = require('../lib/ice');

function carpeta() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-ice-'));
}

const RESPUESTA_CLOUDFLARE = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478'] },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turn:turn.cloudflare.com:3478?transport=tcp',
        'turns:turn.cloudflare.com:5349?transport=tcp',
        'turns:turn.cloudflare.com:443?transport=tcp'
      ],
      username: 'usuario-temporal',
      credential: 'credencial-temporal'
    }
  ]
};

const CF = { proveedor: 'cloudflare', cloudflare: { keyId: 'abcdef0123456789abcdef0123456789', apiToken: 'token-de-prueba-0123456789' } };

test('ice: normalizar descarta lo inválido y degrada a «ninguno» si faltan datos', () => {
  assert.equal(ice.normalizar(undefined).proveedor, 'ninguno');
  assert.equal(ice.normalizar({ proveedor: 'inventado' }).proveedor, 'ninguno');
  assert.equal(ice.normalizar({ proveedor: 'cloudflare', cloudflare: { keyId: 'abcdef0123456789', apiToken: '' } }).proveedor, 'ninguno');
  assert.equal(ice.normalizar({ proveedor: 'manual', manual: { urls: ['http://no-es-ice'] } }).proveedor, 'ninguno');
  assert.equal(ice.normalizar(CF).proveedor, 'cloudflare');
  const manual = ice.normalizar({ proveedor: 'manual', manual: { urls: ['turn:a.net:3478', 'basura', 'turns:a.net:443?transport=tcp'], usuario: 'u', credencial: 'c' } });
  assert.equal(manual.proveedor, 'manual');
  assert.deepEqual(manual.manual.urls, ['turn:a.net:3478', 'turns:a.net:443?transport=tcp']);
});

test('ice: guardarConfig conserva los secretos que el panel no reenvía y describirConfig no los muestra', () => {
  const dir = carpeta();
  ice.guardarConfig(dir, CF);
  const sinToken = ice.guardarConfig(dir, { proveedor: 'cloudflare', cloudflare: { keyId: CF.cloudflare.keyId } });
  assert.equal(sinToken.cloudflare.apiToken, CF.cloudflare.apiToken);
  assert.equal(sinToken.proveedor, 'cloudflare');
  const vista = JSON.stringify(ice.describirConfig(ice.leerConfig(dir)));
  assert.ok(!vista.includes(CF.cloudflare.apiToken), 'la vista pública no debe llevar el token');
  assert.match(vista, /"tieneApiToken":true/);
  const olvidado = ice.guardarConfig(dir, { proveedor: 'cloudflare', cloudflare: { keyId: CF.cloudflare.keyId }, olvidarSecretos: true });
  assert.equal(olvidado.proveedor, 'ninguno');
  assert.equal(olvidado.cloudflare.apiToken, '');
});

test('ice: el archivo de configuración se crea y, fuera de Windows, sólo lo lee el dueño', () => {
  const dir = carpeta();
  ice.guardarConfig(dir, CF);
  const archivo = path.join(dir, ice.NOMBRE_ARCHIVO);
  assert.ok(fs.existsSync(archivo));
  if (process.platform !== 'win32') assert.equal(fs.statSync(archivo).mode & 0o077, 0);
});

test('ice: limpiarCloudflare quita el puerto 53 y lo que no es ICE', () => {
  const limpio = ice.limpiarCloudflare([...RESPUESTA_CLOUDFLARE.iceServers, { urls: ['http://x'] }, null]);
  assert.equal(limpio.length, 2);
  const turn = limpio.find(servidor => servidor.username);
  assert.ok(turn.urls.every(url => !/:53(\?|$)/.test(url)));
  assert.equal(turn.urls.length, 4);
});

test('ice: sin TURN se usa sólo STUN; con TURN manual se añade a STUN', async () => {
  const dir = carpeta();
  const proveedor = ice.crearProveedorIce({ stateDir: dir });
  assert.deepEqual(await proveedor.obtener(), [{ urls: ['stun:stun.cloudflare.com:3478'] }]);
  await assert.rejects(() => proveedor.comprobar(), /No hay un TURN configurado/);

  ice.guardarConfig(dir, { proveedor: 'manual', manual: { urls: ['turn:t.ejemplo.net:3478?transport=udp'], usuario: 'u', credencial: 'c' } });
  const servidores = await proveedor.obtener();
  assert.equal(servidores.length, 2);
  assert.deepEqual(servidores[1], { urls: ['turn:t.ejemplo.net:3478?transport=udp'], username: 'u', credential: 'c' });
});

test('ice: Cloudflare pide credenciales una vez, las reutiliza y las renueva antes de caducar', async () => {
  const dir = carpeta();
  ice.guardarConfig(dir, CF);
  let reloj = 1_000_000;
  const llamadas = [];
  const proveedor = ice.crearProveedorIce({
    stateDir: dir,
    ahora: () => reloj,
    solicitar: async (url, opciones) => { llamadas.push({ url, opciones }); return { estado: 201, json: RESPUESTA_CLOUDFLARE }; }
  });
  const primera = await proveedor.obtener();
  await proveedor.obtener();
  assert.equal(llamadas.length, 1);
  assert.match(llamadas[0].url, /\/v1\/turn\/keys\/abcdef0123456789abcdef0123456789\/credentials\/generate-ice-servers$/);
  assert.equal(llamadas[0].opciones.cabeceras.authorization, `Bearer ${CF.cloudflare.apiToken}`);
  assert.deepEqual(llamadas[0].opciones.cuerpo, { ttl: ice.TTL_SEGUNDOS });
  assert.equal(primera.find(servidor => servidor.username).username, 'usuario-temporal');

  reloj += (ice.TTL_SEGUNDOS - 3600) * 1000; // falta 1 h: dentro del margen de renovación (2 h)
  await proveedor.obtener();
  assert.equal(llamadas.length, 2);
});

test('ice: si Cloudflare falla se vuelve a STUN, no se insiste durante un minuto y se conservan credenciales aún vigentes', async () => {
  const dir = carpeta();
  ice.guardarConfig(dir, CF);
  let reloj = 5_000_000;
  let falla = true;
  let llamadas = 0;
  const proveedor = ice.crearProveedorIce({
    stateDir: dir,
    ahora: () => reloj,
    solicitar: async () => { llamadas++; if (falla) throw new Error('sin red'); return { estado: 201, json: RESPUESTA_CLOUDFLARE }; }
  });
  assert.deepEqual(await proveedor.obtener(), [{ urls: ['stun:stun.cloudflare.com:3478'] }]);
  await proveedor.obtener();
  assert.equal(llamadas, 1, 'durante la espera tras un fallo no se vuelve a llamar');

  reloj += 61_000;
  falla = false;
  const bien = await proveedor.obtener();
  assert.equal(llamadas, 2);
  assert.ok(bien.some(servidor => servidor.username));

  // La renovación falla justo cuando faltan 1 h: las credenciales actuales siguen sirviendo.
  reloj += (ice.TTL_SEGUNDOS - 3600) * 1000;
  falla = true;
  const aunVigentes = await proveedor.obtener();
  assert.ok(aunVigentes.some(servidor => servidor.username));
});

test('ice: los errores de Cloudflare se explican en español', async () => {
  const dir = carpeta();
  ice.guardarConfig(dir, CF);
  const con = estado => ice.crearProveedorIce({ stateDir: dir, solicitar: async () => ({ estado, json: null }) });
  await assert.rejects(() => con(401).comprobar(), /rechazó el token/);
  await assert.rejects(() => con(404).comprobar(), /Key ID/);
  await assert.rejects(() => con(500).comprobar(), /respondió 500/);
  const sinTurn = ice.crearProveedorIce({ stateDir: dir, solicitar: async () => ({ estado: 201, json: { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] } }) });
  await assert.rejects(() => sinTurn.comprobar(), /ningún servidor TURN/);
});

test('ice: solicitarJson habla de verdad con una API HTTP (cabecera Bearer y cuerpo JSON)', async () => {
  let visto = null;
  const servidor = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', trozo => { cuerpo += trozo; });
    req.on('end', () => {
      visto = { metodo: req.method, url: req.url, auth: req.headers.authorization, cuerpo: JSON.parse(cuerpo) };
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify(RESPUESTA_CLOUDFLARE));
    });
  });
  await new Promise(resolver => servidor.listen(0, '127.0.0.1', resolver));
  const anterior = process.env.NEXO_TURN_API_BASE;
  process.env.NEXO_TURN_API_BASE = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const dir = carpeta();
    ice.guardarConfig(dir, CF);
    const servidores = await ice.crearProveedorIce({ stateDir: dir }).comprobar();
    assert.equal(visto.metodo, 'POST');
    assert.equal(visto.auth, `Bearer ${CF.cloudflare.apiToken}`);
    assert.equal(visto.cuerpo.ttl, ice.TTL_SEGUNDOS);
    assert.ok(servidores.some(s => s.username === 'usuario-temporal'));
  } finally {
    if (anterior === undefined) delete process.env.NEXO_TURN_API_BASE; else process.env.NEXO_TURN_API_BASE = anterior;
    await new Promise(resolver => servidor.close(resolver));
  }
});

test('ice: la cabecera para el puente es base64 de JSON y sobrevive a ida y vuelta', () => {
  const lista = [{ urls: ['turn:a.net:3478'], username: 'u', credential: 'c' }];
  const cabecera = ice.cabeceraParaPuente(lista);
  assert.match(cabecera, /^[A-Za-z0-9+/=]+$/);
  assert.deepEqual(JSON.parse(Buffer.from(cabecera, 'base64').toString('utf8')), lista);
});

test('ice: validarEntrada explica en español qué falta antes de guardar', () => {
  const actual = ice.normalizar({});
  assert.match(ice.validarEntrada({ proveedor: 'raro' }, actual), /Elige cómo/);
  assert.equal(ice.validarEntrada({ proveedor: 'ninguno' }, actual), null);
  assert.match(ice.validarEntrada({ proveedor: 'cloudflare', cloudflare: { keyId: '' } }, actual), /Key ID/);
  assert.match(ice.validarEntrada({ proveedor: 'cloudflare', cloudflare: { keyId: 'abcdef0123456789' } }, actual), /API Token/);
  assert.equal(ice.validarEntrada({ proveedor: 'cloudflare', cloudflare: { keyId: 'abcdef0123456789', apiToken: 'token-de-prueba-0123456789' } }, actual), null);
  // Con el token ya guardado basta con reenviar el Key ID.
  const conToken = ice.normalizar(CF);
  assert.equal(ice.validarEntrada({ proveedor: 'cloudflare', cloudflare: { keyId: CF.cloudflare.keyId } }, conToken), null);
  assert.match(ice.validarEntrada({ proveedor: 'manual', manual: { urls: [] } }, actual), /al menos una dirección/);
  assert.match(ice.validarEntrada({ proveedor: 'manual', manual: { urls: ['http://x'] } }, actual), /no es una dirección válida/);
  assert.match(ice.validarEntrada({ proveedor: 'manual', manual: { urls: ['turn:a.net:3478'] } }, actual), /usuario y contraseña/);
  assert.equal(ice.validarEntrada({ proveedor: 'manual', manual: { urls: ['stun:a.net:3478'] } }, actual), null);
  assert.equal(ice.validarEntrada({ proveedor: 'manual', manual: { urls: ['turn:a.net:3478'], usuario: 'u', credencial: 'c' } }, actual), null);
});

test('ice: scripts/turn-config.js lee y guarda por stdin sin imprimir nunca los secretos', () => {
  const { spawnSync } = require('node:child_process');
  const dir = carpeta();
  const correr = (orden, entrada) => spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'turn-config.js'), orden], {
    input: entrada, encoding: 'utf8', env: { ...process.env, NEXO_STATE_DIR: dir }
  });
  const malo = correr('set', JSON.stringify({ proveedor: 'cloudflare', cloudflare: { keyId: '' } }));
  assert.equal(malo.status, 1);
  assert.match(malo.stderr, /Key ID/);

  const bueno = correr('set', JSON.stringify(CF));
  assert.equal(bueno.status, 0, bueno.stderr);
  assert.ok(!bueno.stdout.includes(CF.cloudflare.apiToken), 'la respuesta no debe llevar el token');
  const vista = JSON.parse(bueno.stdout);
  assert.equal(vista.proveedor, 'cloudflare');
  assert.equal(vista.tieneApiToken, true);

  const leido = correr('get');
  assert.equal(leido.status, 0);
  assert.ok(!leido.stdout.includes(CF.cloudflare.apiToken));
  assert.equal(JSON.parse(leido.stdout).cloudflareKeyId, CF.cloudflare.keyId);
  assert.equal(correr('set', 'no es json').status, 1);
});
