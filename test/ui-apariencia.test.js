'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

// Ejecuta el controlador con un DOM mínimo: comprueba el sondeo real y los
// cambios de política del dueño sin WebRTC, micrófono ni escritorio del usuario.
test('cliente: sigue al dueño y recupera su preferencia al volver a permitir elegir', async () => {
  const dataset = { tema: 'reymuerto', modoPref: 'auto', temaSrv: 'reymuerto', modoSrv: 'auto', porDispositivo: '0' };
  let sondear;
  let datos = { tema: 'cabina', modo: 'claro', porDispositivo: false };
  let preferencia = JSON.stringify({ tema: 'bloque', modo: 'oscuro' });
  const window = { __nexoAp: { fijar(tema, modo) { dataset.tema = tema; dataset.modoPref = modo; } } };
  const contexto = {
    window, URLSearchParams, location: { search: '' },
    document: {
      documentElement: { dataset }, visibilityState: 'visible',
      querySelector(selector) { return selector.startsWith('link[') ? {} : null; },
      getElementById() { return null; }, addEventListener() {}
    },
    localStorage: { getItem() { return preferencia; }, setItem(_clave, valor) { preferencia = valor; } },
    fetch: async () => ({ ok: true, status: 200, json: async () => datos }),
    setInterval(fn) { sondear = fn; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../ui/apariencia.js'), 'utf8'), contexto);
  await sondear();
  assert.equal(dataset.tema, 'cabina', 'todos igual debe respetar al dueño');
  assert.equal(dataset.modoPref, 'claro');
  datos = { ...datos, porDispositivo: true };
  await sondear();
  assert.equal(dataset.tema, 'bloque', 'al permitir elegir se recupera la preferencia guardada');
  assert.equal(dataset.modoPref, 'oscuro');
  datos = { tema: 'nativa', modo: 'auto', porDispositivo: false };
  await sondear();
  assert.equal(dataset.tema, 'nativa');
  assert.equal(dataset.modoPref, 'auto');
  preferencia = '{roto';
  datos = { tema: 'cabina', modo: 'oscuro', porDispositivo: true };
  await sondear();
  assert.equal(dataset.tema, 'cabina', 'una preferencia ilegible usa la del dueño');
});
