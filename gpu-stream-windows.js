#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { defaultStateDir, ensurePrivateDir } = require('./lib/paths');
const { killTree } = require('./lib/proc');
const { readJsonSafe } = require('./lib/safe');
const { AgentClient } = require('./platform/windows/agent-client');
const {
  findFfmpeg,
  gpuStreamArgs,
  invalidateGpuChainCache,
  profileBitrateKbps,
  profileDimensions,
  selectAndProbeGpuChain
} = require('./platform/windows/ffmpeg');

const root = __dirname;
const stateDir = defaultStateDir(root);
ensurePrivateDir(stateDir);

const rtpPort = Math.max(1024, Math.min(65535, Number(process.env.NEXO_GPU_RTP_PORT) || 5004));
const bridgePort = Math.max(1024, Math.min(65535, Number(process.env.NEXO_GPU_WEBRTC_PORT) || 9090));
const idleStopMs = Math.max(2000, Number(process.env.NEXO_GPU_IDLE_STOP_MS) || 60000);
const monitorStatePath = process.env.NEXO_MONITOR_STATE || path.join(stateDir, '.nexo-monitor.json');
const profileStatePath = process.env.NEXO_GPU_PROFILE_STATE || path.join(stateDir, '.nexo-gpu-profile.json');

let monitorName = process.env.NEXO_MONITOR || '';
let height = Number(process.env.NEXO_GPU_HEIGHT || 1080);
let width = Number(process.env.NEXO_GPU_WIDTH || Math.round(height * 16 / 9));
let fps = Number(process.env.NEXO_GPU_FPS || 60);
let bitrate = Number(process.env.NEXO_GPU_BITRATE || 10000);
let mediaKey = '';

let bridge = null;
let bridgeFps = 0;
let bridgeReady = false;
let recorder = null;
let startingMedia = false;
let stopping = false;
let restartTimer = null;
let reconfiguring = false;
let paused = false;
let secureDesktop = false;
let idleSince = Date.now();
let failBackoffMs = 1000;
let quickFailures = 0;
let activeChain = '';
let cachedMonitors = [];

const agent = new AgentClient({
  log: msg => console.error(msg)
});

agent.on('desktop-state', state => {
  const isSecure = state === 'secure';
  if (isSecure === secureDesktop) return;
  secureDesktop = isSecure;
  if (secureDesktop) {
    console.log('GPU en pausa: Windows muestra una pantalla protegida (secure desktop)');
    clearTimeout(restartTimer);
    restartTimer = null;
    stopRecorder();
  } else {
    console.log('Pantalla protegida cerrada (desktop normal); reanudando captura GPU');
    failBackoffMs = 1000;
    if (!paused && !stopping) {
      startMedia().catch(err => console.error(`[GPU] ${err.message}`));
    }
  }
});

agent.on('displays-changed', () => {
  refreshMonitors().catch(() => {});
});

async function refreshMonitors() {
  try {
    const res = await agent.call('monitors');
    if (Array.isArray(res?.monitors) && res.monitors.length > 0) {
      cachedMonitors = res.monitors;
    }
  } catch (err) {
    console.error(`[GPU/Monitores] ${err.message}`);
  }
  return cachedMonitors;
}

function selectedMonitorName() {
  const saved = readJsonSafe(monitorStatePath, null);
  if (saved && typeof saved.name === 'string' && saved.name.trim()) {
    return saved.name.trim();
  }
  return monitorName;
}

async function resolveMonitorObject(preferredName) {
  if (!cachedMonitors.length) {
    await refreshMonitors();
  }
  let match = cachedMonitors.find(m => m.name === preferredName);
  if (!match && preferredName) {
    await refreshMonitors();
    match = cachedMonitors.find(m => m.name === preferredName);
  }
  if (!match) {
    match = cachedMonitors.find(m => m.primary) || cachedMonitors[0] || {
      index: 0,
      name: preferredName || '\\\\.\\DISPLAY1',
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      primary: true
    };
  }
  return match;
}

function selectedProfile() {
  const profile = readJsonSafe(profileStatePath, null);
  if (
    profile &&
    [30, 45, 60].includes(Number(profile.fps)) &&
    [720, 900, 1080].includes(Number(profile.height))
  ) {
    const nextHeight = Number(profile.height);
    const dims = profileDimensions(nextHeight);
    return {
      fps: Number(profile.fps),
      height: dims.height,
      width: dims.width,
      bitrate: profileBitrateKbps(dims.height, process.env.NEXO_GPU_BITRATE)
    };
  }
  const dims = profileDimensions(height, width);
  return {
    fps: [30, 45, 60].includes(fps) ? fps : 60,
    height: dims.height,
    width: dims.width,
    bitrate: profileBitrateKbps(dims.height, process.env.NEXO_GPU_BITRATE || bitrate)
  };
}

function bridgeExecutable() {
  if (process.env.NEXO_GPU_BRIDGE_PATH) {
    return process.env.NEXO_GPU_BRIDGE_PATH;
  }
  return path.join(root, 'bin', 'win', 'nexo-gpu-webrtc.exe');
}

function startBridge() {
  if (bridge || stopping) return;
  const currentProfile = selectedProfile();
  bridgeFps = currentProfile.fps;
  bridgeReady = false;
  const binPath = bridgeExecutable();

  bridge = spawn(binPath, [], {
    env: {
      ...process.env,
      NEXO_GPU_FPS: String(bridgeFps),
      NEXO_GPU_RTP_PORT: String(rtpPort),
      NEXO_GPU_WEBRTC_PORT: String(bridgePort),
      NEXO_EXIT_ON_STDIN_EOF: '1'
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  bridge.stdin.on('error', () => {});
  bridge.stdout.on('data', data => {
    bridgeReady = true;
    process.stdout.write(`[GPU/WebRTC] ${data}`);
  });
  bridge.stderr.on('data', data => {
    bridgeReady = true;
    process.stderr.write(`[GPU/WebRTC] ${data}`);
  });
  bridge.on('error', error => console.error(`[GPU/WebRTC] ${error.message}`));
  bridge.on('close', code => {
    bridge = null;
    bridgeFps = 0;
    bridgeReady = false;
    if (!stopping) {
      console.error(`Puente GPU terminó (${code}); reintentando…`);
      setTimeout(startBridge, 1000);
    }
  });
}

function stopBridgeChild() {
  if (!bridge) return;
  const b = bridge;
  try { b.stdin.end(); } catch {}
  setTimeout(() => {
    if (b.exitCode === null) {
      killTree(b.pid, 300).catch(() => {});
    }
  }, 500).unref();
}

function stopRecorder() {
  if (!recorder) return;
  const r = recorder;
  recorder = null;
  try { r.kill(); } catch {}
  if (r.pid) {
    killTree(r.pid, 400).catch(() => {});
  }
}

function fetchBridgeJson(reqPath = '/health') {
  return new Promise(resolve => {
    const request = http.get({
      host: '127.0.0.1',
      port: bridgePort,
      path: reqPath,
      timeout: 700
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
    request.on('error', () => resolve(null));
  });
}

async function bridgePeers() {
  const data = await fetchBridgeJson('/health');
  if (!data) return null;
  const value = Number(data.peers);
  return Number.isFinite(value) ? value : null;
}

async function waitForBridgeUp(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !stopping) {
    const stats = await fetchBridgeJson('/stats');
    if (stats && stats.ok) return stats;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
}

async function startMedia() {
  if (paused || stopping || secureDesktop) return;
  if (recorder || startingMedia) return;
  startingMedia = true;

  try {
    // Consultar estado de escritorio por si arrancamos directamente en pantalla bloqueada
    try {
      const desk = await agent.call('desktop.state');
      if (desk?.state === 'secure') {
        secureDesktop = true;
        console.log('GPU en espera: escritorio protegido activo');
        return;
      }
    } catch {}

    const targetMonName = selectedMonitorName();
    const monObj = await resolveMonitorObject(targetMonName);
    monitorName = monObj.name;
    const profile = selectedProfile();
    width = profile.width;
    height = profile.height;
    fps = profile.fps;
    bitrate = profile.bitrate;

    if (!bridge) {
      startBridge();
    } else if (bridgeFps !== fps) {
      stopBridgeChild();
    }

    await waitForBridgeUp(4000);
    if (paused || stopping || secureDesktop) return;

    const ffmpegBin = findFfmpeg();
    const probeResult = await selectAndProbeGpuChain({
      stateDir,
      ffmpegBin,
      index: monObj.index,
      fps,
      width,
      height,
      bitrateKbps: bitrate,
      rtpPort,
      monitor: monObj,
      getBridgeStats: () => fetchBridgeJson('/stats'),
      durationMs: Number(process.env.NEXO_GPU_PROBE_MS) || 3000,
      log: msg => console.log(msg)
    });

    if (paused || stopping || secureDesktop) return;

    activeChain = probeResult.chain;
    mediaKey = `${monObj.name}#${monObj.index}:${width}x${height}@${fps}:${bitrate}`;
    reconfiguring = false;

    const args = gpuStreamArgs({
      chain: activeChain,
      index: monObj.index,
      fps,
      width,
      height,
      bitrateKbps: bitrate,
      rtpPort,
      monitor: monObj
    });

    const startedAt = Date.now();
    const child = spawn(ffmpegBin, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true
    });
    recorder = child;

    child.stderr.on('data', data => {
      const line = data.toString().trim();
      if (line) process.stderr.write(`[GPU/FFmpeg] ${line}\n`);
    });
    child.on('error', error => console.error(`[GPU/FFmpeg] ${error.message}`));
    child.on('close', code => {
      if (recorder === child) {
        recorder = null;
      }
      if (stopping || paused || secureDesktop) return;
      if (reconfiguring) {
        failBackoffMs = 1000;
        quickFailures = 0;
        scheduleMediaRestart('', 150);
        return;
      }
      const livedMs = Date.now() - startedAt;
      if (livedMs > 10000) {
        failBackoffMs = 1000;
        quickFailures = 0;
      } else {
        failBackoffMs = Math.min(5000, failBackoffMs * 2);
        // Tres muertes rápidas seguidas con la misma cadena: la recordada ya no
        // sirve (driver, monitor o GPU distintos). Se descarta para volver a sondear.
        if (++quickFailures >= 3) {
          quickFailures = 0;
          invalidateGpuChainCache(stateDir);
          console.error('[GPU] La cadena recordada falla seguido; se volverá a sondear');
        }
      }
      scheduleMediaRestart(`Captura GPU (${activeChain}) terminó (${code})`, failBackoffMs);
    });

    console.log(`GPU activa: ${monObj.name} (output_idx=${monObj.index}) · cadena=${activeChain} · ${width}x${height}@${fps} · NVENC ${bitrate} kbps`);
  } catch (err) {
    if (!stopping && !paused && !secureDesktop) {
      scheduleMediaRestart(`Error iniciando GPU: ${err.message}`, failBackoffMs);
      failBackoffMs = Math.min(5000, failBackoffMs * 2);
    }
  } finally {
    startingMedia = false;
  }
}

function scheduleMediaRestart(reason = '', delayMs = 1000) {
  if (paused || stopping || secureDesktop || restartTimer) return;
  if (reason) console.error(`${reason}; reintentando en ${delayMs} ms…`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (recorder || startingMedia) return scheduleMediaRestart('', 300);
    startMedia();
  }, delayMs);
}

function pauseMedia(reason) {
  if (paused || stopping) return;
  paused = true;
  clearTimeout(restartTimer);
  restartTimer = null;
  mediaKey = '';
  console.log(`GPU en reposo: ${reason}`);
  stopRecorder();
}

function resumeMedia() {
  if (!paused || stopping) return;
  paused = false;
  idleSince = Date.now();
  failBackoffMs = 1000;
  console.log('GPU reactivada: hay un cliente conectado');
  startMedia();
}

function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(restartTimer);
  restartTimer = null;

  const recPid = recorder?.pid;
  const brPid = bridge?.pid;

  try { recorder?.kill(); } catch {}
  try { bridge?.stdin?.end(); } catch {}
  try { bridge?.kill(); } catch {}
  agent.close().catch(() => {});

  setTimeout(async () => {
    if (recPid) await killTree(recPid, 200);
    if (brPid) await killTree(brPid, 200);
    process.exit(0);
  }, 900).unref();
}

process.on('SIGTERM', stop);
process.on('SIGINT', stop);
// Si el lanzador muere, el canal IPC se cierra: sin esto quedaríamos huérfanos.
process.on('disconnect', stop);
process.on('message', msg => {
  if (msg && msg.type === 'shutdown') {
    stop();
  }
});

if (process.env.NEXO_EXIT_ON_STDIN_EOF === '1') {
  process.stdin.resume();
  process.stdin.on('end', stop);
  process.stdin.on('close', stop);
}

// Vigilancia de reposo por falta de pares en el puente Pion (cada 500 ms)
setInterval(async () => {
  if (stopping) return;
  const peers = await bridgePeers();
  if (peers === null) return;
  if (peers > 0) {
    idleSince = Date.now();
    return resumeMedia();
  }
  if (!paused && Date.now() - idleSince >= idleStopMs) {
    pauseMedia(`sin clientes durante ${Math.round(idleStopMs / 1000)} s`);
  }
}, 500).unref();

// Reconfiguración en caliente cada 700 ms si cambian monitor o perfil
setInterval(async () => {
  if (stopping || paused || secureDesktop || reconfiguring || startingMedia) return;
  const wantedMon = selectedMonitorName();
  const monObj = await resolveMonitorObject(wantedMon);
  const profile = selectedProfile();
  const nextKey = `${monObj.name}#${monObj.index}:${profile.width}x${profile.height}@${profile.fps}:${profile.bitrate}`;
  if (!mediaKey || nextKey === mediaKey) return;
  reconfiguring = true;
  monitorName = monObj.name;
  console.log(`Reconfigurando GPU: ${nextKey}`);
  if (bridge && bridgeFps !== profile.fps) {
    stopBridgeChild();
  }
  stopRecorder();
}, 700).unref();

startBridge();
startMedia();
