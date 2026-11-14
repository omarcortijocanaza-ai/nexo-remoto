'use strict';

// Vídeo GPU por el túnel: puente Pion (GET /h264) → este servidor → WebSocket /gpu-live → navegador
// (WebCodecs). Es el respaldo cuando no hay conexión WebRTC directa ni TURN; antes eran JPEG.
//
// El puente entrega mensajes `[4 bytes longitud][1 byte banderas][4 bytes marca][Annex B]`
// (gpu-webrtc/tunel.go). Al navegador se le manda cada mensaje SIN la longitud: banderas, marca y
// datos en un mensaje binario de WebSocket.
//
// Control de congestión: el túnel es TCP, así que si la red del celular no da abasto los bytes se
// acumulan en el socket y el retraso crece sin límite. Antes de mandar cada fotograma se mira lo
// que queda por enviar (`bufferedAmount`): si pasa del límite se descarta y se espera al siguiente
// fotograma clave (un delta sin su referencia sólo pinta basura). El cliente recibe la cuenta de
// enviados y descartados para bajar el bitrate (ui/calidad-auto.js).

const http = require('node:http');

const BANDERA_CLAVE = 1;
const MAX_MENSAJE = 4 * 1024 * 1024;
const LIMITE_PENDIENTE = 256 * 1024; // ≈ 0,5 s a 4 Mbps: más es retraso, no fluidez
const REINTENTO_MS = 500;
const ESTADISTICAS_MS = 2000;

// Separa el flujo del puente en mensajes. `alMensaje(Buffer)` recibe banderas+marca+datos.
function crearLector(alMensaje) {
  let pendiente = Buffer.alloc(0);
  return function leer(trozo) {
    pendiente = pendiente.length ? Buffer.concat([pendiente, trozo]) : trozo;
    while (pendiente.length >= 4) {
      const largo = pendiente.readUInt32BE(0);
      if (largo < 5 || largo > MAX_MENSAJE) throw new Error(`Mensaje de vídeo inválido (${largo} bytes)`);
      if (pendiente.length < 4 + largo) break;
      alMensaje(pendiente.subarray(4, 4 + largo));
      pendiente = pendiente.subarray(4 + largo);
    }
  };
}

// Decide, fotograma a fotograma, si se manda o se descarta. Puro: se prueba sin sockets.
function crearRegulador({ limite = LIMITE_PENDIENTE } = {}) {
  let esperandoClave = true;
  const cuentas = { enviados: 0, descartados: 0 };
  return {
    cuentas,
    decidir(clave, pendienteBytes) {
      if (pendienteBytes > limite) { esperandoClave = true; cuentas.descartados++; return false; }
      if (esperandoClave && !clave) { cuentas.descartados++; return false; }
      esperandoClave = false;
      cuentas.enviados++;
      return true;
    }
  };
}

// Atiende un WebSocket ya aceptado: se suscribe al puente, reenvía y se reconecta si el puente se
// reinicia (al cambiar los FPS). Devuelve una función para cerrar.
function servirTunel(socket, { puertoPuente, log = () => {}, peticion = http.get } = {}) {
  const regulador = crearRegulador();
  let respuestaActual = null;
  let cerrado = false;
  let reintento = null;

  function conectar() {
    if (cerrado) return;
    const req = peticion({ host: '127.0.0.1', port: puertoPuente, path: '/h264', agent: false }, res => {
      if (res.statusCode !== 200) { res.resume(); return programar(); }
      respuestaActual = res;
      const leer = crearLector(mensaje => {
        if (cerrado || socket.readyState !== 1) return;
        const clave = (mensaje[0] & BANDERA_CLAVE) !== 0;
        if (regulador.decidir(clave, socket.bufferedAmount)) socket.send(mensaje, { binary: true });
      });
      res.on('data', trozo => {
        try { leer(trozo); } catch (error) { log(`Vídeo por túnel: ${error.message}`); res.destroy(); }
      });
      res.on('close', programar);
      res.on('error', programar);
    });
    req.on('error', programar);
  }

  function programar() {
    respuestaActual = null;
    if (cerrado || reintento) return;
    reintento = setTimeout(() => { reintento = null; conectar(); }, REINTENTO_MS);
  }

  const estadisticas = setInterval(() => {
    if (socket.readyState === 1) {
      try { socket.send(JSON.stringify({ type: 'tunel', ...regulador.cuentas })); } catch {}
    }
  }, ESTADISTICAS_MS);

  // El cliente mide el retraso real (incluida la cola del túnel) con un eco.
  socket.on('message', (datos, binario) => {
    if (binario) return;
    try {
      const m = JSON.parse(String(datos));
      if (m && m.type === 'ping' && Number.isFinite(m.t)) socket.send(JSON.stringify({ type: 'pong', t: m.t }));
    } catch {}
  });

  function cerrar() {
    if (cerrado) return;
    cerrado = true;
    clearTimeout(reintento);
    clearInterval(estadisticas);
    if (respuestaActual) respuestaActual.destroy();
  }
  socket.on('close', cerrar);
  socket.on('error', cerrar);
  conectar();
  return cerrar;
}

module.exports = { crearLector, crearRegulador, servirTunel, LIMITE_PENDIENTE, BANDERA_CLAVE };
