'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CODE_LENGTH, DeviceStore, cancelPairing, consumePairing, createPairing, normalizeCode, pairingStatus
} = require('../device-manager');

function temporary() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-device-'));
}

test('el código de emparejamiento sirve una sola vez', () => {
  const directory = temporary(), file = path.join(directory, 'pairing.json');
  const { code } = createPairing(file);
  assert.equal(normalizeCode(code).length, CODE_LENGTH);
  assert.equal(pairingStatus(file).active, true);
  assert.equal(consumePairing(file, code), true);
  assert.equal(consumePairing(file, code), false);
  assert.equal(pairingStatus(file).active, false);
  fs.rmSync(directory, { recursive: true });
});

test('el código se acepta con minúsculas, espacios y guiones, y se rechaza el ajeno', () => {
  const directory = temporary(), file = path.join(directory, 'pairing.json');
  const { code } = createPairing(file);
  const plain = normalizeCode(code);
  assert.equal(consumePairing(file, 'XXXX-XXXX'), false);
  assert.equal(consumePairing(file, ` ${plain.slice(0, 4).toLowerCase()} ${plain.slice(4)} `), true);
  fs.rmSync(directory, { recursive: true });
});

test('un código caducado o cancelado no abre nada', () => {
  const directory = temporary(), file = path.join(directory, 'pairing.json');
  const { code } = createPairing(file, 30000);
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...state, expiresAt: Date.now() - 1 }));
  assert.equal(consumePairing(file, code), false);
  const second = createPairing(file);
  cancelPairing(file);
  assert.equal(consumePairing(file, second.code), false);
  fs.rmSync(directory, { recursive: true });
});

test('el archivo de emparejamiento no guarda el código en claro', () => {
  const directory = temporary(), file = path.join(directory, 'pairing.json');
  const { code } = createPairing(file);
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.includes(normalizeCode(code)), false);
  // En Windows los modos POSIX (0600) no existen; la protección se hace con ACL en F8/F9.
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  fs.rmSync(directory, { recursive: true });
});

test('los dispositivos sobreviven al reinicio y se revocan por separado', () => {
  const directory = temporary(), file = path.join(directory, 'devices.json');
  const store = new DeviceStore(file);
  const first = store.create('Celular');
  const second = store.create('Portátil');
  assert.equal(store.get(first.secret).id, first.device.id);

  const revived = new DeviceStore(file);
  assert.equal(revived.get(second.secret).label, 'Portátil');
  assert.equal('hash' in revived.list()[0], false);
  assert.equal(fs.readFileSync(file, 'utf8').includes(first.secret), false);

  revived.revokeAllExcept(first.device.id);
  assert.deepEqual(revived.list().map(item => item.id), [first.device.id]);
  assert.equal(revived.get(second.secret), null);
  assert.equal(revived.revoke(first.device.id), true);
  assert.equal(revived.get(first.secret), null);
  fs.rmSync(directory, { recursive: true });
});

test('un dispositivo caducado deja de valer aunque siga en el archivo', () => {
  const directory = temporary(), file = path.join(directory, 'devices.json');
  const store = new DeviceStore(file, 60000);
  const { secret, device } = store.create('Celular');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.devices[0].expiresAt = Date.now() - 1;
  fs.writeFileSync(file, JSON.stringify(state));
  const revived = new DeviceStore(file, 60000);
  assert.equal(revived.get(secret), null);
  assert.equal(revived.list().find(item => item.id === device.id), undefined);
  fs.rmSync(directory, { recursive: true });
});
