'use strict';

// /ice y el reenvío de servidores ICE al puente GPU, con server.js real y un «puente» falso.

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

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

function pedir({ port, method = 'GET', ruta, headers = {}, cuerpo = null }) {
  return new Promise((resolver, rechazar) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: ruta, headers }, res => {
      const trozos = [];
      res.on('data', trozo => trozos.push(trozo));
      res.on('end', () => resolver({ estado: res.statusCode, headers: res.headers, cuerpo: Buffer.concat(trozos).toString('utf8') }));
    });
    req.on('error', rechazar);
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}

async function arrancarServidor(env) {
  const hijo = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolver, rechazar) => {
    const limite = setTimeout(() => rechazar(new Error('Timeout esperando el arranque de server.js')), 10000);
    hijo.stdout.on('data', trozo => { if (trozo.toString().includes('Teclado remoto activo')) { clearTimeout(limite); resolver(); } });
    hijo.on('exit', codigo => { clearTimeout(limite); rechazar(new Error(`server.js salió con código ${codigo}`)); });
  });
  return hijo;
}

test('server.js: /ice exige dispositivo emparejado y entrega STUN o STUN+TURN; el puente recibe los servidores vigentes', async () => {
  const port = await puertoLibre();
  const puertoPuente = await puertoLibre();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-server-ice-'));
  const token = 'token-prueba-ice';

  // «Puente» falso: guarda las cabeceras de la última oferta.
  let ultima = null;
  const puente = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', trozo => { cuerpo += trozo; });
    req.on('end', () => {
      ultima = { headers: req.headers, cuerpo };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'answer', sdp: 'v=0' }));
    });
  });
  await new Promise(resolver => puente.listen(puertoPuente, '127.0.0.1', resolver));

  const env = {
    ...process.env,
    REMOTE_KEYBOARD_HOST: '127.0.0.1', REMOTE_KEYBOARD_PORT: String(port), REMOTE_KEYBOARD_TOKEN: token,
    NEXO_STATE_DIR: stateDir, NEXO_GPU: '1', NEXO_GPU_WEBRTC_PORT: String(puertoPuente),
    NEXO_MICROFONO: '0', NEXO_REQUIRE_LOGIN: '0'
  };
  delete env.NEXO_PLATFORM;
  const hijo = await arrancarServidor(env);

  try {
    // Sin emparejar: 403.
    assert.equal((await pedir({ port, ruta: '/ice' })).estado, 403);

    // Se empareja con el enlace y se usa la cookie.
    const par = await pedir({ port, ruta: `/?token=${token}` });
    const cookie = (par.headers['set-cookie'] || []).find(c => c.startsWith('nexo_device=')).split(';')[0];
    const conCookie = { cookie };

    // Sin TURN configurado: sólo STUN.
    const sinTurn = await pedir({ port, ruta: '/ice', headers: conCookie });
    assert.equal(sinTurn.estado, 200);
    assert.deepEqual(JSON.parse(sinTurn.cuerpo).iceServers, [{ urls: ['stun:stun.cloudflare.com:3478'] }]);

    // Con un TURN manual (el panel escribe este archivo): el cliente lo recibe al instante y el puente también.
    fs.writeFileSync(path.join(stateDir, '.nexo-turn.json'), JSON.stringify({
      proveedor: 'manual', manual: { urls: ['turn:t.ejemplo.net:3478?transport=udp'], usuario: 'u', credencial: 'c' }
    }));
    const conTurn = JSON.parse((await pedir({ port, ruta: '/ice', headers: conCookie })).cuerpo).iceServers;
    assert.equal(conTurn.length, 2);
    assert.deepEqual(conTurn[1], { urls: ['turn:t.ejemplo.net:3478?transport=udp'], username: 'u', credential: 'c' });

    // La oferta al puente lleva X-Nexo-Ice con esos servidores aunque el cliente mande otra cabecera.
    const oferta = await pedir({
      port, method: 'POST', ruta: '/gpu-webrtc/offer',
      headers: { ...conCookie, 'content-type': 'application/json', 'x-nexo-ice': Buffer.from('[{"urls":["turn:atacante.net"]}]').toString('base64') },
      cuerpo: JSON.stringify({ type: 'offer', sdp: 'v=0' })
    });
    assert.equal(oferta.estado, 200);
    const reenviados = JSON.parse(Buffer.from(ultima.headers['x-nexo-ice'], 'base64').toString('utf8'));
    assert.deepEqual(reenviados, conTurn);
    assert.ok(!JSON.stringify(reenviados).includes('atacante'), 'la cabecera del cliente no debe llegar al puente');

    // Las consultas (stats) no llevan la cabecera.
    await pedir({ port, ruta: '/gpu-webrtc/stats', headers: conCookie });
    assert.equal(ultima.headers['x-nexo-ice'], undefined);
  } finally {
    hijo.kill();
    await new Promise(resolver => puente.close(resolver));
  }
});
