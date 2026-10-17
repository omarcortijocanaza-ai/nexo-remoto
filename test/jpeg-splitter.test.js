'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JpegSplitter } = require('../platform/windows/ffmpeg');

function makeFakeJpeg(payloadBytes) {
  return Buffer.concat([
    Buffer.from([0xFF, 0xD8]),
    Buffer.from(payloadBytes),
    Buffer.from([0xFF, 0xD9])
  ]);
}

test('JpegSplitter reconstruye un JPEG partido de 1 en 1 byte', async () => {
  const jpeg = makeFakeJpeg([0x01, 0x02, 0xFF, 0x00, 0x10, 0x20, 0x30]);
  const splitter = new JpegSplitter();
  const frames = [];
  splitter.on('data', frame => frames.push(frame));

  for (let i = 0; i < jpeg.length; i++) {
    splitter.write(jpeg.subarray(i, i + 1));
  }
  splitter.end();

  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], jpeg);
});

test('JpegSplitter reconstruye un JPEG partido en 3 trozos (incluyendo corte en marcador)', async () => {
  const jpeg = makeFakeJpeg([0xAA, 0xBB, 0xCC, 0xDD, 0xEE]);
  const splitter = new JpegSplitter();
  const frames = [];
  splitter.on('data', frame => frames.push(frame));

  // Trozo 1 termina justo en el primer 0xFF de SOI; trozo 3 empieza en 0xD9 de EOI
  splitter.write(jpeg.subarray(0, 1));
  splitter.write(jpeg.subarray(1, jpeg.length - 1));
  splitter.write(jpeg.subarray(jpeg.length - 1));
  splitter.end();

  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], jpeg);
});

test('JpegSplitter emite dos JPEGs cuando llegan juntos en un mismo trozo', async () => {
  const jpeg1 = makeFakeJpeg([0x11, 0x22, 0x33]);
  const jpeg2 = makeFakeJpeg([0x44, 0x55, 0x66, 0x77]);
  const combined = Buffer.concat([
    Buffer.from([0x00, 0x99]), // basura previa
    jpeg1,
    Buffer.from([0x55]),       // basura intermedia
    jpeg2
  ]);

  const splitter = new JpegSplitter();
  const frames = [];
  splitter.on('data', frame => frames.push(frame));

  splitter.write(combined);
  splitter.end();

  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0], jpeg1);
  assert.deepEqual(frames[1], jpeg2);
});
