#!/usr/bin/env node
'use strict';

// Instancia AISLADA del servidor para revisar el cliente web (index.html y microfono.html) sin tocar el NEXO real:
// escucha sólo en 127.0.0.1, usa un estado temporal propio (no el token, ni los dispositivos, ni el perfil del
// dueño), sin vídeo por GPU, sin micrófono virtual y sin pedir contraseña. Con `?demo=1` en la URL el cliente
// dibuja un escritorio de muestra y no abre WebSocket, WebRTC ni micrófono, así que nunca se captura la pantalla real.
//
//   node scripts/ui/servir-cliente.js [--puerto 18777] [--tema reymuerto] [--modo auto] [--por-dispositivo]
//
// Abre   http://127.0.0.1:<puerto>/?demo=1          (portal «¿A dónde entramos?»)
//        …/?demo=1&vista=acceso|elegir|login|sesion|mas|teclado|atajos|diagnostico|compartir
//        …/?demo=1&cliente=celular|pc&tema=cabina&modo=claro      (sólo pruebas)
//        …/microfono?demo=1
// El tema también se cambia sin reiniciar escribiendo el archivo del estado temporal (se imprime su ruta).

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const args = process.argv.slice(2);
const valor = (nombre, defecto) => { const i = args.indexOf(nombre); return i >= 0 && args[i + 1] ? args[i + 1] : defecto; };
const puerto = Number(valor('--puerto', process.env.NEXO_UI_PUERTO || 18777));
const estado = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-ui-estado-'));
const token = crypto.randomBytes(12).toString('base64url');

fs.writeFileSync(path.join(estado, '.nexo-apariencia.json'), JSON.stringify({
  tema: valor('--tema', 'reymuerto'), modo: valor('--modo', 'auto'), porDispositivo: args.includes('--por-dispositivo')
}));

const hijo = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server.js')], {
  cwd: path.join(__dirname, '..', '..'),
  env: {
    ...process.env,
    REMOTE_KEYBOARD_HOST: '127.0.0.1', REMOTE_KEYBOARD_PORT: String(puerto), REMOTE_KEYBOARD_TOKEN: token,
    NEXO_STATE_DIR: estado, NEXO_GPU: '0', NEXO_MICROFONO: '0', NEXO_REQUIRE_LOGIN: '0'
  },
  stdio: ['ignore', 'inherit', 'inherit']
});

console.log(`Cliente de prueba (aislado): http://127.0.0.1:${puerto}/?demo=1`);
console.log(`Estado temporal: ${estado}`);
console.log(`Apariencia: ${path.join(estado, '.nexo-apariencia.json')}`);

function salir() {
  try { hijo.kill(); } catch {}
  setTimeout(() => { try { fs.rmSync(estado, { recursive: true, force: true }); } catch {} process.exit(0); }, 300);
}
process.on('SIGINT', salir);
process.on('SIGTERM', salir);
hijo.on('exit', () => { try { fs.rmSync(estado, { recursive: true, force: true }); } catch {} process.exit(0); });
