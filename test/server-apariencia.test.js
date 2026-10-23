'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const RAIZ = path.join(__dirname, '..');
const IDS = ['cabina', 'nativa', 'reymuerto', 'cianotipo', 'bloque'];
const DEFECTO = { tema: 'reymuerto', modo: 'auto', porDispositivo: false };

function puertoLibre() {
  return new Promise((resolver, rechazar) => {
    const servidor = net.createServer();
    servidor.on('error', rechazar);
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address();
      servidor.close(error => error ? rechazar(error) : resolver(port));
    });
  });
}

function pedir(port, ruta, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolver, rechazar) => {
    // http.request conserva el traversal crudo; fetch lo normalizaría antes de enviarlo.
    const req = http.request({ host: '127.0.0.1', port, path: ruta, method, headers, agent: false }, res => {
      const trozos = [];
      res.on('error', rechazar);
      res.on('end', () => resolver({ estado: res.statusCode, headers: res.headers, cuerpo: Buffer.concat(trozos) }));
      res.on('data', trozo => trozos.push(trozo));
    });
    req.setTimeout(5000, () => req.destroy(new Error('Timeout de petición de prueba')));
    req.on('error', rechazar);
    req.end();
  });
}

async function arrancar(t) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-server-apariencia-'));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const port = await puertoLibre();
  // No se heredan rutas, credenciales ni opciones de una instancia real del dueño.
  const env = Object.fromEntries(Object.entries(process.env).filter(([clave]) =>
    !/^(NEXO_|REMOTE_KEYBOARD_|NODE_OPTIONS$)/i.test(clave)));
  const token = 'token-sintetico-apariencia';
  Object.assign(env, {
    REMOTE_KEYBOARD_HOST: '127.0.0.1', REMOTE_KEYBOARD_PORT: String(port), REMOTE_KEYBOARD_TOKEN: token,
    NEXO_STATE_DIR: stateDir, NEXO_LOGS_DIR: stateDir,
    NEXO_GPU: '0', NEXO_MICROFONO: '0', NEXO_REQUIRE_LOGIN: '0', NEXO_TLS_PORT: '0'
  });
  // Las rutas HTTP son reales; se sustituye sólo el adaptador del escritorio para
  // impedir agentes nativos, capturas, entrada o cambios en la PC durante estas pruebas.
  const inicio = `
    const id = require.resolve('./platform');
    const plataforma = {
      name: 'prueba', capabilities: { independentSession: false, textBatchMs: 0 },
      init: async () => {}, close: () => {}, on: () => {}, listMonitors: async () => []
    };
    require.cache[id] = { id, filename: id, loaded: true, exports: new Proxy(plataforma, {
      get(objeto, clave) {
        if (clave in objeto) return objeto[clave];
        throw new Error('Operación de escritorio prohibida en prueba: ' + String(clave));
      }
    }) };
    require('./server');
  `;
  const hijo = spawn(process.execPath, ['-e', inicio], { cwd: RAIZ, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (hijo.exitCode === null && hijo.signalCode === null) {
      const cerrado = once(hijo, 'close');
      hijo.kill();
      await cerrado;
    }
  });
  // Sólo se conserva la salida para detectar el arranque; no se imprimen enlaces ni cookies.
  await new Promise((resolver, rechazar) => {
    let salida = '';
    const limite = setTimeout(() => terminar(new Error('Timeout esperando server.js aislado')), 15000);
    const salir = codigo => terminar(new Error(`server.js aislado salió con código ${codigo}`));
    const error = causa => terminar(causa);
    const leer = trozo => {
      salida = (salida + trozo.toString()).slice(-8192);
      if (salida.includes('Teclado remoto activo')) terminar();
    };
    function terminar(causa) {
      clearTimeout(limite);
      hijo.off('exit', salir);
      hijo.off('error', error);
      hijo.stdout.off('data', leer);
      causa ? rechazar(causa) : resolver();
    }
    hijo.stdout.on('data', leer);
    hijo.stderr.on('data', () => {});
    hijo.on('exit', salir);
    hijo.on('error', error);
  });
  const archivo = path.join(stateDir, '.nexo-apariencia.json');
  let fecha = Date.now();
  return {
    port, token, archivo,
    guardar(valor) {
      // Reproduce la publicación atómica del panel y fuerza mtime distinto sin sleeps.
      const temporal = `${archivo}.tmp`;
      fs.writeFileSync(temporal, typeof valor === 'string' ? valor : JSON.stringify(valor));
      fecha += 2000;
      fs.utimesSync(temporal, fecha / 1000, fecha / 1000);
      fs.renameSync(temporal, archivo);
    }
  };
}

function comprobarPagina(respuesta, apariencia) {
  assert.equal(respuesta.estado, 200);
  assert.match(respuesta.headers['content-type'], /^text\/html/);
  assert.equal(respuesta.headers['cache-control'], 'no-store');
  const html = respuesta.cuerpo.toString('utf8');
  const etiqueta = html.match(/<html\b[^>]*>/i)?.[0];
  assert.ok(etiqueta, 'la página debe tener elemento html');
  for (const [clave, valor] of Object.entries({
    'data-tema': apariencia.tema, 'data-modo': apariencia.modo === 'auto' ? 'oscuro' : apariencia.modo,
    'data-modo-pref': apariencia.modo, 'data-tema-srv': apariencia.tema,
    'data-modo-srv': apariencia.modo, 'data-por-dispositivo': apariencia.porDispositivo ? '1' : '0'
  })) assert.ok(etiqueta.includes(`${clave}="${valor}"`), `${clave} debe reflejar la apariencia vigente`);
  const cargados = [...html.matchAll(/data-tema-css="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(cargados, apariencia.porDispositivo ? IDS : [apariencia.tema]);
  assert.match(html, new RegExp(`/ui/temas/${apariencia.tema}\\.css\\?v=[a-z0-9]+`));
  assert.ok(!html.includes('<!--NEXO:APARIENCIA-->'));
}

test('server: páginas públicas y /apariencia emparejado reflejan cambios sin reinicio', { timeout: 30000 }, async t => {
  const servidor = await arrancar(t);
  const { port, token } = servidor;
  for (const ruta of ['/', '/microfono']) comprobarPagina(await pedir(port, ruta), DEFECTO);
  for (const headers of [{}, { cookie: 'nexo_device=inventado' }]) {
    const denegado = await pedir(port, '/apariencia', { headers });
    assert.equal(denegado.estado, 403);
    assert.equal(JSON.parse(denegado.cuerpo).pairing, true);
    assert.ok(!Object.hasOwn(JSON.parse(denegado.cuerpo), 'temas'));
  }
  const par = await pedir(port, `/?token=${token}`);
  assert.equal(par.estado, 302);
  assert.equal(par.headers.location, '/');
  const credencial = (par.headers['set-cookie'] || []).find(c => c.startsWith('nexo_device='));
  assert.ok(credencial, 'el enlace sintético debe emitir una cookie de dispositivo');
  const headers = { cookie: credencial.split(';')[0] };
  async function comprobarApi(esperada) {
    const respuesta = await pedir(port, '/apariencia', { headers });
    assert.equal(respuesta.estado, 200);
    assert.match(respuesta.headers['content-type'], /^application\/json/);
    assert.equal(respuesta.headers['cache-control'], 'no-store');
    const { temas, ...apariencia } = JSON.parse(respuesta.cuerpo);
    assert.deepEqual(apariencia, esperada);
    assert.deepEqual(temas.map(tema => tema.id), IDS);
    for (const tema of temas) {
      assert.deepEqual(Object.keys(tema).sort(), ['descripcion', 'id', 'nombre']);
      assert.ok(tema.nombre && tema.descripcion);
    }
  }
  await comprobarApi(DEFECTO);
  for (const tema of IDS) for (const modo of ['auto', 'claro', 'oscuro']) {
    const apariencia = { tema, modo, porDispositivo: modo === 'claro' };
    servidor.guardar(apariencia);
    for (const ruta of ['/', '/microfono']) comprobarPagina(await pedir(port, ruta), apariencia);
    await comprobarApi(apariencia);
  }
  servidor.guardar('{JSON roto');
  for (const ruta of ['/', '/microfono']) comprobarPagina(await pedir(port, ruta), DEFECTO);
  await comprobarApi(DEFECTO);
  servidor.guardar({ tema: 'bloque', modo: 'claro' });
  await comprobarApi({ tema: 'bloque', modo: 'claro', porDispositivo: false });
  fs.unlinkSync(servidor.archivo);
  for (const ruta of ['/', '/microfono']) comprobarPagina(await pedir(port, ruta), DEFECTO);
  await comprobarApi(DEFECTO);
});

test('server: estáticos públicos, whitelist, traversal, ETag/304, HEAD y caché versionada', { timeout: 30000 }, async t => {
  const { port, token } = await arrancar(t);
  const recursos = [
    ['/ui/cliente.css', 'text/css', 'no-cache'],
    ['/ui/apariencia.js', 'text/javascript', 'no-cache'],
    ...IDS.map(id => [`/ui/temas/${id}.css`, 'text/css', 'no-cache']),
    ['/assets/fuentes/fuentes.css', 'text/css', 'public, max-age=86400'],
    ['/assets/fuentes/Cinzel-500-700.woff2', 'font/woff2', 'public, max-age=86400'],
    ['/assets/viego/rey-pixel.svg', 'image/svg+xml', 'public, max-age=86400'],
    ['/assets/viego/fondo-niebla.webp', 'image/webp', 'public, max-age=86400'],
    ['/ui/demo/escritorio.svg', 'image/svg+xml', 'public, max-age=86400'],
    ['/ui/icono.svg', 'image/svg+xml', 'public, max-age=86400']
  ];
  for (const [ruta, tipo, cache] of recursos) {
    const get = await pedir(port, ruta);
    assert.equal(get.estado, 200, ruta);
    assert.equal(get.headers['content-type'].split(';')[0], tipo, ruta);
    assert.equal(get.headers['cache-control'], cache, ruta);
    assert.equal(get.headers['x-content-type-options'], 'nosniff', ruta);
    assert.ok(get.headers.etag, ruta);
    assert.deepEqual(get.cuerpo, fs.readFileSync(path.join(RAIZ, ruta.slice(1))), ruta);
    const head = await pedir(port, ruta, { method: 'HEAD' });
    assert.equal(head.estado, 200, ruta);
    assert.equal(head.cuerpo.length, 0, ruta);
    for (const clave of ['etag', 'content-length', 'content-type', 'cache-control', 'x-content-type-options']) {
      assert.equal(head.headers[clave], get.headers[clave], `${ruta}: ${clave}`);
    }
    assert.equal(Number(head.headers['content-length']), get.cuerpo.length, ruta);
    for (const method of ['GET', 'HEAD']) {
      const vigente = await pedir(port, ruta, { method, headers: { 'if-none-match': get.headers.etag } });
      assert.equal(vigente.estado, 304, ruta);
      assert.equal(vigente.cuerpo.length, 0, ruta);
      assert.equal(vigente.headers.etag, get.headers.etag, ruta);
    }
    const viejo = await pedir(port, ruta, { headers: { 'if-none-match': 'W/"obsoleto"' } });
    assert.equal(viejo.estado, 200, ruta);
    assert.deepEqual(viejo.cuerpo, get.cuerpo, ruta);
    const versionado = await pedir(port, `${ruta}?v=prueba`);
    assert.equal(versionado.estado, 200, ruta);
    assert.equal(versionado.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(versionado.headers.etag, get.headers.etag);
  }
  const par = await pedir(port, `/?token=${token}`);
  const credencial = (par.headers['set-cookie'] || []).find(c => c.startsWith('nexo_device='));
  assert.ok(credencial);
  const headers = { cookie: credencial.split(';')[0] };
  // Ya emparejado, un rechazo 404 demuestra que no lo oculta sólo el candado 403.
  for (const ruta of [
    '/server.js', '/lib/apariencia.js', '/assets/fuentes/LEEME.md', '/assets/viego/privado.json',
    '/ui/temas/inexistente.css', '/assets/fuentes/ausente.woff2', '/ui/temas/',
    '/ui/../server.js', '/ui/%2e%2e/server.js', '/ui/..%2fserver.js', '/ui/%2e%2e%5cserver.js',
    '/assets/fuentes/../../server.js', '/assets/fuentes/%252e%252e%252fserver.js', '/ui/cliente.css%00'
  ]) {
    const respuesta = await pedir(port, ruta, { headers });
    assert.equal(respuesta.estado, 404, ruta);
    assert.match(respuesta.headers['content-type'], /^application\/json/, ruta);
  }
  assert.equal((await pedir(port, '/ui/cliente.css', { method: 'POST', headers })).estado, 404);
});
