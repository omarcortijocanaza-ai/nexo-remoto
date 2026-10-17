'use strict';

// Registro de ejecución del lanzador: sin secretos y con rotación.
//
// El token del enlace es una credencial: quien lo lea puede emparejar un
// dispositivo propio. Antes `nexo-runtime.log` guardaba cada enlace completo,
// no rotaba (llegó a 1,2 MB) y en Linux lo leía cualquier usuario. Aquí se
// enmascara todo lo que huela a token antes de escribir en archivo; la consola
// interactiva sí puede mostrar los enlaces completos (es lo que el dueño
// necesita ver al arrancar).

const fs = require('fs');
const path = require('path');

// `token=abc`, `"token":"abc"`, `x-remote-token: abc`, `nexo_device=abc`.
const PATRONES = [
  /(token=)[^\s&"'<>)\]]+/gi,
  /(["']?token["']?\s*:\s*["'])[^"']+/gi,
  /(x-remote-token:\s*)\S+/gi,
  /(nexo_device=)[^\s;]+/gi
];

function maskSecrets(texto) {
  let salida = String(texto);
  for (const patron of PATRONES) salida = salida.replace(patron, '$1***');
  return salida;
}

class RotatingLog {
  // `maxBytes` por archivo y `keep` archivos en total (el vivo + keep-1 rotados).
  constructor({ file, maxBytes = 5 * 1024 * 1024, keep = 3 } = {}) {
    this.file = file;
    this.maxBytes = maxBytes;
    this.keep = Math.max(1, keep);
    this.size = 0;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { this.size = fs.statSync(file).size; } catch { this.size = 0; }
  }

  rotar() {
    // Windows no renombra encima de un archivo existente: se borra el último
    // y se desplaza el resto (.2 ← .1 ← vivo).
    for (let n = this.keep - 1; n >= 1; n--) {
      const origen = n === 1 ? this.file : `${this.file}.${n - 1}`;
      const destino = `${this.file}.${n}`;
      try { fs.rmSync(destino, { force: true }); } catch {}
      try { if (fs.existsSync(origen)) fs.renameSync(origen, destino); } catch {}
    }
    if (this.keep === 1) { try { fs.rmSync(this.file, { force: true }); } catch {} }
    this.size = 0;
  }

  write(texto) {
    const datos = Buffer.from(maskSecrets(texto), 'utf8');
    try {
      if (this.size > 0 && this.size + datos.length > this.maxBytes) this.rotar();
      fs.appendFileSync(this.file, datos);
      this.size += datos.length;
    } catch {
      // Un disco lleno no puede tumbar el lanzador: se pierde la línea.
    }
  }
}

module.exports = { maskSecrets, RotatingLog };
