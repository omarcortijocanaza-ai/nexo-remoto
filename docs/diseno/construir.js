'use strict';

// Une los archivos de docs/diseno/fuentes/ en un solo HTML (docs/diseno/bosquejos.html) que se abre
// tal cual en el navegador y se publica como artefacto. Uso: node docs/diseno/construir.js
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, 'fuentes');
const leer = nombre => fs.readFileSync(path.join(dir, nombre), 'utf8').replace(/\r\n/g, '\n');

const fuentes = 'https://fonts.googleapis.com/css2?'
  + 'family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600'
  + '&family=Cinzel:wght@500;600;700&family=Atkinson+Hyperlegible:wght@400;700'
  + '&family=Public+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&family=Caveat:wght@600;700'
  + '&family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap';

const css = ['mock-base.css', 'tema-cabina.css', 'tema-nativa.css', 'tema-reymuerto.css', 'tema-cianotipo.css', 'tema-bloque.css', 'galeria.css'].map(leer).join('\n');
const js = ['mock.js', 'galeria.js'].map(leer).join('\n');

const html = `<title>Bosquejos de NEXO</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="${fuentes}">
<style>
${css}
</style>
${leer('sprite.svg.html')}
${leer('cuerpo.part.html')}
<script>
${js}
</script>
`;
fs.writeFileSync(path.join(__dirname, 'bosquejos.html'), html);
console.log(`bosquejos.html: ${Math.round(html.length / 1024)} KB`);
