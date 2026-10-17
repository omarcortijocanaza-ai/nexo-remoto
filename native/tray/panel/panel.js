/* Panel de NEXO · lógica de la interfaz.
 * Habla con nexo-tray.exe según CONTRATO.md. Sin dependencias.
 * Idea central: la página se pinta una sola vez (index.html) y cada sondeo sólo cambia
 * lo que cambió de verdad, para que nunca se pierda lo que el usuario está escribiendo. */
'use strict';

(() => {
  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

  const MSG_RED = 'No se pudo hablar con la bandeja de NEXO';
  const MSG_SESION = 'Sesión del panel caducada: ciérralo y ábrelo desde el icono de NEXO';
  const MASCARA = '••••••••';

  /* ------------------------------------------------------------------ *
   * Estado global                                                       *
   * ------------------------------------------------------------------ */
  let estado = null;            // última respuesta de /api/estado
  let sesionCaducada = false;   // 401: se deja de sondear
  let saliendo = false;         // el usuario cerró la bandeja
  let redCaida = false;
  let bloqueoHasta = 0;         // evita doble clic mientras la acción arranca
  let textoLocal = '';
  let reinicioLocal = false;    // ajustes guardados en esta sesión del panel
  let pendienteAntes = false;
  let ajDirty = false;          // el usuario tocó el formulario de ajustes
  let avDirty = false;          // ídem para el aviso
  let avisoCargado = false;
  let autoOcupado = false;
  let enVuelo = false;
  let temporizador = 0;

  /* ------------------------------------------------------------------ *
   * Utilidades                                                          *
   * ------------------------------------------------------------------ */
  // Cambia el texto sólo si es distinto: evita repintados (y parpadeos) en cada sondeo.
  function poner(el, texto) {
    if (el && el.textContent !== texto) el.textContent = texto;
  }
  function atributo(el, nombre, valor) {
    if (!el) return;
    if (valor === null || valor === false) {
      if (el.hasAttribute(nombre)) el.removeAttribute(nombre);
    } else if (el.getAttribute(nombre) !== String(valor === true ? '' : valor)) {
      el.setAttribute(nombre, valor === true ? '' : String(valor));
    }
  }
  function mostrar(el, visible) {
    if (el && el.hidden === visible) el.hidden = !visible;
  }
  function mascarar(enlace) {
    return enlace.replace(/(token=)[^&#\s]+/i, '$1' + MASCARA);
  }

  /* ------------------------------------------------------------------ *
   * Toasts                                                              *
   * ------------------------------------------------------------------ */
  function aviso(mensaje, tipo = 'info', ms) {
    const caja = $('#toasts');
    const t = document.createElement('div');
    t.className = 'toast ' + tipo;
    t.textContent = mensaje;
    caja.append(t);
    while (caja.children.length > 3) caja.firstChild.remove();
    t.addEventListener('click', () => t.remove()); // un clic lo descarta
    setTimeout(() => t.remove(), ms || (tipo === 'error' ? 8000 : 5000));
  }

  /* ------------------------------------------------------------------ *
   * Diálogo de confirmación propio                                      *
   * ------------------------------------------------------------------ */
  function confirmar({ titulo, texto, botones }) {
    const dlg = $('#dlg');
    return new Promise((resolver) => {
      poner($('#dlg-titulo'), titulo);
      poner($('#dlg-texto'), texto);
      const cont = $('#dlg-botones');
      cont.replaceChildren();
      let cancelar;
      const todos = [{ texto: 'Cancelar', valor: '' }, ...botones];
      for (const b of todos) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'btn ' + (b.clase || '');
        el.textContent = b.texto;
        el.addEventListener('click', () => dlg.close(b.valor));
        cont.append(el);
        if (!b.valor) cancelar = el;
      }
      dlg.returnValue = '';
      dlg.addEventListener('close', () => resolver(dlg.returnValue || null), { once: true });
      dlg.showModal();
      cancelar.focus(); // el foco empieza en la opción segura
    });
  }

  /* ------------------------------------------------------------------ *
   * Llamadas a la API (un único helper)                                 *
   * ------------------------------------------------------------------ */
  async function api(ruta, cuerpo) {
    const post = cuerpo !== undefined;
    const op = { method: post ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: {} };
    if (post) {
      op.headers['X-NEXO-Panel'] = '1';
      op.headers['Content-Type'] = 'application/json';
      op.body = JSON.stringify(cuerpo);
    }
    let r;
    try {
      r = await fetch(ruta, op);
    } catch (e) {
      marcarRed(true);
      return { ok: false, error: MSG_RED, red: true };
    }
    marcarRed(false);
    if (r.status === 401) {
      marcarSesion();
      return { ok: false, error: MSG_SESION, sesion: true };
    }
    let datos = null;
    try { datos = await r.json(); } catch (e) { /* respuesta sin JSON */ }
    if (!datos || typeof datos !== 'object') datos = {};
    if (!r.ok && datos.ok === undefined) return { ok: false, error: 'La bandeja respondió con un error (' + r.status + ')' };
    return datos;
  }

  function marcarRed(caida) {
    if (redCaida === caida) return;
    redCaida = caida;
    const b = $('#banner-red');
    poner(b, caida ? MSG_RED + '. Reintentando…' : '');
    mostrar(b, caida && !saliendo);
    pintar();
  }
  function marcarSesion() {
    if (sesionCaducada) return;
    sesionCaducada = true;
    clearTimeout(temporizador);
    const b = $('#banner-sesion');
    poner(b, MSG_SESION + '.');
    mostrar(b, true);
    pintar();
  }

  // Ejecuta una acción POST y muestra el resultado; devuelve la respuesta.
  async function accionPost(ruta, cuerpo, { exito, etiqueta } = {}) {
    const r = await api(ruta, cuerpo ?? {});
    if (r.ok === true) {
      const msg = exito || r.mensaje || r.texto;
      if (msg) aviso(msg, 'ok');
    } else if (!r.sesion) {
      aviso(r.error || ('No se pudo ' + (etiqueta || 'completar la acción')), 'error');
    }
    return r;
  }

  /* ------------------------------------------------------------------ *
   * Sondeo de /api/estado                                               *
   * ------------------------------------------------------------------ */
  async function refrescar() {
    if (enVuelo || sesionCaducada || saliendo) return;
    enVuelo = true;
    try {
      const e = await api('/api/estado');
      if (e && e.estado) {
        estado = e;
        pintar();
      }
    } finally {
      enVuelo = false;
    }
  }
  function programar() {
    clearTimeout(temporizador);
    if (sesionCaducada || saliendo) return;
    temporizador = setTimeout(async () => { await refrescar(); programar(); }, document.hidden ? 5000 : 2000);
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { refrescar().then(programar); } else { programar(); }
  });

  /* ------------------------------------------------------------------ *
   * Pintado                                                             *
   * ------------------------------------------------------------------ */
  const DETALLES = {
    activo: 'Todo listo. Abre el enlace de abajo en el navegador de tu celular.',
    conectando: 'NEXO ya responde en esta PC, pero todavía falta publicar el enlace de Internet.',
    detenido: 'NEXO está detenido. Pulsa Iniciar para poder usar esta PC desde el celular.',
    sinconexion: 'La ventana no logra comunicarse con la bandeja de NEXO.',
  };

  function ocupadoAhora() {
    return (estado && estado.ocupado) || (Date.now() < bloqueoHasta ? textoLocal : '');
  }

  function pintar() {
    let est = 'desconocido';
    let texto = 'Comprobando…';
    if (sesionCaducada) { est = 'sinconexion'; texto = 'Panel desconectado'; }
    else if (redCaida) { est = 'sinconexion'; texto = 'Sin conexión con la bandeja'; }
    else if (estado) { est = estado.estado; texto = estado.textoEstado || ('NEXO · ' + est); }

    const heroe = $('#heroe');
    atributo(heroe, 'data-est', est);
    poner($('#pastilla-texto'), texto);
    poner($('#estado-detalle'), sesionCaducada ? 'Cierra esta ventana y ábrela de nuevo desde el icono de NEXO en la bandeja.' : (DETALLES[est] || 'Hablando con la bandeja de NEXO…'));
    for (const id of ['mini-estado', 'mini-estado-m']) atributo($('#' + id), 'data-est', est);
    poner($('#mini-estado-texto'), texto);
    poner($('#mini-estado-texto-m'), texto);
    if (estado) poner($('#version'), 'Versión ' + (estado.version || ''));

    const ocup = ocupadoAhora();
    poner($('#ocupado-texto'), ocup);
    mostrar($('#ocupado'), !!ocup);

    pintarBotones(est, ocup);
    pintarEnlaces();
    pintarAutoarranque();
    pintarReinicio();
    if (estado && !ajDirty) llenarAjustes(estado.ajustes);
  }

  function pintarBotones(est, ocup) {
    const sinContacto = !estado || redCaida || sesionCaducada;
    const libre = !sinContacto && !ocup;
    $('#b-iniciar').disabled = !(libre && est === 'detenido');
    $('#b-detener').disabled = !(libre && (est === 'activo' || est === 'conectando'));
    $('#b-reiniciar').disabled = !(libre && (est === 'activo' || est === 'conectando'));
    const rb = $('#banner-reinicio [data-accion]');
    if (rb) rb.disabled = !libre;
  }

  /* ---- Banner de reinicio pendiente ---- */
  function pintarReinicio() {
    const pendiente = !!(estado && estado.ajustesPendientes);
    if (pendienteAntes && !pendiente) reinicioLocal = false; // ya se aplicó
    pendienteAntes = pendiente;
    const detenido = estado && estado.estado === 'detenido';
    const ver = (pendiente || reinicioLocal) && !!estado && !saliendo && !sesionCaducada && !redCaida;
    const banner = $('#banner-reinicio');
    mostrar(banner, ver);
    mostrar($('#punto-ajustes'), ver);
    const fuerte = $('strong', banner);
    const btn = $('button', banner);
    poner(fuerte, detenido ? 'Los cambios se aplicarán cuando inicies NEXO.' : 'Reinicia NEXO para aplicar los cambios.');
    poner(btn, detenido ? 'Iniciar ahora' : 'Reiniciar ahora');
    atributo(btn, 'data-accion', detenido ? 'iniciar' : 'reiniciar');
  }

  /* ---- Enlaces ---- */
  const tarjetas = $$('.enlace').map((el) => ({
    el,
    que: el.dataset.que,
    enlace: null,
    visible: false,
    qrAbierto: false,
    valor: $('[data-campo="valor"]', el),
    copiar: $('[data-campo="copiar"]', el),
    mostrar: $('[data-campo="mostrar"]', el),
    qr: $('[data-campo="qr"]', el),
    qrCaja: $('[data-campo="qrcaja"]', el),
    qrImg: $('[data-campo="qrimg"]', el),
    qrMsg: $('[data-campo="qrmsg"]', el),
  }));

  function cargarQR(t) {
    t.qrImg.hidden = false;
    poner(t.qrMsg, 'Apunta la cámara del celular a este código.');
    t.qrImg.src = '/api/qr?que=' + t.que + '&t=' + Date.now();
  }

  function pintarEnlaces() {
    for (const t of tarjetas) {
      const enlace = (estado && estado.enlaces && estado.enlaces[t.que]) || '';
      const hay = !!enlace;
      if (enlace !== t.enlace) {
        const cambioReal = t.enlace !== null && hay && t.qrAbierto;
        t.enlace = enlace;
        if (!hay) {
          if (t.qrAbierto) alternarQR(t, false);
          t.visible = false;
        } else if (cambioReal) {
          cargarQR(t); // el enlace cambió: la imagen anterior ya no sirve
        }
      }
      t.valor.classList.toggle('vacio', !hay);
      poner(t.valor, hay ? (t.visible ? enlace : mascarar(enlace)) : 'Aún no disponible');
      poner(t.mostrar, t.visible ? 'Ocultar' : 'Mostrar');
      atributo(t.mostrar, 'aria-pressed', String(t.visible));
      t.copiar.disabled = !hay;
      t.mostrar.disabled = !hay;
      t.qr.disabled = !hay;
    }
  }

  function alternarQR(t, abrir) {
    t.qrAbierto = abrir;
    atributo(t.qr, 'aria-expanded', String(abrir));
    t.qrCaja.hidden = !abrir;
    if (abrir) cargarQR(t);
    else t.qrImg.removeAttribute('src');
  }

  for (const t of tarjetas) {
    t.mostrar.addEventListener('click', () => { t.visible = !t.visible; pintarEnlaces(); });
    t.qr.addEventListener('click', () => alternarQR(t, !t.qrAbierto));
    t.copiar.addEventListener('click', async () => {
      if (!t.enlace) return;
      const ok = await copiarTexto(t.enlace);
      aviso(ok ? 'Enlace copiado. Pégalo en el celular.' : 'No se pudo copiar. Pulsa «Mostrar» y cópialo a mano.', ok ? 'ok' : 'error');
    });
    t.qrImg.addEventListener('error', () => {
      if (!t.qrAbierto) return;
      t.qrImg.hidden = true;
      poner(t.qrMsg, 'No se pudo cargar el código QR. Prueba de nuevo en unos segundos.');
    });
  }

  async function copiarTexto(texto) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(texto);
        return true;
      }
    } catch (e) { /* se prueba la alternativa */ }
    const previo = document.activeElement;
    try {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.append(ta);
      ta.select();
      ta.setSelectionRange(0, texto.length);
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    } finally {
      if (previo && previo.focus) previo.focus();
    }
  }

  /* ------------------------------------------------------------------ *
   * Control: iniciar / detener / reiniciar                              *
   * ------------------------------------------------------------------ */
  const TEXTOS_ACCION = { iniciar: 'Iniciando…', detener: 'Deteniendo…', reiniciar: 'Reiniciando…' };

  async function accionControl(nombre) {
    if (nombre === 'detener') {
      const v = await confirmar({
        titulo: '¿Detener NEXO?',
        texto: 'Mientras esté detenido no podrás usar esta PC desde el celular. Podrás volver a iniciarlo desde este panel.',
        botones: [{ texto: 'Detener NEXO', valor: 'si', clase: 'peligro-fuerte' }],
      });
      if (!v) return;
    }
    bloqueoHasta = Date.now() + 3000;
    textoLocal = TEXTOS_ACCION[nombre];
    pintar();
    setTimeout(pintar, 3100);
    const r = await accionPost('/api/' + nombre, {}, {
      exito: { iniciar: 'Iniciando NEXO…', detener: 'Deteniendo NEXO…', reiniciar: 'Reiniciando NEXO…' }[nombre],
      etiqueta: nombre + ' NEXO',
    });
    if (r.ok === true && nombre === 'reiniciar') reinicioLocal = false;
    if (r.ok !== true) bloqueoHasta = 0;
    await refrescar();
    pintar();
  }
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-accion]');
    if (b && !b.disabled) accionControl(b.dataset.accion);
  });

  /* ------------------------------------------------------------------ *
   * Autoarranque                                                        *
   * ------------------------------------------------------------------ */
  const swAuto = $('#sw-auto');
  function pintarAutoarranque() {
    const a = (estado && estado.autoarranque) || { instalado: false, activo: false };
    const elevado = estado ? estado.elevado !== false : true;
    if (!autoOcupado) atributo(swAuto, 'aria-checked', String(!!a.activo));
    swAuto.disabled = !estado || !a.instalado || !elevado || autoOcupado || sesionCaducada || redCaida;
    const nota = $('#n-auto');
    let msg = '';
    if (estado && !a.instalado) {
      msg = 'Todavía no está preparado el inicio automático: la tarea de Windows no existe. Ejecuta el instalador de NEXO para crearla y vuelve aquí.';
    } else if (estado && !elevado) {
      msg = 'Este panel no tiene permisos de administrador. Windows bloquea el control de las ventanas de administrador y no deja cambiar este ajuste. Abre NEXO como administrador para poder cambiarlo.';
    }
    poner(nota, msg);
    mostrar(nota, !!msg);
  }
  swAuto.addEventListener('click', async () => {
    if (swAuto.disabled) return;
    const quiere = swAuto.getAttribute('aria-checked') !== 'true';
    autoOcupado = true;
    atributo(swAuto, 'aria-checked', String(quiere));
    swAuto.disabled = true;
    const r = await accionPost('/api/autoarranque', { activo: quiere }, {
      exito: quiere ? 'NEXO se iniciará al encender la PC.' : 'NEXO ya no se iniciará al encender la PC.',
      etiqueta: 'cambiar el inicio automático',
    });
    autoOcupado = false;
    if (r.ok === true && estado && r.autoarranque) estado.autoarranque = r.autoarranque;
    pintar();
    if (r.ok !== true) atributo(swAuto, 'aria-checked', String(!quiere));
    await refrescar();
  });

  /* ------------------------------------------------------------------ *
   * Ajustes                                                             *
   * ------------------------------------------------------------------ */
  const fAjustes = $('#f-ajustes');
  const swGpu = $('#sw-gpu');
  const inMic = $('#i-mic');

  function llenarAjustes(a) {
    if (!a) return;
    for (const r of $$('input[name="modo"]', fAjustes)) {
      const marcado = r.value === (a.modo || 'both');
      if (r.checked !== marcado) r.checked = marcado;
    }
    atributo(swGpu, 'aria-checked', String(a.gpu !== false));
    const mic = a.micDispositivo || '';
    if (inMic.value !== mic) inMic.value = mic;
  }
  fAjustes.addEventListener('input', () => { ajDirty = true; poner($('#est-ajustes'), 'Cambios sin guardar'); });
  swGpu.addEventListener('click', () => {
    atributo(swGpu, 'aria-checked', String(swGpu.getAttribute('aria-checked') !== 'true'));
    ajDirty = true;
    poner($('#est-ajustes'), 'Cambios sin guardar');
  });
  fAjustes.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('#b-guardar-ajustes');
    const modo = ($('input[name="modo"]:checked', fAjustes) || {}).value || 'both';
    btn.disabled = true;
    const r = await accionPost('/api/ajustes', {
      modo,
      gpu: swGpu.getAttribute('aria-checked') === 'true',
      micDispositivo: inMic.value.trim().slice(0, 80),
    }, { etiqueta: 'guardar los ajustes' });
    btn.disabled = false;
    if (r.ok === true) {
      ajDirty = false;
      if (r.ajustes) { llenarAjustes(r.ajustes); if (estado) estado.ajustes = r.ajustes; }
      if (r.requiereReinicio) reinicioLocal = true;
      poner($('#est-ajustes'), '');
      aviso(r.requiereReinicio ? 'Ajustes guardados. Reinicia NEXO para aplicarlos.' : 'Ajustes guardados.', 'ok');
      pintar();
      refrescar();
    }
  });

  /* ------------------------------------------------------------------ *
   * Emparejar                                                           *
   * ------------------------------------------------------------------ */
  let codigoActual = '';
  let cuentaAtras = 0;
  let expira = 0;

  function pintarCuenta() {
    const resta = Math.max(0, Math.round((expira - Date.now()) / 1000));
    const el = $('#codigo-caduca');
    if (resta <= 0) {
      clearInterval(cuentaAtras);
      poner(el, 'Este código ya caducó. Genera otro.');
      el.classList.add('caducado');
      return;
    }
    const mm = String(Math.floor(resta / 60)).padStart(2, '0');
    const ss = String(resta % 60).padStart(2, '0');
    poner(el, 'Caduca en ' + mm + ':' + ss);
    el.classList.remove('caducado');
  }
  $('#b-codigo').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const minutos = Number($('#s-minutos').value) || 10;
    btn.disabled = true;
    const r = await accionPost('/api/emparejar', { minutos }, { exito: 'Código generado.', etiqueta: 'generar el código' });
    btn.disabled = false;
    if (r.ok === true && r.codigo) {
      codigoActual = r.codigo;
      poner($('#codigo-valor'), r.codigo);
      poner($('#codigo-texto'), r.texto || '');
      mostrar($('#codigo-caja'), true);
      expira = Date.now() + minutos * 60000;
      clearInterval(cuentaAtras);
      pintarCuenta();
      cuentaAtras = setInterval(pintarCuenta, 1000);
    }
  });
  $('#b-copiar-codigo').addEventListener('click', async () => {
    if (!codigoActual) return;
    const ok = await copiarTexto(codigoActual);
    aviso(ok ? 'Código copiado.' : 'No se pudo copiar el código.', ok ? 'ok' : 'error');
  });

  /* ------------------------------------------------------------------ *
   * Aviso del enlace                                                    *
   * ------------------------------------------------------------------ */
  const fAviso = $('#f-aviso');
  let tieneTelegram = false;

  function metodoActual() {
    return ($('input[name="metodo"]:checked', fAviso) || {}).value || 'ninguno';
  }
  function pintarMetodo() {
    const m = metodoActual();
    mostrar($('#m-ntfy'), m === 'ntfy');
    mostrar($('#m-telegram'), m === 'telegram');
    $('#b-prueba-aviso').disabled = m === 'ninguno';
    poner($('#n-tg-token'), tieneTelegram
      ? 'Ya hay una clave guardada. Déjalo vacío para conservarla.'
      : 'Es la clave que te da BotFather al crear el bot.');
    atributo($('#i-tg-token'), 'placeholder', tieneTelegram ? '•••••••• (guardada)' : null);
  }
  async function cargarAviso(forzar) {
    if (avDirty && !forzar) return;
    const r = await api('/api/aviso');
    if (r.ok === false) { if (!r.sesion && !r.red) aviso(r.error, 'error'); return; }
    avisoCargado = true;
    tieneTelegram = !!r.tieneTelegramToken;
    const metodo = ['ntfy', 'telegram'].includes(r.metodo) ? r.metodo : 'ninguno';
    for (const x of $$('input[name="metodo"]', fAviso)) x.checked = x.value === metodo;
    $('#i-ntfy-servidor').value = r.ntfyServidor || '';
    $('#i-ntfy-tema').value = r.ntfyTema || '';
    $('#i-tg-chat').value = r.telegramChat || '';
    $('#i-tg-token').value = '';
    avDirty = false;
    poner($('#est-aviso'), '');
    pintarMetodo();
  }
  fAviso.addEventListener('input', () => { avDirty = true; poner($('#est-aviso'), 'Cambios sin guardar'); pintarMetodo(); });

  async function guardarAviso() {
    const m = metodoActual();
    const tema = $('#i-ntfy-tema').value.trim();
    const chat = $('#i-tg-chat').value.trim();
    const clave = $('#i-tg-token').value.trim();
    if (m === 'ntfy' && !tema) { aviso('Escribe un tema para ntfy.', 'error'); $('#i-ntfy-tema').focus(); return false; }
    if (m === 'telegram' && !chat) { aviso('Escribe el número de chat de Telegram.', 'error'); $('#i-tg-chat').focus(); return false; }
    if (m === 'telegram' && !clave && !tieneTelegram) { aviso('Escribe la clave del bot de Telegram.', 'error'); $('#i-tg-token').focus(); return false; }
    const r = await accionPost('/api/aviso', {
      metodo: m,
      ntfyServidor: $('#i-ntfy-servidor').value.trim(),
      ntfyTema: tema,
      telegramToken: clave,
      telegramChat: chat,
    }, { exito: 'Aviso guardado.', etiqueta: 'guardar el aviso' });
    if (r.ok !== true) return false;
    avDirty = false;
    await cargarAviso(true);
    return true;
  }
  fAviso.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('#b-guardar-aviso');
    btn.disabled = true;
    await guardarAviso();
    btn.disabled = false;
  });
  $('#b-prueba-aviso').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      if (avDirty && !(await guardarAviso())) return; // la prueba usa lo guardado
      await accionPost('/api/aviso/prueba', {}, { exito: 'Aviso de prueba enviado.', etiqueta: 'enviar la prueba' });
    } finally {
      btn.disabled = metodoActual() === 'ninguno';
    }
  });

  /* ------------------------------------------------------------------ *
   * Seguridad                                                           *
   * ------------------------------------------------------------------ */
  const fClave = $('#f-contrasena');
  const eClave = $('#e-clave');
  function errorClave(msg) {
    poner(eClave, msg);
    mostrar(eClave, !!msg);
  }
  fClave.addEventListener('input', () => errorClave(''));
  fClave.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const usuario = $('#i-usuario').value.trim();
    const c1 = $('#i-clave').value;
    const c2 = $('#i-clave2').value;
    if (!usuario) { errorClave('Escribe el usuario de Windows.'); $('#i-usuario').focus(); return; }
    if (!c1) { errorClave('La contraseña no puede estar vacía.'); $('#i-clave').focus(); return; }
    if (c1 !== c2) { errorClave('Las dos contraseñas no coinciden.'); $('#i-clave2').focus(); return; }
    const v = await confirmar({
      titulo: '¿Cambiar la contraseña?',
      texto: 'NEXO se reiniciará para aplicarla (tarda unos segundos) y se cerrará la conexión actual del celular.',
      botones: [{ texto: 'Cambiar contraseña', valor: 'si', clase: 'primario' }],
    });
    if (!v) return;
    const btn = $('#b-contrasena');
    btn.disabled = true;
    bloqueoHasta = Date.now() + 3000; textoLocal = 'Reiniciando…';
    const r = await accionPost('/api/contrasena', { usuario, contrasena: c1 }, { exito: 'Contraseña cambiada. NEXO se está reiniciando.', etiqueta: 'cambiar la contraseña' });
    btn.disabled = false;
    if (r.ok === true) { $('#i-clave').value = ''; $('#i-clave2').value = ''; refrescar(); }
    else bloqueoHasta = 0;
  });

  $('#b-rotar').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const v = await confirmar({
      titulo: '¿Rotar el enlace?',
      texto: 'Los enlaces y códigos QR que ya compartiste dejarán de funcionar. NEXO se reiniciará (unos 10 segundos) y tendrás que abrir el enlace nuevo en el celular.',
      botones: [{ texto: 'Rotar el enlace', valor: 'si', clase: 'peligro-fuerte' }],
    });
    if (!v) return;
    btn.disabled = true;
    bloqueoHasta = Date.now() + 3000; textoLocal = 'Reiniciando…';
    const r = await accionPost('/api/rotar', {}, { exito: 'Enlace rotado. NEXO se está reiniciando.', etiqueta: 'rotar el enlace' });
    btn.disabled = false;
    if (r.ok === true) { location.hash = '#inicio'; refrescar(); } else bloqueoHasta = 0;
  });

  /* ------------------------------------------------------------------ *
   * Diagnóstico y registro                                              *
   * ------------------------------------------------------------------ */
  $('#b-doctor').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const salida = $('#doctor-salida');
    btn.disabled = true;
    mostrar($('#doctor-carga'), true);
    const r = await api('/api/doctor');
    mostrar($('#doctor-carga'), false);
    btn.disabled = false;
    if (r.ok === false) {
      if (!r.sesion) aviso(r.error || 'No se pudo ejecutar el diagnóstico', 'error');
      return;
    }
    poner(salida, r.texto || '(El diagnóstico no devolvió texto.)');
    mostrar(salida, true);
    salida.scrollTop = 0;
    aviso('Diagnóstico terminado.', 'ok');
  });

  async function verRegistro() {
    const btn = $('#b-registro');
    const salida = $('#registro-salida');
    btn.disabled = true;
    const r = await api('/api/registro');
    btn.disabled = false;
    if (r.ok === false) {
      if (!r.sesion) aviso(r.error || 'No se pudo leer el registro', 'error');
      return;
    }
    poner(salida, r.texto || '(El registro está vacío.)');
    poner(btn, 'Actualizar registro');
    mostrar(salida, true);
    salida.scrollTop = salida.scrollHeight;
  }
  $('#b-registro').addEventListener('click', verRegistro);
  $('#b-carpeta').addEventListener('click', () =>
    accionPost('/api/abrir-registros', {}, { exito: 'Abriendo la carpeta de registros…', etiqueta: 'abrir la carpeta' }));

  /* ------------------------------------------------------------------ *
   * Pie: cerrar panel / salir                                           *
   * ------------------------------------------------------------------ */
  function pantallaFinal(msg) {
    saliendo = true;
    clearTimeout(temporizador);
    mostrar($('#banner-red'), false);
    const b = $('#banner-sesion');
    poner(b, msg);
    mostrar(b, true);
    for (const x of $$('button, input, select')) x.disabled = true;
  }
  $('#b-cerrar-panel').addEventListener('click', () => {
    window.close();
    setTimeout(() => aviso('Cierra esta ventana con la X de arriba. NEXO sigue funcionando.', 'info'), 500);
  });
  $('#b-salir').addEventListener('click', async () => {
    const v = await confirmar({
      titulo: '¿Salir de NEXO?',
      texto: 'Puedes detener NEXO por completo, o cerrar sólo la bandeja y dejar que NEXO siga funcionando en segundo plano.',
      botones: [
        { texto: 'Cerrar sólo la bandeja', valor: 'bandeja' },
        { texto: 'Detener NEXO y cerrar la bandeja', valor: 'todo', clase: 'peligro-fuerte' },
      ],
    });
    if (!v) return;
    const detener = v === 'todo';
    const r = await accionPost('/api/salir', { detener }, { etiqueta: 'salir' });
    if (r.ok === true) {
      pantallaFinal(detener ? 'NEXO se detuvo y la bandeja se cerró. Ya puedes cerrar esta ventana.' : 'La bandeja se cerró; NEXO sigue funcionando. Ya puedes cerrar esta ventana.');
      setTimeout(() => window.close(), 800);
    }
  });

  /* ------------------------------------------------------------------ *
   * Navegación por secciones                                            *
   * ------------------------------------------------------------------ */
  const VISTAS = ['inicio', 'ajustes', 'emparejar', 'aviso', 'seguridad', 'diagnostico'];
  function ruta() {
    const v = location.hash.replace('#', '');
    const nombre = VISTAS.includes(v) ? v : 'inicio';
    for (const n of VISTAS) mostrar($('#v-' + n), n === nombre);
    for (const a of $$('.nav a')) {
      if (a.dataset.vista === nombre) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    document.title = 'NEXO · ' + $('.nav a[data-vista="' + nombre + '"] span').textContent;
    window.scrollTo(0, 0);
    if (nombre === 'aviso') cargarAviso(false);
  }
  window.addEventListener('hashchange', ruta);

  /* ------------------------------------------------------------------ *
   * Arranque                                                            *
   * ------------------------------------------------------------------ */
  ruta();
  pintar();
  refrescar().then(programar);
})();
