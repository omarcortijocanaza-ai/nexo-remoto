'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { Transform } = require('node:stream');

const SOI_MARKER = Buffer.from([0xFF, 0xD8]);
const EOI_MARKER = Buffer.from([0xFF, 0xD9]);
const MAX_JPEG_BUFFER_BYTES = 16 * 1024 * 1024;

let cachedFfmpegPath = null;

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

function normalizeMjpegQ(quality, defaultQ) {
  const n = Number(quality);
  if (!Number.isFinite(n) || n <= 0) return defaultQ;
  // Si ya viene en escala q:v de FFmpeg (2..31), úsalo directamente;
  // si viene como porcentaje (ej. 48 o 65 de server.js), usa el valor por defecto del plan.
  if (n >= 2 && n <= 31) return Math.round(n);
  return defaultQ;
}

function jpegStreamArgs({ index = 0, fps = 10, quality = 8 } = {}) {
  const outIdx = Math.max(0, Number(index) || 0);
  // El respaldo JPEG en Windows usa 10 FPS por diseño (sección 4.5) salvo que se pida menos.
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
        // Si el último byte es 0xFF, podría ser la primera mitad de FF D8 partido entre trozos.
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
  findFfmpeg,
  jpegStreamArgs,
  screenshotArgs,
  JpegSplitter
};
