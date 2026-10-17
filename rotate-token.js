#!/usr/bin/env node
'use strict';

// Cambia el token del enlace. Los dispositivos ya emparejados no se enteran:
// se identifican con su cookie, que no deriva del token. Lo único que deja de
// valer son las direcciones compartidas antes, que hasta ahora seguían siendo
// credenciales válidas para siempre.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { atomicWriteJson } = require('./lib/safe');

const statePath = process.argv[2];
const devicesPath = process.argv[3] || path.join(path.dirname(statePath), '.nexo-devices.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

if (process.argv[2] === '--dispositivos') {
  const devices = readJson(process.argv[3]);
  process.stdout.write(String(devices?.devices?.length || 0));
  process.exit(0);
}

const state = readJson(statePath);
if (!state || typeof state.token !== 'string') {
  process.stderr.write('No hay estado de NEXO todavía; inícialo una vez antes de rotar.\n');
  process.exit(1);
}

const token = crypto.randomBytes(18).toString('base64url');
// `localUrl` lleva el token dentro. Se vacía en lugar de reescribirse para que
// el archivo no conserve ni un instante la dirección antigua; el lanzador
// vuelve a calcular ambas al arrancar.
const next = {
  ...state,
  token,
  localUrl: '',
  status: 'rotating',
  rotatedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

atomicWriteJson(statePath, next, 0o600);

const devices = readJson(devicesPath)?.devices?.length || 0;
process.stdout.write(`Token rotado. Dispositivos emparejados que siguen entrando: ${devices}\n`);
