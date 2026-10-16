'use strict';

// Motor de entrada para la pantalla de inicio de sesion (SDDM, DisplayServer=x11).
//
// Ahi no hay Hyprland ni protocolos de wlroots, asi que nada del motor normal
// sirve: ni `wtype`, ni `wlrctl`, ni `hyprctl`. Se usa XTEST a traves de
// `xdotool`, que es el mismo mecanismo que emplean las herramientas de
// escritorio remoto clasicas para poder escribir en el login.
//
// El acceso al display del greeter lo concede /usr/share/sddm/scripts/Xsetup
// con `xhost +SI:localuser:Letzus`; por eso esto no necesita ser root.

const { execFile } = require('child_process');
const { entornoDe, regionX11 } = require('./entorno');

const XDOTOOL = process.env.NEXO_XDOTOOL || 'xdotool';

// wtype y xdotool nombran las teclas casi igual (ambos usan keysyms de X), asi
// que la traduccion es directa salvo los modificadores.
const MODIFICADORES = { ctrl: 'ctrl', alt: 'alt', shift: 'shift', logo: 'super' };

function correr(args, timeout = 4000) {
  return new Promise((resolve, reject) => {
    execFile(XDOTOOL, args, { env: entornoDe(), timeout }, (error, salida, err) => {
      if (error) return reject(new Error((err || '').trim() || error.message));
      resolve(String(salida || ''));
    });
  });
}

// Convierte los argumentos que el resto del servidor construye para `wtype`:
//   ['--', 'texto']                        -> escribir texto
//   ['-k', 'Return']                       -> pulsar una tecla
//   ['-M','ctrl','-k','v','-m','ctrl']     -> combinacion
function desdeWtype(args) {
  if (args.length === 2 && args[0] === '--') {
    return ['type', '--clearmodifiers', '--delay', '12', '--', args[1]];
  }
  const mods = [];
  let tecla = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-M' && args[i + 1]) {
      const nombre = MODIFICADORES[args[i + 1]];
      if (nombre && !mods.includes(nombre)) mods.push(nombre);
      i += 1;
    } else if (args[i] === '-k' && args[i + 1]) {
      tecla = args[i + 1];
      i += 1;
    }
    // '-m' (soltar modificador) no hace falta: xdotool los suelta solo.
  }
  if (!tecla) return null;
  return ['key', '--clearmodifiers', [...mods, tecla].join('+')];
}

async function escribirComoWtype(args) {
  const traducidos = desdeWtype(args);
  if (!traducidos) throw new Error(`No se pudo traducir la entrada a X11: ${args.join(' ')}`);
  await correr(traducidos);
}

// El greeter es una sola pantalla y el cliente manda coordenadas absolutas,
// que es justo lo que espera `xdotool mousemove`.
async function puntero(data) {
  const x = Math.round(Number(data.x) || 0);
  const y = Math.round(Number(data.y) || 0);
  const boton = ({ 272: 1, 273: 3, 274: 2 })[Number(data.button)] || 1;

  switch (data.action) {
    case 'move':
      return correr(['mousemove', String(x), String(y)]);
    case 'tap':
      return correr(['mousemove', String(x), String(y), 'click', String(boton)]);
    case 'down':
    case 'dragstart':
      return correr(['mousemove', String(x), String(y), 'mousedown', String(boton)]);
    case 'up':
      return correr(['mousemove', String(x), String(y), 'mouseup', String(boton)]);
    default:
      throw new Error('Acción inválida');
  }
}

async function scroll(dy, dx) {
  // En X11 la rueda son los botones 4/5 (vertical) y 6/7 (horizontal).
  const pasos = [];
  const vertical = Math.round(Number(dy) || 0);
  const horizontal = Math.round(Number(dx) || 0);
  for (let i = 0; i < Math.min(Math.abs(vertical), 10); i += 1) pasos.push(vertical > 0 ? '5' : '4');
  for (let i = 0; i < Math.min(Math.abs(horizontal), 10); i += 1) pasos.push(horizontal > 0 ? '7' : '6');
  for (const boton of pasos) await correr(['click', boton]);
}

// La misma region que se esta capturando: el monitor primario, no el conjunto
// de los dos. Si el puntero usara el display entero, un clic en el borde
// derecho del video acabaria en mitad de la otra pantalla.
async function geometria() {
  return regionX11() || { ancho: 1920, alto: 1080, x: 0, y: 0 };
}

module.exports = { desdeWtype, escribirComoWtype, puntero, scroll, geometria };
