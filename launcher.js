#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const root = __dirname;
const stateDir = process.env.NEXO_STATE_DIR || root;
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const mode = (process.env.NEXO_MODE || 'both').toLowerCase();
if (!['local', 'remote', 'both'].includes(mode)) throw new Error('NEXO_MODE debe ser local, remote o both');

const statePath = process.env.NEXO_STATE_FILE || path.join(stateDir, '.nexo-state.json');
const stateMode = Number.parseInt(process.env.NEXO_STATE_MODE || '600', 8);
let prior = {};
try { prior = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}
const token = process.env.REMOTE_KEYBOARD_TOKEN || prior.token || crypto.randomBytes(18).toString('base64url');
const port = Number(process.env.REMOTE_KEYBOARD_PORT || 8765);
const cloudflared = process.env.CLOUDFLARED_PATH || path.join(root, 'bin', 'cloudflared');
const children = new Set();
let serverReady = false;
let tunnel = null;
let gpu = null;
let remoteUrl = '';
let stopping = false;
let tunnelFailures = 0;
let watchdog = null;
// Un fallo persistente reintentaba cada segundo sin fin y llenaba el registro.
// La espera crece hasta medio minuto y vuelve a cero cuando el hijo arranca.
let serverBackoff = 1000;
let gpuBackoff = 1500;

function saveState(extra = {}) {
  const state = { token, mode, port, localUrl: localUrl(), remoteUrl, updatedAt: new Date().toISOString(), ...extra };
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', { mode: stateMode });
  fs.chmodSync(statePath, stateMode);
}

function localIp() {
  try {
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const address of addresses || []) if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  } catch {}
  return '127.0.0.1';
}

function localUrl() { return `http://${localIp()}:${port}/?token=${token}`; }
function remoteAccessUrl() { return remoteUrl ? `${remoteUrl}/?token=${token}` : ''; }

function printAccess() {
  console.log('\n╭─ NEXO · ACCESOS ─────────────────────────────────────────');
  if (mode !== 'remote') console.log(`│ LOCAL    ${localUrl()}`);
  if (remoteUrl) console.log(`│ INTERNET ${remoteAccessUrl()}`);
  else if (mode !== 'local') console.log('│ INTERNET conectando…');
  console.log('╰───────────────────────────────────────────────────────────\n');
}

function startServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      REMOTE_KEYBOARD_TOKEN: token,
      REMOTE_KEYBOARD_PORT: String(port),
      REMOTE_KEYBOARD_HOST: mode === 'remote' ? '127.0.0.1' : '0.0.0.0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  children.add(child);
  const output = data => {
    const value = data.toString();
    process.stdout.write(`[servidor] ${value}`);
    if (!serverReady && value.includes('Teclado remoto activo')) {
      serverReady = true;
      serverBackoff = 1000;
      saveState({ status: 'running' });
      printAccess();
      startGpu();
      if (mode !== 'local') startTunnel();
    }
  };
  child.stdout.on('data', output);
  child.stderr.on('data', data => process.stderr.write(`[servidor] ${data}`));
  child.on('close', code => {
    children.delete(child);
    serverReady = false;
    if (!stopping) {
      const delay = serverBackoff;
      serverBackoff = Math.min(30000, serverBackoff * 2);
      console.error(`Servidor detenido (${code}); reintentando en ${Math.round(delay / 1000)} s…`);
      setTimeout(startServer, delay);
    }
  });
}

function startGpu() {
  if (gpu || stopping || process.env.NEXO_GPU === '0') return;
  gpu = spawn(process.execPath, ['gpu-stream.js'], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(gpu);
  gpu.stdout.on('data', data => { gpuBackoff = 1500; process.stdout.write(`[gpu] ${data}`); });
  gpu.stderr.on('data', data => process.stderr.write(`[gpu] ${data}`));
  gpu.on('close', code => {
    children.delete(gpu);
    gpu = null;
    if (!stopping) {
      const delay = gpuBackoff;
      gpuBackoff = Math.min(30000, gpuBackoff * 2);
      console.error(`GPU detenido (${code}); reintentando en ${Math.round(delay / 1000)} s…`);
      setTimeout(startGpu, delay);
    }
  });
}

function startTunnel() {
  if (tunnel || stopping) return;
  if (!fs.existsSync(cloudflared)) throw new Error(`No se encontró cloudflared en ${cloudflared}`);
  const managedToken = process.env.NEXO_TUNNEL_TOKEN;
  const args = managedToken
    ? ['tunnel', '--no-autoupdate', '--protocol', 'http2', 'run', '--token', managedToken]
    : ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`];
  tunnel = spawn(cloudflared, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(tunnel);
  const inspect = data => {
    const value = data.toString();
    const found = value.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (found && found[0] !== remoteUrl) {
      remoteUrl = found[0];
      tunnelFailures = 0;
      saveState({ status: 'running' });
      printAccess();
      if (process.env.NEXO_RECREATE_TUNNEL === '1') startWatchdog();
    }
    if (/ERR|error/i.test(value)) process.stderr.write(`[túnel] ${value}`);
  };
  tunnel.stdout.on('data', inspect);
  tunnel.stderr.on('data', inspect);
  tunnel.on('close', code => {
    children.delete(tunnel);
    tunnel = null;
    remoteUrl = '';
    saveState({ status: stopping ? 'stopped' : 'reconnecting' });
    if (!stopping) { console.error(`Túnel detenido (${code}); reintentando…`); setTimeout(startTunnel, 1500); }
  });
}

function startWatchdog() {
  if (watchdog) return;
  watchdog = setInterval(() => {
    if (!remoteUrl || !tunnel) return;
    const url = new URL('/health', remoteUrl);
    const req = https.get(url, {
      timeout: 8000,
      lookup: (_hostname, options, callback) => options?.all
        ? callback(null, [{ address: '104.16.231.132', family: 4 }])
        : callback(null, '104.16.231.132', 4)
    }, res => {
      res.resume();
      if (res.statusCode === 200) tunnelFailures = 0;
      else tunnelFailures++;
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => {
      if (++tunnelFailures >= 2 && tunnel) {
        console.error('El acceso externo no responde; recreando el túnel…');
        tunnel.kill('SIGTERM');
      }
    });
  }, 30000);
  watchdog.unref();
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  saveState({ status: 'stopped' });
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1200).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', error => { console.error(error); shutdown(); });
startServer();
