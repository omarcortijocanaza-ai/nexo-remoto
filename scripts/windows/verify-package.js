'use strict';

// Verifica el paquete preparado sin abrir la bandeja ni tocar el estado real.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(process.argv[2] || '');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package-manifest.json'), 'utf8'));
const listed = new Set();
for (const file of manifest.files) {
  assert(!path.isAbsolute(file.path) && !file.path.split(/[\\/]/).includes('..'), 'Ruta fuera del paquete');
  assert(!listed.has(file.path), `Ruta duplicada: ${file.path}`);
  assert(!/(^|\/)(\.nexo-|\.git|\.claude|\.env($|\.))|\.(log|pfx|pem|key)$/i.test(file.path), `Archivo privado: ${file.path}`);
  listed.add(file.path);
  const data = fs.readFileSync(path.join(root, file.path));
  assert.equal(data.length, file.bytes, file.path);
  assert.equal(crypto.createHash('sha256').update(data).digest('hex').toUpperCase(), file.sha256, file.path);
}
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    assert(!item.isSymbolicLink(), 'No se permiten enlaces en el paquete');
    const name = path.join(dir, item.name);
    if (item.isDirectory()) walk(name);
    else {
      const rel = path.relative(root, name).split(path.sep).join('/');
      assert(rel === 'package-manifest.json' || listed.has(rel), `Archivo no inventariado: ${rel}`);
    }
  }
}
walk(root);
for (const name of ['nexo-agent', 'nexo-gpu-webrtc', 'nexo-tray', 'nexo-super-bridge']) {
  assert(fs.statSync(path.join(root, 'bin/win', `${name}.exe`)).size > 100000);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-package-'));
try {
  const env = { ...process.env, PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`, NEXO_STATE_DIR: path.join(temp, 'state'), NEXO_LOGS_DIR: path.join(temp, 'logs') };
  delete env.Path;
  function run(exe, args) {
    const result = spawnSync(exe, args, { cwd: root, env, timeout: 30000, encoding: 'utf8', windowsHide: true });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${exe}: ${result.stderr}`);
    return result.stdout.trim();
  }
  run(path.join(root, 'runtime/node/node.exe'), ['-e', "require('./lib/bundled-runtime').prepareBundledRuntime(process.cwd());require('@roamhq/wrtc');require('ws');const s=require('node:child_process').spawnSync('pwsh.exe',['-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.ToString()'],{encoding:'utf8',windowsHide:true});if(s.status!==0)throw Error(s.stderr);console.log(s.stdout)"]);
  run(path.join(root, 'runtime/cloudflared/cloudflared.exe'), ['--version']);
  const ico = path.join(temp, 'nexo.ico');
  run(path.join(root, 'bin/win/nexo-tray.exe'), ['--icono', ico]);
  assert.equal(fs.readFileSync(ico).readUInt16LE(2), 1, 'ICO inválido');
} finally {
  // Sólo borra la carpeta temporal creada por esta prueba.
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log(`OK: ${listed.size} archivos íntegros, sin estado privado; Node/WebRTC/PowerShell/túnel/ICO con PATH mínimo.`);
