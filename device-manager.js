'use strict';

// El token del enlace viaja en la barra de direcciones: queda en el historial,
// en las capturas de pantalla, en lo que se comparte por mensajería y en la
// pestaña de cualquiera que mire por encima del hombro. Aquí el secreto se
// canjea una sola vez —por enlace heredado o por código de emparejamiento— y a
// partir de entonces el navegador se identifica con una cookie que el dueño
// puede revocar dispositivo por dispositivo.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_DEVICE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000;
// Sin O, 0, I ni 1: quien dicta el código por teléfono no debe dudar.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const LAST_SEEN_WRITE_MS = 5 * 60 * 1000;

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeState(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function normalizeCode(value) {
  const upper = String(value || '').toUpperCase();
  let result = '';
  for (const character of upper) if (CODE_ALPHABET.includes(character)) result += character;
  return result;
}

function formatCode(code) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function randomCode() {
  let code = '';
  // `randomInt` evita el sesgo de tomar el resto de un byte aleatorio.
  for (let index = 0; index < CODE_LENGTH; index++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}

function derive(code, salt) {
  return crypto.scryptSync(code, salt, 32).toString('base64url');
}

function createPairing(file, ttlMs = DEFAULT_PAIRING_TTL_MS) {
  const code = randomCode();
  const salt = crypto.randomBytes(16).toString('base64url');
  const expiresAt = Date.now() + Math.max(30000, ttlMs);
  writeState(file, { version: 1, salt, hash: derive(code, salt), expiresAt, used: false });
  return { code: formatCode(code), expiresAt };
}

function pairingStatus(file) {
  const value = readState(file);
  if (!value || value.used || !(value.expiresAt > Date.now())) return { active: false, expiresAt: 0 };
  return { active: true, expiresAt: value.expiresAt };
}

// Un código de ocho caracteres sólo es seguro si no se puede reintentar: se
// invalida al primer uso y el servidor limita los intentos por origen.
function consumePairing(file, code) {
  const value = readState(file);
  if (!value || value.used || !(value.expiresAt > Date.now())) return false;
  const candidate = normalizeCode(code);
  if (candidate.length !== CODE_LENGTH) return false;
  const expected = Buffer.from(value.hash);
  const actual = Buffer.from(derive(candidate, value.salt));
  const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  if (matches) writeState(file, { ...value, used: true, usedAt: new Date().toISOString() });
  return matches;
}

function cancelPairing(file) {
  fs.rmSync(file, { force: true });
}

class DeviceStore {
  constructor(file, maxAgeMs = DEFAULT_DEVICE_MAX_AGE_MS) {
    this.file = file;
    this.maxAgeMs = Math.max(60000, maxAgeMs);
    this.devices = new Map();
    for (const device of readState(file)?.devices || []) {
      if (device?.hash && device.expiresAt > Date.now()) this.devices.set(device.hash, { ...device });
    }
  }

  save() {
    writeState(this.file, { version: 1, devices: [...this.devices.values()] });
  }

  create(label = 'Dispositivo') {
    const secret = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    const device = {
      id: crypto.randomUUID(),
      hash: hashToken(secret),
      label: String(label).slice(0, 60),
      createdAt: now,
      lastSeen: now,
      expiresAt: now + this.maxAgeMs
    };
    this.devices.set(device.hash, device);
    this.save();
    return { secret, device };
  }

  get(secret) {
    if (!secret) return null;
    const device = this.devices.get(hashToken(secret));
    if (!device) return null;
    if (device.expiresAt <= Date.now()) { this.devices.delete(device.hash); this.save(); return null; }
    const now = Date.now();
    // Escribir en cada petición castigaría el disco sin aportar nada: basta
    // con que la última conexión mostrada tenga unos minutos de resolución.
    if (now - device.lastSeen > LAST_SEEN_WRITE_MS) { device.lastSeen = now; this.save(); }
    else device.lastSeen = now;
    return device;
  }

  revoke(id) {
    for (const [hash, device] of this.devices) {
      if (device.id === id) { this.devices.delete(hash); this.save(); return true; }
    }
    return false;
  }

  revokeAllExcept(id) {
    for (const [hash, device] of this.devices) if (device.id !== id) this.devices.delete(hash);
    this.save();
  }

  prune() {
    const now = Date.now();
    let removed = 0;
    for (const [hash, device] of this.devices) if (device.expiresAt <= now) { this.devices.delete(hash); removed++; }
    if (removed) this.save();
    return this.devices.size;
  }

  list() {
    this.prune();
    return [...this.devices.values()].map(({ hash, ...device }) => device);
  }
}

module.exports = {
  CODE_LENGTH,
  DEFAULT_DEVICE_MAX_AGE_MS,
  DEFAULT_PAIRING_TTL_MS,
  DeviceStore,
  cancelPairing,
  consumePairing,
  createPairing,
  formatCode,
  normalizeCode,
  pairingStatus
};
