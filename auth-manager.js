#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_LENGTH = 32;
const DEFAULT_MAX_AGE_MS = 8 * 60 * 60 * 1000;

function authPath(stateDir, override) {
  return override || path.join(stateDir, '.nexo-auth.json');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, KEY_LENGTH).toString('base64url');
}

function loadAuth(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof value.username === 'string' && typeof value.salt === 'string' && typeof value.hash === 'string') return value;
  } catch {}
  return null;
}

function saveAuth(file, username, password) {
  if (!/^[\p{L}\p{N}_.-]{2,40}$/u.test(username)) throw new Error('Usuario inválido');
  if (String(password).length < 10 || String(password).length > 256) throw new Error('La contraseña debe tener entre 10 y 256 caracteres');
  const salt = crypto.randomBytes(18).toString('base64url');
  const prior = loadAuth(file);
  const value = {
    version: 1,
    username,
    salt,
    hash: hashPassword(password, salt),
    createdAt: prior?.createdAt || new Date().toISOString(),
    passwordChangedAt: new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return value;
}

function verifyAuth(config, username, password) {
  if (!config || typeof username !== 'string' || typeof password !== 'string') return false;
  const expectedUser = Buffer.from(config.username);
  const actualUser = Buffer.from(username);
  const userMatches = expectedUser.length === actualUser.length && crypto.timingSafeEqual(expectedUser, actualUser);
  const expectedHash = Buffer.from(config.hash);
  const actualHash = Buffer.from(hashPassword(password, config.salt));
  return userMatches && expectedHash.length === actualHash.length && crypto.timingSafeEqual(expectedHash, actualHash);
}

class SessionStore {
  constructor(maxAgeMs = DEFAULT_MAX_AGE_MS) {
    this.maxAgeMs = maxAgeMs;
    this.sessions = new Map();
  }

  create(label = 'Navegador') {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    const session = { id: crypto.randomUUID(), token, label: String(label).slice(0, 60), createdAt: now, lastSeen: now, expiresAt: now + this.maxAgeMs };
    this.sessions.set(token, session);
    return session;
  }

  get(token) {
    const session = token && this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) { this.sessions.delete(token); return null; }
    session.lastSeen = Date.now();
    return session;
  }

  revoke(id) {
    for (const [token, session] of this.sessions) if (session.id === id) { this.sessions.delete(token); return true; }
    return false;
  }

  revokeAllExcept(id) {
    for (const [token, session] of this.sessions) if (session.id !== id) this.sessions.delete(token);
  }

  // Sin barrido periódico, una sesión caducada sólo desaparecía si alguien
  // volvía a consultarla: el servidor puede pasar días sin que eso ocurra.
  prune() {
    const now = Date.now();
    for (const [token, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(token);
    return this.sessions.size;
  }

  list() {
    this.prune();
    return [...this.sessions.values()].map(({ token, ...session }) => session);
  }
}

function randomPassword() {
  return `${crypto.randomBytes(6).toString('base64url')}-${crypto.randomBytes(6).toString('base64url')}`;
}

module.exports = { DEFAULT_MAX_AGE_MS, SessionStore, authPath, loadAuth, randomPassword, saveAuth, verifyAuth };

if (require.main === module) {
  const { defaultStateDir } = require('./lib/paths');
  const stateDir = defaultStateDir(__dirname);
  const file = authPath(stateDir, process.env.NEXO_AUTH_FILE);
  const command = process.argv[2] || 'status';
  if (command === 'init') {
    const existing = loadAuth(file);
    if (existing) { console.log(`Credenciales ya configuradas para ${existing.username}`); process.exit(0); }
    const username = process.argv[3] || process.env.USER || 'Letzus';
    const password = randomPassword();
    saveAuth(file, username, password);
    console.log(`Usuario: ${username}`);
    console.log(`Contraseña temporal: ${password}`);
    console.log('Cámbiala con: nexo-control credentials set');
  } else if (command === 'set') {
    const username = process.argv[3] || loadAuth(file)?.username || process.env.USER || 'Letzus';
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { input += chunk; if (input.length > 512) process.exit(2); });
    process.stdin.on('end', () => {
      saveAuth(file, username, input.replace(/[\r\n]+$/, ''));
      console.log(`Contraseña actualizada para ${username}`);
    });
  } else if (command === 'status') {
    const existing = loadAuth(file);
    console.log(existing ? `Credenciales configuradas para ${existing.username}` : 'Credenciales no configuradas');
    process.exit(existing ? 0 : 1);
  } else {
    console.error('Uso: auth-manager.js {init [usuario]|set [usuario]|status}');
    process.exit(2);
  }
}
