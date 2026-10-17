'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const test = require('node:test');

const { killTree } = require('../lib/proc');
const paths = require('../lib/paths');

function vivo(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

test('killTree mata un proceso vivo y sus nietos', async () => {
  // El hijo lanza a su vez un nieto que duerme: sin /T quedaría huérfano.
  const hijo = spawn(process.execPath, ['-e', `
    const { spawn } = require('child_process');
    const nieto = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    console.log(nieto.pid);
    setInterval(()=>{},1000);
  `], { stdio: ['ignore', 'pipe', 'ignore'] });
  const nieto = await new Promise(resolve => hijo.stdout.once('data', d => resolve(Number(String(d).trim()))));
  assert.ok(vivo(hijo.pid) && vivo(nieto));
  const mato = await killTree(hijo.pid, 0);
  assert.equal(mato, true);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(vivo(hijo.pid), false);
  if (process.platform === 'win32') assert.equal(vivo(nieto), false, 'el nieto debe morir con taskkill /T');
  else try { process.kill(nieto, 'SIGKILL'); } catch {}
});

test('killTree no toca PIDs inválidos, el propio ni procesos ya muertos', async () => {
  assert.equal(await killTree(0), false);
  assert.equal(await killTree(-5), false);
  assert.equal(await killTree('abc'), false);
  assert.equal(await killTree(process.pid), false);
  const hijo = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  await new Promise(resolve => hijo.once('close', resolve));
  assert.equal(await killTree(hijo.pid, 0), false);
});

test('killTree respeta la gracia: un proceso que sale solo no se fuerza', async () => {
  const hijo = spawn(process.execPath, ['-e', 'setTimeout(()=>process.exit(0), 150)'], { stdio: 'ignore' });
  const inicio = Date.now();
  const forzado = await killTree(hijo.pid, 3000);
  assert.equal(forzado, false);
  assert.ok(Date.now() - inicio < 2500);
});

test('lib/paths exporta ensurePrivateDir y crea la carpeta', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-paths-'));
  try {
    const destino = path.join(base, 'a', 'b');
    assert.equal(paths.ensurePrivateDir(destino), destino);
    assert.ok(fs.statSync(destino).isDirectory());
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
