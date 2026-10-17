'use strict';

// Sin el entorno de la sesion, wf-recorder y pw-record no encuentran ni el
// compositor ni el audio: NEXO corre como servicio y no hereda nada.
const { entornoDe } = require('../../entorno');
const { runCommand } = require('../../lib/proc');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');

function defaultAudioTarget() {
  return runCommand('pactl', ['get-default-sink'], 4096, { env: entornoDe() }).then(out => out.toString().trim());
}

function spawnRawVideo({ monitor, width, height, fps }) {
  const fifo = `/tmp/nexo-webrtc-${process.pid}-${Date.now()}.raw`;
  fs.rmSync(fifo, { force: true });
  const fifoResult = spawnSync('mkfifo', ['-m', '600', fifo]);
  if (fifoResult.status !== 0) throw new Error(`No se pudo crear el canal de video: ${fifoResult.stderr}`);
  const videoStream = fs.createReadStream(fifo);
  const child = spawn('wf-recorder', [
    '-y', '-o', monitor.name, '-r', String(fps), '-c', 'rawvideo', '-m', 'rawvideo', '-x', 'yuv420p',
    '-F', `scale=${width}:${height}:flags=fast_bilinear,fps=${fps}`, '-f', fifo
  ], { stdio: ['ignore', 'ignore', 'pipe'], env: entornoDe() });
  child.on('close', () => {
    videoStream.destroy();
    fs.rmSync(fifo, { force: true });
  });
  videoStream.on('close', () => fs.rmSync(fifo, { force: true }));
  return { child, stream: videoStream };
}

function spawnSystemAudio({ target = 'alsa_output.pci-0000_09_00.4.analog-stereo.monitor', latencyMs = 20 } = {}) {
  return spawn('pw-record', [
    `--target=${String(target).replace(/\.monitor$/, '')}`,
    '--properties={ "stream.capture.sink": true, "media.name": "Nexo WebRTC Audio" }',
    '--format=s16', '--rate=48000', '--channels=2', `--latency=${latencyMs}ms`, '--raw', '-'
  ], { stdio: ['ignore', 'pipe', 'pipe'], env: entornoDe() });
}

module.exports = { defaultAudioTarget, spawnRawVideo, spawnSystemAudio };
