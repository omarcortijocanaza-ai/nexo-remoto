#!/usr/bin/env node
'use strict';

// Genera assets/viego/fondo-niebla.webp: el wallpaper de Viego del dueño, reducido y ya difuminado.
// Una imagen pequeña y borrosa pesa ~10 KB y se pinta barata en un celular; aplicar `filter: blur()`
// sobre el 1920×1080 original costaría memoria y batería en cada fotograma. Sólo hace falta correrlo
// otra vez si cambia el wallpaper. Requiere ffmpeg en el PATH (o en NEXO_FFMPEG).
// Uso: node scripts/ui/generar-fondo-niebla.js

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..', '..');
const origen = path.join(raiz, 'assets', 'viego-wallpaper.jpg');
const destino = path.join(raiz, 'assets', 'viego', 'fondo-niebla.webp');
const ffmpeg = process.env.NEXO_FFMPEG || 'ffmpeg';

if (!fs.existsSync(origen)) {
  console.error('No existe ' + origen);
  process.exit(1);
}

// 480×270 es suficiente: detrás hay un desenfoque fuerte. Se oscurece un poco para que el texto
// encima conserve el contraste aunque la opacidad del fondo suba.
const filtros = 'scale=480:270:flags=lanczos,gblur=sigma=11:steps=3,eq=brightness=-0.10:saturation=1.05';
const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', origen, '-vf', filtros,
  '-c:v', 'libwebp', '-quality', '55', '-compression_level', '6', destino], { stdio: 'inherit' });
if (r.error || r.status !== 0) {
  console.error('ffmpeg falló' + (r.error ? ': ' + r.error.message : '') + '. ¿Está instalado y en el PATH?');
  process.exit(1);
}
console.log('assets/viego/fondo-niebla.webp ' + Math.round(fs.statSync(destino).size / 1024) + ' KB');
