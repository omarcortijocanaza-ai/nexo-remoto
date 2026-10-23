'use strict';

// Arranca el servidor DEL PAQUETE con adaptador de escritorio simulado: prueba
// dependencias y recursos reales sin capturar pantalla ni lanzar agentes nativos.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

async function main() {
  const root = path.resolve(process.argv[2]);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-package-http-'));
  let child;
  try {
    const socket = net.createServer();
    socket.listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(NEXO_|REMOTE_KEYBOARD_|NODE_OPTIONS$)/i.test(key)));
    Object.assign(env, { REMOTE_KEYBOARD_HOST: '127.0.0.1', REMOTE_KEYBOARD_PORT: String(port), REMOTE_KEYBOARD_TOKEN: 'prueba-paquete-sin-secretos', NEXO_STATE_DIR: temp, NEXO_LOGS_DIR: temp, NEXO_GPU: '0', NEXO_MICROFONO: '0', NEXO_REQUIRE_LOGIN: '0', NEXO_TLS_PORT: '0' });
    const code = `
      const id=require.resolve('./platform');
      const fake={name:'prueba',capabilities:{independentSession:false,textBatchMs:0},init:async()=>{},close:()=>{},on:()=>{},listMonitors:async()=>[]};
      require.cache[id]={id,filename:id,loaded:true,exports:new Proxy(fake,{get(o,k){if(k in o)return o[k];throw Error('Operación de escritorio prohibida: '+String(k));}})};
      require('./server');
    `;
    child = spawn(path.join(root, 'runtime/node/node.exe'), ['-e', code], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => done(new Error('El servidor empaquetado no inició en 20 s')), 20000);
      function done(error) { clearTimeout(timer); child.off('exit', exited); child.off('error', failed); child.stdout.off('data', data); error ? reject(error) : resolve(); }
      function exited(code) { done(new Error(`El servidor empaquetado salió (${code}): ${output.slice(-3000)}`)); }
      function failed(error) { done(error); }
      function data(chunk) { output = (output + chunk).slice(-5000); if (output.includes('Teclado remoto activo')) done(); }
      child.stderr.on('data', chunk => { output = (output + chunk).slice(-5000); });
      child.stdout.on('data', data); child.on('exit', exited); child.on('error', failed);
    });
    for (const route of ['/health','/','/assets/viego-mist-keyboard.webp','/assets/viego-wallpaper.webp','/ui/cliente.css','/ui/apariencia.js','/ui/control-tactil.js','/assets/fuentes/Barlow-400.woff2']) {
      const status = await new Promise((resolve, reject) => {
        const req = http.get({host:'127.0.0.1',port,path:route,agent:false}, res => {res.resume();res.on('end',()=>resolve(res.statusCode));});
        req.setTimeout(5000,()=>req.destroy(new Error('Timeout HTTP')));req.on('error',reject);
      });
      const expected = route.startsWith('/?token=') ? 302 : 200;
      assert.equal(status, expected, `${route} status: ${status} !== ${expected}`);
    }
    console.log('OK: servidor del paquete escucha y responde correctamente (salud, redirección de token, imágenes, CSS, JS y fuente).');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const closed = once(child,'close');child.kill();await closed; }
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
