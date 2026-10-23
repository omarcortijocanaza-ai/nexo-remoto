#!/usr/bin/env node
'use strict';

// Copia las fuentes y las imágenes de las apariencias al directorio que el panel embebe con go:embed
// (native/tray/panel/fuentes y native/tray/panel/img). Las fuentes viven una sola vez en assets/ y las
// usan el cliente y el panel; go:embed no puede salir de native/tray, así que hace falta esta copia.
// Las copias SÍ se versionan: así `go build` y `go test` funcionan en un clon nuevo sin correr nada, y
// el test TestRecursosEmbebidosAlDia avisa si alguien cambia assets/ y olvida volver a sincronizar.
//
// Uso:  node scripts/ui/sync-recursos-panel.js            copia lo que haya cambiado
//       node scripts/ui/sync-recursos-panel.js --verificar  no escribe; sale con 1 si hay copias viejas

const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..', '..');
const panel = path.join(raiz, 'native', 'tray', 'panel');
const verificar = process.argv.includes('--verificar');

// [carpeta de origen, carpeta de destino dentro del panel, filtro de nombres]
const juegos = [
  [path.join(raiz, 'assets', 'fuentes'), path.join(panel, 'fuentes'), (n) => n.endsWith('.woff2') || n === 'fuentes.css'],
  [path.join(raiz, 'assets', 'viego'), path.join(panel, 'img'), (n) => n.endsWith('.svg') || n === 'fondo-niebla.webp'],
];

let cambios = 0;
for (const [origen, destino, acepta] of juegos) {
  if (!fs.existsSync(origen)) {
    console.error('Falta la carpeta de origen: ' + origen);
    process.exit(1);
  }
  const nombres = fs.readdirSync(origen).filter(acepta).sort();
  if (!verificar) fs.mkdirSync(destino, { recursive: true });
  for (const nombre of nombres) {
    const a = path.join(origen, nombre);
    const b = path.join(destino, nombre);
    const igual = fs.existsSync(b) && fs.readFileSync(a).equals(fs.readFileSync(b));
    if (igual) continue;
    cambios++;
    if (verificar) console.log('desactualizado: ' + path.relative(raiz, b));
    else fs.copyFileSync(a, b);
  }
  // Un archivo que ya no existe en assets/ no debe seguir embebido en el panel.
  if (fs.existsSync(destino)) {
    for (const nombre of fs.readdirSync(destino)) {
      if (nombres.includes(nombre)) continue;
      cambios++;
      if (verificar) console.log('sobra: ' + path.relative(raiz, path.join(destino, nombre)));
      else fs.rmSync(path.join(destino, nombre));
    }
  }
}

if (verificar) {
  if (cambios) { console.error(cambios + ' archivo(s) fuera de sync: corre node scripts/ui/sync-recursos-panel.js'); process.exit(1); }
  console.log('Recursos del panel al día.');
} else {
  console.log(cambios ? 'Recursos del panel sincronizados (' + cambios + ' cambio/s).' : 'Recursos del panel ya estaban al día.');
}
