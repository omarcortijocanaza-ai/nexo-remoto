'use strict';

// Calidad automática del cliente (ui/calidad-auto.js) y perfil GPU del servidor (lib/perfil-gpu.js).

const assert = require('node:assert/strict');
const test = require('node:test');
const C = require('../ui/calidad-auto');
const { ESCALERA_KBPS, validarPerfil, leerPerfil, mismoPerfil } = require('../lib/perfil-gpu');
const ffmpeg = require('../platform/windows/ffmpeg');

test('calidad: cliente, servidor y codificador usan la misma escalera de bitrate', () => {
  assert.deepEqual(C.ESCALERA, [...ESCALERA_KBPS]);
  assert.deepEqual(ffmpeg.ESCALERA_KBPS, ESCALERA_KBPS);
  for (const techo of C.TECHOS) assert.ok(ESCALERA_KBPS.includes(techo));
});

test('calidad: la red se clasifica por la dirección con la que se entró', () => {
  for (const h of ['localhost', '127.0.0.1', '192.168.18.6', '10.0.0.5', '172.20.1.1', '169.254.3.3', 'pc.local', '[::1]']) assert.equal(C.clasificarRed(h), 'lan', h);
  for (const h of ['flow-fare-troy-subject.trycloudflare.com', 'nexo.nexussoftware.pe', '172.32.0.1', '8.8.8.8', '']) assert.equal(C.clasificarRed(h), 'remoto', h);
});

test('calidad: perfil inicial prudente por Internet y el techo elegido en la LAN', () => {
  assert.deepEqual(C.perfilInicial('lan', null), { fps: 45, height: 1080, kbps: 10000 });
  assert.deepEqual(C.perfilInicial('remoto', null), { fps: 30, height: 1080, kbps: 4000 });
  assert.deepEqual(C.perfilInicial('remoto', { fps: 60, height: 900, techo: 2500 }), { fps: 60, height: 900, kbps: 2500 });
  assert.deepEqual(C.normalizarPreferencia({ fps: 50, height: 1000, techo: 7000 }, 'lan'), C.preferenciaPorDefecto('lan'));
});

test('calidad: baja primero el bitrate, luego la altura y al final los FPS', () => {
  let p = { fps: 45, height: 1080, kbps: 2500 };
  p = C.bajar(p); assert.deepEqual(p, { fps: 45, height: 1080, kbps: 1500 });
  p = C.bajar(p); assert.deepEqual(p, { fps: 45, height: 900, kbps: 1500 });
  p = C.bajar(p); assert.deepEqual(p, { fps: 45, height: 720, kbps: 1500 });
  p = C.bajar(p); assert.deepEqual(p, { fps: 30, height: 720, kbps: 1500 });
  assert.equal(C.bajar(p), null);
});

test('calidad: sube primero la imagen elegida y luego los bits, sin pasar del techo', () => {
  const pref = { fps: 45, height: 1080, techo: 6000 };
  let p = { fps: 30, height: 720, kbps: 1500 };
  const pasos = [];
  while ((p = C.subir(p, pref))) pasos.push(`${p.height}/${p.fps}/${p.kbps}`);
  assert.deepEqual(pasos, ['900/30/1500', '1080/30/1500', '1080/45/1500', '1080/45/2500', '1080/45/4000', '1080/45/6000']);
});

function adaptador() {
  let reloj = 0;
  const a = C.crearAdaptador({ ahora: () => reloj });
  let perdidos = 0, recibidos = 0;
  return {
    // Una muestra cada 2,5 s con `nuevosPerdidos` de cada 1000 paquetes.
    muestra(nuevosPerdidos, actual, pref, { rttMs = 40, jitterMs = 5 } = {}) {
      reloj += 2500; perdidos += nuevosPerdidos; recibidos += 1000 - nuevosPerdidos;
      return a.muestra({ perdidos, recibidos, rttMs, jitterMs }, actual, pref);
    }
  };
}

test('calidad: dos muestras con pérdida de ventana > 3 % bajan un peldaño, y no hay otro cambio en 20 s', () => {
  const a = adaptador(), pref = { fps: 30, height: 1080, techo: 6000 };
  let actual = { fps: 30, height: 1080, kbps: 4000 };
  a.muestra(0, actual, pref);
  assert.equal(a.muestra(60, actual, pref).perfil, null);
  const r = a.muestra(60, actual, pref);
  assert.deepEqual(r.perfil, { fps: 30, height: 1080, kbps: 2500 });
  actual = r.perfil;
  for (let i = 0; i < 7; i++) assert.equal(a.muestra(60, actual, pref).perfil, null, `muestra ${i} dentro de los 20 s`);
  assert.deepEqual(a.muestra(60, actual, pref).perfil, { fps: 30, height: 1080, kbps: 1500 });
});

test('calidad: la pérdida antigua no impide subir (se mide por ventana, no acumulada)', () => {
  const a = adaptador(), pref = { fps: 30, height: 1080, techo: 6000 }, actual = { fps: 30, height: 1080, kbps: 2500 };
  a.muestra(0, actual, pref);
  for (let i = 0; i < 5; i++) a.muestra(200, actual, pref); // un mal rato al principio
  let decidido = null;
  for (let i = 0; i < 30 && !decidido; i++) decidido = a.muestra(0, actual, pref).perfil;
  assert.deepEqual(decidido, { fps: 30, height: 1080, kbps: 4000 });
});

test('calidad: RTT o jitter altos también cuentan como congestión; sin paquetes nuevos no se decide', () => {
  const a = adaptador(), pref = { fps: 30, height: 1080, techo: 6000 }, actual = { fps: 30, height: 1080, kbps: 4000 };
  a.muestra(0, actual, pref);
  a.muestra(0, actual, pref, { rttMs: 450 });
  assert.deepEqual(a.muestra(0, actual, pref, { rttMs: 450 }).perfil, { fps: 30, height: 1080, kbps: 2500 });
  const b = C.crearAdaptador({ ahora: () => 1e9 });
  assert.equal(b.muestra({ perdidos: 0, recibidos: 10 }, actual, pref).perdida, null);
  assert.equal(b.muestra({ perdidos: 0, recibidos: 10 }, actual, pref).perdida, null);
});

test('calidad: lo elegido a mano recorta el perfil actual', () => {
  assert.deepEqual(C.ajustarAPreferencia({ fps: 60, height: 1080, kbps: 10000 }, { fps: 30, height: 900, techo: 2500 }), { fps: 30, height: 900, kbps: 2500 });
  assert.deepEqual(C.ajustarAPreferencia({ fps: 30, height: 720, kbps: 777 }, { fps: 45, height: 1080, techo: 6000 }), { fps: 30, height: 720, kbps: 6000 });
});

test('perfil GPU: kbps opcional y sólo de la escalera', () => {
  assert.deepEqual(validarPerfil({ fps: 45, height: 1080 }), { fps: 45, height: 1080 });
  assert.deepEqual(validarPerfil({ fps: '30', height: '720', kbps: '2500' }), { fps: 30, height: 720, kbps: 2500 });
  assert.throws(() => validarPerfil({ fps: 45, height: 1080, kbps: 3000 }), /Bitrate/);
  assert.throws(() => validarPerfil({ fps: 50, height: 1080 }), /Perfil/);
  assert.equal(leerPerfil({ fps: 45 }), null);
  assert.equal(mismoPerfil({ fps: 45, height: 1080 }, { fps: 45, height: 1080, kbps: 10000 }), false);
  assert.equal(mismoPerfil({ fps: 45, height: 1080, kbps: 4000 }, { fps: 45, height: 1080, kbps: 4000 }), true);
});
