#!/usr/bin/env node
'use strict';

// Genera un código de emparejamiento de un solo uso: `node scripts/pair.js [minutos]`.
// Es el mismo código que `nexo-control pair` de Linux, pasado a Node para que la
// bandeja y nexo-control.ps1 de Windows no dependan de bash. El código lo genera
// quien tiene acceso local a la máquina y el servidor sólo lo lee del archivo de
// estado: así emparejar no necesita ningún endpoint abierto que alguien pudiera
// invocar desde fuera.

const path = require('path');
const { createPairing } = require('../device-manager');
const { defaultStateDir } = require('../lib/paths');

const texto = process.argv[2] === undefined ? '10' : process.argv[2];
if (!/^\d+$/.test(texto) || Number(texto) < 1 || Number(texto) > 24 * 60) {
  process.stderr.write('Uso: node scripts/pair.js [minutos]\n');
  process.exit(2);
}

const stateDir = defaultStateDir(path.resolve(__dirname, '..'));
const { code, expiresAt } = createPairing(path.join(stateDir, '.nexo-pairing.json'), Number(texto) * 60000);
const minutos = Math.round((expiresAt - Date.now()) / 60000);
process.stdout.write(`\nCódigo de emparejamiento: ${code}\nVálido ${minutos} min y para un solo dispositivo.\nAbre la dirección de NEXO sin token y escríbelo allí.\n\n`);
