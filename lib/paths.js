'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function defaultStateDir(root = path.resolve(__dirname, '..')) {
  if (process.env.NEXO_STATE_DIR) return process.env.NEXO_STATE_DIR;
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'NEXO', 'state');
  }
  return root;
}

function logsDir(root = path.resolve(__dirname, '..')) {
  if (process.env.NEXO_LOGS_DIR) return process.env.NEXO_LOGS_DIR;
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'NEXO', 'logs');
  }
  return root;
}

// Crea la carpeta de estado privada. El modo 0700 sólo protege en Linux; en
// Windows la restringe la ACL que instala install-autostart.ps1 (sección 4.6).
function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

module.exports = { defaultStateDir, logsDir, ensurePrivateDir };
