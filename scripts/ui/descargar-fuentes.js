'use strict';

// Descarga las fuentes de las apariencias de NEXO desde Google Fonts (todas con licencia SIL OFL 1.1) y las guarda
// en assets/fuentes/ junto con un fuentes.css listo para usar. Así el cliente y el panel se ven igual sin Internet
// y el celular no pide nada a Google. Sólo el subconjunto «latin» (cubre el español: ñ, acentos, ¿ ¡).
//
// Uso (una vez, o al cambiar la lista):  node scripts/ui/descargar-fuentes.js

const fs = require('node:fs');
const path = require('node:path');

const DESTINO = path.join(__dirname, '..', '..', 'assets', 'fuentes');
// Un navegador moderno hace que Google responda con WOFF2.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// [nombre de archivo base, consulta de Google Fonts]
const FAMILIAS = [
  ['BarlowCondensed', 'Barlow+Condensed:wght@500;600;700'],
  ['Barlow', 'Barlow:wght@400;500;600'],
  ['JetBrainsMono', 'JetBrains+Mono:wght@400..600'],
  ['Cinzel', 'Cinzel:wght@500..700'],
  ['AtkinsonHyperlegible', 'Atkinson+Hyperlegible:wght@400;700'],
  ['PublicSans', 'Public+Sans:wght@400..800'],
  ['DMMono', 'DM+Mono:wght@400;500'],
  ['Caveat', 'Caveat:wght@600..700'],
  ['BricolageGrotesque', 'Bricolage+Grotesque:opsz,wght@12..96,400..800'],
];

async function texto(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

(async () => {
  fs.mkdirSync(DESTINO, { recursive: true });
  let css = '/* Generado por scripts/ui/descargar-fuentes.js. Fuentes de Google Fonts, licencia SIL OFL 1.1 (ver LEEME.md). */\n';
  let total = 0;
  for (const [base, consulta] of FAMILIAS) {
    const hoja = await texto(`https://fonts.googleapis.com/css2?family=${consulta}&display=swap`);
    // La hoja trae un bloque por subconjunto, precedido de /* latin */, /* latin-ext */…; sólo interesa «latin».
    const bloques = [...hoja.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)];
    const latinos = bloques.filter(b => b[1] === 'latin');
    if (!latinos.length) throw new Error(`${base}: sin bloque latin`);
    for (const [, , bloque] of latinos) {
      const familia = /font-family:\s*'([^']+)'/.exec(bloque)[1];
      const peso = /font-weight:\s*([^;]+);/.exec(bloque)[1].trim();
      const estilo = /font-style:\s*([^;]+);/.exec(bloque)[1].trim();
      const url = /url\((https:[^)]+\.woff2)\)/.exec(bloque)[1];
      const archivo = `${base}-${peso.replace(/\s+/g, '-')}${estilo === 'italic' ? 'i' : ''}.woff2`;
      const datos = Buffer.from(await (await fetch(url, { headers: { 'user-agent': UA } })).arrayBuffer());
      fs.writeFileSync(path.join(DESTINO, archivo), datos);
      total += datos.length;
      const ajusteOpsz = /font-optical-sizing/.test(bloque) ? '' : '';
      css += `@font-face { font-family: '${familia}'; font-style: ${estilo}; font-weight: ${peso}; font-display: swap; src: url('./${archivo}') format('woff2'); }${ajusteOpsz}\n`;
      console.log(`${archivo}  ${(datos.length / 1024).toFixed(1)} KB`);
    }
  }
  fs.writeFileSync(path.join(DESTINO, 'fuentes.css'), css);
  console.log(`\nTotal: ${(total / 1024 / 1024).toFixed(2)} MB en ${DESTINO}`);
})().catch(error => { console.error(error.message); process.exit(1); });
