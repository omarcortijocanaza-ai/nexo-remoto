'use strict';

// Mapa de teclas puro para Windows (conjunto 1 de scan codes).
// No importa ninguna dependencia nativa para poder probarse en cualquier SO.

const SCAN_TABLE = Object.freeze({
  KeyA: { scan: 0x1E, ext: false },
  KeyB: { scan: 0x30, ext: false },
  KeyC: { scan: 0x2E, ext: false },
  KeyD: { scan: 0x20, ext: false },
  KeyE: { scan: 0x12, ext: false },
  KeyF: { scan: 0x21, ext: false },
  KeyG: { scan: 0x22, ext: false },
  KeyH: { scan: 0x23, ext: false },
  KeyI: { scan: 0x17, ext: false },
  KeyJ: { scan: 0x24, ext: false },
  KeyK: { scan: 0x25, ext: false },
  KeyL: { scan: 0x26, ext: false },
  KeyM: { scan: 0x32, ext: false },
  KeyN: { scan: 0x31, ext: false },
  KeyO: { scan: 0x18, ext: false },
  KeyP: { scan: 0x19, ext: false },
  KeyQ: { scan: 0x10, ext: false },
  KeyR: { scan: 0x13, ext: false },
  KeyS: { scan: 0x1F, ext: false },
  KeyT: { scan: 0x14, ext: false },
  KeyU: { scan: 0x16, ext: false },
  KeyV: { scan: 0x2F, ext: false },
  KeyW: { scan: 0x11, ext: false },
  KeyX: { scan: 0x2D, ext: false },
  KeyY: { scan: 0x15, ext: false },
  KeyZ: { scan: 0x2C, ext: false },

  Digit1: { scan: 0x02, ext: false },
  Digit2: { scan: 0x03, ext: false },
  Digit3: { scan: 0x04, ext: false },
  Digit4: { scan: 0x05, ext: false },
  Digit5: { scan: 0x06, ext: false },
  Digit6: { scan: 0x07, ext: false },
  Digit7: { scan: 0x08, ext: false },
  Digit8: { scan: 0x09, ext: false },
  Digit9: { scan: 0x0A, ext: false },
  Digit0: { scan: 0x0B, ext: false },

  Minus: { scan: 0x0C, ext: false },
  Equal: { scan: 0x0D, ext: false },
  BracketLeft: { scan: 0x1A, ext: false },
  BracketRight: { scan: 0x1B, ext: false },
  Backslash: { scan: 0x2B, ext: false },
  Semicolon: { scan: 0x27, ext: false },
  Quote: { scan: 0x28, ext: false },
  Backquote: { scan: 0x29, ext: false },
  Comma: { scan: 0x33, ext: false },
  Period: { scan: 0x34, ext: false },
  Slash: { scan: 0x35, ext: false },
  IntlBackslash: { scan: 0x56, ext: false },

  Enter: { scan: 0x1C, ext: false },
  Escape: { scan: 0x01, ext: false },
  Backspace: { scan: 0x0E, ext: false },
  Tab: { scan: 0x0F, ext: false },
  Space: { scan: 0x39, ext: false },
  CapsLock: { scan: 0x3A, ext: false },

  F1: { scan: 0x3B, ext: false },
  F2: { scan: 0x3C, ext: false },
  F3: { scan: 0x3D, ext: false },
  F4: { scan: 0x3E, ext: false },
  F5: { scan: 0x3F, ext: false },
  F6: { scan: 0x40, ext: false },
  F7: { scan: 0x41, ext: false },
  F8: { scan: 0x42, ext: false },
  F9: { scan: 0x43, ext: false },
  F10: { scan: 0x44, ext: false },
  F11: { scan: 0x57, ext: false },
  F12: { scan: 0x58, ext: false },

  ShiftLeft: { scan: 0x2A, ext: false },
  ShiftRight: { scan: 0x36, ext: false },
  ControlLeft: { scan: 0x1D, ext: false },
  AltLeft: { scan: 0x38, ext: false },

  // Con ext:true
  ControlRight: { scan: 0x1D, ext: true },
  AltRight: { scan: 0x38, ext: true },
  MetaLeft: { scan: 0x5B, ext: true },
  MetaRight: { scan: 0x5C, ext: true },
  ContextMenu: { scan: 0x5D, ext: true },
  Insert: { scan: 0x52, ext: true },
  Delete: { scan: 0x53, ext: true },
  Home: { scan: 0x47, ext: true },
  End: { scan: 0x4F, ext: true },
  PageUp: { scan: 0x49, ext: true },
  PageDown: { scan: 0x51, ext: true },
  ArrowUp: { scan: 0x48, ext: true },
  ArrowDown: { scan: 0x50, ext: true },
  ArrowLeft: { scan: 0x4B, ext: true },
  ArrowRight: { scan: 0x4D, ext: true },
  PrintScreen: { scan: 0x37, ext: true },
  NumpadEnter: { scan: 0x1C, ext: true },
  NumpadDivide: { scan: 0x35, ext: true }
});

const MODIFIERS = Object.freeze({
  ctrl: { scan: 0x1D, ext: false },
  alt: { scan: 0x38, ext: false },
  shift: { scan: 0x2A, ext: false },
  meta: { scan: 0x5B, ext: true }
});

const KEY_TO_CODE = Object.freeze({
  Enter: 'Enter',
  Return: 'Enter',
  Backspace: 'Backspace',
  BackSpace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  Escape: 'Escape',
  Esc: 'Escape',
  ArrowLeft: 'ArrowLeft',
  Left: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Right: 'ArrowRight',
  ArrowUp: 'ArrowUp',
  Up: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  Down: 'ArrowDown',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  Prior: 'PageUp',
  PageDown: 'PageDown',
  Next: 'PageDown',
  Insert: 'Insert',
  ' ': 'Space',
  Space: 'Space',
  Spacebar: 'Space',
  space: 'Space',
  CapsLock: 'CapsLock',
  ContextMenu: 'ContextMenu',
  PrintScreen: 'PrintScreen',
  F1: 'F1',
  F2: 'F2',
  F3: 'F3',
  F4: 'F4',
  F5: 'F5',
  F6: 'F6',
  F7: 'F7',
  F8: 'F8',
  F9: 'F9',
  F10: 'F10',
  F11: 'F11',
  F12: 'F12',
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  '`': 'Backquote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash'
});

const NAMED_SINGLE_KEYS = Object.freeze({
  enter: 'Enter',
  backspace: 'Backspace',
  delete: 'Delete',
  tab: 'Tab',
  escape: 'Escape',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  space: 'Space'
});

// En Windows redo es Ctrl+Y (a diferencia de Ctrl+Shift+Z en algunas apps de Linux).
const NAMED_SHORTCUTS = Object.freeze({
  copy: { ctrl: true, code: 'KeyC' },
  paste: { ctrl: true, code: 'KeyV' },
  cut: { ctrl: true, code: 'KeyX' },
  selectall: { ctrl: true, code: 'KeyA' },
  undo: { ctrl: true, code: 'KeyZ' },
  redo: { ctrl: true, code: 'KeyY' },
  save: { ctrl: true, code: 'KeyS' },
  find: { ctrl: true, code: 'KeyF' },
  alt_tab: { alt: true, code: 'Tab' }
});

function keyToCode(key) {
  if (typeof key !== 'string' || !key) return null;
  if (KEY_TO_CODE[key]) return KEY_TO_CODE[key];
  if (key.length === 1) {
    const ch = key.toUpperCase();
    if (ch >= 'A' && ch <= 'Z') return `Key${ch}`;
    if (ch >= '0' && ch <= '9') return `Digit${ch}`;
  }
  return null;
}

function codeToScan(code) {
  if (typeof code !== 'string' || !code) return null;
  const entry = SCAN_TABLE[code];
  return entry ? { scan: entry.scan, ext: entry.ext } : null;
}

function resolveScan(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.code && SCAN_TABLE[value.code]) {
    return { ...SCAN_TABLE[value.code], code: value.code };
  }
  const mappedCode = keyToCode(value.key);
  if (mappedCode && SCAN_TABLE[mappedCode]) {
    return { ...SCAN_TABLE[mappedCode], code: mappedCode };
  }
  return null;
}

function tapEvents(scan, ext) {
  return [
    { scan, ext: Boolean(ext), up: false },
    { scan, ext: Boolean(ext), up: true }
  ];
}

function named(name) {
  if (typeof name !== 'string' || !name) return null;
  const singleCode = NAMED_SINGLE_KEYS[name];
  if (singleCode) {
    const info = SCAN_TABLE[singleCode];
    return info ? tapEvents(info.scan, info.ext) : null;
  }
  const sc = NAMED_SHORTCUTS[name];
  if (sc) {
    return combo(sc);
  }
  return null;
}

function combo(value) {
  const target = resolveScan(value);
  if (!target) return null;

  // Orden de pulsación obligatorio: Ctrl, Alt, Shift, Win -> tecla -> soltar en orden inverso.
  const activeMods = [];
  if (value.ctrl) activeMods.push(MODIFIERS.ctrl);
  if (value.alt) activeMods.push(MODIFIERS.alt);
  if (value.shift) activeMods.push(MODIFIERS.shift);
  if (value.meta) activeMods.push(MODIFIERS.meta);

  const downMods = activeMods.map(m => ({ scan: m.scan, ext: m.ext, up: false }));
  const upMods = activeMods.slice().reverse().map(m => ({ scan: m.scan, ext: m.ext, up: true }));

  return [
    ...downMods,
    { scan: target.scan, ext: target.ext, up: false },
    { scan: target.scan, ext: target.ext, up: true },
    ...upMods
  ];
}

function normalizeShortcutToken(value) {
  if (!value || typeof value !== 'object') return '';
  const parts = [];
  if (value.ctrl) parts.push('ctrl');
  if (value.alt) parts.push('alt');
  if (value.shift) parts.push('shift');
  if (value.meta) parts.push('meta');

  let keyToken = '';
  const code = typeof value.code === 'string' ? value.code : '';
  if (/^Key[A-Z]$/.test(code)) {
    keyToken = code.slice(3).toLowerCase();
  } else if (/^Digit[0-9]$/.test(code)) {
    keyToken = code.slice(5);
  } else if (code === 'Space' || value.key === ' ') {
    keyToken = 'space';
  } else if (typeof value.key === 'string' && value.key) {
    keyToken = value.key.toLowerCase();
  } else if (code) {
    keyToken = code.toLowerCase();
  }
  if (keyToken) parts.push(keyToken);
  return parts.join('+');
}

function getBlockedSet() {
  const blocked = new Set(['meta+l', 'win+l']);
  const extra = process.env.NEXO_BLOCKED_SHORTCUTS || '';
  for (const raw of extra.split(',')) {
    const clean = raw.trim().toLowerCase().replace(/\bwin\+/g, 'meta+').replace(/\bsuper\+/g, 'meta+');
    if (clean) blocked.add(clean);
  }
  return blocked;
}

function isBlocked(value) {
  if (!value || typeof value !== 'object') return false;
  const token = normalizeShortcutToken(value);
  if (!token) return false;
  return getBlockedSet().has(token);
}

function formatShortcutLabel(value) {
  const parts = [];
  if (value?.ctrl) parts.push('Ctrl');
  if (value?.alt) parts.push('Alt');
  if (value?.shift) parts.push('Shift');
  if (value?.meta) parts.push('Win');
  const code = typeof value?.code === 'string' ? value.code : '';
  if (/^Key[A-Z]$/.test(code)) parts.push(code.slice(3).toUpperCase());
  else if (typeof value?.key === 'string' && value.key) parts.push(value.key.length === 1 ? value.key.toUpperCase() : value.key);
  else if (code) parts.push(code);
  return parts.join('+') || 'desconocido';
}

function shortcut(value) {
  if (!value || typeof value !== 'object') return null;

  if (isBlocked(value)) {
    throw new Error(`Atajo no disponible en remoto: ${formatShortcutLabel(value)}`);
  }

  // meta + ' ' sin otros modificadores -> sólo un toque de Win (abre Inicio).
  const isSpace = value.key === ' ' || value.key === 'Space' || value.key === 'space' || value.code === 'Space';
  if (value.meta && isSpace && !value.ctrl && !value.alt && !value.shift) {
    return tapEvents(MODIFIERS.meta.scan, MODIFIERS.meta.ext);
  }

  return combo({ ...value, meta: Boolean(value.meta) });
}

module.exports = {
  SCAN_TABLE,
  codeToScan,
  keyToCode,
  named,
  combo,
  shortcut,
  isBlocked
};
