'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ap = require('../lib/apariencia');
const { crearEstaticos, crearPlantilla } = require('../lib/estaticos');

const IDS = ['cabina', 'nativa', 'reymuerto', 'cianotipo', 'bloque'];
const DEFECTO = { tema: 'reymuerto', modo: 'auto', porDispositivo: false };
const HTML = '<!doctype html><html lang="es"><head><meta name="theme-color" content="#000"><!--NEXO:APARIENCIA--></head><body>Cliente</body></html>';

function temporal(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-apariencia-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function ejecutarModo(apariencia, { oscuro = false, guardado = null, bloqueado = false, antiguo = false } = {}) {
  const html = ap.inyectar(HTML, apariencia);
  const dataset = {};
  for (const [, clave, valor] of html.matchAll(/data-([a-z-]+)="([^"]*)"/g)) {
    dataset[clave.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = valor;
  }
  let cambio;
  let color;
  const mq = { matches: oscuro };
  if (antiguo) mq.addListener = fn => { cambio = fn; };
  else mq.addEventListener = (evento, fn) => { assert.equal(evento, 'change'); cambio = fn; };
  const contexto = {
    document: {
      documentElement: { dataset },
      querySelector: selector => {
        assert.equal(selector, 'meta[name=theme-color]');
        return { setAttribute: (nombre, valor) => { assert.equal(nombre, 'content'); color = valor; } };
      }
    },
    localStorage: { getItem: clave => {
      assert.equal(clave, 'nexoApariencia');
      if (bloqueado) throw new Error('Almacenamiento deshabilitado');
      return guardado;
    } },
    matchMedia: consulta => { assert.equal(consulta, '(prefers-color-scheme: dark)'); return mq; },
    window: {}
  };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], contexto, { timeout: 1000 });
  return { dataset, contexto, color: () => color, cambiar: valor => { mq.matches = valor; cambio(); } };
}

test('normalizar: cinco temas, tres modos y booleano estricto; rechaza entradas inválidas sin mutarlas', () => {
  assert.deepEqual(ap.IDS_TEMA, IDS);
  assert.deepEqual(ap.MODOS, ['auto', 'claro', 'oscuro']);
  for (const valor of [undefined, null, false, 42, 'cabina', [], ['bloque'], {}]) {
    assert.deepEqual(ap.normalizar(valor), DEFECTO);
  }
  for (const tema of IDS) for (const modo of ['auto', 'claro', 'oscuro']) {
    const valor = Object.freeze({ tema, modo, porDispositivo: true, ignorado: 'extra' });
    assert.deepEqual(ap.normalizar(valor), { tema, modo, porDispositivo: true });
  }
  for (const valor of ['true', 'false', 1, 0, {}, [], null]) {
    assert.equal(ap.normalizar({ porDispositivo: valor }).porDispositivo, false);
  }
  assert.deepEqual(ap.normalizar({ tema: 'Nativa', modo: 'claro', porDispositivo: true }), { ...DEFECTO, modo: 'claro', porDispositivo: true });
  assert.deepEqual(ap.normalizar({ tema: 'bloque', modo: 'dark' }), { ...DEFECTO, tema: 'bloque' });
  const copia = ap.normalizar(null);
  copia.tema = 'cabina';
  assert.deepEqual(ap.normalizar(null), DEFECTO);
  assert.deepEqual(ap.TEMAS.map(({ id }) => id), IDS);
  for (const tema of ap.TEMAS) {
    assert.equal(typeof tema.nombre, 'string');
    assert.ok(tema.nombre.length > 0);
    assert.ok(tema.descripcion.length > 0);
  }
});

test('lector: ausencia, cambio sólo de mtime, caché, copias, eliminación, JSON roto y recuperación', t => {
  const dir = temporal(t);
  const lector = ap.crearLector(dir);
  assert.equal(lector.archivo, path.join(dir, '.nexo-apariencia.json'));
  assert.deepEqual(lector.obtener(), DEFECTO);
  let reloj = Date.now() - 60000;
  function escribir(texto, avanzar = true) {
    fs.writeFileSync(lector.archivo, texto);
    if (avanzar) reloj += 2000;
    fs.utimesSync(lector.archivo, reloj / 1000, reloj / 1000);
  }
  const claro = { tema: 'nativa', modo: 'claro', porDispositivo: true };
  const oscuro = { ...claro, modo: 'oscuro' };
  escribir(JSON.stringify(claro));
  assert.deepEqual(lector.obtener(), claro);
  lector.obtener().tema = 'bloque';
  assert.deepEqual(lector.obtener(), claro);
  // Igual tamaño y fecha conservan la caché; cambiar sólo mtime debe invalidarla.
  const otra = { ...claro, tema: 'bloque' };
  assert.equal(JSON.stringify(otra).length, JSON.stringify(claro).length);
  escribir(JSON.stringify(otra), false);
  assert.deepEqual(lector.obtener(), claro);
  reloj += 2000;
  fs.utimesSync(lector.archivo, reloj / 1000, reloj / 1000);
  assert.deepEqual(lector.obtener(), otra);
  // El tamaño también invalida, aunque la fecha no avance.
  escribir(JSON.stringify(oscuro), false);
  assert.deepEqual(lector.obtener(), oscuro);
  fs.unlinkSync(lector.archivo);
  assert.deepEqual(lector.obtener(), DEFECTO);
  escribir('{JSON roto');
  assert.deepEqual(lector.obtener(), DEFECTO);
  escribir('[]');
  assert.deepEqual(lector.obtener(), DEFECTO);
  escribir(JSON.stringify(claro));
  assert.deepEqual(lector.obtener(), claro);
});

test('inyección: atributos, CSS y fondos de todos los temas/modos, marcador y fallback en head', () => {
  for (const tema of IDS) for (const modo of ['auto', 'claro', 'oscuro']) {
    const html = ap.inyectar(HTML, { tema, modo }, { version: () => 'prueba42' });
    assert.match(html, new RegExp(`<html lang="es" data-tema="${tema}" data-modo="${modo === 'auto' ? 'oscuro' : modo}"`));
    assert.ok(html.includes(`data-modo-pref="${modo}"`));
    assert.ok(html.includes(`href="/ui/temas/${tema}.css?v=prueba42"`));
    assert.equal((html.match(/data-tema-css=/g) || []).length, 1);
    assert.ok(html.includes('href="/assets/fuentes/fuentes.css?v=prueba42"'));
    assert.ok(html.includes('href="/ui/cliente.css?v=prueba42"'));
    assert.ok(html.includes(`content="${ap.COLOR_FONDO[tema][modo === 'claro' ? 'claro' : 'oscuro']}"`));
    assert.ok(!html.includes('<!--NEXO:APARIENCIA-->'));
    assert.ok(html.indexOf('<script>') < html.indexOf('rel="stylesheet"'));
    for (const [, url] of html.matchAll(/rel="preload"[^>]*href="([^"]+)"/g)) assert.ok(!url.includes('?'));
  }
  const html = ap.inyectar(HTML.replace('<!--NEXO:APARIENCIA-->', ''), { tema: 'cabina', modo: 'claro', porDispositivo: true });
  assert.equal((html.match(/data-tema-css=/g) || []).length, 5);
  for (const tema of IDS) assert.ok(html.includes(`href="/ui/temas/${tema}.css"`));
  assert.ok(html.indexOf('<script>') < html.indexOf('</head>'));
  assert.match(html, /data-por-dispositivo="1"/);
});

test('inyección segura: valores de apariencia hostiles nunca pasan a atributos, CSS ni scripts', () => {
  const ataque = '\"><script>globalThis.INYECTADO=1</script><img src=x onerror=alert(1)>';
  const html = ap.inyectar(HTML, { tema: ataque, modo: ataque, porDispositivo: ataque, extra: ataque });
  assert.ok(!html.includes(ataque));
  assert.ok(!html.includes('INYECTADO'));
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.match(html, /data-tema="reymuerto" data-modo="oscuro"/);
  assert.match(html, /data-por-dispositivo="0"/);
  assert.match(html, /href="\/ui\/temas\/reymuerto\.css"/);
});

test('script: auto sigue el esquema, modo explícito permanece y preferencia local requiere permiso', () => {
  for (const antiguo of [false, true]) {
    const modo = ejecutarModo(DEFECTO, { antiguo });
    assert.equal(modo.dataset.modo, 'claro');
    modo.cambiar(true);
    assert.equal(modo.dataset.modo, 'oscuro');
    assert.equal(modo.color(), ap.COLOR_FONDO.reymuerto.oscuro);
    modo.contexto.window.__nexoAp.fijar('bloque', 'claro');
    modo.cambiar(true);
    assert.equal(modo.dataset.tema, 'bloque');
    assert.equal(modo.dataset.modo, 'claro');
    assert.equal(modo.color(), ap.COLOR_FONDO.bloque.claro);
  }
  const guardado = JSON.stringify({ tema: 'cianotipo', modo: 'oscuro' });
  assert.equal(ejecutarModo(DEFECTO, { guardado }).dataset.tema, 'reymuerto');
  const local = ejecutarModo({ ...DEFECTO, porDispositivo: true }, { guardado });
  assert.equal(local.dataset.tema, 'cianotipo');
  assert.equal(local.dataset.modo, 'oscuro');
  for (const opciones of [{ guardado: '{roto' }, { bloqueado: true }, { guardado: '{"tema":"<script>","modo":"dark"}' }]) {
    const resultado = ejecutarModo({ ...DEFECTO, porDispositivo: true }, opciones);
    assert.equal(resultado.dataset.tema, 'reymuerto');
    assert.equal(resultado.dataset.modo, 'claro');
  }
});

test('estáticos: whitelist real, archivos ausentes, directorios, traversal y versión por mtime', t => {
  const raiz = temporal(t);
  const estaticos = crearEstaticos({ raiz });
  const permitidos = ['/ui/cliente.css', '/ui/apariencia.js', '/ui/icono.svg', '/ui/demo/escritorio.svg',
    ...IDS.map(id => `/ui/temas/${id}.css`), '/assets/fuentes/fuentes.css', '/assets/fuentes/Prueba-400.woff2', '/assets/viego/rey-pixel.svg', '/assets/viego/fondo.webp'];
  for (const ruta of permitidos) {
    const archivo = path.join(raiz, ruta.slice(1));
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    fs.writeFileSync(archivo, 'recurso de prueba');
    assert.equal(estaticos.resolver(ruta).archivo, archivo);
    assert.ok(estaticos.version(ruta));
  }
  // Existen en disco: el rechazo tiene que depender de la whitelist, no de ENOENT.
  for (const ruta of ['/server.js', '/ui/secreto.js', '/ui/temas/otro.css', '/assets/viego/privado.json']) {
    fs.writeFileSync(path.join(raiz, ruta.slice(1)), 'privado');
    assert.equal(estaticos.resolver(ruta), null);
    assert.equal(estaticos.version(ruta), '');
  }
  for (const ruta of ['/ui/../server.js', '/ui/%2e%2e/server.js', '/ui/..%2fserver.js', '/ui/..\\server.js', '/assets/fuentes/../../server.js', '/ui/cliente.css\0', '/ui/Cliente.css']) {
    assert.equal(estaticos.resolver(ruta), null, ruta);
    assert.equal(estaticos.version(ruta), '', ruta);
  }
  assert.equal(estaticos.resolver('/assets/fuentes/ausente.woff2'), null);
  fs.mkdirSync(path.join(raiz, 'assets', 'viego', 'directorio.svg'));
  assert.equal(estaticos.resolver('/assets/viego/directorio.svg'), null);
  const archivo = path.join(raiz, 'ui', 'cliente.css');
  const antes = estaticos.version('/ui/cliente.css');
  const fecha = new Date(fs.statSync(archivo).mtimeMs + 5000);
  fs.utimesSync(archivo, fecha, fecha);
  assert.notEqual(estaticos.version('/ui/cliente.css'), antes);
});

test('plantilla: actualiza HTML con mismo tamaño y nuevo mtime sin recrear el lector', t => {
  const archivo = path.join(temporal(t), 'pagina.html');
  fs.writeFileSync(archivo, '<head>uno</head>');
  const plantilla = crearPlantilla(archivo);
  assert.equal(plantilla.texto(), '<head>uno</head>');
  const fecha = new Date(fs.statSync(archivo).mtimeMs + 5000);
  fs.writeFileSync(archivo, '<head>dos</head>');
  fs.utimesSync(archivo, fecha, fecha);
  assert.equal(plantilla.texto(), '<head>dos</head>');
  assert.equal(plantilla.texto(), '<head>dos</head>');
});
