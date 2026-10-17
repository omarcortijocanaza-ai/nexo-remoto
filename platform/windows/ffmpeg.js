'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');
const { atomicWriteJson, readJsonSafe } = require('../../lib/safe');
const { killTree } = require('../../lib/proc');

const SOI_MARKER = Buffer.from([0xFF, 0xD8]);
const EOI_MARKER = Buffer.from([0xFF, 0xD9]);
const MAX_JPEG_BUFFER_BYTES = 16 * 1024 * 1024;

const GPU_CHAINS = ['d3d11-native', 'd3d11-scale', 'cuda-scale', 'cpu-scale', 'gdigrab'];

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
    scale_cuda: /\bscale_cuda\b/.test(text) && /\bhwmap\b/.test(text)
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
      inputArgs = [
        '-f', 'lavfi',
        '-i', `ddagrab=output_idx=${outIdx}:framerate=${f}:draw_mouse=1,hwmap=derive_device=cuda,scale_cuda=${w}:${h}:format=nv12`
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
  if (saved && saved.ffmpegVersion === ffmpegVersion) {
    if (isNativeRes && typeof saved.chain === 'string' && candidates.includes(saved.chain)) {
      return { chain: saved.chain, cached: true, ffmpegVersion };
    }
    if (!isNativeRes) {
      if (typeof saved.scaleChain === 'string' && candidates.includes(saved.scaleChain)) {
        return { chain: saved.scaleChain, cached: true, ffmpegVersion };
      }
      if (typeof saved.chain === 'string' && saved.chain !== 'd3d11-native' && candidates.includes(saved.chain)) {
        return { chain: saved.chain, cached: true, ffmpegVersion };
      }
    }
  }

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
      const nextState = {
        ffmpegVersion,
        chain: isNativeRes ? chain : (saved?.chain || chain),
        probedAt: new Date().toISOString()
      };
      if (!isNativeRes) {
        nextState.scaleChain = chain;
      } else if (saved?.scaleChain) {
        nextState.scaleChain = saved.scaleChain;
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

module.exports = {
  GPU_CHAINS,
  findFfmpeg,
  getFfmpegVersion,
  getAvailableFilters,
  profileBitrateKbps,
  profileDimensions,
  gpuEncoderArgs,
  gpuStreamArgs,
  rawVideoArgs,
  candidateChainsForProfile,
  selectAndProbeGpuChain,
  invalidateGpuChainCache,
  jpegStreamArgs,
  screenshotArgs,
  JpegSplitter
};
