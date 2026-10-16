'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SessionStore, loadAuth, saveAuth, verifyAuth } = require('../auth-manager');

test('guarda contraseña con scrypt y verifica sin texto plano', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-auth-'));
  const file = path.join(directory, 'auth.json');
  saveAuth(file, 'Letzus', 'una-clave-segura-123');
  const raw = fs.readFileSync(file, 'utf8');
  const config = loadAuth(file);
  assert.equal(raw.includes('una-clave-segura-123'), false);
  assert.equal(verifyAuth(config, 'Letzus', 'una-clave-segura-123'), true);
  assert.equal(verifyAuth(config, 'Letzus', 'incorrecta'), false);
  fs.rmSync(directory, { recursive: true });
});

test('descarta sesiones caducadas sin que nadie las consulte', () => {
  const store = new SessionStore(-1);
  store.create('Chrome');
  store.create('Firefox');
  assert.equal(store.sessions.size, 2);
  assert.equal(store.prune(), 0);
  assert.equal(store.sessions.size, 0);
});

test('crea, enumera y revoca sesiones sin exponer su token', () => {
  const store = new SessionStore(5000);
  const first = store.create('Chrome');
  const second = store.create('Firefox');
  assert.equal(store.get(first.token).id, first.id);
  assert.equal('token' in store.list()[0], false);
  store.revokeAllExcept(first.id);
  assert.deepEqual(store.list().map(item => item.id), [first.id]);
  assert.equal(store.revoke(first.id), true);
  assert.equal(store.get(second.token), null);
});
