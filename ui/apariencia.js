'use strict';

// Apariencia del cliente: lo que pasa DESPUÉS del primer pintado.
//
// Antes de pintar, un script mínimo que inyecta el servidor (lib/apariencia.js) ya puso `data-tema` y
// `data-modo` en <html>, de modo que no hay parpadeo. Aquí vive el resto:
//   - seguir lo que el dueño elige en el panel (se consulta `/apariencia` de vez en cuando, sin recargar);
//   - si el dueño dejó «Cada dispositivo» elegir, la sección «Apariencia» de la hoja «Más», que se
//     recuerda en `localStorage.nexoApariencia = {tema, modo}` de este navegador.
// En el modo demostración (?demo=1) se puede probar cualquier combinación con &tema=… y &modo=….

(function () {
  const d = document.documentElement;
  const BASE = [
    { id: 'cabina', nombre: 'Cabina', modo: 'oscuro' },
    { id: 'nativa', nombre: 'Nativa', modo: 'claro' },
    { id: 'reymuerto', nombre: 'Rey Muerto', modo: 'oscuro' },
    { id: 'cianotipo', nombre: 'Cianotipo', modo: 'claro' },
    { id: 'bloque', nombre: 'Bloque', modo: 'claro' }
  ];
  const MODOS = ['auto', 'claro', 'oscuro'];
  const params = new URLSearchParams(location.search);
  const demo = params.get('demo') === '1';
  const forzado = demo && (params.get('tema') || params.get('modo'));
  let temas = BASE;
  const servidor = { tema: d.dataset.temaSrv || 'reymuerto', modo: d.dataset.modoSrv || 'auto', porDispositivo: d.dataset.porDispositivo === '1' };
  const oyentes = new Set();

  const esTema = id => BASE.some(t => t.id === id);

  function guardado() {
    try {
      const g = JSON.parse(localStorage.getItem('nexoApariencia') || 'null');
      if (g && esTema(g.tema) && MODOS.includes(g.modo)) return g;
    } catch {}
    return null;
  }

  function actual() {
    return { tema: d.dataset.tema, modo: d.dataset.modoPref, porDispositivo: servidor.porDispositivo };
  }

  // El CSS de un tema que aún no está cargado se pide antes de cambiar el atributo, para que no se vea
  // la página a medio vestir. Con un límite de tiempo por si la red no contesta.
  function cargarCss(tema, listo) {
    if (document.querySelector(`link[data-tema-css="${tema}"]`)) return listo();
    const enlace = document.createElement('link');
    let terminado = false;
    const fin = () => { if (!terminado) { terminado = true; listo(); } };
    enlace.rel = 'stylesheet';
    enlace.dataset.temaCss = tema;
    enlace.href = `/ui/temas/${tema}.css`;
    enlace.onload = fin;
    enlace.onerror = fin;
    document.head.appendChild(enlace);
    setTimeout(fin, 3000);
  }

  function aplicar(tema, modo) {
    if (!esTema(tema) || !MODOS.includes(modo) || !window.__nexoAp) return;
    if (tema === d.dataset.tema && modo === d.dataset.modoPref) return;
    cargarCss(tema, () => {
      window.__nexoAp.fijar(tema, modo);
      pintar();
      oyentes.forEach(f => { try { f(actual()); } catch {} });
    });
  }

  // Elección de ESTE dispositivo (sólo cuando el dueño permite elegir por dispositivo).
  function elegir(cambios) {
    if (!servidor.porDispositivo && !demo) return false;
    const ahora = actual();
    const tema = cambios.tema || ahora.tema, modo = cambios.modo || ahora.modo;
    try { localStorage.setItem('nexoApariencia', JSON.stringify({ tema, modo })); } catch {}
    aplicar(tema, modo);
    return true;
  }

  // Un dispositivo sin emparejar recibe 403: se deja de preguntar hasta recargar, para no llenar la consola.
  let sinPermiso = false;
  async function sincronizar() {
    if (forzado || sinPermiso || (demo && params.get('sincronizar') !== '1') || document.visibilityState !== 'visible') return;
    if (document.querySelector('#pair-form:not([hidden])')) return;
    try {
      const respuesta = await fetch('/apariencia', { cache: 'no-store' });
      if (respuesta.status === 403) sinPermiso = true;
      if (!respuesta.ok) return;
      const datos = await respuesta.json();
      if (Array.isArray(datos.temas) && datos.temas.length) temas = datos.temas.map(t => ({ ...t, modo: (BASE.find(b => b.id === t.id) || {}).modo || 'claro' }));
      servidor.tema = datos.tema; servidor.modo = datos.modo; servidor.porDispositivo = datos.porDispositivo === true;
      d.dataset.porDispositivo = servidor.porDispositivo ? '1' : '0';
      d.dataset.temaSrv = datos.tema; d.dataset.modoSrv = datos.modo;
      // Con «Todos igual» manda el panel. Con «Cada dispositivo» manda lo que este navegador recordó,
      // y el tema del panel sólo es el valor inicial de quien aún no eligió.
      const preferida = servidor.porDispositivo ? guardado() : null;
      aplicar(preferida ? preferida.tema : datos.tema, preferida ? preferida.modo : datos.modo);
      pintar();
    } catch {}
  }

  // Sección «Apariencia de este dispositivo» de la hoja «Más».
  function pintar() {
    const bloque = document.getElementById('apariencia-bloque');
    if (!bloque) return;
    bloque.hidden = !(servidor.porDispositivo || (demo && params.get('apariencia') === '1'));
    const contenedor = document.getElementById('apariencia-temas'), modos = document.getElementById('apariencia-modos');
    if (!contenedor || !modos) return;
    if (contenedor.childElementCount !== temas.length) {
      contenedor.replaceChildren(...temas.map(t => {
        const boton = document.createElement('button');
        const muestra = document.createElement('span'), nombre = document.createElement('span');
        boton.type = 'button';
        boton.dataset.opTema = t.id;
        muestra.className = 'muestra';
        muestra.setAttribute('data-tema', t.id);
        muestra.setAttribute('data-modo', t.modo || 'claro');
        muestra.setAttribute('aria-hidden', 'true');
        muestra.innerHTML = '<i></i><i></i><i></i>';
        nombre.textContent = t.nombre;
        boton.append(muestra, nombre);
        boton.onclick = () => elegir({ tema: t.id });
        return boton;
      }));
      modos.querySelectorAll('[data-modo]').forEach(b => { b.onclick = () => elegir({ modo: b.dataset.modo }); });
    }
    const ahora = actual();
    contenedor.querySelectorAll('[data-op-tema]').forEach(b => {
      const on = b.dataset.opTema === ahora.tema;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    modos.querySelectorAll('[data-modo]').forEach(b => {
      const on = b.dataset.modo === ahora.modo;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  window.NexoApariencia = {
    get temas() { return temas; },
    actual,
    elegir,
    aplicar,
    alCambiar(f) { oyentes.add(f); return () => oyentes.delete(f); }
  };

  if (forzado) aplicar(params.get('tema') || d.dataset.tema, params.get('modo') || d.dataset.modoPref);
  pintar();
  setInterval(sincronizar, 20000);
  document.addEventListener('visibilitychange', sincronizar);
})();
