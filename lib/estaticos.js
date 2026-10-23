'use strict';

// Archivos estáticos del cliente web (CSS, fuentes, imágenes) con LISTA BLANCA.
//
// Nunca se hace `path.join(raiz, rutaPedida)`: cada ruta pública debe casar con un
// patrón cerrado de `REGLAS` (letras, números, guion y una extensión conocida) y
// además el archivo resuelto tiene que quedar dentro de la carpeta de su regla.
// Así `..`, barras codificadas o nombres inesperados terminan en 404 sin tocar el disco.
//
// Estos archivos no llevan secretos (CSS, fuentes, arte), por eso se sirven antes de
// exigir dispositivo emparejado: la pantalla de emparejar también tiene que verse.

const fs = require('node:fs');
const path = require('node:path');

const TIPOS = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
});

const TEMAS_ID = 'cabina|nativa|reymuerto|cianotipo|bloque';
const NOMBRE = '[A-Za-z0-9_-]+';

// `cache`: 'revalidar' = el navegador pregunta con ETag cada vez (CSS y JS que cambian al
// editarse); 'largo' = un día (fuentes y arte, que casi nunca cambian). Cuando la URL trae
// `?v=` (la pone el servidor al inyectar el tema) la respuesta es inmutable: el valor cambia
// solo cuando cambia el archivo.
const REGLAS = Object.freeze([
  { patron: /^\/ui\/(cliente\.css|apariencia\.js|control-tactil\.js)$/, dir: 'ui', cache: 'revalidar' },
  { patron: new RegExp(`^/ui/(temas/(?:${TEMAS_ID})\\.css)$`), dir: 'ui', cache: 'revalidar' },
  { patron: /^\/ui\/(demo\/escritorio\.svg|icono\.svg)$/, dir: 'ui', cache: 'largo' },
  { patron: new RegExp(`^/assets/(fuentes/${NOMBRE}\\.(?:woff2|css))$`), dir: 'assets', cache: 'largo' },
  { patron: new RegExp(`^/assets/(viego/${NOMBRE}\\.(?:svg|webp))$`), dir: 'assets', cache: 'largo' }
]);

function crearEstaticos({ raiz }) {
  function resolver(pathname) {
    for (const regla of REGLAS) {
      const m = regla.patron.exec(pathname);
      if (!m) continue;
      const base = path.resolve(raiz, regla.dir);
      const archivo = path.resolve(base, m[1]);
      // Segunda barrera, por si algún día se afloja un patrón.
      if (!archivo.startsWith(base + path.sep)) return null;
      try {
        const st = fs.statSync(archivo);
        return st.isFile() ? { archivo, st, regla } : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  // Valor para `?v=`: cambia solo cuando cambia el archivo. Vacío si no está en la lista.
  function version(pathname) {
    const encontrado = resolver(pathname);
    return encontrado ? Math.floor(encontrado.st.mtimeMs).toString(36) : '';
  }

  // Devuelve true si atendió la petición (o respondió 405/404 sobre una ruta suya).
  function servir(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const encontrado = resolver(url.pathname);
    if (!encontrado) return false;
    const { archivo, st, regla } = encontrado;
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const inmutable = url.searchParams.has('v');
    const cabeceras = {
      'content-type': TIPOS[path.extname(archivo)] || 'application/octet-stream',
      etag,
      'cache-control': inmutable ? 'public, max-age=31536000, immutable'
        : regla.cache === 'largo' ? 'public, max-age=86400' : 'no-cache',
      'x-content-type-options': 'nosniff'
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, cabeceras);
      res.end();
      return true;
    }
    fs.readFile(archivo, (error, datos) => {
      if (error) {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
        res.end('{"error":"No encontrado"}');
        return;
      }
      res.writeHead(200, { ...cabeceras, 'content-length': datos.length });
      res.end(req.method === 'HEAD' ? undefined : datos);
    });
    return true;
  }

  return { resolver, version, servir };
}

// Plantilla HTML leída del disco y vuelta a leer sólo si el archivo cambió: se puede
// retocar `index.html` sin reiniciar NEXO y el costo por petición es un `stat`.
function crearPlantilla(archivo) {
  let firma = '';
  let texto = '';
  return {
    texto() {
      const st = fs.statSync(archivo);
      const actual = `${st.size}:${st.mtimeMs}`;
      if (actual !== firma) {
        texto = fs.readFileSync(archivo, 'utf8');
        firma = actual;
      }
      return texto;
    }
  };
}

module.exports = { crearEstaticos, crearPlantilla, REGLAS };
