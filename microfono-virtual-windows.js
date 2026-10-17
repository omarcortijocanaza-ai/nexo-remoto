'use strict';

// Stub provisional del micrófono virtual de Windows para F1 (se completa en F7 con VB-CABLE).

const NOMBRE_SINK = 'CABLE Input';
const NOMBRE_FUENTE = 'CABLE Output';

function asegurarDispositivo() {
  throw new Error('Micrófono de Windows pendiente (fase F7)');
}

function descargarDispositivo() {}

class MicrofonoVirtual {
  constructor({ onLog = () => {} } = {}) {
    this.onLog = onLog;
    this.proceso = null;
    this.formato = null;
    this.silenciado = false;
    this.disponible = false;
    this.ultimoAudio = 0;
    this.muestrasEscritas = 0;
    this.nivel = 0;
    this.error = '';
    this.fallosDeEnlace = 0;
    this.bloqueado = false;
  }

  asegurarProceso() {
    return false;
  }

  escribir() {}

  reiniciarFallos() {
    this.fallosDeEnlace = 0;
    this.bloqueado = false;
    this.error = '';
  }

  silenciar(valor) {
    this.silenciado = Boolean(valor);
    if (this.silenciado) this.nivel = 0;
    return this.silenciado;
  }

  detenerProceso() {
    this.proceso = null;
    this.formato = null;
    this.disponible = false;
    this.nivel = 0;
  }

  estado() {
    return {
      activo: false,
      bloqueado: this.bloqueado,
      silenciado: this.silenciado,
      nivel: 0,
      fuente: NOMBRE_FUENTE,
      descripcion: 'CABLE Output (micrófono del celular)',
      msSinAudio: null,
      error: this.error
    };
  }

  cerrar() {
    this.detenerProceso();
  }
}

module.exports = { MicrofonoVirtual, asegurarDispositivo, descargarDispositivo, NOMBRE_FUENTE, NOMBRE_SINK };
