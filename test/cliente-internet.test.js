'use strict';

// Comprobaciones del cliente web para el uso por Internet (plan «Internet», fase I1).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

test('internet: ninguna conexión WebRTC usa un STUN fijo; todas piden la configuración con TURN', () => {
  // El vídeo GPU creaba su RTCPeerConnection con un STUN literal y nunca usaba el TURN configurado.
  assert.equal(/new RTCPeerConnection\(\{\s*iceServers\s*:\s*\[/.test(html), false);
  const conexiones = html.match(/new RTCPeerConnection\([^)]*\)/g) || [];
  assert.ok(conexiones.length >= 2, 'se esperaban las conexiones CPU y GPU');
  for (const conexion of conexiones) assert.match(conexion, /configuracionRtc\(\)/);
  // El único STUN literal es el de reserva dentro de iceServers().
  const literales = html.match(/stun:stun\.cloudflare\.com:3478/g) || [];
  assert.equal(literales.length, 1);
  const reserva = html.slice(html.indexOf('async function iceServers('));
  assert.ok(reserva.indexOf('stun:stun.cloudflare.com:3478') < reserva.indexOf('\n'));
});

test('internet: ?ice=relay obliga a usar el TURN en ambas conexiones', () => {
  assert.match(html, /ICE_RELAY=PARAMS\.get\('ice'\)==='relay'/);
  assert.match(html, /if\(ICE_RELAY\)config\.iceTransportPolicy='relay'/);
});

test('internet: el cliente carga ui/calidad-auto.js y el servidor lo sirve', () => {
  assert.match(html, /<script src="\/ui\/calidad-auto\.js"><\/script>/);
  assert.ok(html.indexOf('/ui/calidad-auto.js') < html.indexOf('NexoCalidad.clasificarRed'));
  const estaticos = fs.readFileSync(path.join(__dirname, '../lib/estaticos.js'), 'utf8');
  assert.match(estaticos, /calidad-auto\\.js/);
});

test('internet: el perfil se envía con kbps, también al empezar el vídeo GPU', () => {
  assert.match(html, /post\('\/gpu-profile',\{fps:qualityFps,height:resolutionHeight,kbps:kbpsActual\}\)/);
  assert.match(html, /gpuActive=true;enviarPerfil\(\);/);
  // Ya no quedan envíos de perfil sin bitrate.
  assert.equal((html.match(/post\('\/gpu-profile'/g) || []).length, 1);
  assert.equal(html.includes('applyAdaptiveProfile'), false);
});

test('internet: el diagnóstico lleva la ruta ICE y el perfil pedido', () => {
  assert.match(html, /ruta,altura:resolutionHeight,kbpsPedido:kbpsActual/);
  assert.match(html, /candidateType\}→\$\{remoto\.candidateType\}/);
});

test('internet: aviso de respaldo sólo por Internet, una vez y descartable', () => {
  assert.match(html, /id="fallback-banner" role="status" hidden/);
  assert.match(html, /function vigilarRespaldo\(\)\{if\(DEMO\|\|RED!=='remoto'\|\|avisoRespaldoVisto/);
  assert.match(html, /id="fallback-banner-close"/);
});

test('internet: selector «Uso de datos» con los techos de la escalera', () => {
  const C = require('../ui/calidad-auto');
  const techos = [...html.matchAll(/data-kbps="(\d+)"/g)].map(m => Number(m[1]));
  assert.deepEqual(techos, C.TECHOS);
});
