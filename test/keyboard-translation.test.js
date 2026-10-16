'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { browserEvent, browserKeyCommand, isAltGr, isNativeSuper, keyCommand } = require('../keyboard-translation');

test('reconoce todas las variantes Meta/OS como Super', () => {
  for (const value of ['Meta', 'OS', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight']) {
    assert.equal(isNativeSuper({ key: value, code: value }), true, value);
  }
  assert.equal(isNativeSuper({ key: 'Control', code: 'ControlLeft' }), false);
});

test('reconoce AltGr y no confunde Ctrl derecho con el modificador remoto', () => {
  assert.equal(isAltGr({ key: 'AltGraph', code: 'AltRight' }), true);
  assert.equal(isAltGr({ key: 'Alt', code: 'AltRight' }), true);
  assert.equal(isAltGr({ key: 'Control', code: 'ControlRight' }), false);
});

test('convierte AltGr de Windows (Ctrl+Alt) en Super remoto exclusivamente', () => {
  assert.deepEqual(browserEvent({ key: '@', code: 'KeyQ', ctrlKey: true, altKey: true }, { altGrSuper: true }), {
    key: 'q', code: 'KeyQ', ctrl: false, alt: false, shift: false, meta: true, repeat: false
  });
  assert.equal(browserEvent({ key: 'e' }, { virtualSuper: true }).meta, true);
  assert.deepEqual(browserEvent({ key: 'q', code: 'KeyQ', ctrlKey: true }), {
    key: 'q', code: 'KeyQ', ctrl: true, alt: false, shift: false, meta: false, repeat: false
  });
});

test('la tecla Super del cliente sigue valiendo, no solo AltGr', () => {
  // AltGr se añadió como alternativa cuando el sistema se queda la tecla
  // Windows; durante un tiempo la sustituyó, y en los equipos que sí entregan
  // Super no había forma de lanzar un atajo con la tecla de verdad.
  assert.equal(browserEvent({ key: 'q', code: 'KeyQ', metaKey: true }).meta, true);
  assert.equal(browserEvent({ key: 'q', code: 'KeyQ' }, { nativeSuper: true }).meta, true);
  assert.equal(browserEvent({ key: 'q', code: 'KeyQ' }).meta, false);
});

test('normaliza letras con Shift para atajos físicos de copiar y pegar', () => {
  assert.equal(browserEvent({ key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true }).key, 'c');
  assert.equal(browserEvent({ key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true }).key, 'v');
  assert.equal(browserEvent({ key: 'C', code: 'KeyC', shiftKey: true }).key, 'C');
});

test('traduce Ctrl, Alt y Shift con liberación en orden inverso', () => {
  assert.deepEqual(browserKeyCommand({ key: 'F4', ctrl: true, alt: true, shift: true }), [
    '-M', 'ctrl', '-M', 'alt', '-M', 'shift', '-k', 'F4', '-m', 'shift', '-m', 'alt', '-m', 'ctrl'
  ]);
});

test('traduce caracteres internacionales completos', () => {
  assert.deepEqual(browserKeyCommand({ key: 'ñ' }), ['--', 'ñ']);
  assert.deepEqual(browserKeyCommand({ key: '你' }), ['--', '你']);
  assert.deepEqual(browserKeyCommand({ key: 'é', ctrl: true }), ['-M', 'ctrl', '-k', 'é', '-m', 'ctrl']);
});

test('traduce teclas especiales y atajos táctiles', () => {
  assert.deepEqual(browserKeyCommand({ key: ' ' }), ['-k', 'space']);
  assert.equal(browserEvent({ key: 'Spacebar', code: 'Space' }).key, ' ');
  assert.equal(browserEvent({ key: 'Space', code: 'Space' }).key, ' ');
  assert.deepEqual(browserKeyCommand({ key: 'ArrowLeft' }), ['-k', 'Left']);
  assert.deepEqual(browserKeyCommand({ key: 'Enter', shift: true }), ['-M', 'shift', '-k', 'Return', '-m', 'shift']);
  assert.deepEqual(keyCommand('redo'), ['-M', 'ctrl', '-M', 'shift', '-k', 'z', '-m', 'shift', '-m', 'ctrl']);
  assert.equal(keyCommand('desconocida'), null);
});
