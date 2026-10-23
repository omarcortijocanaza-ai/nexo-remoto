'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { prepareBundledRuntime } = require('./bundled-runtime');

function fixture(t, names = ['node', 'pwsh', 'ffmpeg', 'cloudflared']) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo bundled '));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'NEXO con espacios');
  for (const name of names) {
    fs.mkdirSync(path.join(root, 'runtime', name), { recursive: true });
    fs.writeFileSync(path.join(root, 'runtime', name, `${name}.exe`), '');
  }
  return root;
}

test('bundle tiene prioridad, conserva PATH y no se duplica al heredarlo', t => {
  const root = fixture(t);
  const previous = 'C:\\Otro Node;C:\\Windows\\System32;C:\\Otro Node';
  const env = { Path: previous };
  const dirs = ['node', 'pwsh', 'ffmpeg', 'cloudflared'].map(name => path.join(root, 'runtime', name));
  assert.equal(prepareBundledRuntime(root, env, 'win32'), env);
  assert.equal(env.Path, [...dirs, previous].join(';'));
  assert.equal(env.PATH, undefined);
  assert.equal(env.NEXO_FFMPEG, path.join(dirs[2], 'ffmpeg.exe'));
  assert.equal(env.CLOUDFLARED_PATH, path.join(dirs[3], 'cloudflared.exe'));
  const inherited = { ...env };
  prepareBundledRuntime(root, inherited, 'win32');
  assert.deepEqual(inherited, env);
});

test('overrides explícitos ganan aunque apunten fuera del bundle', t => {
  const root = fixture(t);
  const env = { PATH: '', nexo_ffmpeg: 'X:\\Mi FFmpeg\\ffmpeg.exe', CLOUDFLARED_PATH: 'custom-cloudflared' };
  prepareBundledRuntime(root, env, 'win32');
  assert.equal(env.nexo_ffmpeg, 'X:\\Mi FFmpeg\\ffmpeg.exe');
  assert.equal(env.NEXO_FFMPEG, undefined);
  assert.equal(env.CLOUDFLARED_PATH, 'custom-cloudflared');
  assert.equal(env.PATH.split(';').length, 4);
});

test('sin bundle conserva el fallback y no crea variables', t => {
  const root = fixture(t, []);
  const env = { Path: 'C:\\Herramientas', NEXO_FFMPEG: 'custom' };
  const before = { ...env };
  prepareBundledRuntime(root, env, 'win32');
  assert.deepEqual(env, before);
});

test('bundle parcial sin PATH sólo anuncia ejecutables presentes', t => {
  const root = fixture(t, ['node']);
  fs.mkdirSync(path.join(root, 'runtime', 'ffmpeg', 'ffmpeg.exe'), { recursive: true });
  const env = {};
  prepareBundledRuntime(root, env, 'win32');
  assert.deepEqual(env, { PATH: path.join(root, 'runtime', 'node') });
});

test('Linux conserva exactamente el entorno incluso con un bundle presente', t => {
  const root = fixture(t);
  const env = { PATH: '/usr/bin:/bin', NEXO_FFMPEG: '/usr/bin/ffmpeg' };
  const before = { ...env };
  prepareBundledRuntime(root, env, 'linux');
  assert.deepEqual(env, before);
});
