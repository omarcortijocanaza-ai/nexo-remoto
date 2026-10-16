#!/usr/bin/env node
'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
// Un mismo servicio graba el greeter (X11) antes del login y la sesion
// Hyprland (Wayland) despues; `entorno` dice cual toca en cada momento.
const { estado: estadoEntorno, entornoDe, regionX11 } = require('./entorno');

const root = __dirname;
const stateDir = process.env.NEXO_STATE_DIR || root;
const rtpPort = Math.max(1024, Math.min(65535, Number(process.env.NEXO_GPU_RTP_PORT) || 5004));
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const monitorStatePath = process.env.NEXO_MONITOR_STATE || path.join(stateDir, '.nexo-monitor.json');
const profileStatePath = process.env.NEXO_GPU_PROFILE_STATE || path.join(stateDir, '.nexo-gpu-profile.json');
let monitor = process.env.NEXO_MONITOR || 'DP-1';
let height = Number(process.env.NEXO_GPU_HEIGHT || 1080);
let width = Number(process.env.NEXO_GPU_WIDTH || Math.round(height * 16 / 9));
let fps = Number(process.env.NEXO_GPU_FPS || 60);
let bitrate = Number(process.env.NEXO_GPU_BITRATE || 10000);
let mediaKey = '';
// 'x11' mientras se graba el greeter, 'wayland' con la sesion ya iniciada.
let modoCaptura = 'ninguno';
const fifo = `/tmp/nexo-gpu-${process.pid}.raw`;
const bridgePort = Math.max(1024, Math.min(65535, Number(process.env.NEXO_GPU_WEBRTC_PORT) || 9090));
const idleStopMs = Math.max(5000, Number(process.env.NEXO_GPU_IDLE_STOP_MS) || 60000);
let bridge = null;
let bridgeFps = 0;
let recorder = null;
let pipeline = null;
let stopping = false;
let restartTimer = null;
let reconfiguring = false;
let paused = false;
let idleSince = Date.now();

function selectedMonitor() {
  try {
    const selected = JSON.parse(fs.readFileSync(monitorStatePath, 'utf8')).name;
    if (typeof selected === 'string' && selected) return selected;
  } catch {}
  return monitor;
}

function selectedProfile() {
  try {
    const profile = JSON.parse(fs.readFileSync(profileStatePath, 'utf8'));
    if ([30, 45, 60].includes(Number(profile.fps)) && [720, 900, 1080].includes(Number(profile.height))) {
      const nextHeight = Number(profile.height);
      return {
        fps: Number(profile.fps), height: nextHeight,
        width: Math.round(nextHeight * 16 / 9 / 2) * 2,
        bitrate: Number(process.env.NEXO_GPU_BITRATE || (nextHeight === 1080 ? 10000 : nextHeight === 900 ? 7000 : 4500))
      };
    }
  } catch {}
  return { width, height, fps, bitrate };
}

function startBridge() {
  if (bridge || stopping) return;
  bridgeFps = fps;
  bridge = spawn(path.join(root, 'bin', 'nexo-gpu-webrtc'), [], {
    env: { ...process.env, NEXO_GPU_FPS: String(fps) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  bridge.stdout.on('data', data => process.stdout.write(`[GPU/WebRTC] ${data}`));
  bridge.stderr.on('data', data => process.stderr.write(`[GPU/WebRTC] ${data}`));
  bridge.on('error', error => console.error(`[GPU/WebRTC] ${error.message}`));
  bridge.on('close', code => {
    bridge = null;
    bridgeFps = 0;
    if (!stopping) {
      console.error(`Puente GPU terminó (${code}); reintentando…`);
      setTimeout(startBridge, 1000);
    }
  });
}

function createFifo() {
  fs.rmSync(fifo, { force: true });
  const result = spawnSync('mkfifo', ['-m', '600', fifo]);
  if (result.status !== 0) throw new Error(`No se pudo crear FIFO GPU: ${result.stderr}`);
}

function displayX11() {
  return estadoEntorno().entorno.DISPLAY || ':0';
}

function geometriaX11() {
  return regionX11() || { ancho: 1920, alto: 1080, x: 0, y: 0 };
}

function startMedia() {
  if (paused || stopping) return;
  if (recorder || pipeline) return scheduleMediaRestart();
  modoCaptura = estadoEntorno(true).modo;
  // Al encender, NEXO llega antes que la pantalla de inicio de sesion: el
  // servidor X del greeter tarda un par de segundos. Sin esta espera se lanzaba
  // `wf-recorder` contra un Wayland inexistente, fallaba, reintentaba, y el
  // cliente remoto solo veia negro. Mejor no capturar nada hasta saber que hay.
  if (modoCaptura === 'ninguno') {
    console.log('Todavía no hay pantalla que capturar (ni login ni sesión); esperando…');
    return scheduleMediaRestart();
  }
  monitor = modoCaptura === 'wayland' ? selectedMonitor() : displayX11();
  ({ width, height, fps, bitrate } = selectedProfile());
  mediaKey = `${modoCaptura}:${monitor}:${width}x${height}@${fps}:${bitrate}`;
  reconfiguring = false;
  createFifo();
  pipeline = spawn('gst-launch-1.0', [
    'filesrc', `location=${fifo}`, 'do-timestamp=true', '!',
    // Never discard encoded H.264 buffers: losing one predictive frame corrupts
    // every dependent frame until the next IDR. Backpressure is safe here
    // because wf-recorder already produces at the selected real-time rate.
    'queue', 'max-size-buffers=4', '!',
    'h264parse', 'disable-passthrough=true', 'config-interval=-1', '!',
    `video/x-h264,profile=high,stream-format=byte-stream,alignment=au,framerate=${fps}/1`, '!',
    'rtph264pay', 'pt=96', 'config-interval=-1', 'aggregate-mode=none', 'mtu=1200', '!',
    // Pace RTP against the pipeline clock. Without sync GStreamer emits FIFO
    // chunks as UDP bursts, overflowing the receiver even on localhost.
    'udpsink', 'host=127.0.0.1', `port=${rtpPort}`, 'buffer-size=8388608', 'sync=true', 'async=false'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  pipeline.stderr.on('data', data => {
    const line = data.toString();
    if (/ERROR|WARN|nvh264enc/i.test(line)) process.stderr.write(`[GPU/GStreamer] ${line}`);
  });
  pipeline.on('error', error => console.error(`[GPU/GStreamer] ${error.message}`));
  pipeline.on('close', code => {
    pipeline = null;
    recorder?.kill('SIGTERM');
    if (!stopping) scheduleMediaRestart(`GStreamer terminó (${code})`);
  });

  const bitrateBps = bitrate * 1000;

  // Antes del login no hay Wayland que grabar: lo que hay en pantalla es el
  // greeter de SDDM, que es X11. `wf-recorder` no sirve ahi, asi que se captura
  // con `ffmpeg -f x11grab` y el mismo NVENC, escribiendo el H.264 crudo en la
  // misma FIFO — la tuberia de GStreamer y el WebRTC no se enteran del cambio.
  if (modoCaptura === 'x11') {
    const { ancho, alto, x: recorteX, y: recorteY } = geometriaX11();
    const argsFfmpeg = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-f', 'x11grab', '-framerate', String(fps),
      '-video_size', `${ancho}x${alto}`, '-draw_mouse', '1',
      // El greeter ocupa los dos monitores; se sirve solo el primario, que es
      // donde SDDM dibuja el formulario de inicio de sesion.
      '-i', `${displayX11()}+${recorteX},${recorteY}`
    ];
    if (ancho !== width || alto !== height) argsFfmpeg.push('-vf', `scale=${width}:${height}:flags=fast_bilinear`);
    argsFfmpeg.push(
      '-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'ull', '-rc', 'cbr',
      '-b:v', String(bitrateBps), '-maxrate', String(bitrateBps),
      '-bufsize', String(Math.max(240000, Math.round(bitrateBps / 30))),
      '-g', String(Math.max(15, Math.round(fps / 2))),
      '-forced-idr', '1', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-f', 'h264', '-y', fifo
    );
    recorder = spawn('ffmpeg', argsFfmpeg, { stdio: ['ignore', 'ignore', 'pipe'], env: entornoDe() });
    recorder.stderr.on('data', data => process.stderr.write(`[GPU/Captura X11] ${data}`));
    recorder.on('error', error => console.error(`[GPU/Captura X11] ${error.message}`));
    recorder.on('close', code => {
      recorder = null;
      pipeline?.kill('SIGTERM');
      if (!stopping) scheduleMediaRestart(`Captura X11 terminó (${code})`);
    });
    if (bridge && bridgeFps !== fps) bridge.kill('SIGTERM');
    console.log(`GPU activa: pantalla de inicio de sesión (${displayX11()} ${ancho}x${alto}+${recorteX},${recorteY}) · ${width}x${height}@${fps} · NVENC ${bitrate} kbps`);
    return;
  }

  const recorderArgs = [
    '-y', '--no-dmabuf', '-D', '-o', monitor, '-r', String(fps),
    '-c', 'h264_nvenc', '-m', 'h264', '-x', 'nv12', '-b', '0',
    '-p', 'preset=p1', '-p', 'tune=ull', '-p', 'rc=cbr',
    '-p', `b=${bitrateBps}`, '-p', `maxrate=${bitrateBps}`,
    '-p', `bufsize=${Math.max(240000, Math.round(bitrateBps / 30))}`,
    '-p', `g=${Math.max(15, Math.round(fps / 2))}`,
    '-p', 'forced-idr=1', '-p', 'aud=1', '-p', 'delay=0',
    '-p', 'strict_gop=1', '-p', 'zerolatency=1', '-p', 'profile=high'
  ];
  if (width !== 1920 || height !== 1080) recorderArgs.push('-F', `scale=${width}:${height}:flags=fast_bilinear`);
  recorderArgs.push('-f', fifo);
  // El entorno hay que pasarlo a mano: como servicio del sistema, NEXO no
  // hereda WAYLAND_DISPLAY ni XDG_RUNTIME_DIR de ninguna sesion, y sin ellos
  // wf-recorder muere con «failed to create display».
  recorder = spawn('wf-recorder', recorderArgs, { stdio: ['ignore', 'ignore', 'pipe'], env: entornoDe() });
  recorder.stderr.on('data', data => {
    const line = data.toString();
    if (/error|failed/i.test(line)) process.stderr.write(`[GPU/Captura] ${line}`);
  });
  recorder.on('error', error => console.error(`[GPU/Captura] ${error.message}`));
  recorder.on('close', code => {
    recorder = null;
    pipeline?.kill('SIGTERM');
    if (!stopping) scheduleMediaRestart(`Captura GPU terminó (${code})`);
  });
  if (bridge && bridgeFps !== fps) bridge.kill('SIGTERM');
  console.log(`GPU activa: ${monitor} · ${width}x${height}@${fps} · NVENC directo ${bitrate} kbps`);
}

function scheduleMediaRestart(reason = '') {
  if (paused || stopping || restartTimer) return;
  if (reason) console.error(`${reason}; reintentando…`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (recorder || pipeline) return scheduleMediaRestart();
    startMedia();
  }, 1000);
}

function pauseMedia(reason) {
  if (paused || stopping) return;
  paused = true;
  clearTimeout(restartTimer);
  restartTimer = null;
  mediaKey = '';
  console.log(`GPU en reposo: ${reason}`);
  recorder?.kill('SIGTERM');
  pipeline?.kill('SIGTERM');
}

function resumeMedia() {
  if (!paused || stopping) return;
  paused = false;
  idleSince = Date.now();
  console.log('GPU reactivada: hay un cliente conectado');
  startMedia();
}

function bridgePeers() {
  return new Promise(resolve => {
    const request = http.get({ host: '127.0.0.1', port: bridgePort, path: '/health', timeout: 700 }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try {
          const value = Number(JSON.parse(body).peers);
          resolve(Number.isFinite(value) ? value : null);
        } catch { resolve(null); }
      });
    });
    request.on('timeout', () => { request.destroy(); resolve(null); });
    request.on('error', () => resolve(null));
  });
}

function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(restartTimer);
  recorder?.kill('SIGTERM');
  pipeline?.kill('SIGTERM');
  bridge?.kill('SIGTERM');
  setTimeout(() => {
    recorder?.kill('SIGKILL');
    pipeline?.kill('SIGKILL');
    bridge?.kill('SIGKILL');
    fs.rmSync(fifo, { force: true });
    process.exit(0);
  }, 900).unref();
}

process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('exit', () => fs.rmSync(fifo, { force: true }));
// Sin clientes no hay a quién enviar el H.264, y mantener wf-recorder, NVENC y
// GStreamer vivos gasta GPU y batería las veinticuatro horas. El puente
// registra al par al recibir su oferta, así que reactivar en medio segundo
// llega mucho antes del tiempo de espera del navegador.
setInterval(async () => {
  if (stopping) return;
  const peers = await bridgePeers();
  if (peers === null) return;
  if (peers > 0) { idleSince = Date.now(); return resumeMedia(); }
  if (!paused && Date.now() - idleSince >= idleStopMs) pauseMedia(`sin clientes durante ${Math.round(idleStopMs / 1000)} s`);
}, 500);

setInterval(() => {
  const modo = estadoEntorno().modo;
  // El paso del greeter a la sesion (o al reves, al cerrar sesion) cambia por
  // completo como se captura: hay que rehacer la captura, no solo reconfigurar.
  // Sin esto, al iniciar sesion el cliente se quedaba mirando una pantalla
  // congelada del login.
  if (!paused && !reconfiguring && modo !== 'ninguno' && modo !== modoCaptura) {
    reconfiguring = true;
    console.log(`Cambio de pantalla: ${modoCaptura} → ${modo}; rehaciendo la captura`);
    recorder?.kill('SIGTERM');
    pipeline?.kill('SIGTERM');
    return;
  }
  if (modo !== 'wayland') return;
  const selected = selectedMonitor();
  const profile = selectedProfile();
  const nextKey = `${modo}:${selected}:${profile.width}x${profile.height}@${profile.fps}:${profile.bitrate}`;
  if (paused || nextKey === mediaKey || reconfiguring) return;
  reconfiguring = true;
  monitor = selected;
  console.log(`Reconfigurando GPU: ${nextKey}`);
  recorder?.kill('SIGTERM');
  pipeline?.kill('SIGTERM');
}, 700).unref();

startMedia();
startBridge();
