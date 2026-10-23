'use strict';

// Dibuja en pixel art, con formas simples, un busto inspirado en Viego, el Rey Arruinado (League of Legends):
// corona hueca de púas, melena plateada, ojos que brillan, hombreras con púas, cadena espectral y la espada
// carmesí detrás. Es un homenaje de aficionado, dibujado aquí desde cero (no copia ni traza ninguna imagen de Riot).
// Salida: assets/viego/{rey,corona,cadena}-pixel.svg. Uso: node docs/diseno/pixel/generar-rey.js
//
// v2: retrato de 64×72 (cara más estrecha y con mentón, ceño y ojos que brillan), corona con filo de luz
// para que se lea sobre fondos oscuros, y una cadena que encadena sin cortes al repetirse. Los SVG se
// escriben con un <path> por color (≈ 4 veces más livianos que un <rect> por cada tramo).
// El panel y el cliente los muestran con image-rendering: pixelated y a escala ENTERA (1×, 2×, 3×).

const fs = require('node:fs');
const path = require('node:path');

// ── mini lienzo de pixeles ─────────────────────────────────────────────────
function lienzo(W, H) {
  const rej = Array.from({ length: H }, () => Array(W).fill(null));
  const dentro = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
  const L = {
    W, H, rej,
    poner(x, y, c) { x = Math.round(x); y = Math.round(y); if (dentro(x, y)) rej[y][x] = c; },
    leer(x, y) { return dentro(x, y) ? rej[y][x] : null; },
    // polígono relleno (regla par-impar sobre el centro de cada pixel); `soloVacio` no pisa lo ya dibujado
    poli(puntos, c, soloVacio) {
      const ys = puntos.map(p => p[1]);
      for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(H - 1, Math.ceil(Math.max(...ys))); y++) {
        for (let x = 0; x < W; x++) {
          let en = false;
          for (let i = 0, j = puntos.length - 1; i < puntos.length; j = i++) {
            const [xi, yi] = puntos[i], [xj, yj] = puntos[j];
            if ((yi > y + 0.5) !== (yj > y + 0.5) && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) en = !en;
          }
          if (en && (!soloVacio || L.leer(x, y) === null)) L.poner(x, y, c);
        }
      }
    },
    elipse(cx, cy, rx, ry, c) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) L.poner(x, y, c);
      }
    },
    linea(x0, y0, x1, y1, c, grosor = 0) {
      const pasos = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
      for (let i = 0; i <= pasos; i++) {
        const t = i / pasos, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        for (let a = -grosor; a <= grosor; a++) for (let b = -grosor; b <= grosor; b++) if (a * a + b * b <= grosor * grosor + 0.3) L.poner(x + a, y + b, c);
      }
    },
    // contorno de un pixel alrededor de todo lo dibujado
    contorno(c) {
      const marcado = rej.map(f => f.slice());
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (marcado[y][x] !== null) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => { const v = marcado[y + b]?.[x + a]; return v !== undefined && v !== null; })) rej[y][x] = c;
      }
    },
    // a cada pixel `de` cuyo vecino (dx,dy) está vacío o es contorno se le pone el color `a` (filo de luz)
    filo(de, a, dx, dy, vacios) {
      const marcado = rej.map(f => f.slice());
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (marcado[y][x] !== de) continue;
        const v = marcado[y + dy]?.[x + dx];
        if (v === undefined || v === null || vacios.includes(v)) rej[y][x] = a;
      }
    },
    // a partir de filas de texto: cada letra es un color de la paleta, '.' es vacío
    texto(filas, x0 = 0, y0 = 0) {
      filas.forEach((fila, y) => { for (let x = 0; x < fila.length; x++) if (fila[x] !== '.') L.poner(x0 + x, y0 + y, fila[x]); });
    },
  };
  return L;
}

// SVG con un <path> por color: cada tramo horizontal es «M x y h largo v1 h-largo z».
function svg(L, paleta, { ancho, alto, etiqueta, extra = '' }) {
  const porColor = {};
  for (let y = 0; y < L.H; y++) {
    let x = 0;
    while (x < L.W) {
      const c = L.rej[y][x];
      if (c === null || !paleta[c]) { x++; continue; }
      let fin = x; while (fin + 1 < L.W && L.rej[y][fin + 1] === c) fin++;
      (porColor[c] ||= []).push(`M${x} ${y}h${fin - x + 1}v1h-${fin - x + 1}z`);
      x = fin + 1;
    }
  }
  const trazos = Object.entries(porColor).map(([c, d]) => `<path fill="${paleta[c]}" d="${d.join('')}"/>`).join('');
  const medida = ancho ? ` width="${ancho}" height="${alto}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.W} ${L.H}"${medida} shape-rendering="crispEdges" role="img" aria-label="${etiqueta}">${trazos}${extra}</svg>\n`;
}

// ── el rey ─────────────────────────────────────────────────────────────────
const R = lienzo(64, 72);
const { poli, elipse, linea, poner, leer } = R;

// espada carmesí detrás del hombro derecho: hoja dentada que sube hacia la esquina
poli([[41, 52], [45, 52], [62, 6], [58, 2], [57, 8], [53, 9], [53, 14], [49, 16], [50, 22], [46, 24], [46, 31], [42, 33], [42, 40]], 'R');
poli([[43, 51], [46, 50], [60, 8], [57, 5], [56, 10], [52, 12], [52, 17], [48, 19], [49, 25], [45, 27], [45, 34], [43, 39]], 'r');
linea(47, 44, 58, 10, 'q');

// melena plateada: cae por detrás de los hombros
poli([[22, 15], [13, 25], [9, 42], [12, 56], [18, 66], [22, 52], [23, 32]], 'S');
poli([[42, 15], [51, 25], [55, 42], [52, 56], [46, 66], [42, 52], [41, 32]], 'S');
poli([[22, 16], [16, 27], [14, 42], [16, 55], [20, 45], [23, 30]], 's');
poli([[42, 16], [48, 27], [50, 42], [48, 55], [44, 45], [41, 30]], 's');
linea(18, 30, 16, 52, 'h'); linea(46, 30, 48, 52, 'h');

// hombreras con púas
poli([[2, 60], [3, 49], [8, 43], [17, 44], [22, 51], [21, 66], [8, 68]], 'p');
poli([[62, 60], [61, 49], [56, 43], [47, 44], [42, 51], [43, 66], [56, 68]], 'p');
poli([[5, 56], [6, 49], [10, 45], [17, 46], [15, 50], [9, 52]], 'h');
poli([[59, 56], [58, 49], [54, 45], [47, 46], [49, 50], [55, 52]], 'h');
poli([[3, 49], [0, 38], [8, 44]], 'P'); poli([[9, 43], [8, 32], [14, 42]], 'P'); poli([[61, 49], [64, 38], [56, 44]], 'P'); poli([[55, 43], [56, 32], [50, 42]], 'P');

// torso: pecho pálido entre correas de armadura
poli([[21, 46], [43, 46], [45, 58], [43, 72], [21, 72], [19, 58]], 'F');
poli([[24, 46], [40, 46], [42, 58], [40, 72], [24, 72], [22, 58]], 'f');
poli([[21, 58], [43, 58], [43, 72], [21, 72]], 'p');
poli([[24, 58], [40, 58], [40, 72], [24, 72]], 'P');
linea(24, 47, 20, 58, 'p'); linea(40, 47, 44, 58, 'p'); // correas

// cuello
poli([[28, 34], [36, 34], [37, 47], [27, 47]], 'F');
poli([[29, 34], [35, 34], [35, 44], [29, 44]], 'f');

// cara: más estrecha que alta, con pómulos marcados y mentón
poli([[24, 20], [26, 14], [38, 14], [40, 20], [39, 27], [36, 33], [32, 36], [28, 33], [25, 27]], 'F');
poli([[25, 21], [27, 15], [37, 15], [39, 21], [38, 27], [35, 32], [32, 34], [29, 32], [26, 27]], 'f');
// sombras bajo los pómulos y a un costado del rostro
for (const [x, y] of [[26, 26], [26, 27], [27, 28], [38, 26], [38, 27], [37, 28], [28, 31], [36, 31]]) poner(x, y, 'F');

// flequillo plateado partido en dos mechones largos
poli([[23, 14], [41, 14], [40, 17], [36, 15], [32, 19], [28, 15], [24, 17]], 's');
poli([[22, 15], [26, 14], [27, 21], [25, 31], [23, 28]], 's');
poli([[42, 15], [38, 14], [37, 21], [39, 31], [41, 28]], 's');
poli([[22, 28], [25, 31], [24, 50], [20, 44]], 'S'); poli([[42, 28], [39, 31], [40, 50], [44, 44]], 'S');

// corona hueca: banda oscura sobre la frente y púas que se abren como cuernos
poli([[24, 14], [40, 14], [40, 17], [24, 17]], 'g');
poli([[31, 14], [30, 4], [32, 0], [34, 4], [33, 14]], 'g');                  // central
poli([[27, 14], [26, 7], [28, 4], [29, 14]], 'g'); poli([[35, 14], [36, 7], [38, 4], [35, 14]], 'g'); // flanqueantes
poli([[25, 14], [20, 10], [16, 3], [22, 7], [26, 11]], 'g'); poli([[39, 14], [44, 10], [48, 3], [42, 7], [38, 11]], 'g'); // exteriores
poli([[24, 15], [18, 14], [14, 9], [21, 12]], 'g'); poli([[40, 15], [46, 14], [50, 9], [43, 12]], 'g'); // puntas bajas

// ojos que brillan bajo un ceño fruncido
for (const [x, y] of [[26, 19], [27, 19], [28, 20], [29, 20], [38, 19], [37, 19], [36, 20], [35, 20]]) poner(x, y, 'k');
for (const [x, y] of [[27, 21], [28, 21], [29, 21], [35, 21], [36, 21], [37, 21]]) poner(x, y, 'c');
poner(28, 21, 'e'); poner(36, 21, 'e'); poner(27, 22, 'C'); poner(37, 22, 'C');
// nariz, pómulos y boca apretada
poner(32, 24, 'F'); poner(32, 25, 'F'); poner(31, 26, 'F'); poner(33, 26, 'F');
linea(29, 30, 35, 30, 'k'); poner(28, 29, 'k'); poner(36, 29, 'k'); poner(32, 31, 'F');

// cadena espectral cruzando el pecho en diagonal
function eslabon(x, y, vertical) {
  const celdas = vertical ? [[0, -1], [0, 0], [0, 1], [-1, 0], [1, 0]] : [[-1, 0], [0, 0], [1, 0], [0, -1], [0, 1]];
  for (const [a, b] of celdas) poner(x + a, y + b, 'b');
  poner(x, y, null);
  poner(x + (vertical ? 1 : 0), y + (vertical ? 0 : 1), 'B');
}
for (let i = 0; i < 9; i++) eslabon(13 + i * 3, 46 + i * 2, i % 2 === 0);
for (let i = 0; i < 5; i++) eslabon(45 - i * 2, 62 + i * 2, i % 2 === 1);

// contorno oscuro de todo el dibujo y filo de luz en los bordes que miran arriba-izquierda
R.contorno('k');
R.filo('p', 'P', -1, 0, ['k']);
R.filo('g', 'W', -1, 0, ['k']);
R.filo('g', 'W', 0, -1, ['k']);

// niebla negra: motas translúcidas abajo
let semilla = 7; const alea = () => { semilla = (semilla * 1664525 + 1013904223) % 4294967296; return semilla / 4294967296; };
let niebla = '';
for (let i = 0; i < 90; i++) {
  const x = Math.floor(alea() * 64), y = 60 + Math.floor(alea() * 12), o = 0.12 + alea() * 0.3;
  if (leer(x, y) === null) niebla += `<path fill="#6fd3c4" opacity="${o.toFixed(2)}" d="M${x} ${y}h1v1h-1z"/>`;
}

const PALETA_REY = {
  k: '#0b0913', p: '#1c1a2e', P: '#322d52', h: '#544e80', g: '#2b2748', W: '#8b84c8',
  s: '#eae6f6', S: '#a29ec2', f: '#dcd2e8', F: '#9086aa',
  e: '#ffffff', c: '#a8e6ff', C: '#5fa8d8', r: '#d62f4a', R: '#7d1228', q: '#ff8497',
  b: '#8fd3ff', B: '#3d7fb6',
};

const salida = path.join(__dirname, '..', '..', '..', 'assets', 'viego');
fs.mkdirSync(salida, { recursive: true });
fs.writeFileSync(path.join(salida, 'rey-pixel.svg'),
  svg(R, PALETA_REY, { etiqueta: 'Pixel art de un rey con corona de púas y espada carmesí', extra: niebla }));

// ── corona sola (marca pequeña): 32×12, con filo de luz azulada para leerse sobre fondos oscuros ───────
const C = lienzo(32, 12);
C.poli([[2, 11], [3, 4], [5, 1], [7, 5], [8, 11]], 'g');                       // púa izquierda exterior
C.poli([[7, 11], [8, 6], [11, 3], [13, 11]], 'g');
C.poli([[12, 11], [14, 5], [16, 0], [18, 5], [20, 11]], 'g');                  // púa central
C.poli([[19, 11], [21, 3], [24, 6], [25, 11]], 'g');
C.poli([[24, 11], [26, 5], [28, 1], [29, 4], [30, 11]], 'g');                  // púa derecha exterior
C.poli([[2, 8], [30, 8], [30, 11], [2, 11]], 'g');                             // banda
C.contorno('k');
C.filo('g', 'W', -1, 0, ['k']);
C.filo('g', 'W', 0, -1, ['k']);
for (const [x, y] of [[5, 1], [16, 0], [28, 1]]) C.poner(x, y, 'c');            // brillo en las puntas
for (const x of [7, 14, 21, 27]) C.poner(x, 9, 'm');                           // remaches de la banda
fs.writeFileSync(path.join(salida, 'corona-pixel.svg'),
  svg(C, { k: '#0b0913', g: '#3d3766', W: '#8b84c8', c: '#a8e6ff', m: '#5fa8d8' }, { etiqueta: 'Corona de púas en pixel art' }));

// ── cadena horizontal que se repite SIN cortes: 12×6 ────────────────────────────────────────────────
// Un eslabón abierto (cols 0-9) y una barra de canto que lo atraviesa: a la izquierda pasa por delante
// de la pared y a la derecha por detrás, así los eslabones se ven enlazados. La barra de un azulejo
// termina dentro del hueco del siguiente: al repetir cada 12 px la cadena queda continua.
const H = lienzo(12, 6);
H.texto([
  '.bbbbbbbb...',
  'bB......Bb..',
  'bbbb..bbBbbb',
  'BBBB..BBBbBB',
  'bB......Bb..',
  '.BBBBBBBB...',
]);
fs.writeFileSync(path.join(salida, 'cadena-pixel.svg'),
  svg(H, { b: '#8fd3ff', B: '#3d7fb6' }, { etiqueta: 'Eslabones de cadena en pixel art' }));

console.log('assets/viego/{rey,corona,cadena}-pixel.svg');
