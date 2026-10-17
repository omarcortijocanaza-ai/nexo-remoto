'use strict';

// Recibe el micrófono del celular por WebRTC y lo vuelca en el micrófono
// virtual de PipeWire.
//
// Va en su propia conexión, separada de la del escritorio remoto, por tres
// razones concretas: el micrófono sigue vivo aunque se cierre la pantalla
// compartida, la página que sólo es micrófono no arrastra vídeo ni captura, y
// añadir una pista al vuelo no obliga a renegociar la sesión de vídeo que ya
// funciona. Además el barrido de inactividad es distinto: una pestaña en
// segundo plano con el celular bloqueado deja de contestar por el canal de
// control, y ahí matarla sería justo lo contrario de lo que se busca.

const wrtc = require('@roamhq/wrtc');
const { MicrofonoVirtual, asegurarDispositivo } = require(
  process.platform === 'win32' ? './microfono-virtual-windows' : './microfono-virtual'
);

const { RTCAudioSink } = wrtc.nonstandard;

// Sin audio ni transporte durante este tiempo, el par se considera muerto. El
// celular bloqueado sigue enviando paquetes: si de verdad no llega nada, es que
// la conexión se cayó, no que la pantalla está apagada.
const MS_SIN_SENAL = 45000;

// Cuánto se aguanta un ICE en `disconnected` antes de darlo por perdido. De
// sobra para un bache de wifi al bloquear la pantalla, y lo bastante corto para
// que el celular pueda volver a ofertar sin encontrarse la plaza ocupada.
const MS_TOLERANCIA_BACHE = 30000;

class MicrofonoHost {
  constructor({ onLog = () => {} } = {}) {
    this.onLog = onLog;
    this.microfono = new MicrofonoVirtual({ onLog });
    this.par = null;
    this.ultimoCierre = null;
    // El micrófono virtual se publica al arrancar, no cuando llega la primera
    // voz: si apareciera sólo al conectar el celular, habría que abrir Discord
    // *después* de encender el teléfono para poder elegirlo, y cada reinicio
    // dejaría a los programas con una entrada que ya no existe. Un null-sink
    // parado no consume nada, así que vale más tenerlo siempre en la lista.
    // Fallar aquí no puede tumbar NEXO: sin PipeWire el resto sigue sirviendo.
    if (process.env.NEXO_MICROFONO !== '0') {
      try { asegurarDispositivo(); }
      catch (error) { onLog(`Micrófono virtual no disponible: ${error.message}`); }
    }
    this.barrido = setInterval(() => this.revisar(), 5000);
    this.barrido.unref();
  }

  revisar() {
    const par = this.par;
    if (!par) return;
    const estado = par.pc.connectionState;
    if (['failed', 'closed'].includes(estado)) return this.cerrarPar('transporte ' + estado);
    // `disconnected` no es una muerte, es un bache. Al bloquear el teléfono,
    // Android pone el wifi en ahorro de energía y se pierden paquetes: ICE pasa
    // por `disconnected` y vuelve solo a los pocos segundos. Cerrar ahí mataba
    // la sesión justo al bloquear la pantalla, que es exactamente cuando más
    // falta hace que aguante, y el celular ni se enteraba: seguía enviando a
    // una conexión que en la PC ya no existía.
    if (estado === 'disconnected') {
      par.desconectadoDesde = par.desconectadoDesde || Date.now();
      if (Date.now() - par.desconectadoDesde > MS_TOLERANCIA_BACHE) this.cerrarPar('transporte caído');
      return;
    }
    par.desconectadoDesde = 0;
    if (Date.now() - par.ultimaSenal > MS_SIN_SENAL) this.cerrarPar('sin señal');
  }

  async aceptarOferta(oferta, opciones = {}) {
    // Un solo emisor a la vez: dos celulares mezclados en la misma fuente dan
    // eco y solapamiento, y nadie sabría cuál está hablando. Gana el último.
    if (this.par) this.cerrarPar('reemplazado por otro dispositivo');
    this.microfono.reiniciarFallos();
    // Sólo existe en Windows: si falta VB-CABLE el celular recibe un error claro
    // (500 con el mensaje) en vez de conectarse a un micrófono sin destino.
    this.microfono.comprobarDestino?.();

    const pc = new wrtc.RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
      bundlePolicy: 'max-bundle'
    });
    const par = {
      pc, sink: null, canal: null, cerrado: false,
      etiqueta: String(opciones.etiqueta || 'celular').slice(0, 40),
      desde: Date.now(), ultimaSenal: Date.now(), desconectadoDesde: 0
    };
    this.par = par;

    pc.ontrack = evento => {
      if (evento.track.kind !== 'audio' || par.cerrado) return;
      if (par.sink) { try { par.sink.stop(); } catch {} }
      const sink = new RTCAudioSink(evento.track);
      par.sink = sink;
      sink.ondata = datos => {
        if (par.cerrado) return;
        par.ultimaSenal = Date.now();
        this.microfono.escribir(datos);
      };
    };
    pc.ondatachannel = evento => {
      par.canal = evento.channel;
      evento.channel.onmessage = mensaje => {
        par.ultimaSenal = Date.now();
        try {
          const datos = JSON.parse(String(mensaje.data));
          if (datos.type === 'ping' && evento.channel.readyState === 'open') {
            evento.channel.send(JSON.stringify({ type: 'pong', sent: datos.sent, ...this.estado() }));
          }
          if (datos.type === 'mute') this.silenciar(datos.value);
        } catch {}
      };
    };
    pc.onconnectionstatechange = () => {
      // Sólo si este par sigue siendo el vigente: al reemplazar un celular por otro,
      // el `closed` tardío del par viejo cerraba al par NUEVO en plena negociación
      // (el celular veía «signalingState is closed» y tenía que reintentar).
      if (this.par === par && ['failed', 'closed'].includes(pc.connectionState)) this.cerrarPar('transporte ' + pc.connectionState);
    };

    try {
      await pc.setRemoteDescription(oferta);
      const respuesta = await pc.createAnswer();
      await pc.setLocalDescription(respuesta);
      await this.esperarIce(pc, 2500);
      return { type: pc.localDescription.type, sdp: pc.localDescription.sdp };
    } catch (error) {
      this.cerrarPar('error de negociación');
      throw error;
    }
  }

  esperarIce(pc, limite) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
      const temporizador = setTimeout(terminar, limite);
      const manejador = () => { if (pc.iceGatheringState === 'complete') terminar(); };
      function terminar() {
        clearTimeout(temporizador);
        pc.removeEventListener('icegatheringstatechange', manejador);
        resolve();
      }
      pc.addEventListener('icegatheringstatechange', manejador);
    });
  }

  silenciar(valor) {
    return this.microfono.silenciar(valor);
  }

  cerrarPar(motivo = 'cerrado') {
    const par = this.par;
    if (!par || par.cerrado) return;
    par.cerrado = true;
    this.par = null;
    if (par.sink) { try { par.sink.stop(); } catch {} }
    try { par.pc.close(); } catch {}
    this.microfono.detenerProceso();
    // Guardado para el diagnóstico: cuando el micrófono se corta al bloquear el
    // teléfono, lo primero que hay que saber es si lo cerró la PC y por qué.
    this.ultimoCierre = { motivo, cuando: Date.now(), duroMs: Date.now() - par.desde };
    this.onLog(`Micrófono del celular desconectado: ${motivo}`);
  }

  estado() {
    const par = this.par;
    return {
      conectado: Boolean(par) && par.pc.connectionState === 'connected',
      transporte: par ? par.pc.connectionState : 'sin conexión',
      etiqueta: par ? par.etiqueta : '',
      desdeMs: par ? Date.now() - par.desde : null,
      ultimoCierre: this.ultimoCierre || null,
      ...this.microfono.estado()
    };
  }

  cerrar() {
    clearInterval(this.barrido);
    this.cerrarPar('apagado');
    this.microfono.cerrar();
  }
}

module.exports = { MicrofonoHost };
