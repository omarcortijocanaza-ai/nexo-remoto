'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const platform = require('../platform');
const windowsPlatform = require('../platform/windows');

const EXPECTED_KEYS = {
  name: 'string',
  capabilities: 'object',
  init: 'function',
  close: 'function',
  listMonitors: 'function',
  pointer: 'function',
  scroll: 'function',
  text: 'function',
  namedKey: 'function',
  keyEvent: 'function',
  shortcut: 'function',
  workspace: 'function',
  clipboardGet: 'function',
  clipboardSet: 'function',
  screenshotJpeg: 'function',
  startJpegStream: 'function',
  spawnSystemAudio: 'function',
  spawnRawVideo: 'function',
  defaultAudioTarget: 'function',
  keepAwake: 'function',
  on: 'function'
};

const EXPECTED_CAPABILITY_KEYS = {
  gpuVideo: 'boolean',
  cpuVideo: 'boolean',
  systemAudio: 'boolean',
  virtualMic: 'boolean',
  independentSession: 'boolean',
  loginScreen: 'boolean',
  textBatchMs: 'number'
};

function assertContract(mod, expectedName) {
  assert.equal(mod.name, expectedName);
  assert.deepEqual(Object.keys(mod).sort(), Object.keys(EXPECTED_KEYS).sort());
  for (const [key, expectedType] of Object.entries(EXPECTED_KEYS)) {
    assert.equal(typeof mod[key], expectedType, `${expectedName}.${key} debe ser ${expectedType}`);
  }
  assert.deepEqual(Object.keys(mod.capabilities).sort(), Object.keys(EXPECTED_CAPABILITY_KEYS).sort());
  for (const [capKey, expectedType] of Object.entries(EXPECTED_CAPABILITY_KEYS)) {
    assert.equal(typeof mod.capabilities[capKey], expectedType, `${expectedName}.capabilities.${capKey} debe ser ${expectedType}`);
  }
}

test('el módulo de la plataforma actual cumple el contrato de la sección 4.1', () => {
  const expectedName = process.platform === 'win32' ? 'windows' : 'linux';
  assertContract(platform, expectedName);
});

test('el módulo platform/windows cumple el contrato de la sección 4.1', async () => {
  assertContract(windowsPlatform, 'windows');
  assert.equal(windowsPlatform.capabilities.independentSession, false);
  assert.equal(windowsPlatform.capabilities.loginScreen, false);
  assert.equal(windowsPlatform.capabilities.textBatchMs, 0);
  const monitors = await windowsPlatform.listMonitors();
  assert.equal(Array.isArray(monitors), true);
  assert.equal(monitors.length >= 1, true);
  assert.equal(typeof monitors[0].name, 'string');
});
