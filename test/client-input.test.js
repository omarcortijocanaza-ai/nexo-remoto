'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const bloque = html.split('// INICIO RESPALDO DE ENTRADA')[1].split('// FIN RESPALDO DE ENTRADA')[0];
const turno = () => new Promise(resolve => setImmediate(resolve));

function emisor({ demo = false, control = null, motion = null, post = async () => {} } = {}) {
  const contexto = { DEMO: demo, controlChannel: control, motionChannel: motion, post };
  vm.runInNewContext(bloque, contexto);
  return contexto.sendEvent;
}

function canal() {
  const enviados = [];
  return { readyState: 'open', bufferedAmount: 0, enviados, send(s) { enviados.push(JSON.parse(s)); } };
}

test('entrada: posición absoluta por canal rápido, scroll relativo por fiable', async () => {
  const control = canal(), motion = canal();
  const enviar = emisor({ control, motion, post() { assert.fail('no debe usar HTTP'); } });
  await enviar({ type: 'pointer', action: 'move', x: .5, y: .5 }, true);
  await enviar({ type: 'scroll', dx: 0, dy: 12, x: .5, y: .5 }, true);
  assert.equal(motion.enviados[0].type, 'pointer');
  assert.equal(control.enviados[0].type, 'scroll');
});

test('entrada: sin WebRTC, agrupa posiciones y conserva down/move/up en orden', async () => {
  const enviados = [];
  let liberar;
  const bloqueo = new Promise(resolve => { liberar = resolve; });
  const enviar = emisor({ post: async (ruta, data) => {
    enviados.push({ ruta, data });
    if (enviados.length === 1) await bloqueo;
  } });
  const down = enviar({ type: 'pointer', action: 'down', x: 0, y: 0 });
  for (let i = 1; i <= 100; i++) enviar({ type: 'pointer', action: 'move', x: i / 100, y: 0 }, true);
  const up = enviar({ type: 'pointer', action: 'up', x: 1, y: 0 });
  assert.equal(enviados.length, 1, 'sólo una petición en curso');
  liberar();
  await Promise.all([down, up]);
  assert.deepEqual(enviados.map(e => e.data.action), ['down', 'move', 'up']);
  assert.equal(enviados[1].data.x, 1, 'se conserva la posición más reciente');
});

test('entrada: no pierde el scroll acumulado ni supera el límite del servidor', async () => {
  const enviados = [];
  let liberar;
  const bloqueo = new Promise(resolve => { liberar = resolve; });
  const enviar = emisor({ post: async (ruta, data) => {
    enviados.push({ ruta, data });
    if (enviados.length === 1) await bloqueo;
  } });
  enviar({ type: 'scroll', dx: 0, dy: 10, x: .5, y: .5 }, true);
  for (let i = 0; i < 99; i++) enviar({ type: 'scroll', dx: 0, dy: 10, x: .5, y: .5 }, true);
  const fin = enviar({ type: 'workspace', value: 'next' });
  liberar();
  await fin;
  const scrolls = enviados.filter(e => e.ruta === '/scroll');
  assert.equal(scrolls.reduce((n, e) => n + e.data.dy, 0), 1000);
  assert.ok(scrolls.every(e => Math.abs(e.data.dy) <= 240));
  assert.ok(scrolls.length < 10, 'la ráfaga no genera cien peticiones');
});

test('entrada: preserva el formato HTTP del teclado y se recupera de un error', async () => {
  let intentos = 0;
  const enviados = [];
  const enviar = emisor({ post: async (ruta, data) => {
    if (++intentos === 1) throw new Error('red temporalmente caída');
    enviados.push({ ruta, data });
  } });
  await assert.rejects(enviar({ type: 'pointer', action: 'tap' }), /red temporalmente/);
  await enviar({ type: 'input', inputType: 'text', value: 'ñandú' });
  assert.equal(enviados[0].ruta, '/input');
  assert.equal(enviados[0].data.type, 'text');
  assert.equal(enviados[0].data.value, 'ñandú');
});

test('entrada: demo no manda eventos y un canal cerrado durante send usa el respaldo', async () => {
  let peticiones = 0;
  await emisor({ demo: true, post() { assert.fail('demo no debe enviar'); } })({ type: 'pointer' }, true);
  const control = { ...canal(), send() { throw new Error('cerrado'); } };
  const enviar = emisor({ control, post: async () => { peticiones++; } });
  await enviar({ type: 'pointer', action: 'tap' });
  await turno();
  assert.equal(peticiones, 1);
});

test('conexión: temporizador CPU no cierra controles sanos ni el vídeo GPU', () => {
  const linea = html.split('\n').find(l => l.includes('fallbackTimer=setTimeout') && l.includes('6500'));
  for (const caso of [
    { gpuActive: true, readyState: 'closed', esperado: 0 },
    { gpuActive: false, readyState: 'open', esperado: 0 },
    { gpuActive: false, readyState: 'closed', esperado: 1 }
  ]) {
    let cierres = 0;
    vm.runInNewContext(linea, {
      generation: 1, rtcGeneration: 1, transport: 'fallback', gpuActive: caso.gpuActive,
      controlChannel: { readyState: caso.readyState }, startFallback() { cierres++; },
      setTimeout(fn) { fn(); }
    });
    assert.equal(cierres, caso.esperado);
  }
});
