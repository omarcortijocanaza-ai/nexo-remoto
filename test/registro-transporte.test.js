'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { crearRegistroTransporte, normalizarRuta, INTERVALO_MIN_MS } = require('../lib/registro-transporte');

function registro() {
  let reloj = Date.parse('2026-11-14T12:00:00Z');
  const lineas = [];
  const { registrar } = crearRegistroTransporte({ escribir: linea => lineas.push(linea), ahora: () => reloj });
  return { registrar, lineas, avanzar: ms => { reloj += ms; } };
}

test('transporte: una línea al conectar y ninguna mientras nada cambia', () => {
  const r = registro();
  const diagnostico = { transport: 'gpu', ruta: 'srflx→srflx', fps: 44.6, bitrateKbps: 3980, packetLoss: 0.04 };
  r.registrar('a', { label: 'Chrome · móvil', origen: 'remoto', diagnostico });
  r.avanzar(2500);
  r.registrar('a', { label: 'Chrome · móvil', origen: 'remoto', diagnostico });
  assert.equal(r.lineas.length, 1);
  assert.deepEqual(r.lineas[0], {
    at: '2026-11-14T12:00:00.000Z', type: 'transporte', label: 'Chrome · móvil', origen: 'remoto',
    transport: 'gpu', ruta: 'srflx→srflx', fps: 45, kbps: 3980, perdida: 0
  });
});

test('transporte: «connecting» no se registra y el respaldo no lleva ruta', () => {
  const r = registro();
  r.registrar('a', { diagnostico: { transport: 'connecting' } });
  assert.equal(r.lineas.length, 0);
  r.registrar('a', { diagnostico: { transport: 'fallback', ruta: 'host→host' } });
  assert.equal(r.lineas[0].transport, 'fallback');
  assert.equal(r.lineas[0].ruta, '');
});

test('transporte: un cambio dentro de los 30 s se escribe cuando termina la espera', () => {
  const r = registro();
  r.registrar('a', { diagnostico: { transport: 'gpu', ruta: 'host→host' } });
  r.avanzar(5000);
  r.registrar('a', { diagnostico: { transport: 'fallback' } });
  assert.equal(r.lineas.length, 1);
  r.avanzar(INTERVALO_MIN_MS);
  r.registrar('a', { diagnostico: { transport: 'fallback' } });
  assert.equal(r.lineas.length, 2);
  assert.equal(r.lineas[1].transport, 'fallback');
});

test('transporte: cada dispositivo lleva su propia cuenta', () => {
  const r = registro();
  r.registrar('a', { diagnostico: { transport: 'gpu' } });
  r.registrar('b', { diagnostico: { transport: 'gpu' } });
  assert.equal(r.lineas.length, 2);
});

test('transporte: la ruta sólo acepta tipos de candidato conocidos y el origen sólo lan o remoto', () => {
  assert.equal(normalizarRuta('relay→srflx'), 'relay→srflx');
  assert.equal(normalizarRuta('192.168.1.2→host'), '');
  assert.equal(normalizarRuta('relay'), '');
  assert.equal(normalizarRuta(42), '');
  const r = registro();
  r.registrar('a', { origen: '203.0.113.9', diagnostico: { transport: 'rtc' } });
  assert.equal(r.lineas[0].origen, 'lan');
});
