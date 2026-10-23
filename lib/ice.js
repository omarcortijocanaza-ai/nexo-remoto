'use strict';

// Servidores ICE (STUN/TURN) de todo NEXO en un solo lugar.
//
// El host está tras CGNAT y el celular por datos móviles casi siempre también: sólo con STUN
// WebRTC a veces no encuentra camino y NEXO cae al respaldo JPEG por el túnel. Un TURN
// retransmite el vídeo y lo evita. La configuración vive en `<estado>\.nexo-turn.json`, que
// escribe el panel; la carpeta de estado tiene la ACL del dueño (install-autostart.ps1).
//
//   { "proveedor": "ninguno" | "cloudflare" | "manual",
//     "cloudflare": { "keyId": "…", "apiToken": "…" },
//     "manual":     { "urls": ["turn:host:3478?transport=udp", …], "usuario": "…", "credencial": "…" } }
//
// Con «cloudflare» las credenciales se piden a Realtime TURN y duran 24 h (el máximo es 48 h);
// se renuevan solas antes de caducar. Con «manual» se usan tal cual. Si algo falla se vuelve
// al STUN de siempre: un TURN caído nunca debe dejar a nadie sin conexión.

const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { atomicWriteJson, readJsonSafe } = require('./safe');

const NOMBRE_ARCHIVO = '.nexo-turn.json';
const PROVEEDORES = ['ninguno', 'cloudflare', 'manual'];
const STUN_POR_DEFECTO = Object.freeze([Object.freeze({ urls: ['stun:stun.cloudflare.com:3478'] })]);
const TTL_SEGUNDOS = 24 * 3600;
const RENOVAR_ANTES_MS = 2 * 3600 * 1000;
const ESPERA_FALLO_MS = 60 * 1000;
const MAX_URLS_MANUAL = 8;

function baseApiCloudflare() {
  return process.env.NEXO_TURN_API_BASE || 'https://rtc.live.cloudflare.com';
}

function esUrlIce(url) {
  return typeof url === 'string' && /^(stun|turn|turns):[^\s]+$/i.test(url.trim());
}

function texto(valor, max) {
  return typeof valor === 'string' ? valor.trim().slice(0, max) : '';
}

// Devuelve siempre una configuración completa y válida; lo inválido se descarta.
function normalizar(crudo) {
  const origen = crudo && typeof crudo === 'object' ? crudo : {};
  const cf = origen.cloudflare && typeof origen.cloudflare === 'object' ? origen.cloudflare : {};
  const man = origen.manual && typeof origen.manual === 'object' ? origen.manual : {};
  const urls = (Array.isArray(man.urls) ? man.urls : []).map(url => texto(url, 300)).filter(esUrlIce).slice(0, MAX_URLS_MANUAL);
  const config = {
    proveedor: PROVEEDORES.includes(origen.proveedor) ? origen.proveedor : 'ninguno',
    cloudflare: { keyId: texto(cf.keyId, 64), apiToken: texto(cf.apiToken, 512) },
    manual: { urls, usuario: texto(man.usuario, 256), credencial: texto(man.credencial, 512) }
  };
  // Un proveedor sin sus datos no sirve: se trata como «ninguno» en vez de fallar en cada oferta.
  if (config.proveedor === 'cloudflare' && !(/^[A-Za-z0-9_-]{8,64}$/.test(config.cloudflare.keyId) && /^\S{16,512}$/.test(config.cloudflare.apiToken))) config.proveedor = 'ninguno';
  if (config.proveedor === 'manual' && !config.manual.urls.length) config.proveedor = 'ninguno';
  return config;
}

function rutaConfig(stateDir) {
  return path.join(stateDir, NOMBRE_ARCHIVO);
}

function leerConfig(stateDir) {
  return normalizar(readJsonSafe(rutaConfig(stateDir), {}));
}

// Vista sin secretos, para el panel y los diagnósticos.
function describirConfig(config) {
  return {
    proveedor: config.proveedor,
    cloudflareKeyId: config.cloudflare.keyId,
    tieneApiToken: Boolean(config.cloudflare.apiToken),
    manualUrls: config.manual.urls,
    manualUsuario: config.manual.usuario,
    tieneCredencial: Boolean(config.manual.credencial)
  };
}

// Valida lo que llega del panel con mensajes para una persona (guardarConfig, en cambio, es
// indulgente y degrada a «ninguno»). Devuelve el texto del error o null si todo está bien.
function validarEntrada(entrada, actual) {
  const proveedor = entrada?.proveedor;
  if (!PROVEEDORES.includes(proveedor)) return 'Elige cómo quieres conectar: ninguno, Cloudflare o manual.';
  if (proveedor === 'cloudflare') {
    const keyId = texto(entrada?.cloudflare?.keyId, 64);
    const token = texto(entrada?.cloudflare?.apiToken, 512) || actual.cloudflare.apiToken;
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(keyId)) return 'Escribe el «Key ID» de tu clave TURN de Cloudflare (letras y números, sin espacios).';
    if (!/^\S{16,512}$/.test(token)) return 'Escribe el «API Token» de esa clave TURN (Cloudflare lo muestra una sola vez al crearla).';
  }
  if (proveedor === 'manual') {
    const urls = (Array.isArray(entrada?.manual?.urls) ? entrada.manual.urls : []).map(url => texto(url, 300)).filter(Boolean);
    if (!urls.length) return 'Escribe al menos una dirección de servidor (por ejemplo turn:mi-servidor.net:3478).';
    const mala = urls.find(url => !esUrlIce(url));
    if (mala) return `«${mala.slice(0, 60)}» no es una dirección válida: debe empezar por stun:, turn: o turns:.`;
    if (urls.length > MAX_URLS_MANUAL) return `Como máximo ${MAX_URLS_MANUAL} direcciones.`;
    const usuario = texto(entrada?.manual?.usuario, 256);
    const credencial = texto(entrada?.manual?.credencial, 512) || actual.manual.credencial;
    if (urls.some(url => /^turns?:/i.test(url)) && (!usuario || !credencial)) return 'Un servidor TURN necesita usuario y contraseña.';
  }
  return null;
}

// El panel nunca recibe los secretos: si al guardar no manda uno nuevo se conserva el
// guardado. `olvidarSecretos` los borra (cambiar a «ninguno» no los toca, a propósito:
// así se puede apagar el TURN un rato y volver a encenderlo sin reescribir la clave).
function guardarConfig(stateDir, entrada) {
  const actual = leerConfig(stateDir);
  const olvidar = entrada?.olvidarSecretos === true;
  const crudo = {
    proveedor: entrada?.proveedor,
    cloudflare: {
      keyId: entrada?.cloudflare?.keyId,
      apiToken: olvidar ? '' : (texto(entrada?.cloudflare?.apiToken, 512) || actual.cloudflare.apiToken)
    },
    manual: {
      urls: entrada?.manual?.urls,
      usuario: entrada?.manual?.usuario,
      credencial: olvidar ? '' : (texto(entrada?.manual?.credencial, 512) || actual.manual.credencial)
    }
  };
  const final = normalizar(crudo);
  atomicWriteJson(rutaConfig(stateDir), final, 0o600);
  return final;
}

// Quita del resultado de Cloudflare lo que sólo estorba: el puerto 53 «suele agotar el tiempo
// en los navegadores» (documentación de Cloudflare) y en Pion retrasaría la recolección.
function limpiarCloudflare(servidores) {
  return (Array.isArray(servidores) ? servidores : [])
    .map(servidor => {
      const urls = (Array.isArray(servidor?.urls) ? servidor.urls : [servidor?.urls]).filter(esUrlIce).filter(url => !/:53(\?|$)/.test(url));
      if (!urls.length) return null;
      const limpio = { urls };
      if (servidor.username) { limpio.username = String(servidor.username); limpio.credential = String(servidor.credential || ''); }
      return limpio;
    })
    .filter(Boolean);
}

function solicitarJson(urlTexto, { metodo = 'POST', cabeceras = {}, cuerpo, esperaMs = 6000 } = {}) {
  return new Promise((resolver, rechazar) => {
    let url;
    try { url = new URL(urlTexto); } catch (error) { return rechazar(error); }
    const cliente = url.protocol === 'http:' ? http : https;
    const datos = cuerpo === undefined ? null : Buffer.from(JSON.stringify(cuerpo));
    const req = cliente.request(url, {
      method: metodo,
      timeout: esperaMs,
      headers: { ...(datos ? { 'content-type': 'application/json', 'content-length': datos.length } : {}), ...cabeceras }
    }, res => {
      let recibido = '';
      res.setEncoding('utf8');
      res.on('data', trozo => { if ((recibido += trozo).length > 64 * 1024) req.destroy(new Error('Respuesta demasiado grande')); });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(recibido); } catch {}
        resolver({ estado: res.statusCode, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado')));
    req.on('error', rechazar);
    if (datos) req.write(datos);
    req.end();
  });
}

// Pide credenciales temporales a Cloudflare Realtime TURN. Lanza Error con un mensaje en español.
async function pedirCredencialesCloudflare(config, { solicitar = solicitarJson } = {}) {
  const { keyId, apiToken } = config.cloudflare;
  const url = `${baseApiCloudflare()}/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`;
  let respuesta;
  try {
    respuesta = await solicitar(url, { cabeceras: { authorization: `Bearer ${apiToken}` }, cuerpo: { ttl: TTL_SEGUNDOS } });
  } catch (error) {
    throw new Error(`No se pudo contactar con Cloudflare TURN (${error.message}).`);
  }
  if (respuesta.estado === 401 || respuesta.estado === 403) throw new Error('Cloudflare rechazó el token de API: revisa que sea el «TURN Key API Token» de esa clave.');
  if (respuesta.estado === 404) throw new Error('Cloudflare no encontró esa clave TURN: revisa el «Key ID».');
  if (respuesta.estado !== 200 && respuesta.estado !== 201) throw new Error(`Cloudflare TURN respondió ${respuesta.estado}.`);
  const servidores = limpiarCloudflare(respuesta.json?.iceServers);
  if (!servidores.some(servidor => servidor.username)) throw new Error('Cloudflare no devolvió ningún servidor TURN con credenciales.');
  return servidores;
}

function desdeManual(config) {
  const { urls, usuario, credencial } = config.manual;
  const turn = { urls };
  if (usuario) { turn.username = usuario; turn.credential = credencial; }
  return [...STUN_POR_DEFECTO.map(servidor => ({ ...servidor })), turn];
}

// Fábrica con caché: una sola por proceso (server.js la crea y comparte con webrtc-host y
// microfono-host). `ahora` y `solicitar` se inyectan para probar sin red ni reloj real.
function crearProveedorIce({ stateDir, log = () => {}, ahora = Date.now, solicitar = solicitarJson } = {}) {
  let cache = null; // { clave, servidores, caduca }
  let fallo = null; // { clave, hasta }
  let pendiente = null;

  async function obtener() {
    const config = leerConfig(stateDir);
    if (config.proveedor === 'ninguno') return STUN_POR_DEFECTO.map(servidor => ({ ...servidor, urls: [...servidor.urls] }));
    if (config.proveedor === 'manual') return desdeManual(config);

    const clave = `${config.cloudflare.keyId}:${config.cloudflare.apiToken.slice(-6)}`;
    // «vigente» = todavía no caducó (aunque falte poco); «fresca» = sobra tiempo y no hace falta renovar.
    const vigente = Boolean(cache && cache.clave === clave && ahora() < cache.caduca);
    if (vigente && ahora() < cache.caduca - RENOVAR_ANTES_MS) return cache.servidores;
    if (fallo && fallo.clave === clave && ahora() < fallo.hasta) {
      return vigente ? cache.servidores : STUN_POR_DEFECTO.map(servidor => ({ ...servidor, urls: [...servidor.urls] }));
    }
    if (!pendiente) {
      pendiente = pedirCredencialesCloudflare(config, { solicitar })
        .then(servidores => {
          cache = { clave, servidores, caduca: ahora() + TTL_SEGUNDOS * 1000 };
          fallo = null;
          log('TURN de Cloudflare: credenciales renovadas');
          return servidores;
        })
        .catch(error => {
          fallo = { clave, hasta: ahora() + ESPERA_FALLO_MS };
          log(`TURN de Cloudflare no disponible: ${error.message}`);
          // Credenciales aún vigentes (aunque cerca del límite) valen más que ninguna.
          if (cache && cache.clave === clave && ahora() < cache.caduca) return cache.servidores;
          return STUN_POR_DEFECTO.map(servidor => ({ ...servidor, urls: [...servidor.urls] }));
        })
        .finally(() => { pendiente = null; });
    }
    return pendiente;
  }

  return {
    obtener,
    // Para el panel y `nexo-control turn-test`: lanza el error en vez de disimularlo.
    async comprobar() {
      const config = leerConfig(stateDir);
      if (config.proveedor === 'ninguno') throw new Error('No hay un TURN configurado: sólo se usa STUN.');
      if (config.proveedor === 'manual') return desdeManual(config);
      return pedirCredencialesCloudflare(config, { solicitar });
    },
    olvidar() { cache = null; fallo = null; }
  };
}

// Lo que se manda al puente Pion en la cabecera X-Nexo-Ice (base64 de JSON).
function cabeceraParaPuente(servidores) {
  return Buffer.from(JSON.stringify(servidores)).toString('base64');
}

module.exports = {
  NOMBRE_ARCHIVO, PROVEEDORES, STUN_POR_DEFECTO, TTL_SEGUNDOS,
  normalizar, leerConfig, guardarConfig, validarEntrada, describirConfig, rutaConfig,
  limpiarCloudflare, pedirCredencialesCloudflare, crearProveedorIce, cabeceraParaPuente, solicitarJson
};
