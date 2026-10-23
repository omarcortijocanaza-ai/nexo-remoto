'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough, Transform } = require('node:stream');
const { atomicWriteJson, readJsonSafe } = require('../../lib/safe');
const { killTree } = require('../../lib/proc');

const SOI_MARKER = Buffer.from([0xFF, 0xD8]);
const EOI_MARKER = Buffer.from([0xFF, 0xD9]);
const MAX_JPEG_BUFFER_BYTES = 16 * 1024 * 1024;

const GPU_CHAINS = ['d3d11-native', 'd3d11-scale', 'cuda-scale', 'cpu-scale', 'gdigrab'];

// Revisión de las cadenas de escalado. Se guarda junto a la cadena recordada: si cambia el
// significado de una cadena (p. ej. `cuda-scale` dejó de ser un hwmap que no funciona),
// lo recordado con la revisión anterior se descarta y se vuelve a sondear una vez.
const CADENAS_REV = 2;

let cachedFfmpegPath = null;
let cachedFfmpegVersion = null;
let cachedFilters = null;

function findFfmpeg() {
  if (process.env.NEXO_FFMPEG) {
    const custom = process.env.NEXO_FFMPEG.trim();
    if (custom && fs.existsSync(custom)) {
      return custom;
    }
    throw new Error(`La ruta definida en NEXO_FFMPEG no existe: ${custom}`);
  }

  if (cachedFfmpegPath && fs.existsSync(cachedFfmpegPath)) {
    return cachedFfmpegPath;
  }

  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const res = spawnSync(locator, ['ffmpeg'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 4000
  });

  if (res.status === 0 && res.stdout) {
    const firstLine = res.stdout
      .split(/\r?\n/)
      .map(s => s.trim())
      .find(Boolean);
    if (firstLine) {
      cachedFfmpegPath = firstLine;
      return firstLine;
    }
  }

  throw new Error('No se encontró ffmpeg. Define NEXO_FFMPEG o instala FFmpeg en el PATH.');
}

function getFfmpegVersion(ffmpegBin = findFfmpeg()) {
  if (cachedFfmpegVersion) return cachedFfmpegVersion;
  const res = spawnSync(ffmpegBin, ['-version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 4000
  });
  if (res.status === 0 && res.stdout) {
    const firstLine = res.stdout.split(/\r?\n/)[0]?.trim();
    if (firstLine) {
      cachedFfmpegVersion = firstLine;
      return firstLine;
    }
  }
  return 'unknown';
}

function getAvailableFilters(ffmpegBin = findFfmpeg()) {
  if (cachedFilters) return cachedFilters;
  const res = spawnSync(ffmpegBin, ['-hide_banner', '-filters'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000
  });
  const text = (res.stdout || '') + '\n' + (res.stderr || '');
  cachedFilters = {
    scale_d3d11: /\bscale_d3d11\b/.test(text),
    // `cuda-scale` no deriva CUDA desde D3D11 (FFmpeg no lo implementa): baja el fotograma,
    // lo sube con hwupload_cuda y escala en la GPU. Necesita las dos piezas.
    scale_cuda: /\bscale_cuda\b/.test(text) && /\bhwupload_cuda\b/.test(text)
  };
  return cachedFilters;
}

function profileBitrateKbps(height, overrideKbps) {
  const custom = Number(overrideKbps);
  if (Number.isFinite(custom) && custom > 0) return Math.round(custom);
  const h = Number(height) || 1080;
  if (h >= 1080) return 10000;
  if (h >= 900) return 7000;
  return 4500;
}

function profileDimensions(height = 1080, widthOverride = 0) {
  const h = Math.round((Number(height) || 1080) / 2) * 2;
  const w = Number(widthOverride) > 0
    ? Math.round(Number(widthOverride) / 2) * 2
    : Math.round((h * 16 / 9) / 2) * 2;
  return { width: w, height: h };
}

function gpuEncoderArgs({ fps = 60, height = 1080, bitrateKbps, rtpPort = 5004 } = {}) {
  const f = Number(fps) || 60;
  const kbps = profileBitrateKbps(height, bitrateKbps);
  const bitrateBps = kbps * 1000;
  const bufsize = Math.max(240000, Math.round(bitrateBps / 30));
  const gop = Math.max(15, Math.round(f / 2));
  const port = Math.max(1024, Math.min(65535, Number(rtpPort) || 5004));

  return [
    '-c:v', 'h264_nvenc',
    '-preset', 'p1',
    '-tune', 'ull',
    '-rc', 'cbr',
    '-b:v', String(bitrateBps),
    '-maxrate', String(bitrateBps),
    '-bufsize', String(bufsize),
    '-g', String(gop),
    '-bf', '0',
    '-forced-idr', '1',
    '-profile:v', 'high',
    '-delay', '0',
    '-zerolatency', '1',
    '-strict_gop', '1',
    '-aud', '1',
    '-bsf:v', 'dump_extra=freq=keyframe',
    '-f', 'rtp',
    '-payload_type', '96',
    // `localaddr` fuerza los sockets UDP de ffmpeg a 127.0.0.1. Sin él se enlazan a
    // 0.0.0.0 (comprobado con Get-NetUDPEndpoint) y Windows muestra el aviso del
    // firewall "¿permitir que ffmpeg acceda a redes públicas y privadas?".
    `rtp://127.0.0.1:${port}?pkt_size=1200&localaddr=127.0.0.1`
  ];
}

function gpuStreamArgs({
  chain = 'd3d11-native',
  index = 0,
  fps = 60,
  width,
  height = 1080,
  bitrateKbps,
  rtpPort = 5004,
  monitor = null
} = {}) {
  const outIdx = Math.max(0, Number(index ?? monitor?.index) || 0);
  const f = Number(fps) || 60;
  const dims = profileDimensions(height, width);
  const w = dims.width;
  const h = dims.height;
  const monX = Number(monitor?.x) || 0;
  const monY = Number(monitor?.y) || 0;
  const monW = Number(monitor?.width) || w;
  const monH = Number(monitor?.height) || h;

  const prefix = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  let inputArgs;

  switch (chain) {
    case 'd3d11-native':
      inputArgs = [
        '-f', 'lavfi',
        '-i', `ddagrab=output_idx=${outIdx}:framerate=${f}:draw_mouse=1`
      ];
      break;
    case 'd3d11-scale':
      inputArgs = [
        '-f', 'lavfi',
        '-i', `ddagrab=output_idx=${outIdx}:framerate=${f}:draw_mouse=1,scale_d3d11=${w}:${h}:format=nv12`
      ];
      break;
    case 'cuda-scale':
      // Medido en la RTX 3060 Ti con FFmpeg 9.0 (720p y 900p a 60 FPS): ≈ 30 % de un núcleo
      // frente a 54–95 % de `cpu-scale`, y mejor calidad (SSIM 0,9986 contra 0,9972 de swscale
      // bilinear). Se deja el formato en bgra a propósito: pedir `format=nv12` a scale_cuda
      // falla (`cuModuleGetFunction … NOT_FOUND`) y NVENC convierte el color en la GPU.
      inputArgs = [
        '-f', 'lavfi',
        '-i', `ddagrab=output_idx=${outIdx}:framerate=${f}:draw_mouse=1,hwdownload,format=bgra`,
        '-vf', `hwupload_cuda,scale_cuda=${w}:${h}`
      ];
      break;
    case 'cpu-scale':
      inputArgs = [
        '-f', 'lavfi',
        '-i', `ddagrab=output_idx=${outIdx}:framerate=${f}:draw_mouse=1,hwdownload,format=bgra,scale=${w}:${h}:flags=bilinear,format=nv12`
      ];
      break;
    case 'gdigrab':
      inputArgs = [
        '-f', 'gdigrab',
        '-framerate', String(f),
        '-offset_x', String(monX),
        '-offset_y', String(monY),
        '-video_size', `${monW}x${monH}`,
        '-i', 'desktop',
        '-vf', `scale=${w}:${h},format=nv12`
      ];
      break;
    default:
      throw new Error(`Cadena GPU desconocida: ${chain}`);
  }

  return [
    ...prefix,
    ...inputArgs,
    ...gpuEncoderArgs({ fps: f, height: h, bitrateKbps, rtpPort })
  ];
}

function rawVideoArgs({ index = 0, fps = 30, width = 1280, height = 720, monitor = null } = {}) {
  const outIdx = Math.max(0, Number(index ?? monitor?.index) || 0);
  const f = Math.max(1, Number(fps) || 30);
  const w = Math.round((Number(width) || 1280) / 2) * 2;
  const h = Math.round((Number(height) || 720) / 2) * 2;

  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-f', 'lavfi',
    '-i', `ddagrab=output_idx=${outIdx}:framerate=${f}:draw_mouse=1,hwdownload,format=bgra`,
    '-vf', `scale=${w}:${h}:flags=fast_bilinear,format=yuv420p`,
    '-f', 'rawvideo',
    'pipe:1'
  ];
}

function candidateChainsForProfile({ width, height, monitor, filters }) {
  const monW = Number(monitor?.width) || 1920;
  const monH = Number(monitor?.height) || 1080;
  const sameResolution = width === monW && height === monH;
  const avail = filters || { scale_d3d11: true, scale_cuda: true };

  const list = [];
  if (sameResolution) {
    list.push('d3d11-native');
  }
  if (avail.scale_d3d11) {
    list.push('d3d11-scale');
  }
  if (avail.scale_cuda) {
    list.push('cuda-scale');
  }
  list.push('cpu-scale');
  list.push('gdigrab');
  return list;
}

async function probeSingleChain({
  ffmpegBin,
  chain,
  index,
  fps,
  width,
  height,
  bitrateKbps,
  rtpPort,
  monitor,
  getBridgeStats,
  durationMs = 3000
}) {
  const before = await getBridgeStats();
  const startPackets = Number(before?.packets) || 0;
  const args = gpuStreamArgs({ chain, index, fps, width, height, bitrateKbps, rtpPort, monitor });

  const child = spawn(ffmpegBin, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });

  let stderrText = '';
  child.stderr.on('data', d => {
    if (stderrText.length < 2048) stderrText += d.toString();
  });

  let exitedEarly = false;
  child.once('exit', () => { exitedEarly = true; });

  try {
    const deadline = Date.now() + durationMs;
    while (Date.now() < deadline) {
      if (exitedEarly) break;
      await new Promise(r => setTimeout(r, 250));
      const nowStats = await getBridgeStats();
      const nowPackets = Number(nowStats?.packets) || 0;
      if (nowPackets - startPackets >= 15 && Date.now() + 500 >= deadline) {
        return { ok: true, packetsDelta: nowPackets - startPackets };
      }
    }
    const after = await getBridgeStats();
    const delta = (Number(after?.packets) || 0) - startPackets;
    return { ok: !exitedEarly && delta > 0, packetsDelta: delta, error: stderrText.trim() };
  } finally {
    await killTree(child.pid, 0);
    if (child.exitCode === null) {
      try { child.kill(); } catch {}
    }
  }
}

// Cadena guardada que sigue valiendo, o null si hay que sondear. Pura para poder probarla.
// Vale sólo con la misma versión de ffmpeg y la misma revisión de cadenas.
function cadenaRecordada({ saved, ffmpegVersion, candidates, isNativeRes }) {
  if (!saved || saved.ffmpegVersion !== ffmpegVersion || saved.cadenasRev !== CADENAS_REV) return null;
  if (isNativeRes) {
    return typeof saved.chain === 'string' && candidates.includes(saved.chain) ? saved.chain : null;
  }
  if (typeof saved.scaleChain === 'string' && candidates.includes(saved.scaleChain)) return saved.scaleChain;
  if (typeof saved.chain === 'string' && saved.chain !== 'd3d11-native' && candidates.includes(saved.chain)) return saved.chain;
  return null;
}

async function selectAndProbeGpuChain({
  stateDir,
  ffmpegBin = findFfmpeg(),
  index = 0,
  fps = 60,
  width = 1920,
  height = 1080,
  bitrateKbps,
  rtpPort = 5004,
  monitor = null,
  getBridgeStats,
  durationMs = 3000,
  log = console.log
}) {
  const pipelineStatePath = path.join(stateDir, '.nexo-gpu-pipeline.json');
  const ffmpegVersion = getFfmpegVersion(ffmpegBin);
  const filters = getAvailableFilters(ffmpegBin);
  const candidates = candidateChainsForProfile({ width, height, monitor, filters });

  const isNativeRes = (Number(monitor?.width) || 1920) === width && (Number(monitor?.height) || 1080) === height;
  const saved = readJsonSafe(pipelineStatePath, null);
  const recordada = cadenaRecordada({ saved, ffmpegVersion, candidates, isNativeRes });
  if (recordada) return { chain: recordada, cached: true, ffmpegVersion };

  for (const chain of candidates) {
    log(`[GPU/Sondeo] Probando cadena ${chain} (${width}x${height}@${fps}) durante ${durationMs} ms...`);
    const res = await probeSingleChain({
      ffmpegBin,
      chain,
      index,
      fps,
      width,
      height,
      bitrateKbps,
      rtpPort,
      monitor,
      getBridgeStats,
      durationMs
    });
    if (res.ok) {
      // Con otra revisión de cadenas lo recordado ya no vale: no se arrastra `saved`.
      const vigente = saved && saved.cadenasRev === CADENAS_REV ? saved : null;
      const nextState = {
        ffmpegVersion,
        cadenasRev: CADENAS_REV,
        chain: isNativeRes ? chain : (vigente?.chain || chain),
        probedAt: new Date().toISOString()
      };
      if (!isNativeRes) {
        nextState.scaleChain = chain;
      } else if (vigente?.scaleChain) {
        nextState.scaleChain = vigente.scaleChain;
      }
      atomicWriteJson(pipelineStatePath, nextState);
      log(`[GPU/Sondeo] Cadena seleccionada: ${chain} (+${res.packetsDelta} paquetes RTP)`);
      return { chain, cached: false, ffmpegVersion };
    }
    log(`[GPU/Sondeo] Cadena ${chain} descartada (${res.error || 'sin paquetes RTP'})`);
  }

  throw new Error('Ninguna cadena de captura GPU produjo paquetes RTP');
}

// Si la cadena recordada deja de funcionar (cambio de driver, de monitor, de
// GPU) el sondeo no se repetiría nunca mientras no cambie la versión de ffmpeg.
// Quien detecta fallos seguidos llama a esto para forzar un sondeo nuevo.
function invalidateGpuChainCache(stateDir) {
  try {
    fs.rmSync(path.join(stateDir, '.nexo-gpu-pipeline.json'), { force: true });
  } catch {}
}

function normalizeMjpegQ(quality, defaultQ) {
  const n = Number(quality);
  if (!Number.isFinite(n) || n <= 0) return defaultQ;
  if (n >= 2 && n <= 31) return Math.round(n);
  return defaultQ;
}

function jpegStreamArgs({ index = 0, fps = 10, quality = 8 } = {}) {
  const outIdx = Math.max(0, Number(index) || 0);
  const targetFps = Math.max(1, Math.min(15, Number(fps) === 30 ? 10 : (Number(fps) || 10)));
  const qv = normalizeMjpegQ(quality, 8);

  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-f', 'lavfi',
    '-i', `ddagrab=output_idx=${outIdx}:framerate=${targetFps}:draw_mouse=1,hwdownload,format=bgra`,
    '-vf', "scale='min(1280,iw)':-2",
    '-c:v', 'mjpeg',
    '-q:v', String(qv),
    '-f', 'image2pipe',
    'pipe:1'
  ];
}

function screenshotArgs({ index = 0, quality = 5 } = {}) {
  const outIdx = Math.max(0, Number(index) || 0);
  const qv = normalizeMjpegQ(quality, 5);

  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-f', 'lavfi',
    '-i', `ddagrab=output_idx=${outIdx}:framerate=10:draw_mouse=1,hwdownload,format=bgra`,
    '-vf', "scale='min(1280,iw)':-2",
    '-frames:v', '1',
    '-c:v', 'mjpeg',
    '-q:v', String(qv),
    '-f', 'image2pipe',
    'pipe:1'
  ];
}

class JpegSplitter extends Transform {
  constructor(options = {}) {
    super({ ...options, readableObjectMode: false });
    this._buf = Buffer.alloc(0);
  }

  _transform(chunk, _encoding, callback) {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this._buf = this._buf.length ? Buffer.concat([this._buf, incoming]) : incoming;

    if (this._buf.length > MAX_JPEG_BUFFER_BYTES) {
      this._buf = Buffer.alloc(0);
      return callback();
    }

    while (this._buf.length > 0) {
      const soi = this._buf.indexOf(SOI_MARKER);
      if (soi === -1) {
        if (this._buf[this._buf.length - 1] === 0xFF) {
          this._buf = this._buf.subarray(this._buf.length - 1);
        } else {
          this._buf = Buffer.alloc(0);
        }
        break;
      }

      if (soi > 0) {
        this._buf = this._buf.subarray(soi);
      }

      if (this._buf.length < 4) {
        break;
      }

      const eoi = this._buf.indexOf(EOI_MARKER, 2);
      if (eoi === -1) {
        break;
      }

      const frame = Buffer.from(this._buf.subarray(0, eoi + 2));
      this._buf = this._buf.subarray(eoi + 2);
      this.push(frame);
    }

    callback();
  }
}

// Reagrupa los bytes de ffmpeg en cuadros completos. webrtc-host.js trocea el
// flujo por tamaño fijo (ancho*alto*3/2): si ffmpeg muere a mitad de cuadro y
// el siguiente arranca sobre el mismo flujo, todo queda desfasado para siempre.
// Con un reagrupador por cada ejecución sólo pasan cuadros enteros.
class FrameAligner extends Transform {
  constructor(frameBytes) {
    super();
    this.frameBytes = frameBytes;
    this.frame = Buffer.allocUnsafe(frameBytes);
    this.offset = 0;
  }

  _transform(chunk, _encoding, callback) {
    let position = 0;
    while (position < chunk.length) {
      const count = Math.min(this.frameBytes - this.offset, chunk.length - position);
      chunk.copy(this.frame, this.offset, position, position + count);
      this.offset += count;
      position += count;
      if (this.offset === this.frameBytes) {
        this.push(this.frame);
        this.frame = Buffer.allocUnsafe(this.frameBytes);
        this.offset = 0;
      }
    }
    callback();
  }
}

// Vídeo CPU (respaldo WebRTC) con ffmpeg supervisado. webrtc-host.js reintenta
// cada 350 ms si el hijo muere, y con ddagrab eso pasa a menudo en Windows
// (UAC, bloqueo, cambio de resolución: DXGI_ERROR_ACCESS_LOST), así que el
// reintento con espera creciente 1 s → 5 s y la pausa en escritorio seguro viven
// aquí. Devuelve la misma forma que el contrato: { child, stream }, donde `child`
// sólo ofrece lo que webrtc-host usa (stderr, on('error'|'close'), kill()).
function superviseRawVideo({
  ffmpegBin,
  args,
  frameBytes,
  isSecure = () => false,
  onSecureChange = () => () => {},
  log = () => {},
  spawnFn = spawn,
  minBackoffMs = 1000,
  maxBackoffMs = 5000
}) {
  const stream = new PassThrough();
  const child = new EventEmitter();
  child.stderr = new PassThrough();
  let current = null;
  let stopped = false;
  let timer = null;
  let backoff = minBackoffMs;
  let lastLogAt = 0;

  function launch() {
    if (stopped || current || timer || isSecure()) return;
    const proc = spawnFn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const aligner = new FrameAligner(frameBytes);
    const startedAt = Date.now();
    let tail = '';
    let finished = false;
    current = proc;

    proc.stdout.pipe(aligner);
    aligner.on('data', frame => { if (!stopped) stream.write(frame); });
    proc.stdout.on('error', () => {});
    proc.stderr.on('data', data => {
      tail = (tail + data).slice(-300);
      if (!stopped) child.stderr.write(data);
    });
    proc.stderr.on('error', () => {});

    const onEnd = reason => {
      if (finished) return;
      finished = true;
      if (current === proc) current = null;
      aligner.destroy();
      if (stopped || isSecure()) return; // en secure se espera el evento 'normal'
      const lived = Date.now() - startedAt;
      if (lived > 10000) backoff = minBackoffMs;
      const delay = backoff;
      backoff = Math.min(maxBackoffMs, backoff * 2);
      // Sin esto, un bucle de fallos (monitor desconectado) llenaría el registro.
      if (Date.now() - lastLogAt > 30000) {
        lastLogAt = Date.now();
        log(`Captura CPU terminó (${reason}): ${tail.trim() || 'sin detalle'}; reintentando en ${delay} ms`);
      }
      timer = setTimeout(() => { timer = null; launch(); }, delay);
    };
    proc.on('error', error => onEnd(error.message));
    proc.on('close', code => onEnd(`código ${code}`));
  }

  const unsubscribe = onSecureChange(state => {
    if (stopped) return;
    if (state === 'secure') {
      // ddagrab pierde el acceso en la pantalla protegida; se corta sin esperar.
      if (current) { try { current.kill(); } catch {} }
    } else {
      clearTimeout(timer);
      timer = null;
      backoff = minBackoffMs;
      launch();
    }
  });

  child.kill = () => {
    if (stopped) return true;
    stopped = true;
    clearTimeout(timer);
    timer = null;
    unsubscribe();
    const proc = current;
    current = null;
    if (proc) {
      try { proc.kill(); } catch {}
      if (proc.pid) killTree(proc.pid, 300).catch(() => {});
    }
    setImmediate(() => child.emit('close', null));
    return true;
  };

  launch();
  return { child, stream };
}

module.exports = {
  GPU_CHAINS,
  FrameAligner,
  superviseRawVideo,
  findFfmpeg,
  getFfmpegVersion,
  getAvailableFilters,
  profileBitrateKbps,
  profileDimensions,
  gpuEncoderArgs,
  gpuStreamArgs,
  rawVideoArgs,
  candidateChainsForProfile,
  CADENAS_REV,
  cadenaRecordada,
  selectAndProbeGpuChain,
  invalidateGpuChainCache,
  jpegStreamArgs,
  screenshotArgs,
  JpegSplitter
};
