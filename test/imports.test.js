'use strict';

// Red de seguridad contra un fallo que ya ocurrió: módulos que
// desestructuran de un módulo propio funciones que éste nunca exportó
// (killTree, ensurePrivateDir, readJsonSafe). Node no se queja al cargar el
// archivo; revienta mucho después, en la primera llamada, y las pruebas
// unitarias no lo ven porque nunca importan los scripts que se ejecutan solos
// (gpu-stream-windows.js, launcher.js). Aquí se comprueba de forma estática.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const OMITIR_DIRS = new Set(['node_modules', '.git', 'bin', 'greeter', 'headless', 'windows-helper', 'docs', 'native', 'gpu-webrtc']);
// Sólo Linux: llaman a process.getuid() al cargarse.
const SOLO_LINUX = new Set(['entorno.js', 'entrada-x11.js', 'gpu-stream.js', 'microfono-virtual.js']);
const SOLO_LINUX_DIR = `${path.sep}platform${path.sep}linux${path.sep}`;

function* archivosJs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (OMITIR_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* archivosJs(full);
    else if (entry.name.endsWith('.js')) yield full;
  }
}

function esSoloLinux(file) {
  return SOLO_LINUX.has(path.basename(file)) || file.includes(SOLO_LINUX_DIR);
}

test('toda importación desestructurada de un módulo propio existe en sus exportaciones', () => {
  const problemas = [];
  for (const file of archivosJs(root)) {
    if (process.platform === 'win32' && esSoloLinux(file)) continue;
    const fuente = fs.readFileSync(file, 'utf8');
    for (const m of fuente.matchAll(/const\s*\{([^}]+)\}\s*=\s*require\('(\.{1,2}\/[^']+)'\)/g)) {
      const destino = path.resolve(path.dirname(file), m[2]);
      const relativo = path.relative(root, file);
      if (process.platform === 'win32' && esSoloLinux(destino + '.js')) continue;
      let modulo;
      try {
        modulo = require(destino);
      } catch (error) {
        problemas.push(`${relativo}: no se pudo cargar ${m[2]} (${error.message.split('\n')[0]})`);
        continue;
      }
      for (const nombre of m[1].split(',').map(s => s.trim().split(':')[0].trim()).filter(Boolean)) {
        if (!(nombre in modulo)) problemas.push(`${relativo}: ${m[2]} no exporta ${nombre}`);
      }
    }
  }
  assert.deepEqual(problemas, []);
});
