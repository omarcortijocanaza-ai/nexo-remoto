'use strict';

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

module.exports = { defaultStateDir, logsDir };
