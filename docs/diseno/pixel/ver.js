'use strict';

// Arma docs/diseno/pixel/ver.html: los tres dibujos ampliados sobre fondo oscuro y claro, para revisarlos a ojo
// (el panel los usa sobre los dos). Uso: node docs/diseno/pixel/ver.js
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', '..', '..', 'assets', 'viego');
const leer = nombre => fs.readFileSync(path.join(dir, nombre), 'utf8').replace(/ width="\d+" height="\d+"/, '');
const rey = leer('rey-pixel.svg'), corona = leer('corona-pixel.svg');
const img = (svg, ancho) => svg.replace('<svg ', `<svg style="width:${ancho}px;display:block;image-rendering:pixelated" `);
const uri = nombre => 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(dir, nombre)).toString('base64');
const panel = (fondo, color) => `<div style="background:${fondo};color:${color};padding:20px;display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap">
  <div>${img(rey, 64 * 5)}</div>
  <div style="display:flex;flex-direction:column;gap:18px">
    ${img(corona, 32 * 6)}
    <div style="width:${12 * 6 * 4}px;height:36px;background:url(${uri('cadena-pixel.svg')}) left center/auto 36px repeat-x;image-rendering:pixelated"></div>
    <div style="display:flex;gap:22px;align-items:flex-end">${img(rey, 64)}${img(rey, 128)}${img(corona, 64)}</div>
  </div></div>`;
const html = `<!doctype html><meta charset="utf-8"><title>Pixel art</title>
<body style="margin:0;font:14px system-ui">${panel('#0b0a14', '#ddd')}${panel('#ebe8f2', '#222')}</body>`;
fs.writeFileSync(path.join(__dirname, 'ver.html'), html);
console.log('ver.html listo');
