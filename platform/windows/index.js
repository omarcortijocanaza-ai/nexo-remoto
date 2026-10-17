'use strict';

// Stub provisional de la capa de plataforma para Windows en F1.
// La implementación real se completa en las fases F4 y F6.

const capabilities = Object.freeze({
  gpuVideo: true,
  cpuVideo: true,
  systemAudio: true,
  virtualMic: true,
  independentSession: false,
  loginScreen: false,
  textBatchMs: 0
});

function notImplemented() {
  return Promise.reject(new Error('No implementado en Windows todavía (fase F4)'));
}

function notImplementedSync() {
  throw new Error('No implementado en Windows todavía (fase F4)');
}

module.exports = {
  name: 'windows',
  capabilities,
  init: async () => {},
  close: async () => {},
  listMonitors: async () => [
    {
      index: 0,
      name: '\\\\.\\DISPLAY1',
      description: 'Monitor (provisional)',
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      primary: true
    }
  ],
  pointer: notImplemented,
  scroll: notImplemented,
  text: notImplemented,
  namedKey: notImplemented,
  keyEvent: notImplemented,
  shortcut: notImplemented,
  workspace: notImplemented,
  clipboardGet: notImplemented,
  clipboardSet: notImplemented,
  screenshotJpeg: notImplemented,
  startJpegStream: notImplementedSync,
  spawnSystemAudio: notImplementedSync,
  spawnRawVideo: notImplementedSync,
  defaultAudioTarget: notImplemented,
  keepAwake: () => {},
  on: () => {}
};
