'use strict';

// Registro de qué transporte de vídeo obtiene cada dispositivo (plan «Internet», V2).
//
// Cuando alguien se queja de que «por Internet se ve mal» hay que saber si su sesión fue vídeo
// directo (gpu/rtc), vídeo GPU por el túnel con WebCodecs (tunel) o el respaldo JPEG (fallback), y
// si pasó por TURN (relay). El cliente ya manda su diagnóstico cada 2,5 s; aquí se decide cuándo
// merece una línea en nexo-access.log: sólo al cambiar el transporte o la ruta, y como mucho una
// vez cada 30 s por dispositivo, para que una conexión que oscila no llene el registro. Sin IP ni
// token: sólo la etiqueta del dispositivo.

const INTERVALO_MIN_MS = 30 * 1000;
const TRANSPORTES = ['rtc', 'gpu', 'tunel', 'fallback'];
const TIPOS_CANDIDATO = ['host', 'srflx', 'prflx', 'relay'];
const MAX_DISPOSITIVOS = 200;

// «srflx→relay»: tipo de candidato local → remoto del par nominado. Lo demás se descarta.
function normalizarRuta(valor) {
  if (typeof valor !== 'string') return '';
  const partes = valor.split('→');
  if (partes.length !== 2 || !partes.every(parte => TIPOS_CANDIDATO.includes(parte))) return '';
  return valor;
}

function crearRegistroTransporte({ escribir, ahora = Date.now } = {}) {
  const ultimos = new Map(); // clave de dispositivo → { firma, at }

  // Devuelve la línea escrita (para las pruebas) o null si no tocaba escribir.
  function registrar(clave, { label = '', origen = 'lan', diagnostico = {} } = {}) {
    const transport = diagnostico.transport;
    if (!TRANSPORTES.includes(transport)) return null; // «connecting» no dice nada todavía
    // Por el túnel no hay par ICE: una ruta ahí sería la de una conexión WebRTC anterior.
    const ruta = transport === 'fallback' || transport === 'tunel' ? '' : normalizarRuta(diagnostico.ruta);
    const firma = `${transport}|${ruta}`;
    const previo = ultimos.get(clave);
    if (previo && previo.firma === firma) return null;
    if (previo && ahora() - previo.at < INTERVALO_MIN_MS) return null;
    if (!previo && ultimos.size >= MAX_DISPOSITIVOS) ultimos.delete(ultimos.keys().next().value);
    ultimos.set(clave, { firma, at: ahora() });
    const linea = {
      at: new Date(ahora()).toISOString(),
      type: 'transporte',
      label: String(label).slice(0, 60),
      origen: origen === 'remoto' ? 'remoto' : 'lan',
      transport,
      ruta,
      fps: Math.round(Number(diagnostico.fps) || 0),
      kbps: Math.round(Number(diagnostico.bitrateKbps) || 0),
      perdida: Math.round((Number(diagnostico.packetLoss) || 0) * 10) / 10
    };
    escribir(linea);
    return linea;
  }

  return { registrar };
}

module.exports = { crearRegistroTransporte, normalizarRuta, INTERVALO_MIN_MS };
