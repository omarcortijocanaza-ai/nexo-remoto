'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NexoKeyboard = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const KEYS = Object.freeze({
    enter: 'Return', backspace: 'BackSpace', delete: 'Delete', tab: 'Tab', escape: 'Escape',
    left: 'Left', right: 'Right', up: 'Up', down: 'Down', home: 'Home', end: 'End',
    pageup: 'Prior', pagedown: 'Next', space: 'space'
  });
  const SHORTCUTS = Object.freeze({
    copy: ['CTRL', 'c'], paste: ['CTRL', 'v'], cut: ['CTRL', 'x'], selectall: ['CTRL', 'a'],
    undo: ['CTRL', 'z'], redo: ['CTRL', 'SHIFT', 'z'], save: ['CTRL', 's'], find: ['CTRL', 'f'],
    alt_tab: ['ALT', 'Tab']
  });
  const BROWSER_KEYS = Object.freeze({
    Enter: 'Return', Backspace: 'BackSpace', Delete: 'Delete', Tab: 'Tab', Escape: 'Escape',
    ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
    Home: 'Home', End: 'End', PageUp: 'Prior', PageDown: 'Next', ' ': 'space',
    Insert: 'Insert', F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
    F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12'
  });
  const SUPER_KEYS = new Set(['Meta', 'OS', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight']);
  const ALT_GR_KEYS = new Set(['AltGraph', 'AltRight']);

  function isNativeSuper(event) {
    return Boolean(event && (SUPER_KEYS.has(event.key) || SUPER_KEYS.has(event.code)));
  }

  function isAltGr(event) {
    return Boolean(event && (ALT_GR_KEYS.has(event.key) || ALT_GR_KEYS.has(event.code)));
  }

  function keyCommand(name) {
    const key = KEYS[name];
    if (key) return ['-k', key];
    const combo = SHORTCUTS[name];
    if (!combo) return null;
    const modifiers = combo.slice(0, -1).flatMap(value => ['-M', value.toLowerCase()]);
    const releases = combo.slice(0, -1).reverse().flatMap(value => ['-m', value.toLowerCase()]);
    return [...modifiers, '-k', combo.at(-1), ...releases];
  }

  function browserKeyCommand(event) {
    if (!event || typeof event !== 'object' || typeof event.key !== 'string') return null;
    const mappedKey = BROWSER_KEYS[event.key];
    const key = mappedKey || (Array.from(event.key).length === 1 ? event.key : null);
    if (!key) return null;
    const held = [];
    if (event.ctrl) held.push('ctrl');
    if (event.alt) held.push('alt');
    if (event.shift && (Array.from(event.key).length !== 1 || event.ctrl || event.alt || event.meta)) held.push('shift');
    if (event.meta) held.push('logo');
    // Named keys must be emitted as physical key presses. In particular,
    // `wtype -- " "` is not reliable across Wayland keyboard layouts, while
    // `wtype -k space` is. Printable characters still use text input so ñ,
    // accents and non-Latin scripts keep working.
    if (!held.length && !mappedKey && Array.from(event.key).length === 1) return ['--', event.key];
    return [
      ...held.flatMap(modifier => ['-M', modifier]), '-k', key,
      ...held.slice().reverse().flatMap(modifier => ['-m', modifier])
    ];
  }

  function browserEvent(event, extra = {}) {
    let key = event.code === 'Space' && (event.key === 'Space' || event.key === 'Spacebar') ? ' ' : event.key;
    // En un atajo con Shift, KeyboardEvent.key llega como "C"/"V". wtype
    // necesita la tecla física minúscula y el modificador Shift por separado;
    // enviar ambos como mayúscula puede resolver otro keysym en algunos mapas.
    if ((event.ctrlKey || event.altKey || event.metaKey || extra.altGrSuper || extra.virtualSuper) && /^Key[A-Z]$/.test(event.code || '')) {
      key = event.code.slice(3).toLowerCase();
    }
    return {
      key,
      code: event.code || '',
      // En Windows, AltGr se expone como Ctrl+Alt. Cuando se usa como el
      // modificador Super de NEXO hay que retirar ambos bits para que el host
      // reciba exclusivamente Super+tecla.
      ctrl: Boolean(event.ctrlKey && !extra.altGrSuper),
      alt: Boolean(event.altKey && !extra.altGrSuper),
      shift: Boolean(event.shiftKey),
      // Las tres vias valen A LA VEZ: la tecla Super/Windows/Command cuando el
      // sistema la entrega, AltGr como respaldo cuando no, y el boton SUPER de
      // la barra. AltGr se sumo como alternativa, no como sustituto: durante un
      // tiempo el cliente ignoraba la Super nativa y en esos equipos no habia
      // forma de lanzar un atajo con la tecla de verdad.
      meta: Boolean(event.metaKey || extra.nativeSuper || extra.altGrSuper || extra.virtualSuper),
      repeat: Boolean(event.repeat)
    };
  }

  return { BROWSER_KEYS, browserEvent, browserKeyCommand, isAltGr, isNativeSuper, keyCommand };
});
