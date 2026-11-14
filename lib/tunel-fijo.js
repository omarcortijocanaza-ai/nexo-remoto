'use strict';

// Dirección fija por la VM del dueño (plan «Internet», fase I2).
//
//   celular ─HTTPS─▶ Caddy en la VM (nexo.nexussoftware.pe) ─▶ 127.0.0.1:5095 de la VM
//                                         ▲ túnel SSH inverso que abre esta PC (ssh -R)
//
// La configuración vive en `<estado>\.nexo-dominio.json` (no en .nexo-settings.json: el panel
// reescribe ese archivo entero y la borraría) y la llave del túnel en `<estado>\tunel-vm\`. Las
// crea scripts\windows\nexo-dominio.ps1. Sin archivo, o con `activo: false`, no se lanza nada.
//
//   { "activo": true, "url": "https://nexo.nexussoftware.pe",
//     "ssh": { "host": "136.248.65.57", "usuario": "nexotunel", "puertoRemoto": 5095 } }
//
// TryCloudflare sigue funcionando al lado: si la VM o el túnel caen, el enlace de Internet vuelve
// solo a la dirección de TryCloudflare (ver `elegirUrlRemota`).

const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { readJsonSafe } = require('./safe');

const NOMBRE_ARCHIVO = '.nexo-dominio.json';
const CARPETA_LLAVE = 'tunel-vm';
const ESPERA_MIN_MS = 2000;
const ESPERA_MAX_MS = 60000;
const COMPROBAR_CADA_MS = 30000;

function rutas(stateDir) {
  const carpeta = path.join(stateDir, CARPETA_LLAVE);
  return {
    config: path.join(stateDir, NOMBRE_ARCHIVO),
    carpeta,
    llave: path.join(carpeta, 'id_ed25519'),
    conocidos: path.join(carpeta, 'known_hosts')
  };
}

// Devuelve la configuración válida o null. Lo inválido no se intenta «arreglar»: se ignora entera.
function normalizarDominio(crudo) {
  if (!crudo || typeof crudo !== 'object') return null;
  const ssh = crudo.ssh && typeof crudo.ssh === 'object' ? crudo.ssh : {};
  let url;
  try { url = new URL(String(crudo.url || '')); } catch { return null; }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username) return null;
  const host = String(ssh.host || '').trim();
  const usuario = String(ssh.usuario || '').trim();
  const puertoRemoto = Number(ssh.puertoRemoto);
  const esIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) && host.split('.').every(n => Number(n) <= 255);
  const esNombre = /^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/i.test(host);
  if (!esIpv4 && !esNombre) return null;
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(usuario)) return null;
  if (!Number.isInteger(puertoRemoto) || puertoRemoto < 1024 || puertoRemoto > 65535) return null;
  return { activo: crudo.activo === true, url: url.origin, ssh: { host, usuario, puertoRemoto } };
}

function leerDominio(stateDir) {
  return normalizarDominio(readJsonSafe(rutas(stateDir).config, null));
}

function rutaSsh(plataforma = process.platform, entorno = process.env) {
  if (entorno.NEXO_SSH_PATH) return entorno.NEXO_SSH_PATH;
  // El OpenSSH que trae Windows, no el de Git: así no depende de lo que haya en el PATH.
  if (plataforma === 'win32') return path.join(entorno.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
  return 'ssh';
}

function argumentosSsh({ config, stateDir, puertoLocal }) {
  const r = rutas(stateDir);
  return [
    '-N', '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ConnectTimeout=15',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${r.conocidos}`,
    '-o', 'IdentitiesOnly=yes',
    '-i', r.llave,
    '-R', `127.0.0.1:${config.ssh.puertoRemoto}:127.0.0.1:${puertoLocal}`,
    `${config.ssh.usuario}@${config.ssh.host}`
  ];
}

// La dirección que se publica como «enlace de Internet»: la fija si responde, si no TryCloudflare.
function elegirUrlRemota({ fija = '', fijaOk = false, tryCloudflare = '' } = {}) {
  return fija && fijaOk ? fija : tryCloudflare;
}

// Por qué no se puede abrir (o null si se puede). Con dirección fija el inicio de sesión de
// «Mi PC» es la única barrera, así que sin credenciales no se publica.
function motivoParaNoAbrir({ config, stateDir, existe = fs.existsSync }) {
  if (!config || !config.activo) return 'desactivada';
  const r = rutas(stateDir);
  if (!existe(r.llave)) return `falta la llave del túnel (${r.llave}); ejecuta nexo-dominio.ps1 preparar`;
  if (!existe(r.conocidos)) return 'falta la huella de la VM (known_hosts); ejecuta nexo-dominio.ps1 preparar';
  if (!existe(path.join(stateDir, '.nexo-auth.json'))) return 'no hay contraseña de «Mi PC» configurada: sin ella la dirección fija quedaría abierta';
  return null;
}

function comprobarSalud(url, { espera = 8000, peticion = https.get } = {}) {
  return new Promise(resolve => {
    let req;
    try {
      req = peticion(new URL('/health', url), { timeout: espera }, res => { res.resume(); resolve(res.statusCode === 200); });
    } catch { return resolve(false); }
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(false));
  });
}

// Mantiene el túnel vivo (reintento creciente 2 s → 60 s) y comprueba cada 30 s que la dirección
// responde de verdad. `alCambiar(ok)` avisa cuando cambia el estado.
function crearTunelFijo({ config, stateDir, puertoLocal, lanzar, registrarPid = () => {}, log = () => {}, alCambiar = () => {}, salud = comprobarSalud, temporizador = { setTimeout, clearTimeout, setInterval, clearInterval } }) {
  let proceso = null;
  let parado = false;
  let espera = ESPERA_MIN_MS;
  let reintento = null;
  let ok = false;
  let ultimoError = '';
  let arrancoEn = 0;

  function fijarOk(valor) {
    if (valor === ok) return;
    ok = valor;
    log(valor ? `Dirección fija activa: ${config.url}` : `Dirección fija sin respuesta (${config.url}); se usa TryCloudflare`);
    alCambiar(ok);
  }

  function abrir() {
    if (parado || proceso) return;
    const hijo = lanzar(rutaSsh(), argumentosSsh({ config, stateDir, puertoLocal }));
    proceso = hijo;
    arrancoEn = Date.now();
    registrarPid(hijo.pid);
    let salida = '';
    const recoger = datos => { salida = (salida + datos).slice(-400); };
    hijo.stdout?.on('data', recoger);
    hijo.stderr?.on('data', recoger);
    hijo.on('error', error => { salida += error.message; });
    hijo.on('close', codigo => {
      if (proceso === hijo) proceso = null;
      registrarPid(0);
      fijarOk(false);
      if (parado) return;
      // Un túnel que vivió más de un minuto se cayó por la red: se vuelve a intentar enseguida.
      if (Date.now() - arrancoEn > 60000) espera = ESPERA_MIN_MS;
      const motivo = salida.trim().split(/\r?\n/).pop() || `código ${codigo}`;
      if (motivo !== ultimoError) { ultimoError = motivo; log(`Túnel de la dirección fija cerrado: ${motivo}; reintento en ${Math.round(espera / 1000)} s`); }
      reintento = temporizador.setTimeout(() => { reintento = null; abrir(); }, espera);
      espera = Math.min(ESPERA_MAX_MS, espera * 2);
    });
    // La primera comprobación, a los pocos segundos de abrir, sin esperar al ciclo de 30 s.
    temporizador.setTimeout(comprobar, 4000);
  }

  async function comprobar() {
    if (parado || !proceso) return;
    const responde = await salud(config.url);
    if (parado) return;
    if (responde) { espera = ESPERA_MIN_MS; ultimoError = ''; }
    fijarOk(responde);
  }

  const ciclo = temporizador.setInterval(comprobar, COMPROBAR_CADA_MS);
  ciclo?.unref?.();
  abrir();

  return {
    get ok() { return ok; },
    get pid() { return proceso?.pid || 0; },
    parar() {
      parado = true;
      temporizador.clearTimeout(reintento);
      temporizador.clearInterval(ciclo);
      const hijo = proceso;
      proceso = null;
      try { hijo?.kill(); } catch {}
      return hijo?.pid || 0;
    }
  };
}

module.exports = {
  NOMBRE_ARCHIVO, rutas, normalizarDominio, leerDominio, rutaSsh, argumentosSsh,
  elegirUrlRemota, motivoParaNoAbrir, comprobarSalud, crearTunelFijo
};
