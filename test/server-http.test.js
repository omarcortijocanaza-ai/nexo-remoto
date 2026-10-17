'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(err => (err ? reject(err) : resolve(port)));
    });
    srv.on('error', reject);
  });
}

function rawRequest({ port, method = 'GET', reqPath = '/', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers,
      setHost: !Object.prototype.hasOwnProperty.call(headers, 'Host')
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8')
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('server.js soporta entradas malformadas, emparejamiento, límites de subida y filtrado de proxy', async () => {
  const port = await getFreePort();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-server-http-'));
  const token = 'token-fijo-prueba-f2';
  const env = {
    ...process.env,
    REMOTE_KEYBOARD_HOST: '127.0.0.1',
    REMOTE_KEYBOARD_PORT: String(port),
    REMOTE_KEYBOARD_TOKEN: token,
    NEXO_STATE_DIR: stateDir,
    NEXO_GPU: '0',
    NEXO_MICROFONO: '0',
    NEXO_REQUIRE_LOGIN: '0',
    NEXO_MAX_UPLOAD_BYTES: '2048'
  };
  delete env.NEXO_PLATFORM;

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout esperando arranque de server.js')), 8000);
      child.stdout.on('data', chunk => {
        if (chunk.toString().includes('Teclado remoto activo')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on('exit', code => {
        clearTimeout(timer);
        reject(new Error(`server.js salió prematuramente con código ${code}`));
      });
    });

    // 1) cookie nexo_device=% → 403 y /health sigue en 200 después
    const r1 = await rawRequest({
      port,
      reqPath: '/info',
      headers: { Cookie: 'nexo_device=%' }
    });
    assert.equal(r1.status, 403);
    const h1 = await rawRequest({ port, reqPath: '/health' });
    assert.equal(h1.status, 200);
    assert.deepEqual(JSON.parse(h1.body), { ok: true });

    // 2) Host inválido → 400 y el servidor vivo
    const r2 = await rawRequest({
      port,
      reqPath: '/info',
      headers: { Host: '[::1' }
    });
    assert.equal(r2.status, 400);
    const h2 = await rawRequest({ port, reqPath: '/health' });
    assert.equal(h2.status, 200);

    // 3) GET /files/%E0%A4%A con token → 400 y vivo
    const r3 = await rawRequest({
      port,
      reqPath: '/files/%E0%A4%A',
      headers: { 'x-remote-token': token }
    });
    assert.equal(r3.status, 400);
    const h3 = await rawRequest({ port, reqPath: '/health' });
    assert.equal(h3.status, 200);

    // 4) emparejamiento por token: GET /?token=… → 302 y Set-Cookie nexo_device; GET /info con esa cookie → 200
    const r4 = await rawRequest({
      port,
      reqPath: `/?token=${encodeURIComponent(token)}`
    });
    assert.equal(r4.status, 302);
    const setCookies = r4.headers['set-cookie'] || [];
    const deviceCookieHeader = setCookies.find(c => c.startsWith('nexo_device='));
    assert.ok(deviceCookieHeader, 'Debe devolver cookie nexo_device');
    const cookiePair = deviceCookieHeader.split(';')[0];

    const r4Info = await rawRequest({
      port,
      reqPath: '/info',
      headers: { Cookie: cookiePair }
    });
    assert.equal(r4Info.status, 200);
    assert.equal(JSON.parse(r4Info.body).webrtc, true);

    // 5) subida de 1 KiB → 201; subida mayor que NEXO_MAX_UPLOAD_BYTES=2048 → 413 y sin archivo temporal
    const r5Ok = await rawRequest({
      port,
      method: 'POST',
      reqPath: '/files',
      headers: {
        Cookie: cookiePair,
        'x-nexo-filename': 'pequeno.bin',
        'content-length': '1024'
      },
      body: Buffer.alloc(1024, 0x61)
    });
    assert.equal(r5Ok.status, 201);

    const r5Big = await rawRequest({
      port,
      method: 'POST',
      reqPath: '/files',
      headers: {
        Cookie: cookiePair,
        'x-nexo-filename': 'grande.bin',
        'content-length': '4096'
      },
      body: Buffer.alloc(4096, 0x62)
    });
    assert.equal(r5Big.status, 413);

    const filesDir = path.join(stateDir, '.nexo-files');
    const uploadedEntries = fs.readdirSync(filesDir);
    assert.deepEqual(uploadedEntries, ['pequeno.bin']);

    // 6) proxy: GET /gpu-webrtc/otra → 404
    const r6 = await rawRequest({
      port,
      reqPath: '/gpu-webrtc/otra',
      headers: { Cookie: cookiePair }
    });
    assert.equal(r6.status, 404);
  } finally {
    child.kill();
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 1500);
    });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
