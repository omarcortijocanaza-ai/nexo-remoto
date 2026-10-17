'use strict';

const fs = require('fs');
const path = require('path');

function safeDecode(texto) {
  if (typeof texto !== 'string') return null;
  try {
    return decodeURIComponent(texto);
  } catch {
    return null;
  }
}

function cookieValue(reqOrHeader, name) {
  const rawCookie = typeof reqOrHeader === 'string'
    ? reqOrHeader
    : String(reqOrHeader?.headers?.cookie || '');
  const cookies = rawCookie.split(';');
  for (const item of cookies) {
    const [key, ...parts] = item.trim().split('=');
    if (key === name) {
      const decoded = safeDecode(parts.join('='));
      return decoded === null ? '' : decoded;
    }
  }
  return '';
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* espera síncrona de respaldo */ }
  }
}

function atomicWriteJson(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  const payload = JSON.stringify(value, null, 2) + '\n';
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'w', mode);
    fs.writeFileSync(fd, payload, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    if (process.platform !== 'win32') {
      fs.chmodSync(tmp, mode);
    }
    const maxAttempts = process.platform === 'win32' ? 5 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        fs.renameSync(tmp, file);
        break;
      } catch (error) {
        const retryable = process.platform === 'win32' && ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code);
        if (!retryable || attempt === maxAttempts) throw error;
        sleepSync(50);
      }
    }
    if (process.platform !== 'win32') {
      fs.chmodSync(file, mode);
    }
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw error;
  }
}

module.exports = { atomicWriteJson, cookieValue, safeDecode };
