'use strict';

// HTTPS en la LAN con server.js real: certificado propio, mismo manejador, cookie Secure y enlace publicado.

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { WebSocket } = require('ws');
const { entornoDeAjustes, normalizar, PUERTO_HTTPS_LAN } = require('../lib/settings');

function puertoLibre() {
  return new Promise((resolver, rechazar) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(error => (error ? rechazar(error) : resolver(port)));
    });
    srv.on('error', rechazar);
  });
}

function pedirHttps({ port, ruta, headers = {}, method = 'GET' }) {
  return new Promise((resolver, rechazar) => {
    const req = https.request({ host: '127.0.0.1', port, path: ruta, method, headers, rejectUnauthorized: false }, res => {
      const trozos = [];
      res.on('data', trozo => trozos.push(trozo));
      res.on('end', () => resolver({ estado: res.statusCode, headers: res.headers, cuerpo: Buffer.concat(trozos) }));
    });
    req.on('error', rechazar);
    req.end();
  });
}

test('settings: httpsLan es falso por defecto y sólo entonces pide el puerto TLS al servidor', () => {
  assert.equal(normalizar({}).httpsLan, false);
  assert.equal(normalizar({ httpsLan: 'sí' }).httpsLan, false);
  assert.deepEqual(entornoDeAjustes(normalizar({ httpsLan: false }), {}), {});
  assert.equal(entornoDeAjustes(normalizar({ httpsLan: true }), {}).NEXO_TLS_PORT, String(PUERTO_HTTPS_LAN));
  // Una variable explícita gana al archivo, como con el resto de ajustes.
  assert.equal(entornoDeAjustes(normalizar({ httpsLan: true }), { NEXO_TLS_PORT: '9443' }).NEXO_TLS_PORT, undefined);
});

test('server.js: con NEXO_TLS_PORT sirve el mismo sitio por HTTPS con cookie Secure y publica el certificado', { skip: process.platform !== 'win32' && 'requiere PowerShell de Windows' }, async () => {
  const port = await puertoLibre();
  const puertoTls = await puertoLibre();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-server-tls-'));
  const token = 'token-prueba-tls';
  const env = {
    ...process.env,
    // 0.0.0.0 como en uso real (en 127.0.0.1 el HTTPS se omite a propósito).
    REMOTE_KEYBOARD_HOST: '0.0.0.0', REMOTE_KEYBOARD_PORT: String(port), REMOTE_KEYBOARD_TOKEN: token,
    NEXO_STATE_DIR: stateDir, NEXO_GPU: '0', NEXO_MICROFONO: '0', NEXO_REQUIRE_LOGIN: '0', NEXO_TLS_PORT: String(puertoTls)
  };
  delete env.NEXO_PLATFORM;

  const hijo = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let salida = '';
  hijo.stdout.on('data', trozo => { salida += trozo; });
  hijo.stderr.on('data', trozo => { salida += trozo; });
  try {
    await new Promise((resolver, rechazar) => {
      const limite = setTimeout(() => rechazar(new Error(`Timeout esperando el HTTPS. Salida:\n${salida}`)), 40000);
      const mirar = setInterval(() => { if (salida.includes('HTTPS en la LAN activo')) { clearTimeout(limite); clearInterval(mirar); resolver(); } }, 100);
      hijo.on('exit', codigo => { clearTimeout(limite); clearInterval(mirar); rechazar(new Error(`server.js salió con código ${codigo}. Salida:\n${salida}`)); });
    });

    // Mismo manejador: /health por HTTPS.
    const salud = await pedirHttps({ port: puertoTls, ruta: '/health' });
    assert.equal(salud.estado, 200);

    // El enlace con token empareja y la cookie de dispositivo lleva Secure (sólo viaja por HTTPS).
    const par = await pedirHttps({ port: puertoTls, ruta: `/?token=${token}` });
    assert.equal(par.estado, 302);
    const cookie = (par.headers['set-cookie'] || []).find(c => c.startsWith('nexo_device='));
    assert.ok(cookie, 'debe emparejar el dispositivo');
    assert.match(cookie, /;\s*Secure/i);

    // La página principal ya se puede pedir con esa cookie y /info responde.
    const info = await pedirHttps({ port: puertoTls, ruta: '/info', headers: { cookie: cookie.split(';')[0] } });
    assert.equal(info.estado, 200);

    // El WebSocket (vídeo JPEG) también funciona por wss://: el 'upgrade' se enlazó al servidor HTTPS.
    await new Promise((resolver, rechazar) => {
      const ws = new WebSocket(`wss://127.0.0.1:${puertoTls}/live`, { headers: { cookie: cookie.split(';')[0] }, rejectUnauthorized: false });
      const limite = setTimeout(() => { ws.terminate(); rechazar(new Error('wss no abrió')); }, 8000);
      ws.on('open', () => { clearTimeout(limite); ws.close(); resolver(); });
      ws.on('error', error => { clearTimeout(limite); rechazar(error); });
    });

    // El certificado público se puede bajar (por HTTP también) y es el mismo que presenta el servidor.
    const cer = await pedirHttps({ port: puertoTls, ruta: '/nexo-lan.cer' });
    assert.equal(cer.estado, 200);
    assert.ok(cer.cuerpo.length > 300);
    assert.deepEqual(cer.cuerpo, fs.readFileSync(path.join(stateDir, 'nexo-lan.cer')));

    // La contraseña del PFX no aparece en ninguna salida del servidor.
    const meta = JSON.parse(fs.readFileSync(path.join(stateDir, '.nexo-tls.json'), 'utf8'));
    assert.ok(!salida.includes(meta.passphrase), 'la contraseña del PFX no debe imprimirse');
  } finally {
    hijo.kill();
  }
});

test('server.js: si el HTTPS falla (o no es Windows) NEXO sigue sirviendo por HTTP', async () => {
  const port = await puertoLibre();
  const puertoTls = await puertoLibre();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-server-tls-falla-'));
  const env = {
    ...process.env,
    REMOTE_KEYBOARD_HOST: '0.0.0.0', REMOTE_KEYBOARD_PORT: String(port), REMOTE_KEYBOARD_TOKEN: 'token-x',
    NEXO_STATE_DIR: stateDir, NEXO_GPU: '0', NEXO_MICROFONO: '0', NEXO_REQUIRE_LOGIN: '0', NEXO_TLS_PORT: String(puertoTls),
    // Simula un sistema sin PowerShell: el generador no puede ejecutarse.
    PATH: ''
  };
  delete env.NEXO_PLATFORM;
  const hijo = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let salida = '';
  hijo.stdout.on('data', trozo => { salida += trozo; });
  hijo.stderr.on('data', trozo => { salida += trozo; });
  try {
    await new Promise((resolver, rechazar) => {
      const limite = setTimeout(() => rechazar(new Error(`Timeout. Salida:\n${salida}`)), 15000);
      const mirar = setInterval(() => { if (/HTTPS LAN no disponible|HTTPS LAN: generando/.test(salida) && salida.includes('Teclado remoto activo')) { clearTimeout(limite); clearInterval(mirar); resolver(); } }, 100);
      hijo.on('exit', codigo => { clearTimeout(limite); clearInterval(mirar); rechazar(new Error(`server.js salió con código ${codigo}. Salida:\n${salida}`)); });
    });
    const respuesta = await new Promise((resolver, rechazar) => {
      require('node:http').get({ host: '127.0.0.1', port, path: '/health' }, res => { res.resume(); resolver(res.statusCode); }).on('error', rechazar);
    });
    assert.equal(respuesta, 200);
    assert.ok(!salida.includes('HTTPS en la LAN activo'));
  } finally {
    hijo.kill();
  }
});
