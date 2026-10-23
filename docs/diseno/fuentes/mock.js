/* Genera las pantallas de muestra. El texto y la estructura son los mismos en los cinco diseños;
   cada tema los viste distinto con su CSS. Nada de esto es el cliente real: es el bosquejo. */
(() => {
  'use strict';

  const TEMAS = [
    { id: 'cabina', nombre: 'Cabina', modo: 'oscuro' },
    { id: 'nativa', nombre: 'Nativa', modo: 'claro' },
    { id: 'reymuerto', nombre: 'Rey Muerto', modo: 'oscuro' },
    { id: 'cianotipo', nombre: 'Cianotipo', modo: 'claro' },
    { id: 'bloque', nombre: 'Bloque', modo: 'claro' },
  ];

  const ic = (n) => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;

  /* Marca: cada tema dibuja la suya (la corona sólo en «Rey Muerto», que conserva tu identidad). */
  const MARCAS = {
    cabina: `<svg class="mk" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><rect x="2" y="2" width="24" height="24" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 20V8l12 12V8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="miter"/></svg><span>NEXO</span>`,
    nativa: `<svg class="mk" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><rect width="28" height="28" rx="7" fill="var(--ac)"/><path d="M9 20V8l10 12V8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span>NEXO</span>`,
    reymuerto: `<svg class="mk" viewBox="0 0 32 28" width="32" height="28" aria-hidden="true"><path d="M3 22l2-13 6 6 5-9 5 9 6-6 2 13z" fill="none" stroke="var(--oro)" stroke-width="1.8" stroke-linejoin="round"/><path d="M3 25h26" stroke="var(--oro)" stroke-width="1.8" stroke-linecap="round"/></svg><span>NEXO</span>`,
    cianotipo: `<svg class="mk" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><path d="M4 24V4h20v20z M4 4l20 20" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="14" cy="14" r="3.2" fill="var(--bg)" stroke="currentColor" stroke-width="1.5"/></svg><span>NEXO</span>`,
    bloque: `<svg class="mk" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><rect x="1.5" y="1.5" width="25" height="25" fill="var(--am)" stroke="#0b0b0b" stroke-width="3"/><path d="M8 20V8l12 12V8" fill="none" stroke="#0b0b0b" stroke-width="3.2" stroke-linejoin="miter"/></svg><span>NEXO</span>`,
  };

  /* QR de muestra (no codifica nada): cuadros de esquina + módulos repetibles. */
  function qr(semilla) {
    const N = 29;
    let h = 2166136261;
    for (const c of semilla) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
    const esq = (x, y) => (x < 8 && y < 8) || (x >= N - 8 && y < 8) || (x < 8 && y >= N - 8);
    let c = '';
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let on;
      if (esq(x, y)) {
        const cx = x < 8 ? x : x - (N - 8), cy = y < 8 ? y : y - (N - 8);
        on = cx === 7 || cy === 7 ? false : cx === 0 || cx === 6 || cy === 0 || cy === 6 || (cx >= 2 && cx <= 4 && cy >= 2 && cy <= 4);
      } else on = rnd() > 0.52;
      if (on) c += `<rect x="${x}" y="${y}" width="1.02" height="1.02"/>`;
    }
    return `<svg viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges" role="img" aria-label="Código QR de muestra"><g fill="#0b0b0b">${c}</g></svg>`;
  }

  const SB = `<div class="isla"></div><div class="sb"><span>07:14</span><span>${ic('wifi')}${ic('bateria')}</span></div>`;
  const raiz = (t, modo, clases) => `class="m ${clases}" data-t="${t.id}" data-modo="${modo}"`;

  /* ---------- Panel del servidor ---------- */
  function panel(t, modo) {
    return `<figure ${raiz(t, modo, 'pnl')}>
      <aside class="nav">
        <div class="marca">${MARCAS[t.id]}</div>
        <nav aria-label="Secciones">
          <a class="it on">${ic('inicio')}<span>Inicio</span></a>
          <a class="it">${ic('dispositivos')}<span>Dispositivos</span><b class="n">3</b></a>
          <a class="it">${ic('wifi')}<span>Conexión</span></a>
          <a class="it">${ic('mitad')}<span>Apariencia</span></a>
          <a class="it">${ic('ajustes')}<span>Ajustes</span></a>
          <a class="it">${ic('diagnostico')}<span>Diagnóstico</span></a>
        </nav>
        <div class="nav-pie"><i class="luz ok"></i><span>Panel de NEXO · v1.1</span></div>
      </aside>
      <main class="cuerpo">
        <header class="cab">
          <div class="est"><i class="luz ok"></i><div><h1>NEXO está activo</h1><p>Desde las 06:58 · lleva 14 min</p></div></div>
          <div class="acc"><button class="btn" type="button">${ic('reiniciar')}Reiniciar</button><button class="btn mal" type="button">${ic('stop')}Detener</button></div>
        </header>
        <section class="conecta" aria-label="Conectar un celular">
          <div class="qrbox">${qr('nexo-' + t.id)}</div>
          <div class="pasos">
            <h2>Conecta tu celular</h2>
            <ol><li>Abre la cámara del celular.</li><li>Apunta al código y toca el aviso.</li><li>Verás «Mi PC» lista para entrar.</li></ol>
            <div class="via" role="group" aria-label="Tipo de enlace"><button class="on" type="button">${ic('nube')}Internet</button><button type="button">${ic('wifi')}Casa</button><button type="button">${ic('candado')}Casa segura</button></div>
            <div class="enlace"><code>https://cuatro-lagos-azules.trycloudflare.com/?token=••••••••</code><button class="btn pri" type="button">${ic('copiar')}Copiar</button></div>
          </div>
          <span class="lapiz">escanea esto</span>
        </section>
        <section class="esq" aria-label="Camino de la conexión">
          <div class="nodo"><b>Tu celular</b><small>Pixel de Letzus</small></div>
          <div class="enl"><span>Internet · túnel</span><i></i><em>38 ms</em></div>
          <div class="nodo fuerte"><b>NEXO</b><small>Mi PC · DESKTOP-SQMGFE5</small></div>
          <div class="enl casa"><span>Wi‑Fi de casa · HTTPS</span><i></i><em>3 ms</em></div>
        </section>
        <section class="datos" aria-label="Estado">
          <div class="dato">${ic('nube')}<div><small>Internet</small><b>Conectado</b><em>Túnel de Cloudflare · 38 ms</em></div></div>
          <div class="dato">${ic('wifi')}<div><small>Red de casa</small><b>Privada · segura</b><em>192.168.18.6 · HTTPS 8443</em></div></div>
          <div class="dato">${ic('monitor')}<div><small>Vídeo</small><b>1080p · 60 FPS</b><em>GPU NVIDIA · NVENC</em></div></div>
          <div class="dato">${ic('dispositivos')}<div><small>Dispositivos</small><b>1 conectado</b><em>3 emparejados</em></div></div>
        </section>
      </main>
    </figure>`;
  }

  /* ---------- Celular · entrar ---------- */
  function acceso(t, modo) {
    return `<div class="tel"><figure ${raiz(t, modo, 'pant')}>${SB}
      <div class="acc-p">
        <div class="logo">${MARCAS[t.id]}</div>
        <h2>Conecta con tu PC</h2>
        <p>Escribe el código que aparece en el panel de NEXO, en tu PC: <b>Dispositivos</b> y luego <b>Generar código</b>.</p>
        <div class="cod"><span>K</span><span>7</span><span>F</span><span>Q</span><i>–</i><span>2</span><span>M</span><span class="ac"></span><span></span></div>
        <span class="lapiz">lo ves en tu PC</span>
        <button class="btn pri grande" type="button">Emparejar</button>
        <button class="btn txt" type="button">${ic('portapapeles')}Pegar código</button>
        <p class="nota">El código vale 10 minutos y se usa una sola vez.</p>
      </div></figure></div>`;
  }

  function elegir(t, modo) {
    return `<div class="tel"><figure ${raiz(t, modo, 'pant')}>${SB}
      <div class="elegir">
        <div class="logo">${MARCAS[t.id]}</div>
        <h2>¿A dónde entramos?</h2>
        <button class="dest gran" type="button"><div class="mini"><svg viewBox="0 0 1600 900"><use href="#escritorio"/></svg></div>
          <div class="fila"><div><b>Mi PC</b><small>DESKTOP-SQMGFE5 · encendida</small></div><i class="luz ok"></i></div></button>
        <button class="dest" type="button">${ic('micro')}<div><b>Sólo micrófono</b><small>Usa la voz del celular en la PC. Gasta poca batería.</small></div></button>
        <div class="pie"><span>Este celular: «Pixel de Letzus»</span><span>Olvidar</span></div>
      </div></figure></div>`;
  }

  /* ---------- Celular · sesión (horizontal) ---------- */
  function sesionCel(t, modo, hoja) {
    const barra = `<nav class="bar" aria-label="Controles">
        <button class="t on" type="button">${ic('teclado')}<span>Teclado</span></button>
        <button class="t" type="button">${ic('mover')}<span>Mover</span></button>
        <button class="t" type="button">${ic('volumen')}<span>Sonido</span></button>
        <button class="t" type="button">${ic('micro')}<span>Micrófono</span></button>
        <button class="t ${hoja ? 'on' : ''}" type="button">${ic('mas')}<span>Más</span></button>
      </nav>`;
    const h = hoja ? `<div class="velo"></div><div class="hoja">
        <div class="asa"></div><h3>Más opciones</h3>
        <div class="rej">
          <button type="button">${ic('monitor')}Cambiar monitor</button><button type="button">${ic('rotar')}Rotar pantalla</button>
          <button type="button">${ic('ventana')}Ventana flotante</button><button type="button">${ic('portapapeles')}Portapapeles y archivos</button>
          <button type="button">${ic('expandir')}Pantalla completa</button><button type="button">${ic('info')}Diagnóstico</button>
          <button type="button">${ic('dispositivos')}Dispositivos</button><button type="button">${ic('salir')}Salir</button>
        </div>
        <div class="calidad" role="group" aria-label="Calidad"><button type="button">Ahorro · 30</button><button type="button">Equilibrada · 45</button><button class="on" type="button">Fluida · 60</button></div>
      </div>` : '';
    return `<div class="tel hor"><figure ${raiz(t, modo, 'pant')}><div class="isla"></div>
      <div class="ses">
        <div class="stage"><svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet"><use href="#escritorio"/></svg></div>
        <div class="hud"><span class="viv"><i class="luz ok"></i>En vivo</span><span class="met">58 FPS</span><span class="met">24 ms</span><span class="met">1080p</span><button class="mon" type="button">${ic('monitor')}Monitor 1</button></div>
        ${barra}${h}
      </div></figure></div>`;
  }

  /* ---------- PC · navegador con NEXO ---------- */
  function sesionPc(t, modo) {
    return `<figure ${raiz(t, modo, 'pcw')}>
      <div class="nav-b"><div class="pest"><i class="luz ok"></i>NEXO · Mi PC</div></div>
      <div class="url"><span>${ic('candado')}192.168.18.6:8443</span></div>
      <div class="ses">
        <div class="tbar">
          <div class="izq"><span class="marca-m">${MARCAS[t.id]}</span><span class="viv"><i class="luz ok"></i>En vivo</span><span class="met">58 FPS</span><span class="met">24 ms</span><span class="met">1080p</span></div>
          <div class="cen"><button class="on" type="button">${ic('monitor')}Monitor 1</button><button type="button">${ic('teclado')}Teclado</button><button type="button">${ic('volumen')}Sonido</button><button type="button">${ic('micro')}Micrófono</button><button type="button">${ic('portapapeles')}Portapapeles</button></div>
          <div class="der"><button type="button">${ic('calidad')}Fluida</button><button type="button" aria-label="Pantalla completa">${ic('expandir')}</button><button type="button" aria-label="Más">${ic('mas')}</button></div>
        </div>
        <div class="stage"><svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet"><use href="#escritorio"/></svg></div>
      </div></figure>`;
  }

  /* ---------- Elegir apariencia (panel del servidor) ---------- */
  function elegirApariencia() {
    const tarjeta = (t, sel) => `<button class="ap-t ${sel ? 'on' : ''}" type="button" data-id="${t.id}" aria-pressed="${sel}">
        <span class="ap-mini m" data-t="${t.id}" data-modo="${t.modo}"><i class="ap-b1"></i><i class="ap-b2"></i><i class="ap-b3"></i><i class="ap-bt"></i></span>
        <b>${t.nombre}</b><small>${DESCR[t.id]}</small></button>`;
    return `<figure class="m ap" data-t="nativa" data-modo="claro">
      <header><h2>Apariencia</h2><p>Elige cómo se ve NEXO en el celular y en la PC. Se puede cambiar cuando quieras; no hace falta reiniciar.</p></header>
      <div class="ap-grid">${TEMAS.map((t, i) => tarjeta(t, i === 2)).join('')}</div>
      <div class="ap-ajustes">
        <div class="ap-fila"><div><b>Quién elige</b><small>Si dejas que cada dispositivo elija, tu celular puede usar uno y la PC otro.</small></div>
          <div class="via" role="group"><button class="on" type="button">Todos igual</button><button type="button">Cada dispositivo</button></div></div>
        <div class="ap-fila"><div><b>Claro u oscuro</b><small>«Automático» sigue al sistema de cada dispositivo.</small></div>
          <div class="via" role="group"><button class="on" type="button">Automático</button><button type="button">Claro</button><button type="button">Oscuro</button></div></div>
      </div></figure>`;
  }

  const DESCR = {
    cabina: 'Instrumentos de cabina, ámbar sobre grafito.',
    nativa: 'Se parece a las apps del sistema.',
    reymuerto: 'Tu identidad: corona, bruma y oro viejo.',
    cianotipo: 'Plano técnico, tinta azul sobre papel.',
    bloque: 'Bloques de color, bordes gruesos, sin rodeos.',
  };

  window.NEXO_MOCK = { TEMAS, panel, acceso, elegir, sesionCel, sesionPc, elegirApariencia, DESCR };
})();
