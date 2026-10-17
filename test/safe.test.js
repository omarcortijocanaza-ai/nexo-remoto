'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { atomicWriteJson, cookieValue, readJsonSafe, safeDecode } = require('../lib/safe');

test('safeDecode decodifica cadenas válidas y devuelve null ante secuencias inválidas', () => {
  assert.equal(safeDecode('hola%20mundo'), 'hola mundo');
  assert.equal(safeDecode('ñandú'), 'ñandú');
  assert.equal(safeDecode('%'), null);
  assert.equal(safeDecode('%E0%A4%A'), null);
  assert.equal(safeDecode(null), null);
});

test('cookieValue tolera cookies malformadas sin lanzar URIError', () => {
  assert.equal(cookieValue('nexo_device=%', 'nexo_device'), '');
  assert.equal(cookieValue('nexo_device=%E0%A4%A', 'nexo_device'), '');
  assert.equal(cookieValue('otra=1; nexo_device=secreto%2B1; fin=2', 'nexo_device'), 'secreto+1');
  assert.equal(cookieValue({ headers: { cookie: 'nexo_device=%' } }, 'nexo_device'), '');
  assert.equal(cookieValue({ headers: { cookie: 'nexo_device=abc123' } }, 'nexo_device'), 'abc123');
});

test('atomicWriteJson escribe, sobrescribe y no deja archivos .tmp', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-safe-test-'));
  try {
    const file = path.join(dir, 'estado.json');
    atomicWriteJson(file, { a: 1, texto: 'primero' });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1, texto: 'primero' });

    atomicWriteJson(file, { a: 2, texto: 'segundo' });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 2, texto: 'segundo' });

    const entries = fs.readdirSync(dir);
    assert.deepEqual(entries, ['estado.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readJsonSafe devuelve el contenido o el valor de respaldo sin lanzar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-safe-'));
  try {
    const bueno = path.join(dir, 'bueno.json');
    const roto = path.join(dir, 'roto.json');
    fs.writeFileSync(bueno, '{"a":1}');
    fs.writeFileSync(roto, '{"a":');
    assert.deepEqual(readJsonSafe(bueno, null), { a: 1 });
    assert.equal(readJsonSafe(roto, null), null);
    assert.deepEqual(readJsonSafe(path.join(dir, 'no-existe.json'), { b: 2 }), { b: 2 });
    assert.equal(readJsonSafe(path.join(dir, 'no-existe.json')), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
