'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GPU_CHAINS,
  gpuStreamArgs,
  profileBitrateKbps,
  profileDimensions,
  candidateChainsForProfile,
  CADENAS_REV,
  cadenaRecordada
} = require('../platform/windows/ffmpeg');

test('ffmpeg-args: dimensiones y bitrates de perfiles 720p, 900p y 1080p coinciden con Linux', () => {
  assert.deepEqual(profileDimensions(1080), { width: 1920, height: 1080 });
  assert.deepEqual(profileDimensions(900), { width: 1600, height: 900 });
  assert.deepEqual(profileDimensions(720), { width: 1280, height: 720 });

  assert.equal(profileBitrateKbps(1080), 10000);
  assert.equal(profileBitrateKbps(900), 7000);
  assert.equal(profileBitrateKbps(720), 4500);
});

test('ffmpeg-args: argumentos de cada cadena GPU para 720p/900p/1080p y 30/45/60 FPS', () => {
  const profiles = [
    { height: 720, width: 1280, bitrateBps: 4500000, bufsize: 240000 },
    { height: 900, width: 1600, bitrateBps: 7000000, bufsize: Math.round(7000000 / 30) },
    { height: 1080, width: 1920, bitrateBps: 10000000, bufsize: Math.round(10000000 / 30) }
  ];
  const fpsList = [
    { fps: 30, gop: 15 },
    { fps: 45, gop: Math.max(15, Math.round(45 / 2)) },
    { fps: 60, gop: 30 }
  ];

  const monitor = { index: 1, x: 1920, y: -88, width: 1920, height: 1080 };

  for (const chain of GPU_CHAINS) {
    for (const p of profiles) {
      for (const f of fpsList) {
        const args = gpuStreamArgs({
          chain,
          index: monitor.index,
          fps: f.fps,
          width: p.width,
          height: p.height,
          rtpPort: 5004,
          monitor
        });

        // Prefijo obligatorio
        assert.deepEqual(args.slice(0, 5), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f']);

        // Codificador común idéntico a Linux (sección 4.5)
        const encIdx = args.indexOf('h264_nvenc');
        assert.ok(encIdx > 0, `Falta h264_nvenc en cadena ${chain}`);

        const getFlag = flag => {
          const idx = args.indexOf(flag);
          return idx >= 0 ? args[idx + 1] : null;
        };

        assert.equal(getFlag('-preset'), 'p1');
        assert.equal(getFlag('-tune'), 'ull');
        assert.equal(getFlag('-rc'), 'cbr');
        assert.equal(getFlag('-b:v'), String(p.bitrateBps));
        assert.equal(getFlag('-maxrate'), String(p.bitrateBps));
        assert.equal(getFlag('-bufsize'), String(Math.max(240000, p.bufsize)));
        assert.equal(getFlag('-g'), String(f.gop));
        assert.equal(getFlag('-bf'), '0');
        assert.equal(getFlag('-forced-idr'), '1');
        assert.equal(getFlag('-profile:v'), 'high');
        assert.equal(getFlag('-delay'), '0');
        assert.equal(getFlag('-zerolatency'), '1');
        assert.equal(getFlag('-strict_gop'), '1');
        assert.equal(getFlag('-aud'), '1');
        assert.equal(getFlag('-bsf:v'), 'dump_extra=freq=keyframe');
        assert.equal(getFlag('-payload_type'), '96');
        assert.equal(args.at(-1), 'rtp://127.0.0.1:5004?pkt_size=1200&localaddr=127.0.0.1');

        // Verificar filtro de entrada según cadena
        const inputVal = getFlag('-i');
        if (chain === 'd3d11-native') {
          assert.equal(inputVal, `ddagrab=output_idx=1:framerate=${f.fps}:draw_mouse=1`);
        } else if (chain === 'd3d11-scale') {
          assert.equal(inputVal, `ddagrab=output_idx=1:framerate=${f.fps}:draw_mouse=1,scale_d3d11=${p.width}:${p.height}:format=nv12`);
        } else if (chain === 'cuda-scale') {
          assert.equal(inputVal, `ddagrab=output_idx=1:framerate=${f.fps}:draw_mouse=1,hwdownload,format=bgra`);
          assert.equal(getFlag('-vf'), `hwupload_cuda,scale_cuda=${p.width}:${p.height}`);
          assert.ok(!args.join(' ').includes('hwmap'), 'FFmpeg no sabe derivar CUDA desde D3D11: no debe haber hwmap');
        } else if (chain === 'cpu-scale') {
          assert.equal(inputVal, `ddagrab=output_idx=1:framerate=${f.fps}:draw_mouse=1,hwdownload,format=bgra,scale=${p.width}:${p.height}:flags=bilinear,format=nv12`);
        } else if (chain === 'gdigrab') {
          assert.equal(inputVal, 'desktop');
          assert.equal(getFlag('-offset_x'), '1920');
          assert.equal(getFlag('-offset_y'), '-88');
          assert.equal(getFlag('-video_size'), '1920x1080');
          assert.equal(getFlag('-vf'), `scale=${p.width}:${p.height},format=nv12`);
        }
      }
    }
  }
});

test('ffmpeg-args: d3d11-native sólo se incluye como candidata si la resolución coincide con el monitor', () => {
  const monitor = { width: 1920, height: 1080 };
  const filters = { scale_d3d11: true, scale_cuda: true };

  const nativeCandidates = candidateChainsForProfile({ width: 1920, height: 1080, monitor, filters });
  assert.equal(nativeCandidates[0], 'd3d11-native');

  const scaledCandidates = candidateChainsForProfile({ width: 1280, height: 720, monitor, filters });
  assert.ok(!scaledCandidates.includes('d3d11-native'));
  assert.equal(scaledCandidates[0], 'd3d11-scale');
});

test('ffmpeg-args: la cadena recordada sólo vale con la misma versión de ffmpeg y la misma revisión de cadenas', () => {
  const candidates = ['d3d11-scale', 'cuda-scale', 'cpu-scale', 'gdigrab'];
  const base = { ffmpegVersion: 'ffmpeg version 9.0', candidates, isNativeRes: false };

  // Lo guardado antes de la revisión 2 recordaba `cpu-scale`: no debe impedir que se pruebe `cuda-scale`.
  const viejo = { ffmpegVersion: 'ffmpeg version 9.0', chain: 'd3d11-native', scaleChain: 'cpu-scale' };
  assert.equal(cadenaRecordada({ ...base, saved: viejo }), null);

  const vigente = { ...viejo, cadenasRev: CADENAS_REV };
  assert.equal(cadenaRecordada({ ...base, saved: vigente }), 'cpu-scale');
  assert.equal(cadenaRecordada({ ...base, saved: { ...vigente, ffmpegVersion: 'ffmpeg version 9.1' } }), null);

  // A resolución nativa se usa `chain`; si no está entre las candidatas, se sondea.
  assert.equal(cadenaRecordada({ ...base, isNativeRes: true, candidates: ['d3d11-native', 'cpu-scale'], saved: vigente }), 'd3d11-native');
  assert.equal(cadenaRecordada({ ...base, isNativeRes: true, saved: vigente }), null);
  assert.equal(cadenaRecordada({ ...base, saved: null }), null);
});
