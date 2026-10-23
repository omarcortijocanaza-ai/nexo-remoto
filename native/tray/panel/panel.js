/* Panel de NEXO · lógica de la interfaz.
 * Habla con nexo-tray.exe según CONTRATO.md. Sin dependencias.
 * Idea central: la página se pinta una sola vez (index.html) y cada sondeo sólo cambia
 * lo que cambió de verdad, para que nunca se pierda lo que el usuario está escribiendo.
 * La apariencia (cinco temas, claro/oscuro) es un atributo de <html>: cambiarla es instantáneo. */
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
  let httpsDirty = false;       // ídem para el interruptor del HTTPS
  let avDirty = false;          // ídem para el aviso
  let autoOcupado = false;
  let enVuelo = false;
  let temporizador = 0;
  let vuelta = 0;               // cuenta de sondeos (para refrescar la lista de dispositivos de vez en cuando)

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
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

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
   * Grupos de opciones (role="radiogroup"): flechas, foco y marca       *
   * ------------------------------------------------------------------ */
  // Un solo botón del grupo entra en el orden del tabulador (el marcado); las flechas mueven y eligen.
  function grupoRadio(contenedor, alElegir) {
    const items = () => $$('[role="radio"]', contenedor);
    function marcar(el) {
      for (const x of items()) {
        const on = x === el;
        atributo(x, 'aria-checked', String(on));
        atributo(x, 'tabindex', on ? '0' : '-1');
      }
    }
    contenedor.addEventListener('click', (ev) => {
      const el = ev.target.closest('[role="radio"]');
      if (el && contenedor.contains(el) && !el.disabled) alElegir(el, 'clic');
    });
    contenedor.addEventListener('keydown', (ev) => {
      const flechas = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!(ev.key in flechas)) return;
      const lista = items().filter((x) => !x.disabled);
      const i = lista.indexOf(document.activeElement);
      if (i < 0) return;
      ev.preventDefault();
      const sig = lista[(i + flechas[ev.key] + lista.length) % lista.length];
      sig.focus();
      alElegir(sig, 'teclado');
    });
    return { marcar, items };
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
    temporizador = setTimeout(async () => {
      await refrescar();
      // La lista de dispositivos cambia poco: se relee cada ~20 s, no en cada sondeo.
      if (++vuelta % 10 === 0 && !document.hidden) cargarDispositivos();
      programar();
    }, document.hidden ? 5000 : 2000);
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { refrescar().then(programar); } else { programar(); }
  });

  /* ------------------------------------------------------------------ *
   * Pintado                                                             *
   * ------------------------------------------------------------------ */
  const TITULOS = {
    activo: 'NEXO está activo',
    conectando: 'NEXO se está conectando',
    detenido: 'NEXO está detenido',
    sinconexion: 'Sin conexión con la bandeja',
    desconocido: 'Comprobando…',
  };
  const DETALLES = {
    activo: 'Todo listo: ya puedes conectar tu celular.',
    conectando: 'NEXO ya responde en esta PC; falta publicar el enlace de Internet.',
    detenido: 'Pulsa Iniciar para poder usar esta PC desde el celular.',
    sinconexion: 'La ventana no logra comunicarse con la bandeja de NEXO.',
    desconocido: 'Hablando con la bandeja de NEXO…',
  };

  function ocupadoAhora() {
    return (estado && estado.ocupado) || (Date.now() < bloqueoHasta ? textoLocal : '');
  }

  function estadoVisual() {
    if (sesionCaducada) return { est: 'sinconexion', titulo: 'Panel desconectado', detalle: 'Cierra esta ventana y ábrela de nuevo desde el icono de NEXO en la bandeja.', corto: 'Panel desconectado' };
    if (redCaida) return { est: 'sinconexion', titulo: TITULOS.sinconexion, detalle: DETALLES.sinconexion, corto: 'Sin conexión con la bandeja' };
    if (estado) {
      const est = TITULOS[estado.estado] ? estado.estado : 'desconocido';
      return { est, titulo: TITULOS[est], detalle: DETALLES[est], corto: estado.textoEstado || ('NEXO · ' + est) };
    }
    return { est: 'desconocido', titulo: TITULOS.desconocido, detalle: DETALLES.desconocido, corto: 'Comprobando…' };
  }

  function pintar() {
    const v = estadoVisual();
    atributo($('#heroe'), 'data-est', v.est);
    poner($('#t-inicio'), v.titulo);
    poner($('#estado-detalle'), v.detalle);
    for (const id of ['pie-luz', 'barra-luz']) atributo($('#' + id), 'data-est', v.est);
    poner($('#pie-texto'), v.corto + (estado && estado.version ? ' · v' + estado.version : ''));
    poner($('#barra-texto'), v.corto);

    const ocup = ocupadoAhora();
    poner($('#ocupado-texto'), ocup);
    mostrar($('#ocupado'), !!ocup);

    pintarBotones(v.est, ocup);
    pintarConexion();
    pintarDatos();
    pintarAutoarranque();
    pintarReinicio();
    if (estado && !ajDirty) llenarAjustes(estado.ajustes);
    if (estado && !httpsDirty) llenarHttps(estado.ajustes);
  }

  function pintarBotones(est, ocup) {
    const sinContacto = !estado || redCaida || sesionCaducada;
    const libre = !sinContacto && !ocup;
    const parado = est === 'detenido';
    mostrar($('#b-iniciar'), parado);
    mostrar($('#b-reiniciar'), !parado);
    mostrar($('#b-detener'), !parado);
    $('#b-iniciar').disabled = !(libre && parado);
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

  /* ---- Conectar el celular: QR, tres pasos, vía y enlace ---- */
  const VIAS = {
    internet: {
      nota: 'Funciona desde cualquier lugar, con datos móviles o con Wi-Fi.',
      pasos: ['Abre la cámara del celular.', 'Apunta al código y toca el aviso.', 'Verás «Mi PC» lista para entrar.'],
      etiqueta: 'Internet',
    },
    local: {
      nota: 'Más rápido, pero el celular debe estar en el mismo Wi-Fi que esta PC.',
      pasos: ['Conecta el celular al mismo Wi-Fi que esta PC.', 'Apunta la cámara al código y toca el aviso.', 'Verás «Mi PC» lista para entrar.'],
      etiqueta: 'red de casa',
    },
    localSeguro: {
      nota: 'El mismo Wi-Fi, pero con candado (HTTPS): así el celular deja usar el micrófono y el portapapeles.',
      pasos: ['Conecta el celular al mismo Wi-Fi que esta PC.', 'Apunta la cámara al código y toca el aviso.', 'Si el navegador avisa «conexión no privada», acéptalo: el certificado lo creó esta PC.'],
      etiqueta: 'red de casa con candado',
    },
  };
  const ORDEN_VIAS = ['internet', 'local', 'localSeguro'];
  let via = 'internet';
  let viaManual = false;        // el usuario eligió una vía: se respeta aunque aún no tenga enlace
  let enlaceVisible = false;    // el enlace se enseña completo (por defecto, con el token oculto)
  let qrClave = '';             // «vía|enlace» del QR cargado, para no pedirlo en cada sondeo

  function enlaceDe(que) {
    return (estado && estado.enlaces && estado.enlaces[que]) || '';
  }

  function motivoSinEnlace(que) {
    if (!estado) return 'Comprobando…';
    if (estado.estado === 'detenido') return 'NEXO está detenido. Pulsa Iniciar para obtener un enlace.';
    const modo = estado.modo;
    if (que === 'internet') {
      if (modo === 'local') return 'El modo actual es «sólo red local»: no hay enlace de Internet. Cámbialo en Ajustes.';
      return 'Publicando el enlace de Internet… suele tardar unos segundos.';
    }
    if (que === 'local') {
      if (modo === 'remote') return 'El modo actual es «sólo Internet»: no hay enlace para la red de casa. Cámbialo en Ajustes.';
      return 'Aún no hay enlace para la red de casa.';
    }
    if (!(estado.ajustes && estado.ajustes.httpsLan)) return 'El candado (HTTPS) está apagado. Actívalo en Conexión.';
    if (estado.ajustesPendientes) return 'Reinicia NEXO para activar el candado.';
    return 'Aún no hay enlace con candado.';
  }

  const grupoVia = grupoRadio($('#via'), (el) => {
    via = el.dataset.via;
    viaManual = true;
    pintarConexion();
  });

  function pintarConexion() {
    // Mientras nadie haya elegido, se muestra la mejor vía disponible (Internet, si ya está publicada).
    if (!viaManual) via = ORDEN_VIAS.find((q) => enlaceDe(q)) || 'internet';
    for (const b of grupoVia.items()) {
      const q = b.dataset.via;
      b.classList.toggle('no-disp', !enlaceDe(q));
      atributo(b, 'title', enlaceDe(q) ? null : motivoSinEnlace(q));
    }
    grupoVia.marcar($(`[data-via="${via}"]`));

    const enlace = enlaceDe(via);
    const hay = !!enlace;
    const def = VIAS[via];
    poner($('#via-nota'), def.nota);
    const items = $$('#pasos-lista li');
    def.pasos.forEach((t, i) => poner(items[i], t));

    // QR: sólo se vuelve a pedir si cambia la vía o el enlace.
    const img = $('#qr-img');
    const vacio = $('#qr-vacio');
    const clave = hay ? via + '|' + enlace : '';
    if (clave !== qrClave) {
      qrClave = clave;
      if (hay) {
        img.hidden = false;
        img.src = '/api/qr?que=' + via + '&t=' + Date.now();
      } else {
        img.removeAttribute('src');
        img.hidden = true;
      }
    }
    atributo(img, 'alt', 'Código QR del enlace de ' + def.etiqueta + ' para el celular');
    if (!hay) {
      poner(vacio, motivoSinEnlace(via));
      mostrar(vacio, true);
    } else if (img.hidden) {
      poner(vacio, 'No se pudo cargar el código QR. Prueba de nuevo en unos segundos.');
      mostrar(vacio, true);
    } else {
      mostrar(vacio, false);
    }

    const code = $('#enlace-valor');
    code.classList.toggle('vacio', !hay);
    code.classList.toggle('mostrando', hay && enlaceVisible);
    poner(code, hay ? (enlaceVisible ? enlace : mascarar(enlace)) : 'Aún no disponible');
    $('#b-copiar').disabled = !hay;
    $('#b-mostrar').disabled = !hay;
    atributo($('#b-mostrar'), 'aria-pressed', String(enlaceVisible));
    atributo($('#b-mostrar'), 'aria-label', enlaceVisible ? 'Ocultar el enlace' : 'Mostrar el enlace completo');
    const ico = $('#b-mostrar use');
    atributo(ico, 'href', enlaceVisible ? '#i-ojo-no' : '#i-ojo');
  }

  $('#qr-img').addEventListener('error', () => {
    $('#qr-img').hidden = true;
    qrClave = '';
    pintarConexion();
  });
  $('#b-mostrar').addEventListener('click', () => { enlaceVisible = !enlaceVisible; pintarConexion(); });
  $('#b-copiar').addEventListener('click', async () => {
    const enlace = enlaceDe(via);
    if (!enlace) return;
    const ok = await copiarTexto(enlace);
    aviso(ok ? 'Enlace copiado. Pégalo en el celular.' : 'No se pudo copiar. Pulsa el ojo para verlo y cópialo a mano.', ok ? 'ok' : 'error');
  });

  /* ---- Los cuatro datos y el esquema de Cianotipo ---- */
  function hostDe(enlace) {
    try { return new URL(enlace); } catch (e) { return null; }
  }

  function pintarDatos() {
    const sin = !estado;
    const parado = estado && estado.estado === 'detenido';
    const modo = estado ? estado.modo : '';
    const ajustes = (estado && estado.ajustes) || {};

    // Internet
    let b = '—', em = ' ', esq = '—';
    if (!sin) {
      if (parado) { b = 'Apagado'; em = 'NEXO está detenido'; esq = 'apagado'; }
      else if (modo === 'local') { b = 'No se usa'; em = 'Modo «sólo red local»'; esq = 'no se usa'; }
      else if (enlaceDe('internet')) { b = 'Conectado'; em = 'Túnel de Cloudflare'; esq = 'listo'; }
      else { b = 'Conectando…'; em = 'Publicando el enlace'; esq = 'publicando…'; }
    }
    poner($('#d-internet-b'), b); poner($('#d-internet-em'), em); poner($('#esq-internet-em'), esq);

    // Red de casa
    b = '—'; em = ' '; esq = '—';
    if (!sin) {
      const local = hostDe(enlaceDe('local'));
      const seguro = hostDe(enlaceDe('localSeguro'));
      if (parado) { b = 'Apagada'; em = 'NEXO está detenido'; esq = 'apagado'; }
      else if (modo === 'remote') { b = 'No se usa'; em = 'Modo «sólo Internet»'; esq = 'no se usa'; }
      else if (local) {
        const cat = categoriaRed();
        b = cat ? cat : 'Disponible';
        em = local.hostname + (seguro ? ' · HTTPS ' + (seguro.port || '443') : '');
        esq = seguro ? 'con candado' : 'listo';
      } else { b = 'Sin enlace aún'; em = 'Esperando a NEXO'; esq = '…'; }
    }
    poner($('#d-casa-b'), b); poner($('#d-casa-em'), em); poner($('#esq-casa-em'), esq);

    // Vídeo
    b = '—'; em = ' ';
    if (!sin) {
      if (ajustes.gpu === false) { b = 'Procesador'; em = 'Sin la tarjeta gráfica'; }
      else { b = 'Tarjeta gráfica'; em = 'Más fluido y gasta menos procesador'; }
    }
    poner($('#d-video-b'), b); poner($('#d-video-em'), em);

    // Dispositivos con acceso (viene de /api/dispositivos)
    b = '—'; em = ' ';
    if (dispositivos) {
      const n = dispositivos.length;
      b = n === 0 ? 'Ninguno todavía' : (n === 1 ? '1 con acceso' : n + ' con acceso');
      em = n === 0 ? 'Genera un código para añadir uno' : 'Último: ' + haceCuanto(Math.max(...dispositivos.map((d) => d.ultimaVez || 0)));
    }
    poner($('#d-disp-b'), b); poner($('#d-disp-em'), em);
  }

  // Categoría de red conocida (sólo si ya se consultó el firewall en la vista Conexión).
  function categoriaRed() {
    if (!red || !red.comprobado || !red.perfiles || !red.perfiles.length) return '';
    if (red.perfiles.some((p) => p.categoria === 'Private' || p.categoria === 'DomainAuthenticated')) return 'Privada · segura';
    return 'Pública';
  }

  function haceCuanto(ms) {
    if (!ms) return 'sin datos';
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'hace un momento';
    const m = Math.round(s / 60);
    if (m < 60) return 'hace ' + m + ' min';
    const h = Math.round(m / 60);
    if (h < 24) return 'hace ' + h + (h === 1 ? ' hora' : ' horas');
    const d = Math.round(h / 24);
    return 'hace ' + d + (d === 1 ? ' día' : ' días');
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
        botones: [{ texto: 'Detener NEXO', valor: 'si', clase: 'mal-fuerte' }],
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
   * Ajustes (modo, GPU, micrófono) y HTTPS de la red de casa            *
   * ------------------------------------------------------------------ */
  // POST /api/ajustes recibe el objeto completo. Cada formulario manda sus campos sobre lo ya guardado,
  // así guardar uno nunca pisa lo que el otro tiene sin guardar.
  function ajustesGuardados() {
    const a = (estado && estado.ajustes) || {};
    return { modo: a.modo || 'both', gpu: a.gpu !== false, micDispositivo: a.micDispositivo || '', httpsLan: !!a.httpsLan };
  }

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
      ...ajustesGuardados(),
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

  const fHttps = $('#f-https');
  const swHttps = $('#sw-https');
  function llenarHttps(a) {
    if (!a) return;
    atributo(swHttps, 'aria-checked', String(!!a.httpsLan));
  }
  swHttps.addEventListener('click', () => {
    atributo(swHttps, 'aria-checked', String(swHttps.getAttribute('aria-checked') !== 'true'));
    httpsDirty = true;
    poner($('#est-https'), 'Cambios sin guardar');
  });
  fHttps.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('#b-guardar-https');
    btn.disabled = true;
    const r = await accionPost('/api/ajustes', {
      ...ajustesGuardados(),
      httpsLan: swHttps.getAttribute('aria-checked') === 'true',
    }, { etiqueta: 'guardar el HTTPS' });
    btn.disabled = false;
    if (r.ok === true) {
      httpsDirty = false;
      if (r.ajustes) { llenarHttps(r.ajustes); if (estado) estado.ajustes = r.ajustes; }
      if (r.requiereReinicio) reinicioLocal = true;
      poner($('#est-https'), '');
      aviso('Guardado. Reinicia NEXO para aplicarlo.', 'ok');
      pintar();
      refrescar();
    }
  });

  /* ------------------------------------------------------------------ *
   * Conexión: red, firewall y TURN                                      *
   * ------------------------------------------------------------------ */
  const NOMBRE_CATEGORIA = { Public: 'Pública', Private: 'Privada', DomainAuthenticated: 'De dominio' };
  let red = null;
  let redOcupada = false;

  function pintarRed() {
    const ok = !!(red && red.comprobado);
    mostrar($('#red-carga'), redOcupada);
    const lista = $('#red-perfiles');
    lista.replaceChildren();
    if (ok) {
      for (const p of red.perfiles) {
        const li = document.createElement('li');
        li.textContent = p.interfaz + ' · ' + p.nombre + ': ' + (NOMBRE_CATEGORIA[p.categoria] || p.categoria);
        lista.append(li);
      }
    }
    mostrar(lista, ok && red.perfiles.length > 0);

    const aviso1 = $('#red-aviso');
    let texto = '';
    if (red && !red.comprobado) texto = red.error || 'No se pudo consultar el firewall.';
    else if (ok && red.todasPublicas) texto = 'Windows tiene tu red como «Pública», la categoría más restrictiva. Las reglas propias de NEXO sólo valen en redes Privadas, así que hoy el celular entra por el Wi-Fi gracias a reglas que Windows creó solo. Si esta es tu red de casa, márcala como Privada.';
    poner(aviso1, texto);
    mostrar(aviso1, !!texto);

    const reglas = $('#red-reglas');
    let tReglas = '';
    if (ok && red.reglasPublicas.length) {
      tReglas = red.reglasPublicas.length + ' regla(s) de Windows dejan entrar a NEXO desde redes públicas (cafeterías, hoteles): ' +
        Array.from(new Set(red.reglasPublicas.map((r) => r.nombre))).join(', ') + '. Se pueden cerrar sin perder el acceso en casa cuando la red sea Privada.';
    } else if (ok) {
      tReglas = 'No hay reglas abiertas a redes públicas para NEXO.';
    }
    poner(reglas, tReglas);
    mostrar(reglas, !!tReglas);

    const elevado = !!(red && red.elevado);
    const hayPublicas = ok && red.reglasPublicas.length > 0;
    const quiereHttps = !!(estado && estado.ajustes && estado.ajustes.httpsLan);
    const bPriv = $('#b-red-privada');
    const bCerrar = $('#b-red-cerrar');
    const bForzar = $('#b-red-forzar');
    const bHttps = $('#b-red-https');
    mostrar(bPriv, ok && red.todasPublicas);
    mostrar(bCerrar, hayPublicas && !red.todasPublicas);
    mostrar(bForzar, hayPublicas && red.todasPublicas);
    mostrar(bHttps, ok && quiereHttps && !red.reglaHttps);
    for (const b of [bPriv, bCerrar, bForzar, bHttps]) b.disabled = redOcupada || !elevado;
    $('#b-red-releer').disabled = redOcupada;
    if (ok && !elevado) {
      poner(aviso1, (texto ? texto + ' ' : '') + 'NEXO no está abierto como administrador: Windows no dejará aplicar los cambios desde aquí.');
      mostrar(aviso1, true);
    }
    pintarDatos(); // «Red de casa» muestra Privada/Pública cuando ya se conoce
  }

  async function cargarRed() {
    if (redOcupada) return;
    redOcupada = true; pintarRed();
    const r = await api('/api/red');
    redOcupada = false;
    if (r.ok === true) red = r.red;
    else if (!r.sesion) red = { comprobado: false, error: r.error, perfiles: [], reglasPublicas: [] };
    pintarRed();
  }

  async function accionRed(ruta, cuerpo, confirmacion) {
    if (confirmacion) {
      const v = await confirmar(confirmacion);
      if (!v) return;
    }
    redOcupada = true; pintarRed();
    const r = await accionPost(ruta, cuerpo, { etiqueta: 'cambiar la red' });
    redOcupada = false;
    if (r.ok === true && r.red) red = r.red;
    pintarRed();
    if (r.ok === true) cargarRed();
  }
  $('#b-red-releer').addEventListener('click', cargarRed);
  $('#b-red-privada').addEventListener('click', () => accionRed('/api/red/privada', {}, {
    titulo: '¿Marcar tu red como Privada?',
    texto: 'Úsalo sólo si es tu red de casa o de confianza. Windows tratará esta red como segura (descubrimiento de equipos, uso compartido) y NEXO podrá abrirse a ella.',
    botones: [{ texto: 'Marcar como Privada', valor: 'si', clase: 'pri' }],
  }));
  $('#b-red-cerrar').addEventListener('click', () => accionRed('/api/red/cerrar-publicas', {}, {
    titulo: '¿Cerrar las reglas públicas?',
    texto: 'Se quitarán las reglas que Windows creó para NEXO en redes públicas. En tu red Privada seguirás entrando igual.',
    botones: [{ texto: 'Cerrar reglas', valor: 'si', clase: 'pri' }],
  }));
  $('#b-red-forzar').addEventListener('click', () => accionRed('/api/red/cerrar-publicas', { forzar: true }, {
    titulo: '¿Cerrarlas de todos modos?',
    texto: 'Tu red sigue siendo Pública: el celular dejará de entrar por el Wi-Fi de casa y sólo funcionará el enlace de Internet. Mejor marca antes la red como Privada.',
    botones: [{ texto: 'Cerrar de todos modos', valor: 'si', clase: 'mal-fuerte' }],
  }));
  $('#b-red-https').addEventListener('click', () => accionRed('/api/red/regla-https', {}));

  /* ---- TURN ---- */
  const fTurn = $('#f-turn');
  let turn = null;
  let turnDirty = false;

  function proveedorTurn() { return ($('input[name="turn"]:checked', fTurn) || {}).value || 'ninguno'; }
  function pintarTurn() {
    const p = proveedorTurn();
    mostrar($('#m-turn-cloudflare'), p === 'cloudflare');
    mostrar($('#m-turn-manual'), p === 'manual');
    $('#b-turn-probar').disabled = p === 'ninguno' && !turnDirty;
    poner($('#n-cf-token'), turn && turn.tieneApiToken ? 'Ya hay un token guardado. Déjalo vacío para conservarlo.' : 'Cloudflare lo muestra una sola vez al crear la clave.');
    atributo($('#i-cf-token'), 'placeholder', turn && turn.tieneApiToken ? '•••••••• (guardado)' : null);
    poner($('#n-tm-clave'), turn && turn.tieneCredencial ? 'Ya hay una contraseña guardada. Déjala vacía para conservarla.' : 'Se guarda sólo en esta PC.');
    atributo($('#i-tm-clave'), 'placeholder', turn && turn.tieneCredencial ? '•••••••• (guardada)' : null);
  }
  async function cargarTurn(forzar) {
    if (turnDirty && !forzar) return;
    const r = await api('/api/turn');
    if (r.ok !== true) { if (!r.sesion && !r.red) aviso(r.error, 'error'); return; }
    turn = r.turn;
    for (const x of $$('input[name="turn"]', fTurn)) x.checked = x.value === (turn.proveedor || 'ninguno');
    $('#i-cf-key').value = turn.cloudflareKeyId || '';
    $('#i-cf-token').value = '';
    $('#i-tm-urls').value = (turn.manualUrls || []).join('\n');
    $('#i-tm-usuario').value = turn.manualUsuario || '';
    $('#i-tm-clave').value = '';
    turnDirty = false;
    poner($('#est-turn'), '');
    pintarTurn();
  }
  fTurn.addEventListener('input', () => { turnDirty = true; poner($('#est-turn'), 'Cambios sin guardar'); mostrar($('#turn-resultado'), false); pintarTurn(); });

  async function guardarTurn() {
    const r = await accionPost('/api/turn', {
      proveedor: proveedorTurn(),
      cloudflare: { keyId: $('#i-cf-key').value.trim(), apiToken: $('#i-cf-token').value.trim() },
      manual: { urls: $('#i-tm-urls').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean), usuario: $('#i-tm-usuario').value.trim(), credencial: $('#i-tm-clave').value.trim() },
    }, { exito: 'Servidor TURN guardado. Se usa en la próxima conexión, sin reiniciar.', etiqueta: 'guardar el TURN' });
    if (r.ok !== true) return false;
    turnDirty = false;
    await cargarTurn(true);
    return true;
  }
  fTurn.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('#b-turn-guardar');
    btn.disabled = true;
    await guardarTurn();
    btn.disabled = false;
  });
  $('#b-turn-probar').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    const res = $('#turn-resultado');
    try {
      if (turnDirty && !(await guardarTurn())) return; // la prueba usa lo guardado
      poner(res, 'Probando con el servidor… (hasta 20 segundos)');
      mostrar(res, true);
      const r = await api('/api/turn/prueba', {});
      if (r.ok === true) { poner(res, 'Funciona. ' + r.texto); aviso(r.texto, 'ok'); }
      else if (!r.sesion) { poner(res, 'No funcionó. ' + (r.error || 'La prueba falló.')); aviso('La prueba del TURN falló.', 'error'); }
    } finally {
      btn.disabled = false;
      pintarTurn();
    }
  });

  /* ------------------------------------------------------------------ *
   * Dispositivos: código de emparejamiento y lista                      *
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

  // Lista de sólo lectura: etiqueta y última vez visto (nunca secretos) de .nexo-devices.json.
  let dispositivos = null;
  function pintarDispositivos() {
    const lista = $('#lista-disp');
    lista.replaceChildren();
    const n = dispositivos ? dispositivos.length : 0;
    mostrar($('#lista-vacia'), !!dispositivos && n === 0);
    mostrar(lista, n > 0);
    for (const d of dispositivos || []) {
      const li = document.createElement('li');
      li.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-dispositivos"/></svg><div class="disp-txt"><b></b><small></small></div>';
      $('b', li).textContent = d.etiqueta || 'Dispositivo';
      $('small', li).textContent = 'Última vez: ' + haceCuanto(d.ultimaVez) + ' · con acceso ' + haceCuanto(d.creado);
      lista.append(li);
    }
    const insignia = $('#n-dispositivos');
    poner(insignia, String(n));
    mostrar(insignia, n > 0);
    pintarDatos();
  }
  async function cargarDispositivos() {
    const r = await api('/api/dispositivos');
    if (r.ok === true && Array.isArray(r.dispositivos)) {
      dispositivos = r.dispositivos;
      pintarDispositivos();
    }
  }

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
   * Contraseña de «Mi PC» y cambio de enlace                            *
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
    if (!usuario) { errorClave('Escribe el usuario de NEXO.'); $('#i-usuario').focus(); return; }
    if (!c1) { errorClave('La contraseña no puede estar vacía.'); $('#i-clave').focus(); return; }
    if (c1 !== c2) { errorClave('Las dos contraseñas no coinciden.'); $('#i-clave2').focus(); return; }
    const v = await confirmar({
      titulo: '¿Cambiar la contraseña?',
      texto: 'NEXO se reiniciará para aplicarla (tarda unos segundos) y se cerrará la conexión actual del celular.',
      botones: [{ texto: 'Cambiar contraseña', valor: 'si', clase: 'pri' }],
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
      titulo: '¿Cambiar el enlace?',
      texto: 'Los enlaces y códigos QR que ya compartiste dejarán de funcionar. NEXO se reiniciará (unos 10 segundos) y tendrás que abrir el enlace nuevo en el celular.',
      botones: [{ texto: 'Cambiar el enlace', valor: 'si', clase: 'mal-fuerte' }],
    });
    if (!v) return;
    btn.disabled = true;
    bloqueoHasta = Date.now() + 3000; textoLocal = 'Reiniciando…';
    const r = await accionPost('/api/rotar', {}, { exito: 'Enlace cambiado. NEXO se está reiniciando.', etiqueta: 'cambiar el enlace' });
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
   * Cerrar el panel / salir de NEXO                                     *
   * ------------------------------------------------------------------ */
  function pantallaFinal(msg) {
    saliendo = true;
    clearTimeout(temporizador);
    mostrar($('#banner-red'), false);
    const b = $('#banner-sesion');
    poner(b, msg);
    mostrar(b, true);
    for (const x of $$('button, input, select, textarea')) x.disabled = true;
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
        { texto: 'Detener NEXO y cerrar la bandeja', valor: 'todo', clase: 'mal-fuerte' },
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
   * Apariencia: tema, claro/oscuro y quién elige                        *
   * ------------------------------------------------------------------ */
  const TEMAS = ['cabina', 'nativa', 'reymuerto', 'cianotipo', 'bloque'];
  const NOMBRES_TEMA = { cabina: 'Cabina', nativa: 'Nativa', reymuerto: 'Rey Muerto', cianotipo: 'Cianotipo', bloque: 'Bloque' };
  // Fuentes que hay que tener listas antes de cambiar, para que el cambio sea limpio y no «salte».
  const FUENTES_TEMA = {
    cabina: ['700 16px "Barlow Condensed"', '400 16px "Barlow"', '400 14px "JetBrains Mono"'],
    nativa: [],
    reymuerto: ['600 16px "Cinzel"', '400 16px "Atkinson Hyperlegible"', '700 16px "Atkinson Hyperlegible"'],
    cianotipo: ['400 16px "Public Sans"', '800 16px "Public Sans"', '400 14px "DM Mono"', '700 20px "Caveat"'],
    bloque: ['400 16px "Bricolage Grotesque"', '800 16px "Bricolage Grotesque"'],
  };
  const raiz = document.documentElement;
  // Lo que el servidor del panel dejó en <html> es lo que está guardado.
  let apariencia = {
    tema: TEMAS.includes(raiz.dataset.tema) ? raiz.dataset.tema : 'reymuerto',
    modo: ['auto', 'claro', 'oscuro'].includes(raiz.dataset.pref) ? raiz.dataset.pref : 'auto',
    porDispositivo: false,
  };
  let aparienciaCargada = false;

  const gTema = grupoRadio($('#ap-grid'), (el) => elegirApariencia({ tema: el.dataset.id }));
  const gQuien = grupoRadio($('#ap-quien'), (el) => elegirApariencia({ porDispositivo: el.dataset.valor === 'cada' }));
  const gModo = grupoRadio($('#ap-modo'), (el) => elegirApariencia({ modo: el.dataset.valor }));

  function pintarApariencia(mensaje) {
    gTema.marcar($(`#ap-grid [data-id="${apariencia.tema}"]`));
    gQuien.marcar($(`#ap-quien [data-valor="${apariencia.porDispositivo ? 'cada' : 'todos'}"]`));
    gModo.marcar($(`#ap-modo [data-valor="${apariencia.modo}"]`));
    if (typeof mensaje === 'string') poner($('#ap-estado'), mensaje || ' ');
  }

  async function aplicarApariencia(a) {
    const fuentes = FUENTES_TEMA[a.tema] || [];
    if (fuentes.length && document.fonts && document.fonts.load) {
      // Se espera a las fuentes del tema nuevo, pero nunca más de 350 ms: el cambio debe sentirse instantáneo.
      await Promise.race([Promise.all(fuentes.map((f) => document.fonts.load(f).catch(() => []))), dormir(350)]);
    }
    if (window.NEXO_TEMA) window.NEXO_TEMA.poner(a.tema, a.modo);
    else { raiz.dataset.tema = a.tema; raiz.dataset.pref = a.modo; raiz.dataset.modo = a.modo === 'oscuro' ? 'oscuro' : 'claro'; }
  }

  // Los cambios se mandan de uno en uno y en orden, aunque se hagan clics seguidos.
  let colaApariencia = Promise.resolve();
  function elegirApariencia(cambios) {
    const previa = { ...apariencia };
    const nueva = { ...apariencia, ...cambios };
    if (nueva.tema === previa.tema && nueva.modo === previa.modo && nueva.porDispositivo === previa.porDispositivo) return colaApariencia;
    apariencia = nueva;
    pintarApariencia('Guardando…');
    colaApariencia = colaApariencia.then(async () => {
      await aplicarApariencia(nueva);
      const r = await api('/api/apariencia', nueva);
      if (r.ok === true && r.apariencia) {
        apariencia = r.apariencia;
        pintarApariencia(textoGuardado(cambios));
      } else {
        apariencia = previa;
        pintarApariencia('No se guardó: ' + (r.error || 'inténtalo de nuevo') + '.');
        await aplicarApariencia(previa);
        if (!r.sesion) aviso(r.error || 'No se pudo guardar la apariencia.', 'error');
      }
    });
    return colaApariencia;
  }

  function textoGuardado(cambios) {
    if ('porDispositivo' in cambios) {
      return apariencia.porDispositivo
        ? 'Guardado. Cada dispositivo podrá elegir su apariencia; la tuya es la inicial.'
        : 'Guardado. Todos los dispositivos usan «' + NOMBRES_TEMA[apariencia.tema] + '».';
    }
    return 'Guardado: ' + NOMBRES_TEMA[apariencia.tema] + ' · ' + { auto: 'automático', claro: 'claro', oscuro: 'oscuro' }[apariencia.modo] +
      '. Los dispositivos la verán la próxima vez que abran o recarguen NEXO.';
  }

  async function cargarApariencia() {
    const r = await api('/api/apariencia');
    if (r.ok !== true || !r.apariencia) return;
    const guardada = r.apariencia;
    const cambioTema = guardada.tema !== apariencia.tema || guardada.modo !== apariencia.modo;
    apariencia = guardada;
    aparienciaCargada = true;
    if (cambioTema) aplicarApariencia(guardada);
    pintarApariencia();
  }

  /* ------------------------------------------------------------------ *
   * Navegación por secciones                                            *
   * ------------------------------------------------------------------ */
  const VISTAS = ['inicio', 'dispositivos', 'conexion', 'apariencia', 'ajustes', 'diagnostico'];
  // Los nombres de la versión anterior del panel siguen llevando a su sitio.
  const ANTIGUAS = { emparejar: 'dispositivos', aviso: 'dispositivos', seguridad: 'ajustes' };
  function ruta() {
    let v = location.hash.replace('#', '');
    v = ANTIGUAS[v] || v;
    const nombre = VISTAS.includes(v) ? v : 'inicio';
    for (const n of VISTAS) mostrar($('#v-' + n), n === nombre);
    for (const a of $$('.nav nav a')) {
      if (a.dataset.vista === nombre) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    document.title = 'NEXO · ' + $('.nav nav a[data-vista="' + nombre + '"] span').textContent;
    window.scrollTo(0, 0);
    if (nombre === 'dispositivos') { cargarAviso(false); cargarDispositivos(); }
    if (nombre === 'conexion') { cargarRed(); cargarTurn(false); }
    if (nombre === 'apariencia') cargarApariencia();
  }
  window.addEventListener('hashchange', ruta);

  /* ------------------------------------------------------------------ *
   * Arranque                                                            *
   * ------------------------------------------------------------------ */
  // La barra superior de las ventanas estrechas lleva la misma marca que la barra lateral.
  const marcaCopia = $('#marca').cloneNode(true);
  marcaCopia.removeAttribute('id');
  $('#barra-m').prepend(marcaCopia);

  pintarApariencia();
  ruta();
  pintar();
  cargarApariencia();
  cargarDispositivos();
  refrescar().then(programar);
})();
