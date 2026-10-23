'use strict';

// HTTPS en la red local (fase O2).
//
// Por LAN el navegador del celular trata `http://192.168.x.x` como página NO segura y bloquea el
// micrófono (getUserMedia), el portapapeles y otras funciones. Con HTTPS vuelven. Se usa un
// certificado autofirmado generado en esta PC (Windows: New-SelfSignedCertificate); el navegador
// avisará una vez («conexión no privada») y bastará aceptarlo. El tráfico por Internet no pasa por
// aquí: el túnel de Cloudflare ya es HTTPS con certificado válido.
//
// Archivos en la carpeta de estado (que tiene la ACL del dueño):
//   .nexo-tls.pfx   certificado + clave privada
//   .nexo-tls.json  { passphrase, creado, hasta, ips[] }   (la contraseña del PFX es aleatoria)
//   nexo-lan.cer    sólo el certificado público (por si se quiere instalar en el celular)
//
// El certificado se regenera solo si falta, si caduca en menos de 30 días o si el equipo tiene una
// IP que el certificado no cubre (cambió de red).

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { atomicWriteJson, readJsonSafe } = require('./safe');

const ARCHIVO_PFX = '.nexo-tls.pfx';
const ARCHIVO_META = '.nexo-tls.json';
const ARCHIVO_CER = 'nexo-lan.cer';
const VALIDEZ_DIAS = 365; // iOS/macOS rechazan certificados de más de 825 días
const RENOVAR_ANTES_DIAS = 30;
const DIA_MS = 24 * 3600 * 1000;

// IPv4 de la LAN: se descartan loopback y las de enlace local (169.254.x.x, sin DHCP).
function ipsLan(interfaces = os.networkInterfaces()) {
  const ips = new Set();
  for (const direcciones of Object.values(interfaces)) {
    for (const d of direcciones || []) {
      if (d.family === 'IPv4' && !d.internal && !d.address.startsWith('169.254.')) ips.add(d.address);
    }
  }
  return [...ips].sort();
}

function rutas(stateDir) {
  return { pfx: path.join(stateDir, ARCHIVO_PFX), meta: path.join(stateDir, ARCHIVO_META), cer: path.join(stateDir, ARCHIVO_CER) };
}

// IPs que lleva el certificado en su campo «Subject Alternative Name».
function ipsDelCertificado(cerDer) {
  try {
    const cert = new crypto.X509Certificate(cerDer);
    return [...String(cert.subjectAltName || '').matchAll(/IP Address:([0-9.]+)/g)].map(m => m[1]);
  } catch { return null; }
}

// Decide si hay que (re)generar. Pura: se prueba con buffers y relojes inventados.
function necesitaRegenerar({ existe, cerDer, ips, ahora = Date.now() }) {
  if (!existe || !cerDer) return { regenerar: true, motivo: 'no existe' };
  let cert;
  try { cert = new crypto.X509Certificate(cerDer); } catch { return { regenerar: true, motivo: 'ilegible' }; }
  const hasta = Date.parse(cert.validTo);
  if (!Number.isFinite(hasta) || hasta - ahora < RENOVAR_ANTES_DIAS * DIA_MS) return { regenerar: true, motivo: 'por caducar' };
  const cubiertas = new Set(ipsDelCertificado(cerDer) || []);
  const faltan = ips.filter(ip => !cubiertas.has(ip));
  if (faltan.length) return { regenerar: true, motivo: `cambió la red (${faltan.join(', ')})` };
  return { regenerar: false, motivo: 'vigente' };
}

// Script de PowerShell 5.1 (siempre presente en Windows). La contraseña llega por entorno, no por la
// línea de órdenes. El certificado se crea en el almacén del usuario sólo el tiempo de exportarlo.
function scriptPowerShell({ nombres, ips, dias = VALIDEZ_DIAS }) {
  const san = ['2.5.29.17={text}' + [...nombres.map(n => `DNS=${n}`), ...ips.map(ip => `IPAddress=${ip}`)].join('&')];
  const comillas = texto => `'${String(texto).replace(/'/g, "''")}'`;
  return [
    "$ErrorActionPreference = 'Stop'",
    // Desde pwsh o Node el proveedor Cert: puede no haberse cargado todavía.
    // PKI contiene New-SelfSignedCertificate, pero no monta ese proveedor.
    'Import-Module Microsoft.PowerShell.Security -ErrorAction Stop',
    `$cert = New-SelfSignedCertificate -Subject ${comillas('CN=NEXO ' + (nombres[1] || nombres[0]))} -TextExtension @(${comillas(san[0])}, '2.5.29.37={text}1.3.6.1.5.5.7.3.1') -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -NotAfter (Get-Date).AddDays(${Number(dias)}) -CertStoreLocation Cert:\\CurrentUser\\My`,
    'try {',
    "  $clave = ConvertTo-SecureString -String $env:NEXO_TLS_PASS -AsPlainText -Force",
    "  Export-PfxCertificate -Cert $cert -FilePath $env:NEXO_TLS_PFX -Password $clave -CryptoAlgorithmOption AES256_SHA256 | Out-Null",
    "  Export-Certificate -Cert $cert -FilePath $env:NEXO_TLS_CER -Type CERT | Out-Null",
    '} finally {',
    '  Remove-Item -LiteralPath ("Cert:\\CurrentUser\\My\\" + $cert.Thumbprint) -Force -ErrorAction SilentlyContinue',
    '}'
  ].join('\n');
}

// El script va a un archivo temporal y se corre con -File: por stdin (`-Command -`) PowerShell 5.1
// no ejecuta los bloques `try { … } finally { … }` de varias líneas (sale con 0 sin hacer nada).
function ejecutarPowerShell(script, entorno, esperaMs = 30000) {
  const archivo = path.join(os.tmpdir(), `nexo-tls-${process.pid}-${crypto.randomBytes(4).toString('hex')}.ps1`);
  fs.writeFileSync(archivo, `﻿${script}\r\n`, 'utf8'); // BOM: PowerShell 5.1 lee UTF-8 sólo con él
  return new Promise((resolver, rechazar) => {
    // pwsh hereda rutas de módulos de la versión 7. Windows PowerShell 5.1 no
    // puede cargar sus datos de tipos: se limita este hijo a sus módulos nativos.
    const env = { ...process.env, ...entorno };
    for (const clave of Object.keys(env)) {
      if (clave.toLowerCase() === 'psmodulepath') delete env[clave];
    }
    env.PSModulePath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules');
    const hijo = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', archivo], {
      env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    let salida = '';
    hijo.stdout.on('data', trozo => { salida += trozo; });
    hijo.stderr.on('data', trozo => { salida += trozo; });
    const terminar = () => { try { fs.rmSync(archivo, { force: true }); } catch {} };
    const limite = setTimeout(() => { try { hijo.kill(); } catch {} terminar(); rechazar(new Error('PowerShell tardó demasiado generando el certificado.')); }, esperaMs);
    hijo.on('error', error => { clearTimeout(limite); terminar(); rechazar(error); });
    hijo.on('close', codigo => {
      clearTimeout(limite);
      terminar();
      if (codigo === 0) resolver(salida);
      else rechazar(new Error(`No se pudo crear el certificado (${salida.trim().split(/\r?\n/)[0] || 'código ' + codigo}).`));
    });
  });
}

// Devuelve { pfx, passphrase, ips, regenerado, motivo } o lanza Error con un mensaje en español.
// `generar` se inyecta en las pruebas para no depender de PowerShell.
async function asegurarCertificado({ stateDir, ips = ipsLan(), hostname = os.hostname(), plataforma = process.platform, ahora = Date.now(), generar = ejecutarPowerShell, log = () => {} }) {
  if (plataforma !== 'win32') throw new Error('El HTTPS de la LAN sólo está disponible en Windows por ahora.');
  const archivos = rutas(stateDir);
  const direcciones = [...new Set(['127.0.0.1', ...ips])];
  const nombres = ['localhost', hostname];

  let meta = readJsonSafe(archivos.meta, null);
  let cerDer = null;
  try { cerDer = fs.readFileSync(archivos.cer); } catch {}
  const existe = Boolean(meta && meta.passphrase && fs.existsSync(archivos.pfx));
  const decision = necesitaRegenerar({ existe, cerDer, ips: direcciones, ahora });

  if (decision.regenerar) {
    log(`HTTPS LAN: generando certificado (${decision.motivo})`);
    const passphrase = crypto.randomBytes(24).toString('hex');
    const temporal = { pfx: `${archivos.pfx}.nuevo`, cer: `${archivos.cer}.nuevo` };
    await generar(scriptPowerShell({ nombres, ips: direcciones }), { NEXO_TLS_PASS: passphrase, NEXO_TLS_PFX: temporal.pfx, NEXO_TLS_CER: temporal.cer });
    // Se publican juntos sólo si la generación terminó bien: un fallo a medias no deja un PFX sin su meta.
    fs.renameSync(temporal.pfx, archivos.pfx);
    fs.renameSync(temporal.cer, archivos.cer);
    try { fs.chmodSync(archivos.pfx, 0o600); } catch {}
    cerDer = fs.readFileSync(archivos.cer);
    const cert = new crypto.X509Certificate(cerDer);
    meta = { pfx: ARCHIVO_PFX, passphrase, creado: new Date(ahora).toISOString(), hasta: new Date(Date.parse(cert.validTo)).toISOString(), ips: direcciones };
    atomicWriteJson(archivos.meta, meta, 0o600);
  }
  return { pfx: fs.readFileSync(archivos.pfx), passphrase: meta.passphrase, ips: direcciones, regenerado: decision.regenerar, motivo: decision.motivo };
}

// Certificado público para descargarlo (nexo-lan.cer); null si aún no existe.
function leerCertificadoPublico(stateDir) {
  try { return fs.readFileSync(rutas(stateDir).cer); } catch { return null; }
}

module.exports = {
  ARCHIVO_PFX, ARCHIVO_META, ARCHIVO_CER, VALIDEZ_DIAS,
  ipsLan, ipsDelCertificado, necesitaRegenerar, scriptPowerShell, asegurarCertificado, leerCertificadoPublico, rutas
};
