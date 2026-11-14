'use strict';

// Perfil del vídeo GPU que eligen los clientes: `<estado>\.nexo-gpu-profile.json`.
//
//   { "fps": 30|45|60, "height": 720|900|1080, "kbps"?: uno de ESCALERA_KBPS }
//
// `kbps` es opcional (plan «Internet», V4): sin él se usa el bitrate ligado a la altura de
// siempre, así un cliente viejo en caché o el host Linux (gpu-stream.js no lo lee) no cambian.
// La escalera es la misma que usa la calidad automática del cliente (ui/calidad-auto.js).

const ESCALERA_KBPS = Object.freeze([1500, 2500, 4000, 6000, 8000, 10000]);
const FPS_VALIDOS = Object.freeze([30, 45, 60]);
const ALTURAS_VALIDAS = Object.freeze([720, 900, 1080]);

// Lo que llega del cliente: lanza Error si no es válido.
function validarPerfil(valor) {
  const fps = Number(valor?.fps), height = Number(valor?.height);
  if (!FPS_VALIDOS.includes(fps) || !ALTURAS_VALIDAS.includes(height)) throw new Error('Perfil GPU inválido');
  const perfil = { fps, height };
  if (valor?.kbps !== undefined && valor?.kbps !== null) {
    const kbps = Number(valor.kbps);
    if (!ESCALERA_KBPS.includes(kbps)) throw new Error('Bitrate GPU inválido');
    perfil.kbps = kbps;
  }
  return perfil;
}

// Lo que hay en disco: indulgente, devuelve null si no sirve.
function leerPerfil(valor) {
  try { return validarPerfil(valor); } catch { return null; }
}

function mismoPerfil(a, b) {
  return Boolean(a && b) && a.fps === b.fps && a.height === b.height && (a.kbps ?? null) === (b.kbps ?? null);
}

module.exports = { ESCALERA_KBPS, FPS_VALIDOS, ALTURAS_VALIDAS, validarPerfil, leerPerfil, mismoPerfil };
