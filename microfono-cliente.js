'use strict';

// Micrófono del celular usado como micrófono del PC.
//
// Lo comparten la barra del escritorio remoto y la página que sólo es
// micrófono, porque el problema difícil es el mismo en las dos: que Android no
// congele la pestaña al bloquear el teléfono. Tres defensas a la vez, porque
// ninguna basta sola y cuál sobrevive depende del navegador y del ahorro de
// batería:
//
//   1. La captura de micrófono en curso. Chrome no congela una pestaña que está
//      grabando, y el indicador del sistema queda a la vista.
//   2. Un audio inaudible en bucle con Media Session. Android lo trata como
//      reproducción y saca una notificación persistente; mientras esa
//      notificación exista, la pestaña conserva su hilo.
//   3. Wake Lock mientras la pantalla está encendida, y se vuelve a pedir al
//      volver, porque el sistema lo suelta al bloquear.
//
// Lo que NO se hace es igual de importante: al pasar a segundo plano no se
// corta la pista, no se cierra la conexión y no se apaga nada. El servidor
// tampoco vigila el canal de control para decidir si seguimos vivos, sino el
// propio audio, que sigue llegando con la pantalla apagada.

(function () {
  // `fallo` separa "apagado porque lo apagaste" de "apagado porque algo salió
  // mal": la barra del escritorio remoto sólo debe gritar en el segundo caso.
  const ESTADO_INICIAL = { activo: false, silenciado: false, conectando: false, nivel: 0, mensaje: '', dispositivo: '', fallo: false, aviso: '' };

  class Microfono {
    constructor() {
      this.estado = { ...ESTADO_INICIAL };
      this.oyentes = new Set();
      this.pc = null;
      this.canal = null;
      this.pista = null;
      this.flujo = null;
      this.wakeLock = null;
      this.sostener = null;
      this.reintento = null;
      this.bache = null;
      this.vigilanteSosten = null;
      this.sostenActivo = false;
      this.intentos = 0;
      this.generacion = 0;
      this.medidor = null;
      this.analizador = null;
      this.contexto = null;
      document.addEventListener('visibilitychange', () => this.alVolver());
    }

    alCambiar(oyente) {
      this.oyentes.add(oyente);
      oyente(this.estado);
      return () => this.oyentes.delete(oyente);
    }

    publicar(cambios = {}) {
      this.estado = { ...this.estado, ...cambios };
      for (const oyente of this.oyentes) {
        try { oyente(this.estado); } catch {}
      }
    }

    async alternar() {
      if (this.estado.activo || this.estado.conectando) return this.desactivar();
      return this.activar();
    }

    async activar() {
      if (this.estado.activo || this.estado.conectando) return;
      const generacion = ++this.generacion;
      // La causa número uno de que esto no funcione, y conviene decirla antes
      // de intentar nada: el navegador esconde `mediaDevices` fuera de un
      // contexto seguro, así que por la URL de LAN en HTTP no hay micrófono
      // posible por mucho que se den permisos. Con la URL de Internet, que va
      // por HTTPS, funciona.
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.publicar({
          conectando: false, activo: false, fallo: true,
          mensaje: 'El navegador sólo da micrófono por HTTPS. Entra por el enlace de Internet, no por la IP de la red local.'
        });
        return;
      }
      // El audio de sostén tiene que arrancar AQUÍ, antes del primer `await`.
      // La política de reproducción automática de Chrome sólo deja sonar algo
      // mientras dura la activación del usuario, y esa activación se pierde en
      // cuanto se cede el turno al `await` de getUserMedia. Arrancándolo
      // después, `play()` se rechazaba en silencio, Android nunca sacaba la
      // notificación de medios y dormía la pestaña al bloquear la pantalla:
      // justo el fallo que hacía que el micrófono muriera al bloquear.
      this.iniciarSosten();
      this.publicar({ conectando: true, fallo: false, mensaje: 'Pidiendo permiso del micrófono…' });
      try {
        // Sin cancelación de eco: no hay señal de referencia del PC en el
        // celular, así que activarla sólo recortaría la voz. La supresión de
        // ruido y el control de ganancia sí ayudan, y son los que hacen que un
        // celular a medio metro suene aceptable.
        this.flujo = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false, noiseSuppression: true, autoGainControl: true,
            channelCount: 1, sampleRate: 48000
          }, video: false
        });
      } catch (error) {
        this.publicar({ conectando: false, activo: false, fallo: true, mensaje: mensajeDePermiso(error) });
        return;
      }
      if (generacion !== this.generacion) return this.soltarFlujo();
      this.pista = this.flujo.getAudioTracks()[0];
      this.publicar({ dispositivo: this.pista.label || 'Micrófono del celular' });
      this.medirNivel();
      await this.conectar(generacion);
    }

    async conectar(generacion) {
      this.publicar({ conectando: true, mensaje: 'Conectando con la PC…' });
      try {
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
          bundlePolicy: 'max-bundle'
        });
        this.pc = pc;
        pc.addTransceiver(this.pista, { direction: 'sendonly', streams: [this.flujo] });
        this.canal = pc.createDataChannel('control');
        this.canal.onopen = () => this.enviarSilencio();
        pc.onconnectionstatechange = () => {
          if (generacion !== this.generacion) return;
          const estado = pc.connectionState;
          if (estado === 'connected') {
            this.intentos = 0;
            clearTimeout(this.bache);
            this.publicar({ activo: true, conectando: false, fallo: false, mensaje: 'Micrófono en uso en la PC' });
          } else if (['failed', 'closed'].includes(estado)) {
            clearTimeout(this.bache);
            this.reconectar('Se cortó la conexión');
          } else if (estado === 'disconnected') {
            // Un `disconnected` casi siempre se arregla solo en unos segundos y
            // rehacer la conexión ahí cortaría la voz sin motivo. Pero si no
            // vuelve, nadie lo va a rescatar: `failed` puede tardar medio
            // minuto en llegar, o no llegar nunca con la pantalla bloqueada.
            this.publicar({ mensaje: 'Reconectando…' });
            clearTimeout(this.bache);
            this.bache = setTimeout(() => {
              if (this.pc === pc && pc.connectionState === 'disconnected') this.reconectar('La red del teléfono se cortó');
            }, 12000);
          }
        };

        await pc.setLocalDescription(await pc.createOffer());
        await esperarIce(pc, 2500);
        if (generacion !== this.generacion) return;
        const respuesta = await fetch('/microfono/oferta', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: pc.localDescription.type, sdp: pc.localDescription.sdp,
            etiqueta: navigator.userAgentData?.platform || 'celular'
          })
        });
        if (!respuesta.ok) {
          const detalle = await respuesta.json().catch(() => ({}));
          // 401 y 403 no son fallos de red y reintentar cada diez segundos no
          // los va a arreglar: falta emparejar el aparato o iniciar sesión, y
          // eso sólo se hace en la página principal.
          if (respuesta.status === 401 || respuesta.status === 403) {
            this.generacion++;
            this.soltarFlujo();
            this.soltarDespierto();
            this.cerrarConexion();
            this.publicar({
              activo: false, conectando: false, fallo: true,
              mensaje: respuesta.status === 403
                ? 'Este aparato no está emparejado. Ábrelo desde el enlace de NEXO.'
                : 'Falta iniciar sesión en NEXO. Entra en la página principal y vuelve.'
            });
            return;
          }
          throw new Error(detalle.error || `La PC respondió ${respuesta.status}`);
        }
        const answer = await respuesta.json();
        if (generacion !== this.generacion) return;
        await pc.setRemoteDescription(answer);
        this.mantenerDespierto();
      } catch (error) {
        this.reconectar(error.message || 'No se pudo conectar');
      }
    }

    reconectar(motivo) {
      if (!this.estado.activo && !this.estado.conectando) return;
      const generacion = this.generacion;
      this.cerrarConexion();
      this.intentos++;
      // Un celular que sale de un túnel o cambia de wifi tarda unos segundos.
      // La espera crece hasta diez segundos y ahí se queda: rendirse dejaría el
      // micrófono muerto sin que nadie mire la pantalla para reactivarlo.
      const espera = Math.min(10000, 800 * Math.pow(2, Math.min(4, this.intentos - 1)));
      this.publicar({ activo: false, conectando: true, fallo: true, mensaje: `${motivo}. Reintentando…` });
      clearTimeout(this.reintento);
      this.reintento = setTimeout(() => {
        if (generacion !== this.generacion) return;
        if (!this.pista || this.pista.readyState !== 'live') {
          // El sistema puede quitarnos el micrófono (una llamada, otra app). Sin
          // pista viva no hay nada que reconectar: hay que pedirlo otra vez.
          this.soltarFlujo();
          this.publicar({ conectando: false, fallo: true, mensaje: 'El sistema cerró el micrófono. Vuelve a activarlo.' });
          return;
        }
        this.conectar(generacion);
      }, espera);
    }

    desactivar() {
      this.generacion++;
      clearTimeout(this.reintento);
      clearTimeout(this.bache);
      this.intentos = 0;
      this.cerrarConexion();
      this.soltarFlujo();
      this.soltarDespierto();
      this.publicar({ ...ESTADO_INICIAL, mensaje: 'Micrófono apagado' });
    }

    cerrarConexion() {
      clearTimeout(this.bache);
      if (this.canal) { try { this.canal.close(); } catch {} }
      if (this.pc) { try { this.pc.close(); } catch {} }
      this.canal = null;
      this.pc = null;
    }

    soltarFlujo() {
      if (this.medidor) { clearInterval(this.medidor); this.medidor = null; }
      if (this.contexto) { this.contexto.close().catch(() => {}); this.contexto = null; }
      this.analizador = null;
      if (this.flujo) for (const pista of this.flujo.getTracks()) pista.stop();
      this.flujo = null;
      this.pista = null;
    }

    silenciar(valor) {
      const silenciado = valor === undefined ? !this.estado.silenciado : Boolean(valor);
      // Doble candado a propósito. En el celular la pista deja de emitir, que es
      // lo único instantáneo. En la PC se escriben ceros, que es lo único fiable
      // si el teléfono está dormido y tarda en enterarse.
      if (this.pista) this.pista.enabled = !silenciado;
      this.publicar({ silenciado, nivel: silenciado ? 0 : this.estado.nivel });
      this.enviarSilencio();
      fetch('/microfono/silencio', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ silenciado })
      }).catch(() => {});
      return silenciado;
    }

    enviarSilencio() {
      if (this.canal && this.canal.readyState === 'open') {
        try { this.canal.send(JSON.stringify({ type: 'mute', value: this.estado.silenciado })); } catch {}
      }
    }

    medirNivel() {
      if (!this.flujo || this.medidor) return;
      const Contexto = window.AudioContext || window.webkitAudioContext;
      if (!Contexto) return;
      this.contexto = new Contexto();
      const analizador = this.contexto.createAnalyser();
      analizador.fftSize = 512;
      this.contexto.createMediaStreamSource(this.flujo).connect(analizador);
      this.analizador = analizador;
      const datos = new Uint8Array(analizador.frequencyBinCount);
      this.medidor = setInterval(() => {
        if (!this.analizador) return;
        this.analizador.getByteTimeDomainData(datos);
        let pico = 0;
        for (const valor of datos) {
          const desviacion = Math.abs(valor - 128);
          if (desviacion > pico) pico = desviacion;
        }
        const nivel = this.estado.silenciado ? 0 : Math.min(1, pico / 90);
        if (Math.abs(nivel - this.estado.nivel) > 0.02) this.publicar({ nivel });
      }, 120);
    }

    // --- Supervivencia en segundo plano ---

    // Se llama de forma síncrona desde el manejador del toque, nunca después de
    // un `await`: es el único momento en que el navegador deja sonar algo.
    iniciarSosten() {
      if (this.sostener) {
        if (this.sostener.paused) this.sostener.play().catch(() => {});
        return;
      }
      const audio = new Audio('/microfono/sostener.wav');
      audio.loop = true;
      audio.volume = 0.02;
      audio.setAttribute('playsinline', '');
      this.sostener = audio;
      // Si esto se rechaza, Android no dará notificación de medios y dormirá la
      // pestaña al bloquear. Es un fallo silencioso que costaría horas de
      // depuración, así que se anota para poder decirlo en pantalla.
      audio.play().then(() => { this.sostenActivo = true; })
        .catch(error => {
          this.sostenActivo = false;
          this.publicar({ aviso: `El navegador no dejó sonar el aviso de fondo (${error.name}); puede que se corte al bloquear.` });
        });
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Micrófono activo', artist: 'NEXO', album: 'Micrófono del celular en la PC'
        });
        navigator.mediaSession.playbackState = 'playing';
        // Sin manejadores, Android puede pausar la reproducción desde la
        // notificación y llevarse por delante la protección. Pausar aquí
        // significa silenciar, no soltar el micrófono.
        try {
          navigator.mediaSession.setActionHandler('pause', () => this.silenciar(true));
          navigator.mediaSession.setActionHandler('play', () => this.silenciar(false));
          navigator.mediaSession.setActionHandler('stop', () => this.desactivar());
        } catch {}
      }
    }

    mantenerDespierto() {
      this.pedirWakeLock();
      this.iniciarSosten();
      // El sostén puede morir por su cuenta: Android lo pausa al perder el foco
      // de audio (una llamada, una notificación con sonido, otro reproductor).
      // Sin él vuelve el problema original, así que se vigila y se reanima.
      clearInterval(this.vigilanteSosten);
      this.vigilanteSosten = setInterval(() => {
        if (!this.estado.activo && !this.estado.conectando) return;
        if (this.sostener && this.sostener.paused) this.sostener.play().catch(() => {});
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      }, 10000);
    }

    soltarDespierto() {
      clearInterval(this.vigilanteSosten);
      this.vigilanteSosten = null;
      this.sostenActivo = false;
      if (this.sostener) { this.sostener.pause(); this.sostener.src = ''; this.sostener = null; }
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
      if (this.wakeLock) { this.wakeLock.release().catch(() => {}); this.wakeLock = null; }
    }

    async pedirWakeLock() {
      if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
      } catch {}
    }

    alVolver() {
      if (document.visibilityState !== 'visible') return;
      if (!this.estado.activo && !this.estado.conectando) return;
      this.pedirWakeLock();
      if (this.sostener && this.sostener.paused) this.sostener.play().catch(() => {});
      // Volver a mirar la pantalla es el momento de descubrir que la conexión
      // se cayó mientras el teléfono dormía: los temporizadores estaban
      // congelados y nadie pudo reintentar.
      if (this.pc && ['failed', 'closed', 'disconnected'].includes(this.pc.connectionState)) {
        this.reconectar('La conexión se perdió mientras el teléfono estaba bloqueado');
      }
    }
  }

  function esperarIce(pc, limite) {
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

  function mensajeDePermiso(error) {
    const nombre = error && error.name;
    if (nombre === 'NotAllowedError') return 'Permiso denegado. Habilita el micrófono para este sitio.';
    if (nombre === 'NotFoundError') return 'Este dispositivo no tiene micrófono disponible.';
    if (nombre === 'NotReadableError') return 'Otra aplicación está usando el micrófono.';
    // getUserMedia sólo existe en contextos seguros. Por LAN sin HTTPS el
    // navegador ni siquiera expone la API, y conviene decirlo con nombre y
    // apellido en vez de dejar un "undefined" en pantalla.
    if (!navigator.mediaDevices) return 'El navegador bloquea el micrófono en conexiones sin HTTPS. Usa el enlace de Internet.';
    return (error && error.message) || 'No se pudo abrir el micrófono';
  }

  window.NexoMicrofono = new Microfono();
})();
