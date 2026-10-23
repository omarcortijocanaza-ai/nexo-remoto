'use strict';

// Lee o guarda la configuración del TURN para el panel (nexo-tray.exe) y para quien prefiera la consola.
// La validación vive aquí, en Node, junto a lib/ice.js, para no duplicarla en Go.
//
//   node scripts/turn-config.js get               imprime la configuración SIN secretos (JSON)
//   node scripts/turn-config.js set  < entrada    guarda el JSON recibido por stdin y lo imprime (SIN secretos)
//
// Los secretos (token de Cloudflare, contraseña del TURN) sólo entran por stdin: nunca por la línea de órdenes.

const { defaultStateDir } = require('../lib/paths');
const { leerConfig, guardarConfig, validarEntrada, describirConfig } = require('../lib/ice');

const stateDir = defaultStateDir(require('node:path').join(__dirname, '..'));
const orden = process.argv[2] || 'get';

function leerStdin() {
  return new Promise(resolver => {
    let datos = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', trozo => { if ((datos += trozo).length > 32 * 1024) process.exit(2); });
    process.stdin.on('end', () => resolver(datos));
  });
}

(async () => {
  if (orden === 'get') {
    console.log(JSON.stringify(describirConfig(leerConfig(stateDir))));
    return;
  }
  if (orden === 'set') {
    let entrada;
    try { entrada = JSON.parse(await leerStdin()); } catch { console.error('La configuración recibida no es un JSON válido.'); process.exit(1); }
    const problema = validarEntrada(entrada, leerConfig(stateDir));
    if (problema) { console.error(problema); process.exit(1); }
    console.log(JSON.stringify(describirConfig(guardarConfig(stateDir, entrada))));
    return;
  }
  console.error('Uso: node scripts/turn-config.js {get|set}');
  process.exit(2);
})();
