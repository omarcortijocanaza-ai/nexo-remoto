'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MicrofonoVirtual, asegurarDispositivo, descargarDispositivo, NOMBRE_FUENTE, NOMBRE_SINK
} = require('../microfono-virtual-windows');

// Agente falso: imita `audio-devices` y `audio-play` de nexo-agent.exe.
const AGENTE_FALSO = `
const fs = require('fs');
const [,, sub, ...resto] = process.argv;
if (sub === 'audio-devices') {
  process.stdout.write(JSON.stringify({ outputs: JSON.parse(process.env.FALSO_SALIDAS || '[]'), inputs: [] }));
} else if (sub === 'audio-play') {
  fs.appendFileSync(process.env.FALSO_REGISTRO, 'ARGS ' + JSON.stringify(resto) + '\\n');
  if (process.env.FALSO_CODIGO) { console.error('No existe ningún dispositivo de salida'); process.exit(Number(process.env.FALSO_CODIGO)); }
  process.stdin.on('data', d => fs.appendFileSync(process.env.FALSO_REGISTRO, 'PCM ' + d.toString('hex') + '\\n'));
  process.stdin.on('end', () => process.exit(0));
}`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-mic-'));
const agente = path.join(dir, 'agente-falso.js');
const registro = path.join(dir, 'registro.txt');
fs.writeFileSync(agente, AGENTE_FALSO);
process.env.NEXO_AGENT_PATH = agente;
process.env.FALSO_REGISTRO = registro;
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const CON_CABLE = JSON.stringify([
  { name: 'Altavoces (Realtek)', default: true },
  { name: 'CABLE Input (VB-Audio Virtual Cable)', default: false }
]);
const SIN_CABLE = JSON.stringify([{ name: 'Altavoces (Realtek)', default: true }]);

function entorno({ salidas = CON_CABLE, codigo = '', dispositivo } = {}) {
  process.env.FALSO_SALIDAS = salidas;
  if (codigo) process.env.FALSO_CODIGO = codigo; else delete process.env.FALSO_CODIGO;
  if (dispositivo) process.env.NEXO_MIC_DEVICE = dispositivo; else delete process.env.NEXO_MIC_DEVICE;
  fs.writeFileSync(registro, '');
  // Vacía la caché de dispositivos del módulo.
  new MicrofonoVirtual().reiniciarFallos();
}

const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));
async function hasta(condicion, limite = 5000) {
  for (let t = 0; t < limite && !condicion(); t += 25) await esperar(25);
}
const lineas = () => fs.readFileSync(registro, 'utf8').split('\n').filter(Boolean);

test('exporta la misma API que la versión de Linux', () => {
  assert.equal(NOMBRE_SINK, 'CABLE Input');
  assert.equal(NOMBRE_FUENTE, 'CABLE Output');
  assert.equal(typeof descargarDispositivo, 'function');
  descargarDispositivo(); // no hace nada en Windows
  const mic = new MicrofonoVirtual();
  for (const metodo of ['asegurarProceso', 'escribir', 'reiniciarFallos', 'silenciar', 'detenerProceso', 'estado', 'cerrar']) {
    assert.equal(typeof mic[metodo], 'function', metodo);
  }
  assert.equal(mic.estado().descripcion, 'CABLE Output (micrófono del celular)');
});

test('asegurarDispositivo encuentra CABLE Input y falla con un mensaje claro si falta', () => {
  entorno({ salidas: CON_CABLE });
  assert.deepEqual(asegurarDispositivo(), { sink: 'CABLE Input', fuente: 'CABLE Output' });
  entorno({ salidas: SIN_CABLE });
  assert.throws(() => asegurarDispositivo(), /VB-CABLE no está instalado: instala VB-Audio Virtual Cable y reinicia/);
  // Con otro destino configurado el mensaje lo nombra.
  entorno({ salidas: SIN_CABLE, dispositivo: 'NoExiste' });
  assert.throws(() => asegurarDispositivo(), /«NoExiste»/);
});

test('escribir lanza audio-play con --match y entrega el PCM s16le tal cual', async () => {
  entorno();
  const mic = new MicrofonoVirtual();
  mic.escribir({ samples: new Int16Array([0, 1000, -1000, 32767]), sampleRate: 48000, channelCount: 1 });
  await hasta(() => lineas().some(l => l.startsWith('PCM ')));
  const argumentos = JSON.parse(lineas().find(l => l.startsWith('ARGS ')).slice(5));
  assert.deepEqual(argumentos, ['--match', 'CABLE Input', '--rate', '48000', '--channels', '1']);
  assert.equal(lineas().find(l => l.startsWith('PCM ')).slice(4), Buffer.from(new Int16Array([0, 1000, -1000, 32767]).buffer).toString('hex'));
  assert.ok(mic.estado().nivel > 0.9);
  assert.equal(mic.estado().activo, true);
  mic.cerrar();
  assert.equal(mic.estado().activo, false);
});

test('NUNCA se lanza audio-play sin --match (no hay camino al dispositivo por defecto)', async () => {
  entorno({ dispositivo: 'Voicemeeter VAIO3 Input', salidas: JSON.stringify([{ name: 'Voicemeeter VAIO3 Input (VB-Audio Voicemeeter VAIO)' }]) });
  const mic = new MicrofonoVirtual();
  mic.escribir({ samples: new Int16Array(480), sampleRate: 44100, channelCount: 2 });
  await hasta(() => lineas().some(l => l.startsWith('ARGS ')));
  const argumentos = JSON.parse(lineas().find(l => l.startsWith('ARGS ')).slice(5));
  assert.equal(argumentos[0], '--match');
  assert.equal(argumentos[1], 'Voicemeeter VAIO3 Input');
  assert.deepEqual(argumentos.slice(2), ['--rate', '44100', '--channels', '2']);
  mic.cerrar();
  // Un nombre vacío en la variable vuelve a «CABLE Input», jamás a «cualquiera».
  process.env.NEXO_MIC_DEVICE = '   ';
  entorno({ salidas: SIN_CABLE });
  assert.throws(() => new MicrofonoVirtual().comprobarDestino(), /VB-CABLE no está instalado/);
});

test('silenciar escribe ceros sin cortar el flujo', async () => {
  entorno();
  const mic = new MicrofonoVirtual();
  mic.escribir({ samples: new Int16Array([5000, 5000]), sampleRate: 48000, channelCount: 1 });
  mic.silenciar(true);
  mic.escribir({ samples: new Int16Array([5000, 5000]), sampleRate: 48000, channelCount: 1 });
  await hasta(() => lineas().filter(l => l.startsWith('PCM ')).length >= 1 && lineas().join('').includes('00000000'));
  assert.equal(mic.estado().nivel, 0);
  assert.equal(mic.estado().silenciado, true);
  assert.equal(mic.estado().activo, true);
  mic.cerrar();
});

test('código 3 del agente: error claro y bloqueo a la tercera; reiniciarFallos lo libera', async () => {
  entorno({ codigo: '3' });
  const avisos = [];
  const mic = new MicrofonoVirtual({ onLog: texto => avisos.push(texto) });
  const bloque = { samples: new Int16Array(480), sampleRate: 48000, channelCount: 1 };
  for (let intento = 1; intento <= 3; intento++) {
    mic.escribir(bloque);
    await hasta(() => mic.fallosDeEnlace >= intento);
  }
  assert.equal(mic.fallosDeEnlace, 3);
  assert.equal(mic.estado().bloqueado, true);
  assert.match(mic.estado().error, /VB-CABLE no está instalado/);
  assert.ok(avisos.some(texto => /VB-CABLE/.test(texto)));
  // Bloqueado: no lanza más procesos.
  const antes = lineas().length;
  mic.escribir(bloque);
  await esperar(150);
  assert.equal(lineas().length, antes);
  mic.reiniciarFallos();
  assert.equal(mic.estado().bloqueado, false);
  assert.equal(mic.estado().error, '');
});

test('sin VB-CABLE, escribir no inunda el registro (un aviso cada 10 s)', () => {
  entorno({ salidas: SIN_CABLE });
  const avisos = [];
  const mic = new MicrofonoVirtual({ onLog: texto => avisos.push(texto) });
  for (let i = 0; i < 200; i++) mic.escribir({ samples: new Int16Array(480), sampleRate: 48000, channelCount: 1 });
  assert.equal(avisos.length, 1);
  assert.match(mic.estado().error, /VB-CABLE/);
});

test('comprobarDestino lanza el error claro que verá el celular', () => {
  entorno({ salidas: SIN_CABLE });
  assert.throws(() => new MicrofonoVirtual().comprobarDestino(), /VB-CABLE no está instalado/);
  entorno({ salidas: CON_CABLE });
  assert.doesNotThrow(() => new MicrofonoVirtual().comprobarDestino());
});
