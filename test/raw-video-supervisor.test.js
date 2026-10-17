'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const test = require('node:test');

const { FrameAligner, rawVideoArgs, superviseRawVideo } = require('../platform/windows/ffmpeg');
const { agentCommand } = require('../platform/windows/agent-client');

// ffmpeg falso: escribe `bytes` bytes y se queda vivo (o sale) según el guion.
function ffmpegFalso(script) {
  return () => spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function recoger(stream) {
  const cuadros = [];
  stream.on('data', frame => cuadros.push(frame));
  return cuadros;
}

const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

test('rawVideoArgs sigue la cadena de vídeo CPU de la sección 4.5', () => {
  const args = rawVideoArgs({ index: 1, fps: 30, width: 1280, height: 720 });
  assert.deepEqual(args.slice(0, 4), ['-hide_banner', '-loglevel', 'error', '-nostdin']);
  assert.equal(args[args.indexOf('-i') + 1], 'ddagrab=output_idx=1:framerate=30:draw_mouse=1,hwdownload,format=bgra');
  assert.equal(args[args.indexOf('-vf') + 1], 'scale=1280:720:flags=fast_bilinear,format=yuv420p');
  assert.deepEqual(args.slice(-3), ['-f', 'rawvideo', 'pipe:1']);
  // Dimensiones impares se redondean a pares: webrtc-host espera ancho*alto*3/2.
  const impares = rawVideoArgs({ width: 1281, height: 721 });
  assert.equal(impares[impares.indexOf('-vf') + 1], 'scale=1282:722:flags=fast_bilinear,format=yuv420p');
});

test('FrameAligner sólo emite cuadros completos aunque los trozos lleguen partidos', async () => {
  const aligner = new FrameAligner(10);
  const cuadros = recoger(aligner);
  aligner.write(Buffer.alloc(4, 1));
  aligner.write(Buffer.alloc(9, 2)); // 13 bytes: completa 1 cuadro, sobran 3
  aligner.write(Buffer.alloc(7, 3)); // 10 bytes: completa el 2.º
  aligner.end();
  await esperar(20);
  assert.equal(cuadros.length, 2);
  assert.ok(cuadros.every(frame => frame.length === 10));
});

test('el supervisor reagrupa por ejecución: un ffmpeg que muere a mitad de cuadro no desfasa al siguiente', async () => {
  // Cada ejecución escribe 1,5 cuadros de 100 bytes y muere. Sin reagrupar,
  // el cuadro 2 mezclaría la mitad de la ejecución 1 con la mitad de la 2.
  const { child, stream } = superviseRawVideo({
    ffmpegBin: 'falso',
    args: [],
    frameBytes: 100,
    minBackoffMs: 20,
    maxBackoffMs: 40,
    spawnFn: ffmpegFalso("process.stdout.write(Buffer.alloc(150, 7)); setTimeout(() => process.exit(1), 30);")
  });
  const cuadros = recoger(stream);
  // Arrancar node cuesta cientos de ms con la suite en paralelo: se espera por
  // el resultado, no por un tiempo fijo.
  for (let intento = 0; intento < 100 && cuadros.length < 3; intento++) await esperar(50);
  child.kill();
  assert.ok(cuadros.length >= 3, `llegaron ${cuadros.length} cuadros`);
  assert.ok(cuadros.every(frame => frame.length === 100 && frame.every(byte => byte === 7)));
});

test('en escritorio seguro no se lanza ffmpeg y vuelve solo al pasar a normal', async () => {
  let seguro = true;
  let lanzamientos = 0;
  const bus = new EventEmitter();
  const { child, stream } = superviseRawVideo({
    ffmpegBin: 'falso',
    args: [],
    frameBytes: 50,
    isSecure: () => seguro,
    onSecureChange: handler => { bus.on('desktop-state', handler); return () => bus.off('desktop-state', handler); },
    spawnFn: () => {
      lanzamientos++;
      return spawn(process.execPath, ['-e', 'process.stdout.write(Buffer.alloc(50, 9)); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'pipe'] });
    }
  });
  const cuadros = recoger(stream);
  await esperar(150);
  assert.equal(lanzamientos, 0);
  seguro = false;
  bus.emit('desktop-state', 'normal');
  for (let intento = 0; intento < 100 && cuadros.length < 1; intento++) await esperar(50);
  assert.equal(lanzamientos, 1);
  assert.equal(cuadros.length, 1);
  // Al volver a secure se corta el ffmpeg vivo y no se relanza.
  seguro = true;
  bus.emit('desktop-state', 'secure');
  await esperar(1300);
  assert.equal(lanzamientos, 1);
  child.kill();
});

test('el supervisor espera 1 s → 2 s → tope y no relanza tras kill()', async () => {
  const instantes = [];
  const { child } = superviseRawVideo({
    ffmpegBin: 'falso',
    args: [],
    frameBytes: 10,
    minBackoffMs: 40,
    maxBackoffMs: 100,
    spawnFn: () => {
      instantes.push(Date.now());
      return spawn(process.execPath, ['-e', 'process.exit(1)'], { stdio: ['ignore', 'pipe', 'pipe'] });
    }
  });
  for (let intento = 0; intento < 200 && instantes.length < 4; intento++) await esperar(50);
  const cerrado = new Promise(resolve => child.once('close', resolve));
  child.kill();
  await cerrado;
  const lanzados = instantes.length;
  assert.ok(lanzados >= 4, `lanzamientos: ${lanzados}`);
  const huecos = instantes.slice(1).map((t, n) => t - instantes[n]);
  assert.ok(huecos[1] >= huecos[0] - 15, 'la espera no decrece al fallar seguido');
  await esperar(300);
  assert.equal(instantes.length, lanzados, 'no hay relanzamientos tras kill()');
});

test('agentCommand admite el agente real y un script .js de pruebas', () => {
  assert.deepEqual(agentCommand(['audio-devices'], 'C:\\nexo\\nexo-agent.exe'), { command: 'C:\\nexo\\nexo-agent.exe', args: ['audio-devices'] });
  const falso = agentCommand(['audio-play', '--rate', '48000'], 'D:\\pruebas\\agente-falso.js');
  assert.equal(falso.command, process.execPath);
  assert.deepEqual(falso.args, ['D:\\pruebas\\agente-falso.js', 'audio-play', '--rate', '48000']);
});
