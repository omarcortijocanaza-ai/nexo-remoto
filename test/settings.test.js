'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { NOMBRE_ARCHIVO, POR_DEFECTO, entornoDeAjustes, leerAjustes, normalizar } = require('../lib/settings');

test('normalizar rellena lo ausente y descarta lo inválido', () => {
  assert.deepEqual(normalizar(null), POR_DEFECTO);
  assert.deepEqual(normalizar({ modo: 'raro', gpu: 'sí', micDispositivo: 42 }), POR_DEFECTO);
  assert.deepEqual(normalizar({ modo: 'local', gpu: false, micDispositivo: '  Voicemeeter Input  ' }), { modo: 'local', gpu: false, micDispositivo: 'Voicemeeter Input' });
  assert.equal(normalizar({ micDispositivo: 'x'.repeat(200) }).micDispositivo.length, 80);
  assert.equal(normalizar({ micDispositivo: '   ' }).micDispositivo, POR_DEFECTO.micDispositivo);
});

test('leerAjustes tolera archivo ausente o roto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-ajustes-'));
  try {
    assert.deepEqual(leerAjustes(dir), POR_DEFECTO);
    fs.writeFileSync(path.join(dir, NOMBRE_ARCHIVO), '{"modo":');
    assert.deepEqual(leerAjustes(dir), POR_DEFECTO);
    fs.writeFileSync(path.join(dir, NOMBRE_ARCHIVO), JSON.stringify({ modo: 'remote', gpu: false }));
    assert.deepEqual(leerAjustes(dir), { modo: 'remote', gpu: false, micDispositivo: 'CABLE Input' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('entornoDeAjustes traduce a variables y respeta las explícitas', () => {
  assert.deepEqual(entornoDeAjustes(POR_DEFECTO, {}), {});
  assert.deepEqual(entornoDeAjustes({ modo: 'both', gpu: false, micDispositivo: 'Voicemeeter Input' }, {}), { NEXO_GPU: '0', NEXO_MIC_DEVICE: 'Voicemeeter Input' });
  // Lo definido en el entorno gana al archivo.
  assert.deepEqual(entornoDeAjustes({ modo: 'both', gpu: false, micDispositivo: 'Otro' }, { NEXO_GPU: '1', NEXO_MIC_DEVICE: 'Mio' }), {});
});
