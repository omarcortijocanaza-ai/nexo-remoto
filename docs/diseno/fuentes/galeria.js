/* Galería: pestañas, modo claro/oscuro de los bosquejos y ajuste de tamaño de cada pantalla. */
(() => {
  'use strict';
  const M = window.NEXO_MOCK;

  const FICHAS = {
    cabina: {
      lema: 'Un panel de instrumentos: lo importante se lee de un vistazo, con números reales y luces de estado.',
      para: 'Quien quiere ver cuántos FPS y cuántos milisegundos hay, sin adornos.',
      siente: 'Preciso, denso y sobrio. Ámbar sobre grafito, como los indicadores de una cabina.',
      tipo: 'Barlow Condensed para rótulos · JetBrains Mono para las cifras',
      uso: 'Carril de iconos a la izquierda, franja de lecturas arriba y teclas con rótulo abajo.',
      paleta: ['#12110d', '#27231a', '#efe8d6', '#f2a93b', '#93d27b'],
    },
    nativa: {
      lema: 'Se parece a lo que ya conoces: listas agrupadas, títulos grandes y controles del sistema.',
      para: 'Quien no quiere aprender nada nuevo, ni tú ni quien te pida prestado el control.',
      siente: 'Tranquilo y familiar. Windows 11 en la PC, iOS y Android en el celular.',
      tipo: 'La fuente del sistema de cada dispositivo (Segoe UI, SF Pro, Roboto)',
      uso: 'Barra flotante con icono y nombre, hoja inferior para «Más» y estados como lista.',
      paleta: ['#f1f1f6', '#ffffff', '#0c0c10', '#0a68f5', '#1fa64f'],
    },
    reymuerto: {
      lema: 'Tu identidad, sin el neón: verde casi negro, hueso y oro viejo; la corona como marca.',
      para: 'Tú. Conserva Letzus / Rex Mortis y deja de verse como una plantilla.',
      siente: 'Sobrio y con carácter. El estado de NEXO entra por un sello grande, no por una barra.',
      tipo: 'Cinzel para títulos y marca · Atkinson Hyperlegible para todo lo demás',
      uso: 'Pestañas de texto arriba, «dock» de sólo iconos en la sesión (el activo muestra su nombre).',
      paleta: ['#0a0f0e', '#172623', '#e9e4d2', '#5cc8a8', '#c9a24b'],
    },
    cianotipo: {
      lema: 'Un plano técnico: papel con rejilla, tinta azul y notas a lápiz. Enseña el camino de la conexión.',
      para: 'Quien quiere entender qué pasa: celular → Internet o Wi-Fi → tu PC, con sus milisegundos.',
      siente: 'Artesanal y claro. En oscuro es el cianotipo de verdad: fondo azul, líneas blancas.',
      tipo: 'Public Sans · DM Mono para datos · Caveat sólo para las anotaciones',
      uso: 'Índice a la izquierda, esquema de conexión en el panel y regla de herramientas a la derecha en el celular.',
      paleta: ['#f1f4f1', '#e3eaf3', '#0f2a5e', '#123f9b', '#cf3a2d'],
    },
    bloque: {
      lema: 'Bloques de color, bordes gruesos y letras grandes: cada cosa es un botón que se acierta con el pulgar.',
      para: 'Quien usa NEXO en movimiento, con una mano, o prefiere algo con personalidad.',
      siente: 'Directo y alegre. Sin degradados ni brillos; el color separa lo que hace cada cosa.',
      tipo: 'Bricolage Grotesque en pesos 700–800',
      uso: 'Cuatro botones grandes de colores abajo y una pegatina de estado arriba.',
      paleta: ['#ffffff', '#ffd60a', '#0b0b0b', '#3d5afe', '#19c37d'],
    },
  };

  const FILAS = [
    { t: 'Panel del servidor', s: 'en la PC · lo primero es conectar el celular', clave: 'panel' },
    { t: 'Celular · entrar', s: 'primera vez, y cada día después', clave: 'entrar' },
    { t: 'Celular · en sesión', s: 'horizontal, con la hoja «Más» abierta a la derecha', clave: 'celular' },
    { t: 'PC · en sesión', s: 'el mismo cliente, abierto en un navegador de escritorio', clave: 'pc' },
  ];

  let modo = 'original'; // original | claro | oscuro
  let activa = (location.hash || '#cabina').slice(1);
  const raiz = document.getElementById('g-temas');

  const marco = (html, w, h, max) => `<div class="g-marco" data-w="${w}" data-h="${h}" data-max="${max}">${html}</div>`;

  function modoDe(t) { return modo === 'original' ? t.modo : modo; }

  function seccion(t) {
    const f = FICHAS[t.id];
    const m = modoDe(t);
    const fila = (clave) => {
      switch (clave) {
        case 'panel': return marco(M.panel(t, m), 1040, 680, 1);
        case 'entrar': return marco(M.acceso(t, m), 412, 802, 0.62) + marco(M.elegir(t, m), 412, 802, 0.62);
        case 'celular': return marco(M.sesionCel(t, m, false), 802, 412, 0.7) + marco(M.sesionCel(t, m, true), 802, 412, 0.7);
        default: return marco(M.sesionPc(t, m), 1120, 640, 1);
      }
    };
    return `<section class="g-tema" id="tema-${t.id}" ${t.id === activa ? '' : 'hidden'}>
      <h2>${t.nombre}</h2><p class="g-lema">${f.lema}</p>
      <div class="g-ficha">
        <div><b>Para quién</b><span>${f.para}</span></div><div><b>Se siente</b><span>${f.siente}</span></div>
        <div><b>Tipografía</b><span>${f.tipo}</span></div><div><b>Cómo se usa</b><span>${f.uso}</span></div>
        <div><b>Paleta</b><div class="g-paleta">${f.paleta.map((c) => `<i style="background:${c}"></i>`).join('')}</div></div>
      </div>
      ${FILAS.map((x) => `<h3 class="g-fila-t">${x.t}<small>${x.s}</small></h3><div class="g-fila" data-fila="${x.clave}">${fila(x.clave)}</div>`).join('')}
    </section>`;
  }

  function apariencia() {
    return `<section class="g-tema" id="tema-apariencia" ${activa === 'apariencia' ? '' : 'hidden'}>
      <h2>Elegir la apariencia</h2>
      <p class="g-lema">Si te gustan varios, no hace falta decidir: el panel del servidor deja elegir cuál ven los dispositivos. Así se vería esa pantalla (aquí con «Rey Muerto» elegido).</p>
      <div class="g-fila" data-fila="ap">${marco(M.elegirApariencia(), 800, 560, 1)}</div>
      <div class="g-como">
        <article><h3>Qué es un tema</h3><p>Un archivo de estilos con los colores, las fuentes y la forma de los botones. La estructura de las pantallas es la misma para todos, así que agregar un tema nuevo no toca el programa.</p></article>
        <article><h3>Dónde se elige</h3><p>En el panel, sección Apariencia. El servidor guarda la elección y el cliente la aplica al abrir; no hay que reiniciar NEXO.</p></article>
        <article><h3>Quién elige</h3><p>«Todos igual» usa el tema del servidor en cada dispositivo. «Cada dispositivo» deja que el celular recuerde el suyo y la PC otro. Claro, oscuro o automático se decide aparte.</p></article>
      </div>
    </section>`;
  }

  function pintar() {
    raiz.innerHTML = M.TEMAS.map(seccion).join('') + apariencia();
    ajustar();
    for (const b of document.querySelectorAll('.g-tabs button')) b.setAttribute('aria-selected', String(b.dataset.id === activa));
  }

  function ajustar() {
    for (const m of document.querySelectorAll('.g-marco')) {
      const fila = m.parentElement;
      if (!fila || fila.closest('[hidden]')) continue;
      // Tamaño natural medido (offsetWidth/Height no cuentan la transformación): no hay que adivinar la altura.
      const w = m.firstElementChild.offsetWidth, h = m.firstElementChild.offsetHeight, max = Number(m.dataset.max);
      const hermanos = fila.querySelectorAll('.g-marco').length;
      const disp = (fila.clientWidth - 22 * (hermanos - 1)) / hermanos;
      const esc = Math.max(0.46, Math.min(max, disp / w));
      m.style.width = Math.round(w * esc) + 'px';
      m.style.height = Math.round(h * esc) + 'px';
      m.firstElementChild.style.transform = `scale(${esc})`;
    }
  }

  function elegir(id) {
    activa = id;
    history.replaceState(null, '', '#' + id);
    for (const s of document.querySelectorAll('.g-tema')) s.hidden = s.id !== 'tema-' + id;
    for (const b of document.querySelectorAll('.g-tabs button')) b.setAttribute('aria-selected', String(b.dataset.id === id));
    ajustar();
    window.scrollTo({ top: document.querySelector('.g-barra').offsetTop - 4 });
  }

  document.querySelector('.g-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) elegir(b.dataset.id); });
  document.querySelector('.g-modo').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    modo = b.dataset.modo;
    for (const x of document.querySelectorAll('.g-modo button')) x.setAttribute('aria-pressed', String(x === b));
    pintar();
  });
  window.addEventListener('resize', ajustar);
  if (!M.TEMAS.some((t) => t.id === activa) && activa !== 'apariencia') activa = 'cabina';
  pintar();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(ajustar);
})();
