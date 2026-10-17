'use strict';

const net = require('net');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { browserKeyCommand, keyCommand } = require('../../keyboard-translation');
// Un mismo servicio atiende la pantalla de inicio de sesion (X11) y la sesion
// Hyprland ya iniciada (Wayland): `entorno.estado()` dice cual hay delante en
// cada momento y `entrada-x11` es el motor para la primera.
const { estado: estadoEntorno, entornoDe } = require('../../entorno');
const entradaX11 = require('../../entrada-x11');
const proc = require('../../lib/proc');
const { defaultAudioTarget, spawnRawVideo, spawnSystemAudio } = require('./media');

const wlrctl = path.join(__dirname, '..', '..', 'bin', 'wlrctl');
let queue = Promise.resolve();
// Waybar, Rofi y otras superficies layer-shell no aparecen en `hyprctl clients`.
// Si el gesto comienza sobre una de ellas, se completa con el puntero virtual
// para que el clic llegue a la superficie bajo el cursor, no a activewindow.
const layerPointerButtons = new Set();

function runCommand(command, args, maxBytes = 20 * 1024 * 1024) {
  return proc.runCommand(command, args, maxBytes, { env: entornoDe() });
}

function runCommandInput(command, args, input) {
  return proc.runCommandInput(command, args, input, { env: entornoDe() });
}

function startCommandInput(command, args, input, readyDelay = 25) {
  return proc.startCommandInput(command, args, input, readyDelay, { env: entornoDe() });
}

// La ruta del socket NO puede calcularse una vez al arrancar: como servicio,
// NEXO nace antes que la sesion y entonces no existe ninguna firma de Hyprland.
// Se pregunta en cada uso, que ademas sobrevive a cerrar y volver a iniciar
// sesion (la firma cambia).
function hyprSocketPath() {
  return estadoEntorno().socketHyprland || '';
}

function executeWtype(args) {
  // En el greeter no hay Wayland: la misma orden se traduce a XTEST.
  if (estadoEntorno().modo === 'x11') return entradaX11.escribirComoWtype(args);
  return new Promise((resolve, reject) => {
    const child = spawn('wtype', args, { stdio: ['ignore', 'ignore', 'pipe'], env: entornoDe() });
    let err = '';
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(err.trim() || `wtype terminó con ${code}`)));
  });
}

function enqueueInput(task) {
  const job = queue.then(task);
  queue = job.catch(() => {});
  return job;
}

function runWtype(args) {
  return enqueueInput(() => executeWtype(args));
}

// El nombre de la ventana no basta: Claude Desktop se anuncia como
// `com.anthropic.Claude` y es Electron puro, asi que caia en la ruta rapida y
// perdia el espacio. Cuando el nombre no delata nada se mira el ejecutable: un
// empaquetado Electron/Chromium siempre lleva estos ficheros al lado.
const MARCAS_ELECTRON = ['chrome_crashpad_handler', 'libffmpeg.so', 'resources.pak'];
const electronPorPid = new Map();

function procesoEsElectron(pid) {
  if (!pid) return false;
  if (electronPorPid.has(pid)) return electronPorPid.get(pid);
  let esElectron = false;
  try {
    const carpeta = path.dirname(fs.readlinkSync(`/proc/${pid}/exe`));
    esElectron = MARCAS_ELECTRON.some(marca => fs.existsSync(path.join(carpeta, marca)));
  } catch {}
  if (electronPorPid.size > 256) electronPorPid.clear();
  electronPorPid.set(pid, esElectron);
  return esElectron;
}

async function activeWindowIsChromium() {
  // En el greeter no hay ventanas que consultar, y ahi `xdotool type` entrega
  // el texto entero sin los problemas de Chromium bajo Wayland.
  if (estadoEntorno().modo !== 'wayland') return false;
  try {
    const active = JSON.parse(await hyprIpc('j/activewindow'));
    const identity = `${active.class || ''} ${active.initialClass || ''} ${active.title || ''}`;
    if (/brave|chrom(?:e|ium)|electron/i.test(identity)) return true;
    return procesoEsElectron(active.pid);
  } catch {
    return false;
  }
}

// Chromium/Brave under native Wayland currently discards an injected KEY_SPACE
// even though it accepts the surrounding keys. A clipboard owner plus Ctrl+V
// produces an actual U+0020 (unlike NBSP).
//
// Todo lo que toca el portapapeles —copiar, pegar y restaurar— va por la cola
// de entrada. Repartirlo en dos colas para ganar unos milisegundos fue lo que
// rompio el tecleo rapido: ver el comentario de `scheduleClipboardRestore`.
const clipboardArgs = ['--type', 'text/plain;charset=utf-8'];
// Texto que hemos dejado nosotros en el portapapeles; `undefined` = es del
// usuario y no se ha tocado.
let clipboardOwnedText;
let clipboardOriginal;
let clipboardRestoreTimer = null;

// La restauracion va en la MISMA cola que las entregas. Estaba en una cola
// aparte, y su `wl-copy` se colaba entre el copiado y el Ctrl+V de la tecla
// siguiente: se pegaba el contenido anterior. Escribiendo rapido en Chromium
// eso sacaba caracteres de hace varias teclas — «rápida, con» salia
// «rápidaácon». Ademas peor: si el `wl-paste` que guarda el original corria
// mientras la restauracion seguia en vuelo, guardaba NUESTRA propia letra como
// «original» y la dejaba pegada para siempre.
//
// El plazo tambien sube: 120 ms es menos de lo que se tarda entre dos teclas,
// asi que la restauracion saltaba constantemente en medio del tecleo. Ahora
// espera a que se deje de escribir.
const CLIPBOARD_RESTORE_MS = Math.max(300, Number(process.env.NEXO_CLIPBOARD_RESTORE_MS) || 1500);

function scheduleClipboardRestore() {
  clearTimeout(clipboardRestoreTimer);
  clipboardRestoreTimer = setTimeout(() => {
    clipboardRestoreTimer = null;
    enqueueInput(async () => {
      if (clipboardOwnedText === undefined) return;
      clipboardOwnedText = undefined;
      const previous = clipboardOriginal;
      clipboardOriginal = undefined;
      if (previous !== undefined) await startCommandInput('wl-copy', clipboardArgs, previous);
    }).catch(() => {});
  }, CLIPBOARD_RESTORE_MS);
}

// No es solo el espacio: dentro de Electron/Chromium tampoco llegaban la coma y
// otros caracteres, porque `wtype` reescribe el mapa de teclas en cada llamada y
// esas ventanas no lo aplican igual que el resto. El pegado no depende del mapa,
// asi que todo el texto que va a una ventana de ese tipo se entrega por aqui.
// Fuera de ellas no cambia nada: se sigue escribiendo con `wtype`, que es mas
// rapido y no toca el portapapeles.
// Letras y numeros sueltos si llegan bien por `wtype` en Chromium: su posicion
// en el mapa que genera wtype coincide con la del teclado real. Lo que se
// pierde son los espacios, las comas y los acentos, y solo para esos hace falta
// el portapapeles. Medido tecla a tecla en una ventana Chromium: «esto es una
// prueba rápida, con acentos: está escrito así» llegaba como
// «estoesunapruebarpidaconacentosestescritoas».
const SEGURO_POR_TECLADO = /^[A-Za-z0-9]$/;

function runChromiumAwareText(texto) {
  return enqueueInput(async () => {
    if (!await activeWindowIsChromium()) {
      return executeWtype(texto === ' ' ? ['-k', 'space'] : ['--', texto]);
    }

    if (SEGURO_POR_TECLADO.test(texto)) return executeWtype(['--', texto]);

    if (clipboardOwnedText === texto) {
      // El portapapeles ya contiene este texto: repetirlo cuesta un `wtype` y
      // nada más. Cada pulsación aplaza la restauración.
      await executeWtype(['-M', 'ctrl', '-k', 'v', '-m', 'ctrl']);
      return scheduleClipboardRestore();
    }

    if (clipboardOwnedText === undefined) {
      // Ya no hace falta esperar a `clipboardTail`: la restauracion corre en
      // esta misma cola, asi que aqui no puede haber una en vuelo.
      try {
        clipboardOriginal = await runCommand('wl-paste', ['--no-newline', '--type', 'text/plain'], 1024 * 1024);
      } catch { clipboardOriginal = undefined; }
    }

    await startCommandInput('wl-copy', clipboardArgs, texto);
    // `startCommandInput` solo espera un plazo fijo, no a que wl-copy sea dueño
    // del portapapeles de verdad. Escribiendo rapido eso hacia que el Ctrl+V
    // pegara el texto del turno anterior: salian letras cambiadas. Medido en una
    // ventana Chromium: «abcdefghij» llegaba como «á csbcdefghij». Se comprueba
    // antes de pegar.
    for (let intento = 0; intento < 3; intento++) {
      let actual;
      try {
        actual = (await runCommand('wl-paste', ['--no-newline', '--type', 'text/plain'], 1024 * 1024)).toString();
      } catch {}
      if (actual === texto) break;
      await new Promise(listo => setTimeout(listo, 15));
    }
    clipboardOwnedText = texto;
    await executeWtype(['-M', 'ctrl', '-k', 'v', '-m', 'ctrl']);
    scheduleClipboardRestore();
  });
}

function runChromiumAwareSpace() {
  return runChromiumAwareText(' ');
}

// Si el servidor se detiene entre el pegado y la restauración, el portapapeles
// se quedaría con un espacio. `wl-copy` se bifurca al arrancar, así que esta
// llamada síncrona devuelve enseguida.
function restoreClipboardOnExit() {
  if (clipboardOwnedText === undefined || clipboardOriginal === undefined) return;
  clipboardOwnedText = undefined;
  try { spawnSync('wl-copy', clipboardArgs, { input: clipboardOriginal, timeout: 1000 }); } catch {}
}

function hyprIpc(command) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(hyprSocketPath(), () => socket.end(command));
    const chunks = [];
    socket.on('data', chunk => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString()));
    socket.on('error', reject);
  });
}

// Hyprland 0.55+ evaluates `dispatch` arguments as Lua dispatcher objects.
// The former `dispatch movecursor X Y` wire format is consequently parsed as
// invalid Lua and makes NEXO receive pointer events without applying them.
// JSON string literals are valid Lua literals too and keep selectors/commands
// quoted when they come from compositor state.
function luaString(value) {
  return JSON.stringify(String(value));
}

function luaDispatch(expression) {
  // `eval` is independent from the user's config format. In contrast,
  // `dispatch hl.dsp...` works with Lua configs but is treated as a legacy
  // dispatcher name when the compositor still loads a .conf file.
  return `eval hl.dispatch(${expression})`;
}

async function listMonitors() {
  const data = JSON.parse(await hyprIpc('j/monitors')).filter(item => !item.disabled && item.dpmsStatus !== false);
  return data.map((item, index) => ({ name: item.name, description: item.description || item.model || item.name, width: item.width, height: item.height, x: item.x, y: item.y, primary: item.x === 0 && item.y === 0, focused: Boolean(item.focused), index }));
}

async function pointerAction(data, monitor) {
  const nx = Math.max(0, Math.min(1, Number(data.x)));
  const ny = Math.max(0, Math.min(1, Number(data.y)));
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new Error('Coordenadas inválidas');
  // En el greeter no hay monitores que consultarle a Hyprland ni ventanas bajo
  // el cursor: es una pantalla y basta con llevar el puntero al pixel.
  if (estadoEntorno().modo === 'x11') {
    // Las coordenadas van referidas a la region que se esta emitiendo (el
    // monitor primario), asi que hay que sumarle su posicion dentro del
    // display: sin el desplazamiento, los clics caen en la otra pantalla.
    const { ancho, alto, x: origenX, y: origenY } = await entradaX11.geometria();
    return entradaX11.puntero({
      ...data,
      x: origenX + Math.round(nx * Math.max(0, ancho - 1)),
      y: origenY + Math.round(ny * Math.max(0, alto - 1))
    });
  }
  const x = monitor.x + Math.round(nx * (monitor.width - 1));
  const y = monitor.y + Math.round(ny * (monitor.height - 1));
  const commands = [luaDispatch(`hl.dsp.cursor.move({ x = ${x}, y = ${y} })`)];
  const button = data.button === 'right' ? 273 : 272;
  const buttonName = data.button === 'right' ? 'right' : 'left';
  let targetAddress = '';
  // `activewindow` era la causa de que un clic remoto nunca cambiara de
  // terminal: el botón se enviaba a la ventana previamente activa, no a la
  // que estaba debajo del cursor. En down/tap enfocamos primero el cliente
  // que contiene las coordenadas; después Hyprland entrega el botón allí.
  if (data.action === 'tap' || data.action === 'down' || data.action === 'dragstart') {
    try {
      const [clients, monitorList, layers] = await Promise.all([
        hyprIpc('j/clients').then(JSON.parse),
        hyprIpc('j/monitors').then(JSON.parse),
        hyprIpc('j/layers').then(JSON.parse).catch(() => ({}))
      ]);
      const controlledMonitor = monitorList.find(item => item.name === monitor.name)
        || monitorList.find(item => item.focused)
        || monitorList[0];
      const visibleWorkspace = controlledMonitor?.activeWorkspace?.id;
      const containsPoint = surface => {
        const [sx, sy] = surface.at || [surface.x, surface.y];
        const [sw, sh] = surface.size || [surface.w, surface.h];
        return [sx, sy, sw, sh].every(Number.isFinite)
          && x >= sx && y >= sy && x < sx + sw && y < sy + sh;
      };
      const layerSurfaces = Object.values(layers).flatMap(output =>
        Object.values(output?.levels || {}).flatMap(level => Array.isArray(level) ? level : []));
      const rofiSurface = clients.find(client => /(^|\b)rofi(\b|$)/i.test(`${client.class || ''} ${client.initialClass || ''} ${client.title || ''}`))
        || layerSurfaces.find(layer => /rofi/i.test(`${layer.namespace || ''} ${layer.name || ''}`));
      // Rofi used to be a layer surface, so clicks outside went straight to
      // the application below without dismissing Start. Close it explicitly;
      // the same click can then continue to its intended window.
      if (rofiSurface && !containsPoint(rofiSurface)) {
        await hyprIpc(luaDispatch(`hl.dsp.exec_cmd(${luaString('pkill -x rofi')})`));
        await new Promise(resolve => setTimeout(resolve, 35));
      }
      const candidates = clients.filter(client => {
        const [cx, cy] = client.at || [], [cw, ch] = client.size || [];
        const visibleHere = client.pinned || client.workspace?.id === visibleWorkspace;
        return visibleHere && client.mapped !== false && !client.hidden
          && client !== rofiSurface
          && x >= cx && y >= cy && x < cx + cw && y < cy + ch;
      }).sort((a, b) => (a.focusHistoryID ?? 999999) - (b.focusHistoryID ?? 999999));
      if (rofiSurface && containsPoint(rofiSurface) && rofiSurface.address) candidates.unshift(rofiSurface);
      targetAddress = candidates[0]?.address || '';
      if (targetAddress) {
        commands.push(luaDispatch(`hl.dsp.focus({ window = ${luaString(`address:${targetAddress}`)} })`));
        // Hyprland may warp the cursor to the centre when focus changes.
        // Put it back on the requested pixel before delivering the button;
        // otherwise popups and small controls receive a click in the middle
        // of their parent window instead of where the user actually clicked.
        commands.push(luaDispatch(`hl.dsp.cursor.move({ x = ${x}, y = ${y} })`));
      }
    } catch (error) { console.error(`Foco bajo cursor: ${error.message}`); }
  }
  let virtualClick = false;
  if (data.action === 'tap') {
    // A compositor-level click follows the real surface under the cursor,
    // including xdg-popups (permission dialogs, menus and dropdowns). Sending
    // the button to `activewindow` bypasses those child surfaces in Chromium.
    virtualClick = true;
  }
  if (data.action === 'down' || data.action === 'dragstart') {
    if (targetAddress) commands.push(luaDispatch(`hl.dsp.send_key_state({ mods = "", key = ${luaString(`mouse:${button}`)}, state = "down", window = "activewindow" })`));
    else layerPointerButtons.add(button);
  }
  if (data.action === 'up') {
    if (layerPointerButtons.delete(button)) virtualClick = true;
    else commands.push(luaDispatch(`hl.dsp.send_key_state({ mods = "", key = ${luaString(`mouse:${button}`)}, state = "up", window = "activewindow" })`));
  }
  if (!['move', 'tap', 'down', 'up', 'dragstart'].includes(data.action)) throw new Error('Acción inválida');
  const response = await hyprIpc(`[[BATCH]]${commands.join(';')}`);
  if (response.split('\n').some(line => line && line !== 'ok')) throw new Error(response.trim());
  if (virtualClick) await runCommand(wlrctl, ['pointer', 'click', buttonName], 4096);
}

async function scrollAction(data, monitor) {
  await pointerAction({ action: 'move', x: data.x, y: data.y }, monitor);
  const dx = Math.round(data.dx);
  const dy = Math.round(data.dy);
  if (dx || dy) {
    if (estadoEntorno().modo === 'x11') await entradaX11.scroll(dy, dx);
    else await runCommand(wlrctl, ['pointer', 'scroll', String(dy), String(dx)], 4096);
  }
}

// Atajos del rice publicados por mapa-atajos.py. Hacen falta porque con la
// config Lua de Hyprland los binds se publican como `__lua` + un id de callback
// que no se puede re-despachar, y el compositor tampoco atiende los atajos que
// llegan de un teclado virtual (`wtype -M logo -k a` no dispara nada, medido).
// Lo unico que acepta desde fuera es una expresion Lua, y para eso hay que
// saber que hace cada atajo: eso es lo que trae el mapa.
const mapaAtajosPath = path.join(__dirname, '..', '..', 'mapa-atajos.json');
const generadorAtajos = path.join(__dirname, '..', '..', 'mapa-atajos.py');
const keybindsRice = path.join(process.env.HOME || '', '.config/hypr/conf/keybinds.lua');
let mapaAtajos = null;
let mapaAtajosAt = 0;

function atajoDelRice(clave) {
  try {
    let publicado = 0;
    try { publicado = fs.statSync(mapaAtajosPath).mtimeMs; } catch {}
    // Si el rice cambio sus atajos, se regenera: el mapa nunca queda desfasado.
    if (fs.statSync(keybindsRice).mtimeMs > publicado) {
      spawnSync(process.env.NEXO_PYTHON || 'python3', [generadorAtajos], { timeout: 10000 });
      publicado = fs.statSync(mapaAtajosPath).mtimeMs;
    }
    if (!mapaAtajos || publicado > mapaAtajosAt) {
      mapaAtajos = JSON.parse(fs.readFileSync(mapaAtajosPath, 'utf8'));
      mapaAtajosAt = publicado;
    }
  } catch {
    if (!mapaAtajos) return null;
  }
  return mapaAtajos[clave] || null;
}

let bindCache = { at: 0, items: [] };
async function effectiveBinds() {
  if (Date.now() - bindCache.at < 2000) return bindCache.items;
  const text = (await runCommand('hyprctl', ['binds'], 1024 * 1024)).toString();
  const items = text.split(/\n(?=bind\n)/).map(block => {
    const value = name => block.match(new RegExp(`^\\s*${name}:\\s*(.*)$`, 'm'))?.[1]?.trim() || '';
    return { modmask: Number(value('modmask')), key: value('key'), dispatcher: value('dispatcher'), arg: value('arg') };
  }).filter(item => item.key && item.dispatcher && Number.isFinite(item.modmask));
  bindCache = { at: Date.now(), items };
  return items;
}

async function runHyprShortcut(event) {
  // En el greeter no hay atajos de compositor que resolver: la combinacion se
  // manda tal cual por XTEST, que es lo que espera el dialogo de inicio de
  // sesion (Ctrl+Alt+F2, Alt+F4, Tab entre campos...).
  if (estadoEntorno().modo === 'x11') {
    const combinacion = browserKeyCommand(event);
    if (!combinacion) throw new Error('Entrada inválida');
    return executeWtype(combinacion);
  }
  const keyNames = {
    ' ': 'SPACE', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down'
  };
  const key = keyNames[event.key] || event.key;
  const normalizedKey = String(key).toLowerCase();
  // Alt+Tab/F4 are recovery/window-management actions. Give them precedence
  // even if a browser reports a stale Ctrl/Super bit after fullscreen changes.
  const reservedAltShortcut = event.alt && ['tab', 'f4'].includes(normalizedKey);
  const otherModifiers = (event.shift ? 1 : 0) + (event.ctrl ? 4 : 0) +
    (event.alt ? 8 : 0);
  // El cliente usa `meta` como el modificador principal lógico de NEXO. La
  // sesión independiente conserva SUPER (64), mientras el escritorio físico
  // usa MOD5/AltGr (128). Consultar ambas máscaras permite ejecutar el atajo
  // real de cada compositor sin volver a inyectar AltGr ni Super físicamente.
  const requestedModmasks = reservedAltShortcut ? [8]
    : event.meta ? [otherModifiers + 64, otherModifiers + 128]
      : [otherModifiers];
  // Combinaciones que no se reenvian a la sesion. Una pulsacion mal
  // interpretada por la red apagaria el equipo o cerraria la sesion, y con
  // ella el tunel: no habria forma de volver a entrar. En el teclado fisico
  // siguen funcionando. Vaciar el Set devuelve el comportamiento literal.
  const BLOQUEADOS = new Set(['65:delete', '69:delete', '65:m']);
  if (BLOQUEADOS.has(`${otherModifiers + 64}:${normalizedKey}`)) {
    throw new Error(`Atajo no disponible en remoto: ${key}`);
  }

  const bindings = (await effectiveBinds()).filter(item =>
    requestedModmasks.includes(item.modmask) && item.key.toLowerCase() === normalizedKey);

  // Con config Lua (Hyprland 0.55+) los binds se publican como dispatcher
  // `__lua` mas un id interno, asi que reenviarlos llega al compositor como
  // `hl.dispatch(__lua 6)` -> error de sintaxis, y NINGUN atajo remoto
  // funcionaba. Ese id no se puede re-despachar por IPC, y el compositor
  // tampoco dispara sus atajos desde un teclado virtual. Para esos se usa el
  // mapa que publica el rice, que si trae la accion en Lua.
  const reenviables = bindings.filter(binding => binding.dispatcher !== '__lua');
  if (reenviables.length) {
    const commands = reenviables.map(binding =>
      `dispatch ${binding.dispatcher}${binding.arg ? ` ${binding.arg}` : ''}`);
    const response = await hyprIpc(`[[BATCH]]${commands.join(';')}`);
    if (response.split('\n').some(line => line && line !== 'ok')) throw new Error(response.trim());
    return;
  }
  // Se busca solo la familia SUPER aunque el bind exista tambien en MOD5: el
  // rice registra cada atajo con los dos modificadores y ejecutarlo por ambos
  // lo haria dos veces.
  const accionDelRice = bindings.length ? atajoDelRice(`${otherModifiers + 64}:${normalizedKey}`) : null;
  if (accionDelRice) {
    const response = await hyprIpc(luaDispatch(accionDelRice));
    if (response.trim() !== 'ok') throw new Error(response.trim());
    return;
  }

  // Compatibilidad para sesiones con configuraciones incompletas. Las
  // acciones explícitas sólo se usan cuando Hyprland no publicó un bind real.
  const modmask = reservedAltShortcut ? 8
    : (event.meta ? 64 : 0) + otherModifiers;
  const explicit = new Map([
    ['64:space', [`hl.dsp.exec_cmd(${luaString('/usr/local/lib/nexo/windows-start-menu')})`]],
    ['64:s', [`hl.dsp.exec_cmd(${luaString('/usr/local/lib/nexo/windows-start-menu')})`]],
    ['64:r', [`hl.dsp.exec_cmd(${luaString('/usr/local/lib/nexo/windows-start-menu')})`]],
    ['64:e', [`hl.dsp.exec_cmd(${luaString('dolphin')})`]],
    ['64:b', [`hl.dsp.exec_cmd(${luaString('firefox')})`]],
    ['64:q', [`hl.dsp.exec_cmd(${luaString('kitty')})`]],
    ['64:d', [`hl.dsp.exec_cmd(${luaString('/usr/local/lib/nexo/windows-show-desktop')})`]],
    ['64:m', [`hl.dsp.exec_cmd(${luaString('/usr/local/lib/nexo/windows-show-desktop')})`]],
    ['64:i', [`hl.dsp.exec_cmd(${luaString('/usr/local/lib/nexo/windows-quick-settings')})`]],
    ['64:n', [`hl.dsp.exec_cmd(${luaString('swaync-client -t -sw')})`]],
    ['64:up', ['hl.dsp.window.fullscreen({ mode = "fullscreen", action = "set" })']],
    ['64:down', ['hl.dsp.window.fullscreen({ mode = "fullscreen", action = "unset" })']],
    ['8:f4', ['hl.dsp.window.close({ window = "activewindow" })']],
    ['8:tab', ['hl.dsp.window.cycle_next({})', 'hl.dsp.window.alter_zorder({ mode = "top", window = "activewindow" })']]
  ]).get(`${modmask}:${normalizedKey}`);
  if (explicit) {
    const command = explicit.length > 1
      ? `[[BATCH]]${explicit.map(luaDispatch).join(';')}`
      : luaDispatch(explicit[0]);
    const response = await hyprIpc(command);
    if (response.split('\n').some(line => line && line !== 'ok')) throw new Error(response.trim());
    return;
  }
  throw new Error(`No existe atajo del compositor para ${key}`);
}

async function workspaceAction(workspace) {
  const target = typeof workspace === 'number' && Number.isInteger(workspace) && workspace >= 1 && workspace <= 10
    ? String(workspace)
    : ({ next: '+1', previous: '-1' })[workspace];
  if (!target) throw new Error('Escritorio inválido');
  const response = await hyprIpc(luaDispatch(`hl.dsp.focus({ workspace = ${luaString(target)} })`));
  if (response.trim() !== 'ok') throw new Error(response.trim());
}

function namedKey(nombre) {
  if (nombre === 'space') return runChromiumAwareSpace();
  const args = keyCommand(nombre);
  if (!args) throw new Error(`Entrada inválida (tipo=key key=${JSON.stringify(nombre)} code=undefined)`);
  if (args.length === 2 && args[0] === '--') return runChromiumAwareText(args[1]);
  return runWtype(args);
}

function keyEvent(value) {
  const args = browserKeyCommand(value);
  if (!args) {
    const v = value || {};
    throw new Error(`Entrada inválida (tipo=keyboard key=${JSON.stringify(v.key)} code=${JSON.stringify(v.code)})`);
  }
  if (args.length === 2 && args[0] === '--') return runChromiumAwareText(args[1]);
  return runWtype(args);
}

async function clipboardGet() {
  const value = await runCommand('wl-paste', ['--no-newline', '--type', 'text/plain'], 1024 * 1024);
  return value.toString('utf8');
}

function clipboardSet(texto) {
  return startCommandInput('wl-copy', ['--type', 'text/plain;charset=utf-8'], texto);
}

function screenshotJpeg({ quality = 65 } = {}) {
  return runCommand('grim', ['-t', 'jpeg', '-q', String(quality), '-']);
}

function startJpegStream({ monitor, quality = 48, onFrame }) {
  let active = true;
  (async () => {
    while (active) {
      try {
        const currentMonitor = typeof monitor === 'function' ? monitor() : monitor;
        const frame = await runCommand('grim', ['-o', currentMonitor.name, '-t', 'jpeg', '-q', String(quality), '-']);
        if (active && onFrame) onFrame(frame);
      } catch {}
      if (active) await new Promise(resolve => setTimeout(resolve, 25));
    }
  })();
  return {
    stop() {
      active = false;
    }
  };
}

const capabilities = Object.freeze({
  gpuVideo: true,
  cpuVideo: true,
  systemAudio: true,
  virtualMic: true,
  independentSession: true,
  loginScreen: true,
  textBatchMs: 30
});

module.exports = {
  name: 'linux',
  capabilities,
  init: async () => {},
  close: () => { restoreClipboardOnExit(); return Promise.resolve(); },
  listMonitors,
  pointer: pointerAction,
  scroll: scrollAction,
  text: runChromiumAwareText,
  namedKey,
  keyEvent,
  shortcut: runHyprShortcut,
  workspace: workspaceAction,
  clipboardGet,
  clipboardSet,
  screenshotJpeg,
  startJpegStream,
  spawnSystemAudio,
  spawnRawVideo,
  defaultAudioTarget,
  keepAwake: () => {},
  on: () => {}
};
