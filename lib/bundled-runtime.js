'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Sólo modifica el entorno de este proceso; Linux y los checkouts sin bundle
// conservan sus búsquedas habituales. La raíz es la del launcher, nunca el cwd.
function prepareBundledRuntime(appRoot, env = process.env, platform = process.platform) {
  if (platform !== 'win32') return env;
  const root = path.resolve(appRoot);
  // Windows ignora mayúsculas en variables, pero los objetos pasados a spawn no.
  const keyFor = name => Object.keys(env).find(key => key.toUpperCase() === name) || name;
  const dirs = [];
  for (const [name, variable] of [
    ['node', null], ['pwsh', null], ['ffmpeg', 'NEXO_FFMPEG'], ['cloudflared', 'CLOUDFLARED_PATH']
  ]) {
    const bin = path.join(root, 'runtime', name, `${name}.exe`);
    try {
      if (!fs.statSync(bin).isFile()) continue;
    } catch { continue; }
    dirs.push(path.dirname(bin));
    if (variable) {
      const key = keyFor(variable);
      if (!env[key]) env[key] = bin;
    }
  }
  if (!dirs.length) return env;
  const key = keyFor('PATH');
  const bundled = new Set(dirs.map(dir => path.normalize(dir).toLowerCase()));
  const previous = env[key] ? env[key].split(';') : [];
  env[key] = [...dirs, ...previous.filter(dir => !bundled.has(path.normalize(dir).toLowerCase()))].join(';');
  return env;
}

module.exports = { prepareBundledRuntime };
