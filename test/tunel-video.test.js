'use strict';

// Vídeo GPU por el túnel: lector del flujo del puente, regulador de congestión y reenvío completo
// con un puente falso en 127.0.0.1 (sin tocar la red ni el escritorio).

const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter, once } = require('node:events');
const test = require('node:test');
const { crearLector, crearRegulador, servirTunel, LIMITE_PENDIENTE } = require('../lib/tunel-video');

function mensaje(clave, marca, datos) {
  const cuerpo = Buffer.concat([Buffer.from([clave ? 1 : 0]), Buffer.alloc(4), Buffer.from(datos)]);
  cuerpo.writeUInt32BE(marca, 1);
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(cuerpo.length);
  return Buffer.concat([largo, cuerpo]);
}

test('túnel: el lector separa mensajes aunque lleguen partidos o juntos', () => {
  const recibidos = [];
  const leer = crearLector(m => recibidos.push(m));
  const flujo = Buffer.concat([mensaje(true, 1, [0, 0, 0, 1, 0x67]), mensaje(false, 2, [9, 9, 9])]);
  for (const trozo of [flujo.subarray(0, 3), flujo.subarray(3, 11), flujo.subarray(11)]) leer(trozo);
  assert.equal(recibidos.length, 2);
  assert.equal(recibidos[0][0], 1);
  assert.equal(recibidos[0].readUInt32BE(1), 1);
  assert.deepEqual([...recibidos[1].subarray(5)], [9, 9, 9]);
  assert.throws(() => crearLector(() => {})(Buffer.from([0, 0, 0, 2, 1, 1])), /inválido/);
});

test('túnel: el regulador empieza en clave y, si el socket se atasca, descarta hasta el siguiente clave', () => {
  const r = crearRegulador({ limite: 1000 });
  assert.equal(r.decidir(false, 0), false); // delta sin referencia
  assert.equal(r.decidir(true, 0), true);
  assert.equal(r.decidir(false, 0), true);
  assert.equal(r.decidir(false, 5000), false); // atascado
  assert.equal(r.decidir(false, 0), false); // ya se desatascó, pero falta la referencia
  assert.equal(r.decidir(true, 0), true);
  assert.deepEqual(r.cuentas, { enviados: 3, descartados: 3 });
  assert.ok(LIMITE_PENDIENTE >= 128 * 1024 && LIMITE_PENDIENTE <= 1024 * 1024);
});

class SocketFalso extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.bufferedAmount = 0; this.enviados = []; }
  send(datos) { this.enviados.push(datos); }
}

test('túnel: reenvía el flujo del puente, contesta el eco y se reconecta si el puente se reinicia', async () => {
  let conexiones = 0;
  const puente = http.createServer((req, res) => {
    assert.equal(req.url, '/h264');
    conexiones++;
    res.writeHead(200);
    if (conexiones === 1) {
      res.write(mensaje(true, 10, [1, 2, 3]));
      res.write(mensaje(false, 11, [4]));
      setTimeout(() => res.destroy(), 50); // el puente se reinicia (cambio de FPS)
    } else {
      res.write(mensaje(true, 20, [5]));
    }
  });
  puente.listen(0, '127.0.0.1');
  await once(puente, 'listening');
  const socket = new SocketFalso();
  const cerrar = servirTunel(socket, { puertoPuente: puente.address().port });
  try {
    for (let i = 0; i < 100 && conexiones < 2; i++) await new Promise(r => setTimeout(r, 20));
    await new Promise(r => setTimeout(r, 100));
    const binarios = socket.enviados.filter(Buffer.isBuffer);
    assert.deepEqual(binarios.map(m => m.readUInt32BE(1)), [10, 11, 20]);
    assert.equal(conexiones, 2);
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'ping', t: 123 })), false);
    assert.deepEqual(JSON.parse(socket.enviados.at(-1)), { type: 'pong', t: 123 });
  } finally {
    cerrar();
    puente.closeAllConnections?.();
    puente.close();
  }
});
