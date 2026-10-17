'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  codeToScan,
  named,
  combo,
  shortcut,
  isBlocked
} = require('../platform/windows/keymap');

test('keymap.codeToScan contiene todos los códigos obligatorios de la sección 4.3', () => {
  const expectedNormal = {
    KeyA: 0x1E, KeyB: 0x30, KeyC: 0x2E, KeyD: 0x20, KeyE: 0x12, KeyF: 0x21,
    KeyG: 0x22, KeyH: 0x23, KeyI: 0x17, KeyJ: 0x24, KeyK: 0x25, KeyL: 0x26,
    KeyM: 0x32, KeyN: 0x31, KeyO: 0x18, KeyP: 0x19, KeyQ: 0x10, KeyR: 0x13,
    KeyS: 0x1F, KeyT: 0x14, KeyU: 0x16, KeyV: 0x2F, KeyW: 0x11, KeyX: 0x2D,
    KeyY: 0x15, KeyZ: 0x2C,
    Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05, Digit5: 0x06,
    Digit6: 0x07, Digit7: 0x08, Digit8: 0x09, Digit9: 0x0A, Digit0: 0x0B,
    Minus: 0x0C, Equal: 0x0D, BracketLeft: 0x1A, BracketRight: 0x1B,
    Backslash: 0x2B, Semicolon: 0x27, Quote: 0x28, Backquote: 0x29,
    Comma: 0x33, Period: 0x34, Slash: 0x35, IntlBackslash: 0x56,
    Enter: 0x1C, Escape: 0x01, Backspace: 0x0E, Tab: 0x0F, Space: 0x39,
    CapsLock: 0x3A,
    F1: 0x3B, F2: 0x3C, F3: 0x3D, F4: 0x3E, F5: 0x3F, F6: 0x40,
    F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44, F11: 0x57, F12: 0x58,
    ShiftLeft: 0x2A, ShiftRight: 0x36, ControlLeft: 0x1D, AltLeft: 0x38
  };

  for (const [code, scan] of Object.entries(expectedNormal)) {
    assert.deepEqual(codeToScan(code), { scan, ext: false }, `Fallo en ${code}`);
  }

  const expectedExt = {
    ControlRight: 0x1D, AltRight: 0x38, MetaLeft: 0x5B, MetaRight: 0x5C,
    ContextMenu: 0x5D, Insert: 0x52, Delete: 0x53, Home: 0x47, End: 0x4F,
    PageUp: 0x49, PageDown: 0x51, ArrowUp: 0x48, ArrowDown: 0x50,
    ArrowLeft: 0x4B, ArrowRight: 0x4D, PrintScreen: 0x37,
    NumpadEnter: 0x1C, NumpadDivide: 0x35
  };

  for (const [code, scan] of Object.entries(expectedExt)) {
    assert.deepEqual(codeToScan(code), { scan, ext: true }, `Fallo en extendida ${code}`);
  }

  assert.equal(codeToScan('NoExiste'), null);
});

test('keymap.combo respeta orden de modificadores (Ctrl, Alt, Shift, Win) y soltado inverso en Ctrl+Shift+C', () => {
  const events = combo({ ctrl: true, shift: true, alt: false, meta: false, code: 'KeyC', key: 'c' });
  assert.deepEqual(events, [
    { scan: 0x1D, ext: false, up: false }, // Ctrl down
    { scan: 0x2A, ext: false, up: false }, // Shift down
    { scan: 0x2E, ext: false, up: false }, // KeyC down
    { scan: 0x2E, ext: false, up: true },  // KeyC up
    { scan: 0x2A, ext: false, up: true },  // Shift up
    { scan: 0x1D, ext: false, up: true }   // Ctrl up
  ]);
});

test('keymap.shortcut traduce AltGr ya convertido a meta (Win+E) y meta+espacio como toque de Win', () => {
  // AltGr+E llega desde browserEvent con ctrl:false, alt:false, meta:true
  const winE = shortcut({ key: 'e', code: 'KeyE', ctrl: false, alt: false, shift: false, meta: true });
  assert.deepEqual(winE, [
    { scan: 0x5B, ext: true, up: false },  // Win down
    { scan: 0x12, ext: false, up: false }, // KeyE down
    { scan: 0x12, ext: false, up: true },  // KeyE up
    { scan: 0x5B, ext: true, up: true }   // Win up
  ]);

  // meta + espacio sin otros modificadores -> sólo un toque de Win (abre Inicio)
  const winTap = shortcut({ key: ' ', code: 'Space', ctrl: false, alt: false, shift: false, meta: true });
  assert.deepEqual(winTap, [
    { scan: 0x5B, ext: true, up: false },
    { scan: 0x5B, ext: true, up: true }
  ]);
});

test('keymap bloquea Win+L siempre y respeta NEXO_BLOCKED_SHORTCUTS', () => {
  const winL = { key: 'l', code: 'KeyL', ctrl: false, alt: false, shift: false, meta: true };
  assert.equal(isBlocked(winL), true);
  assert.throws(() => shortcut(winL), /Atajo no disponible en remoto: Win\+L/);

  const prev = process.env.NEXO_BLOCKED_SHORTCUTS;
  process.env.NEXO_BLOCKED_SHORTCUTS = 'meta+l,ctrl+alt+delete';
  try {
    const cad = { key: 'Delete', code: 'Delete', ctrl: true, alt: true, shift: false, meta: false };
    assert.equal(isBlocked(cad), true);
    assert.throws(() => shortcut(cad), /Atajo no disponible en remoto:/);
  } finally {
    if (prev === undefined) delete process.env.NEXO_BLOCKED_SHORTCUTS;
    else process.env.NEXO_BLOCKED_SHORTCUTS = prev;
  }
});

test('keymap.named usa Ctrl+Y para redo en Windows', () => {
  assert.deepEqual(named('redo'), [
    { scan: 0x1D, ext: false, up: false }, // Ctrl down
    { scan: 0x15, ext: false, up: false }, // KeyY down
    { scan: 0x15, ext: false, up: true },  // KeyY up
    { scan: 0x1D, ext: false, up: true }   // Ctrl up
  ]);
  assert.deepEqual(named('copy'), [
    { scan: 0x1D, ext: false, up: false },
    { scan: 0x2E, ext: false, up: false },
    { scan: 0x2E, ext: false, up: true },
    { scan: 0x1D, ext: false, up: true }
  ]);
  assert.equal(named('inexistente'), null);
});
