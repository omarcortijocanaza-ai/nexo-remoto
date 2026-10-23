'use strict';

// Comprueba de verdad el TURN configurado: pide las credenciales (Cloudflare) o usa las manuales,
// arranca un puente Pion de prueba en puertos libres y le pide recolectar candidatos ICE. Si hay un
// candidato «relay», el TURN acepta las credenciales y ofrece ruta de retransmisión.
//
//   node scripts/turn-test.js [--json]      (lo llaman `nexo-control turn-test` y el panel)
//
// No toca el NEXO en marcha ni el vídeo: el puente de prueba es un proceso aparte que se cierra al acabar.

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { defaultStateDir } = require('../lib/paths');
const { crearProveedorIce, leerConfig } = require('../lib/ice');

const raiz = path.join(__dirname, '..');
const comoJson = process.argv.includes('--json');

function puertoLibre() {
  return new Promise((resolver, rechazar) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(error => (error ? rechazar(error) : resolver(port)));
    });
    srv.on('error', rechazar);
  });
}

function exePuente() {
  if (process.env.NEXO_GPU_WEBRTC_EXE) return process.env.NEXO_GPU_WEBRTC_EXE;
  return path.join(raiz, 'bin', process.platform === 'win32' ? 'win' : '', process.platform === 'win32' ? 'nexo-gpu-webrtc.exe' : 'nexo-gpu-webrtc');
}

function enviarJson(puerto, ruta, cuerpo) {
  return new Promise((resolver, rechazar) => {
    const datos = Buffer.from(JSON.stringify(cuerpo));
    const req = http.request({ host: '127.0.0.1', port: puerto, method: 'POST', path: ruta, timeout: 15000, headers: { 'content-type': 'application/json', 'content-length': datos.length } }, res => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', trozo => { texto += trozo; });
      res.on('end', () => resolver({ estado: res.statusCode, texto }));
    });
    req.on('timeout', () => req.destroy(new Error('El puente de prueba no respondió.')));
    req.on('error', rechazar);
    req.end(datos);
  });
}

async function esperarPuente(puerto, hijo) {
  const limite = Date.now() + 8000;
  while (Date.now() < limite) {
    if (hijo.exitCode !== null) throw new Error('El puente de prueba se cerró al arrancar.');
    const vivo = await new Promise(resolver => {
      const req = http.get({ host: '127.0.0.1', port: puerto, path: '/health', timeout: 500 }, res => { res.resume(); resolver(res.statusCode === 200); });
      req.on('error', () => resolver(false));
      req.on('timeout', () => { req.destroy(); resolver(false); });
    });
    if (vivo) return;
    await new Promise(resolver => setTimeout(resolver, 150));
  }
  throw new Error('El puente de prueba no arrancó a tiempo.');
}

async function probar() {
  const stateDir = defaultStateDir(raiz);
  const config = leerConfig(stateDir);
  if (config.proveedor === 'ninguno') return { ok: false, motivo: 'sin-turn', mensaje: 'No hay un TURN configurado: NEXO usa sólo STUN (suficiente en casa; por datos móviles puede caer al respaldo JPEG).' };

  let servidores;
  try { servidores = await crearProveedorIce({ stateDir }).comprobar(); }
  catch (error) { return { ok: false, motivo: 'credenciales', mensaje: error.message }; }

  const exe = exePuente();
  if (!fs.existsSync(exe)) return { ok: false, motivo: 'sin-puente', mensaje: `Falta ${exe}: ejecuta scripts\\windows\\build.ps1.` };

  const [puertoHttp, puertoRtp] = [await puertoLibre(), await puertoLibre()];
  const hijo = spawn(exe, [], { env: { ...process.env, NEXO_GPU_WEBRTC_PORT: String(puertoHttp), NEXO_GPU_RTP_PORT: String(puertoRtp) }, stdio: 'ignore', windowsHide: true });
  try {
    await esperarPuente(puertoHttp, hijo);
    const respuesta = await enviarJson(puertoHttp, '/ice-test', { iceServers: servidores });
    if (respuesta.estado === 404) return { ok: false, motivo: 'puente-viejo', mensaje: 'El puente instalado es anterior a esta función: ejecuta scripts\\windows\\build.ps1 y reinicia NEXO.' };
    if (respuesta.estado !== 200) return { ok: false, motivo: 'puente', mensaje: `El puente de prueba respondió ${respuesta.estado}: ${respuesta.texto.trim().slice(0, 120)}` };
    const datos = JSON.parse(respuesta.texto);
    if (datos.relay > 0) return { ok: true, relay: datos.relay, srflx: datos.srflx, host: datos.host, ms: datos.ms, mensaje: `TURN funcionando: ofrece ${datos.relay} ruta(s) de retransmisión (${datos.ms} ms).` };
    return { ok: false, motivo: 'sin-relay', relay: 0, srflx: datos.srflx, host: datos.host, ms: datos.ms, mensaje: 'El TURN respondió pero no ofreció ninguna ruta de retransmisión: revisa el usuario, la clave y que el firewall deje salir UDP 3478 y TCP 443.' };
  } catch (error) {
    return { ok: false, motivo: 'error', mensaje: error.message };
  } finally {
    try { hijo.kill(); } catch {}
  }
}

probar().then(resultado => {
  if (comoJson) console.log(JSON.stringify(resultado));
  else console.log(`${resultado.ok ? 'OK    ' : (resultado.motivo === 'sin-turn' ? 'AVISO ' : 'FALLA ')} ${resultado.mensaje}`);
  process.exit(resultado.ok ? 0 : (resultado.motivo === 'sin-turn' ? 0 : 1));
});
