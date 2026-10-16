'use strict';

// Descubre a que se puede conectar NEXO en cada momento, para que un unico
// servicio sirva desde el arranque hasta que se apaga el equipo:
//
//   modo 'x11'      -> pantalla de inicio de sesion de SDDM (greeter, X11)
//   modo 'wayland'  -> sesion Hyprland ya iniciada
//   modo 'ninguno'  -> ni una cosa ni la otra (arrancando, o apagandose)
//
// El servicio arranca antes de que nadie inicie sesion, asi que no hereda
// ninguna variable de entorno de la sesion: hay que averiguarlas mirando el
// runtime del usuario. Por eso todo lo de aqui se recalcula, no se cachea mas
// alla de un segundo.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const UID = Number(process.env.NEXO_UID || process.getuid());
const RUNTIME = process.env.NEXO_RUNTIME_DIR || `/run/user/${UID}`;
const VENTANA_CACHE_MS = 1000;

let cache = { at: 0, valor: null };

function socketHyprland() {
  // /run/user/1000/hypr/<firma>/.socket.sock
  let firmas;
  try {
    firmas = fs.readdirSync(path.join(RUNTIME, 'hypr'));
  } catch {
    return null;
  }
  for (const firma of firmas) {
    const socket = path.join(RUNTIME, 'hypr', firma, '.socket.sock');
    if (fs.existsSync(socket)) return { firma, socket };
  }
  return null;
}

function displayWayland() {
  try {
    return fs.readdirSync(RUNTIME).find(nombre => /^wayland-\d+$/.test(nombre)) || null;
  } catch {
    return null;
  }
}

// El greeter de SDDM corre en X11 (DisplayServer=x11). Su cookie de
// autorizacion es de root, asi que NEXO no puede abrirlo por su cuenta: el
// Xsetup copia la cookie a /run/nexo-greeter.auth (legible por el usuario) y
// ademas hace `xhost +SI:localuser:`. Aqui se prueba de verdad a abrir cada
// display, porque la primera version dio por bueno `:0` sin comprobarlo y la
// sesion remota acabo en negro.
const COOKIE_GREETER = process.env.NEXO_X11_COOKIE || '/run/nexo-greeter.auth';

function displaysCandidatos() {
  if (process.env.NEXO_X11_DISPLAY) return [process.env.NEXO_X11_DISPLAY];
  // Los sockets reales mandan: suponer `:0` fallaba cuando el numero cambiaba,
  // y ademas el archivo puede quedar huerfano tras cerrar el servidor.
  try {
    const numeros = fs.readdirSync('/tmp/.X11-unix')
      .map(nombre => /^X(\d+)$/.exec(nombre)?.[1])
      .filter(Boolean)
      .sort((a, b) => Number(a) - Number(b));
    return numeros.length ? numeros.map(n => `:${n}`) : [':0'];
  } catch {
    return [':0'];
  }
}

function abre(display, cookie) {
  const env = { ...process.env, DISPLAY: display };
  if (cookie) env.XAUTHORITY = cookie;
  else delete env.XAUTHORITY;
  try {
    execFileSync('xdotool', ['getdisplaygeometry'], {
      env,
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 2000
    });
    return true;
  } catch {
    return false;
  }
}

function displayX11() {
  const cookies = [];
  if (fs.existsSync(COOKIE_GREETER)) cookies.push(COOKIE_GREETER);
  cookies.push(null); // sin cookie: vale si el xhost concedio el acceso
  for (const display of displaysCandidatos()) {
    for (const cookie of cookies) {
      if (abre(display, cookie)) return { display, cookie };
    }
  }
  return null;
}

function detectar() {
  const hypr = socketHyprland();
  const wayland = displayWayland();
  if (hypr && wayland) {
    return {
      modo: 'wayland',
      entorno: {
        XDG_RUNTIME_DIR: RUNTIME,
        WAYLAND_DISPLAY: wayland,
        HYPRLAND_INSTANCE_SIGNATURE: hypr.firma
      },
      socketHyprland: hypr.socket
    };
  }
  const x11 = displayX11();
  if (x11) {
    const entorno = { DISPLAY: x11.display };
    if (x11.cookie) entorno.XAUTHORITY = x11.cookie;
    return { modo: 'x11', entorno, socketHyprland: null };
  }
  return { modo: 'ninguno', entorno: {}, socketHyprland: null };
}

// Que trozo del display X hay que servir. El greeter abarca los dos monitores
// (3840x1080 aqui), pero SDDM dibuja el formulario de inicio de sesion en el
// PRIMARIO: capturarlo entero se veria aplastado y con media pantalla vacia.
// Se recorta al primario, y si xrandr no dice nada se sirve todo.
function regionX11() {
  const estadoActual = estado();
  if (estadoActual.modo !== 'x11') return null;
  const env = { ...process.env, ...estadoActual.entorno };
  try {
    const salida = execFileSync('xrandr', ['--query'], { env, timeout: 3000 }).toString();
    const primario = salida.split('\n').find(linea => / connected primary /.test(linea));
    const medida = /(\d+)x(\d+)\+(\d+)\+(\d+)/.exec(primario || '');
    if (medida) {
      return {
        ancho: Number(medida[1]), alto: Number(medida[2]),
        x: Number(medida[3]), y: Number(medida[4])
      };
    }
  } catch {}
  try {
    const salida = execFileSync('xdotool', ['getdisplaygeometry'], { env, timeout: 2000 }).toString();
    const [ancho, alto] = salida.trim().split(/\s+/).map(Number);
    if (ancho && alto) return { ancho, alto, x: 0, y: 0 };
  } catch {}
  return { ancho: 1920, alto: 1080, x: 0, y: 0 };
}

function estado(forzar = false) {
  const ahora = Date.now();
  if (!forzar && cache.valor && ahora - cache.at < VENTANA_CACHE_MS) return cache.valor;
  cache = { at: ahora, valor: detectar() };
  return cache.valor;
}

// Entorno listo para pasar a un proceso hijo (wtype, hyprctl, xdotool, ffmpeg).
function entornoDe(actual = process.env) {
  return { ...actual, ...estado().entorno };
}

module.exports = { estado, entornoDe, regionX11, RUNTIME, UID };
