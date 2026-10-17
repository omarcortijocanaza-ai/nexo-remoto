'use strict';

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { killTree } = require('../../lib/proc');
const { AgentClient } = require('./agent-client');
const keymap = require('./keymap');
const { findFfmpeg, jpegStreamArgs, screenshotArgs, JpegSplitter } = require('./ffmpeg');

const capabilities = Object.freeze({
  gpuVideo: true,
  cpuVideo: true,
  systemAudio: true,
  virtualMic: true,
  independentSession: false,
  loginScreen: false,
  textBatchMs: 0
});

const emitter = new EventEmitter();
let logFn = msg => console.error(msg);
let agent = null;
let desktopState = 'normal';
let activeJpegController = null;
let inputQueue = Promise.resolve();
let lastUipiWarningAt = 0;

function enqueueInput(task) {
  const job = inputQueue.then(task);
  inputQueue = job.catch(() => {});
  return job;
}

function ensureAgent() {
  if (!agent) {
    agent = new AgentClient({ log: msg => logFn(msg) });
    agent.on('desktop-state', state => {
      const prev = desktopState;
      desktopState = state === 'secure' ? 'secure' : 'normal';
      if (prev !== desktopState) {
        logFn(`[windows] Estado del escritorio de entrada: ${desktopState}`);
        emitter.emit('desktop-state', desktopState);
      }
      if (desktopState === 'normal' && activeJpegController) {
        activeJpegController.resumeFromSecure();
      } else if (desktopState === 'secure' && activeJpegController) {
        activeJpegController.pauseForSecure();
      }
    });
    agent.on('displays-changed', () => {
      emitter.emit('displays-changed');
    });
  }
  return agent;
}

async function init(options = {}) {
  if (typeof options.log === 'function') {
    logFn = options.log;
  }
  const client = ensureAgent();
  await client.start();
  try {
    const st = await client.call('desktop.state');
    if (st && st.state) {
      desktopState = st.state === 'secure' ? 'secure' : 'normal';
    }
  } catch {}
}

async function close() {
  if (activeJpegController) {
    activeJpegController.stop();
    activeJpegController = null;
  }
  if (agent) {
    const current = agent;
    agent = null;
    await current.close();
  }
}

async function listMonitors() {
  const client = ensureAgent();
  const res = await client.call('monitors');
  const list = Array.isArray(res.monitors) ? res.monitors : [];
  return list.map((item, idx) => ({
    index: item.index ?? idx,
    name: item.name || `\\\\.\\DISPLAY${(item.index ?? idx) + 1}`,
    description: item.description || item.name || `Monitor ${(item.index ?? idx) + 1}`,
    x: Number(item.x) || 0,
    y: Number(item.y) || 0,
    width: Number(item.width) || 1920,
    height: Number(item.height) || 1080,
    primary: Boolean(item.primary),
    rotation: Number(item.rotation) || 0
  }));
}

function toAbsoluteCoords(data, monitor) {
  const nx = Math.max(0, Math.min(1, Number(data?.x)));
  const ny = Math.max(0, Math.min(1, Number(data?.y)));
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    throw new Error('Coordenadas inválidas');
  }
  const mx = Number(monitor?.x) || 0;
  const my = Number(monitor?.y) || 0;
  const mw = Math.max(1, Number(monitor?.width) || 1920);
  const mh = Math.max(1, Number(monitor?.height) || 1080);
  return {
    x: mx + Math.round(nx * (mw - 1)),
    y: my + Math.round(ny * (mh - 1))
  };
}

async function warnIfForegroundElevated(client, contextLabel) {
  if (client.readyInfo?.elevated) return;
  const now = Date.now();
  if (now - lastUipiWarningAt < 3000) return;
  try {
    const fg = await client.call('foreground');
    if (fg && fg.elevated) {
      lastUipiWarningAt = now;
      logFn(`[windows] Aviso UIPI (${contextLabel}): la ventana al frente (${fg.process || fg.title || 'administrador'}) está elevada y NEXO corre sin permisos de administrador; Windows bloquea la entrada.`);
    }
  } catch {}
}

function pointer(data, monitor) {
  const { x, y } = toAbsoluteCoords(data, monitor);
  const rawAction = String(data?.action || 'move');
  let action = 'move';
  if (rawAction === 'tap' || rawAction === 'click') action = 'click';
  else if (rawAction === 'down' || rawAction === 'dragstart') action = 'down';
  else if (rawAction === 'up') action = 'up';
  else if (rawAction === 'move') action = 'move';
  else throw new Error(`Acción de puntero desconocida: ${rawAction}`);

  const button = data?.button === 'right' ? 'right' : (data?.button === 'middle' ? 'middle' : 'left');
  const client = ensureAgent();

  const exec = async () => {
    try {
      await client.call('pointer', { action, x, y, button });
      if (action === 'click' || action === 'down') {
        await warnIfForegroundElevated(client, `pointer:${action}`);
      }
    } catch (err) {
      if (action === 'click' || action === 'down') {
        await warnIfForegroundElevated(client, `pointer:${action}`);
      }
      throw err;
    }
  };

  if (action === 'move') {
    return exec();
  }
  return enqueueInput(exec);
}

function scroll(data, monitor) {
  const { x, y } = toAbsoluteCoords(data, monitor);
  const dx = Number(data?.dx) || 0;
  const dy = Number(data?.dy) || 0;
  const client = ensureAgent();
  return enqueueInput(() => client.call('scroll', { x, y, dx, dy }));
}

function text(value) {
  const str = String(value ?? '');
  if (!str) return Promise.resolve();
  const client = ensureAgent();
  const timeoutMs = Math.max(2000, Math.min(15000, str.length * 25));
  return enqueueInput(async () => {
    await client.call('text', { text: str }, timeoutMs);
  });
}

function namedKey(name) {
  const events = keymap.named(name);
  if (!events) {
    return Promise.reject(new Error(`Tecla desconocida: ${name}`));
  }
  const client = ensureAgent();
  return enqueueInput(async () => {
    await client.call('keys', { events });
  });
}

function keyEvent(value) {
  const events = keymap.combo(value);
  if (!events) {
    return Promise.reject(new Error(`Entrada inválida (tipo=keyboard key=${JSON.stringify(value?.key)} code=${JSON.stringify(value?.code)})`));
  }
  const client = ensureAgent();
  return enqueueInput(async () => {
    await client.call('keys', { events });
  });
}

function shortcut(value) {
  let events;
  try {
    events = keymap.shortcut(value);
  } catch (err) {
    return Promise.reject(err);
  }
  if (!events) {
    return Promise.reject(new Error(`Entrada inválida (tipo=shortcut key=${JSON.stringify(value?.key)} code=${JSON.stringify(value?.code)})`));
  }
  const client = ensureAgent();
  return enqueueInput(async () => {
    await client.call('keys', { events });
  });
}

async function workspace(target) {
  const client = ensureAgent();
  await client.call('desktop.switch', { target }, 5000);
}

async function clipboardGet() {
  const client = ensureAgent();
  const res = await client.call('clipboard.get');
  return typeof res.text === 'string' ? res.text : '';
}

async function clipboardSet(value) {
  const client = ensureAgent();
  await client.call('clipboard.set', { text: String(value ?? '') }, 5000);
}

function screenshotJpeg({ monitor, quality = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let ffmpegBin;
    try {
      ffmpegBin = findFfmpeg();
    } catch (err) {
      return reject(err);
    }

    const args = screenshotArgs({ index: monitor?.index ?? 0, quality });
    const child = spawn(ffmpegBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    const splitter = new JpegSplitter();
    let frame = null;
    let stderr = '';

    splitter.on('data', buf => {
      if (!frame) frame = buf;
    });

    child.stdout.pipe(splitter);
    child.stderr.on('data', chunk => {
      if (stderr.length < 4096) stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', code => {
      if (frame && frame.length > 0) {
        return resolve(frame);
      }
      reject(new Error(stderr.trim() || `ffmpeg screenshot terminó con código ${code}`));
    });
  });
}

function startJpegStream({ monitor, fps = 10, quality = 8, onFrame } = {}) {
  if (activeJpegController) {
    activeJpegController.stop();
    activeJpegController = null;
  }

  const ffmpegBin = findFfmpeg();
  const monitorIndex = monitor?.index ?? 0;
  let stopped = false;
  let child = null;
  let retryTimer = null;
  let retryAttempt = 0;

  function killCurrentChild() {
    const procToKill = child;
    child = null;
    if (!procToKill) return;
    const pid = procToKill.pid;
    let exited = false;
    procToKill.once('close', () => { exited = true; });
    try { procToKill.kill(); } catch {}
    setTimeout(() => {
      if (!exited && pid) {
        killTree(pid).catch(() => {});
      }
    }, 1000).unref();
  }

  function scheduleRestart() {
    if (stopped || desktopState === 'secure' || retryTimer) return;
    const delayMs = Math.min(5000, 1000 * (2 ** retryAttempt));
    retryAttempt = Math.min(retryAttempt + 1, 4);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!stopped && desktopState !== 'secure') {
        launch();
      }
    }, delayMs);
    if (retryTimer.unref) retryTimer.unref();
  }

  function launch() {
    if (stopped || desktopState === 'secure' || child) return;
    const args = jpegStreamArgs({ index: monitorIndex, fps, quality });
    let spawned;
    try {
      spawned = spawn(ffmpegBin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (err) {
      logFn(`[windows] Error lanzando ffmpeg JPEG: ${err.message}`);
      scheduleRestart();
      return;
    }

    child = spawned;
    const splitter = new JpegSplitter();
    let stderr = '';

    splitter.on('data', frame => {
      retryAttempt = 0;
      if (!stopped && typeof onFrame === 'function') {
        onFrame(frame);
      }
    });

    spawned.stdout.pipe(splitter);
    spawned.stderr.on('data', chunk => {
      if (stderr.length < 2048) stderr += chunk;
    });

    spawned.on('error', err => {
      if (child === spawned) child = null;
      if (!stopped && desktopState !== 'secure') {
        logFn(`[windows] Error en proceso ffmpeg JPEG: ${err.message}`);
        scheduleRestart();
      }
    });

    spawned.on('close', code => {
      try { splitter.destroy(); } catch {}
      if (child !== spawned) return;
      child = null;
      if (stopped || desktopState === 'secure') return;
      if (retryAttempt === 0 && stderr.trim()) {
        logFn(`[windows] ffmpeg JPEG terminó (${code}): ${stderr.trim().slice(-240)}`);
      }
      scheduleRestart();
    });
  }

  const controller = {
    stop() {
      stopped = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      killCurrentChild();
      if (activeJpegController === controller) {
        activeJpegController = null;
      }
    },
    pauseForSecure() {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      killCurrentChild();
    },
    resumeFromSecure() {
      if (stopped) return;
      retryAttempt = 0;
      launch();
    }
  };

  activeJpegController = controller;
  if (desktopState !== 'secure') {
    launch();
  }
  return { stop: () => controller.stop() };
}

function spawnSystemAudio() {
  throw new Error('No implementado en Windows todavía (fase F6)');
}

function spawnRawVideo() {
  throw new Error('No implementado en Windows todavía (fase F6)');
}

function defaultAudioTarget() {
  return Promise.resolve('');
}

function keepAwake(on) {
  const client = ensureAgent();
  client.call('keepawake', { on: Boolean(on) }).catch(() => {});
}

function on(event, handler) {
  emitter.on(event, handler);
  return () => emitter.off(event, handler);
}

module.exports = {
  name: 'windows',
  capabilities,
  init,
  close,
  listMonitors,
  pointer,
  scroll,
  text,
  namedKey,
  keyEvent,
  shortcut,
  workspace,
  clipboardGet,
  clipboardSet,
  screenshotJpeg,
  startJpegStream,
  spawnSystemAudio,
  spawnRawVideo,
  defaultAudioTarget,
  keepAwake,
  on
};
