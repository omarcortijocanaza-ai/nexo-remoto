'use strict';

// Apariencia del cliente web (celular y PC): qué tema y qué modo ve cada dispositivo.
//
// El archivo `<estado>\.nexo-apariencia.json` lo escribe el panel del servidor (Go) y lo lee
// este módulo en cada petición de página, con caché por fecha de modificación: cambiar el
// tema en el panel se nota al recargar la página, sin reiniciar NEXO.
//
//   { "tema": "reymuerto", "modo": "auto", "porDispositivo": false }
//
// Validación (la misma que hace el panel al guardar): `tema` ∈ TEMAS, `modo` ∈ MODOS y
// `porDispositivo` sólo es verdadero si el JSON trae exactamente `true`. Un archivo ausente,
// ilegible o que no sea un objeto da los valores por defecto; si sólo un campo es inválido,
// ese campo vuelve a su valor por defecto y los demás se respetan. Nunca lanza error: una
// apariencia rota no puede dejar sin cliente a quien quiere conectarse.

const fs = require('node:fs');
const path = require('node:path');

const ARCHIVO = '.nexo-apariencia.json';

const TEMAS = Object.freeze([
  { id: 'cabina', nombre: 'Cabina', descripcion: 'Instrumentos de cabina, ámbar sobre grafito.' },
  { id: 'nativa', nombre: 'Nativa', descripcion: 'Se parece a las apps del sistema.' },
  { id: 'reymuerto', nombre: 'Rey Muerto', descripcion: 'Viego, el Rey Arruinado: niebla, cadenas azules y espada carmesí.' },
  { id: 'cianotipo', nombre: 'Cianotipo', descripcion: 'Plano técnico, tinta azul sobre papel.' },
  { id: 'bloque', nombre: 'Bloque', descripcion: 'Bloques de color, bordes gruesos, sin rodeos.' }
]);
const IDS_TEMA = Object.freeze(TEMAS.map(t => t.id));
const MODOS = Object.freeze(['auto', 'claro', 'oscuro']);
const POR_DEFECTO = Object.freeze({ tema: 'reymuerto', modo: 'auto', porDispositivo: false });

// Color de fondo de cada tema y modo: lo usa la barra del navegador del celular
// (`theme-color`) y el manifiesto. Debe coincidir con `--bg` de `ui/temas/<id>.css`.
const COLOR_FONDO = Object.freeze({
  cabina: { claro: '#e5e1d4', oscuro: '#12110d' },
  nativa: { claro: '#f1f1f6', oscuro: '#161618' },
  reymuerto: { claro: '#ebe8f2', oscuro: '#0b0a14' },
  cianotipo: { claro: '#f1f4f1', oscuro: '#0d2a5c' },
  bloque: { claro: '#ffffff', oscuro: '#141414' }
});

// Fuentes que el primer pintado necesita de cada tema (se precargan con la página para
// que el título no salte de una tipografía a otra). Nativa usa las del sistema.
const PRECARGA_FUENTES = Object.freeze({
  cabina: ['BarlowCondensed-700.woff2', 'Barlow-400.woff2'],
  nativa: [],
  reymuerto: ['Cinzel-500-700.woff2', 'AtkinsonHyperlegible-400.woff2'],
  cianotipo: ['PublicSans-400-800.woff2'],
  bloque: ['BricolageGrotesque-400-800.woff2']
});

function normalizar(valor) {
  const origen = valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
  return {
    tema: IDS_TEMA.includes(origen.tema) ? origen.tema : POR_DEFECTO.tema,
    modo: MODOS.includes(origen.modo) ? origen.modo : POR_DEFECTO.modo,
    porDispositivo: origen.porDispositivo === true
  };
}

function rutaArchivo(stateDir) {
  return path.join(stateDir, ARCHIVO);
}

// Lector con caché: sólo vuelve a abrir el archivo si cambió su tamaño o su fecha.
function crearLector(stateDir) {
  const archivo = rutaArchivo(stateDir);
  let firma = null;
  let valor = normalizar(null);
  return {
    archivo,
    obtener() {
      let actual = 'ausente';
      try {
        const st = fs.statSync(archivo);
        actual = `${st.size}:${st.mtimeMs}`;
      } catch {}
      if (actual !== firma) {
        firma = actual;
        try {
          valor = normalizar(actual === 'ausente' ? null : JSON.parse(fs.readFileSync(archivo, 'utf8')));
        } catch {
          valor = normalizar(null);
        }
      }
      return { ...valor };
    }
  };
}

function colorDeFondo(apariencia) {
  const modo = apariencia.modo === 'claro' ? 'claro' : 'oscuro';
  return COLOR_FONDO[apariencia.tema][modo];
}

// Script mínimo que va dentro de <head>, antes del primer pintado: pone data-tema y
// data-modo (resolviendo «auto» con el esquema de color del dispositivo) y deja
// `window.__nexoAp` para que `ui/apariencia.js` cambie de tema sin recargar. Si el dueño
// permite elegir por dispositivo, lee la preferencia guardada en este navegador.
function scriptDeModo() {
  const fondos = JSON.stringify(COLOR_FONDO);
  const temas = JSON.stringify(IDS_TEMA);
  return `(function(){var d=document.documentElement,T=${temas},C=${fondos},tema=d.dataset.tema,pref=d.dataset.modoPref;`
    + `if(d.dataset.porDispositivo==='1'){try{var g=JSON.parse(localStorage.getItem('nexoApariencia')||'null');`
    + `if(g){if(T.indexOf(g.tema)>-1)tema=g.tema;if(g.modo==='auto'||g.modo==='claro'||g.modo==='oscuro')pref=g.modo}}catch(e){}}`
    + `var mq=matchMedia('(prefers-color-scheme: dark)');`
    + `function m(){var r=pref==='auto'?(mq.matches?'oscuro':'claro'):pref;d.dataset.tema=tema;d.dataset.modo=r;d.dataset.modoPref=pref;`
    + `var t=document.querySelector('meta[name=theme-color]');if(t&&C[tema])t.setAttribute('content',C[tema][r])}`
    + `m();if(mq.addEventListener)mq.addEventListener('change',m);else if(mq.addListener)mq.addListener(m);`
    + `window.__nexoAp={fijar:function(a,b){if(a&&T.indexOf(a)>-1)tema=a;if(b)pref=b;m()}}})();`;
}

const MARCADOR = '<!--NEXO:APARIENCIA-->';

// Devuelve la página con la apariencia aplicada: atributos en <html>, el script de modo, las
// fuentes, el CSS base y el CSS del tema (o de los cinco si cada dispositivo puede elegir).
// `version(ruta)` devuelve el valor de `?v=` de un archivo estático ('' si no existe).
function inyectar(html, apariencia, { version = () => '' } = {}) {
  const ap = normalizar(apariencia);
  const con = ruta => {
    const v = version(ruta);
    return v ? `${ruta}?v=${v}` : ruta;
  };
  const temasACargar = ap.porDispositivo ? IDS_TEMA : [ap.tema];
  const bloque = [
    `<script>${scriptDeModo()}</script>`,
    // Sin ?v=: el navegador sólo reutiliza la precarga si la URL es idéntica a la del @font-face de fuentes.css.
    ...PRECARGA_FUENTES[ap.tema].map(f => `<link rel="preload" as="font" type="font/woff2" crossorigin href="/assets/fuentes/${f}">`),
    `<link rel="stylesheet" href="${con('/assets/fuentes/fuentes.css')}">`,
    `<link rel="stylesheet" href="${con('/ui/cliente.css')}">`,
    ...temasACargar.map(id => `<link rel="stylesheet" data-tema-css="${id}" href="${con('/ui/temas/' + id + '.css')}">`),
    `<link rel="icon" type="image/svg+xml" href="${ap.tema === 'reymuerto' ? '/assets/viego/corona-pixel.svg' : con('/ui/icono.svg')}">`
  ].join('\n  ');
  const modoInicial = ap.modo === 'auto' ? 'oscuro' : ap.modo;
  const atributos = ` data-tema="${ap.tema}" data-modo="${modoInicial}" data-modo-pref="${ap.modo}"`
    + ` data-tema-srv="${ap.tema}" data-modo-srv="${ap.modo}" data-por-dispositivo="${ap.porDispositivo ? 1 : 0}"`;
  let salida = html.replace(/<html\b([^>]*)>/i, (_, resto) => `<html${resto}${atributos}>`);
  salida = salida.includes(MARCADOR)
    ? salida.replace(MARCADOR, bloque)
    : salida.replace(/<\/head>/i, `  ${bloque}\n</head>`);
  // Mientras el script no resuelve «auto», el color de la barra del navegador ya es el del tema.
  return salida.replace(/(<meta name="theme-color" content=")[^"]*(")/i, `$1${colorDeFondo(ap)}$2`);
}

module.exports = {
  ARCHIVO, TEMAS, IDS_TEMA, MODOS, POR_DEFECTO, COLOR_FONDO,
  normalizar, rutaArchivo, crearLector, colorDeFondo, inyectar
};
