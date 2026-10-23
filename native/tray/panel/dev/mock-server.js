#!/usr/bin/env node
// Servidor de desarrollo del panel de NEXO.
// Simula toda la API de CONTRATO.md con estado en memoria, para probar la interfaz sin
// nexo-tray.exe. Sin dependencias:  node native/tray/panel/dev/mock-server.js
//
// Abrir: http://127.0.0.1:18900/?k=dev   (la clave de desarrollo es «dev»)
// Escenarios (variable MOCK_ESCENARIO o /?k=dev&estado=<nombre> o /dev/escenario?nombre=<n>):
//   normal      todo funciona
//   detenido    NEXO arranca detenido
//   sin-tarea   autoarranque.instalado = false
//   sin-admin   elevado = false
//   sin-enlaces estado «conectando» sin ningún enlace publicado
//   errores     todas las acciones POST devuelven {ok:false,error}
//   sin-dispositivos  la lista de dispositivos con acceso está vacía
// La apariencia (GET/POST /api/apariencia) vive en memoria y se inyecta en el HTML igual que lo hace
// el servidor real (data-tema y data-pref en <html>); empieza en reymuerto/auto/false.
// Utilidades: /dev/caducar (borra la cookie -> 401), /dev/red?caida=1 (corta las conexiones /api).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUERTO = 18900;
const CLAVE = 'dev';
const RAIZ = path.join(__dirname, '..');
// Lo único que se sirve: estos archivos y el contenido de estas carpetas (como el go:embed del panel real).
const RAIZ_ARCHIVOS = ['index.html', 'panel.css', 'panel.js', 'tema-inicial.js'];
const CARPETAS = ['temas', 'fuentes', 'img'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png',
};
const TEMAS = ['cabina', 'nativa', 'reymuerto', 'cianotipo', 'bloque'];

// URL → ruta de archivo, o null. Se compara contra el listado real de la carpeta: nada de path.join
// con lo que pida el navegador.
function archivoEstatico(ruta) {
  if (ruta === '/') ruta = '/index.html';
  const partes = ruta.split('/').filter(Boolean);
  if (partes.length === 1 && RAIZ_ARCHIVOS.includes(partes[0])) return path.join(RAIZ, partes[0]);
  if (partes.length === 2 && CARPETAS.includes(partes[0])) {
    let lista = [];
    try { lista = fs.readdirSync(path.join(RAIZ, partes[0])); } catch { /* carpeta ausente */ }
    if (lista.includes(partes[1]) && MIME[path.extname(partes[1])]) return path.join(RAIZ, partes[0], partes[1]);
  }
  return null;
}

/* ---------------------------- estado en memoria --------------------------- */
let escenario = process.env.MOCK_ESCENARIO || 'normal';
let redCaida = false;
const S = {
  estado: 'activo',
  ocupado: '',
  token: crypto.randomBytes(12).toString('hex'),
  dominio: 'cuando-lago-azul-demo',
  autoarranque: { instalado: true, activo: true },
  ajustes: { modo: 'both', gpu: true, micDispositivo: 'CABLE Input', httpsLan: false },
  ajustesPendientes: false,
  turn: { proveedor: 'ninguno', cloudflareKeyId: '', tieneApiToken: false, manualUrls: [], manualUsuario: '', tieneCredencial: false },
  // Red como en la PC del dueño: Ethernet marcada Pública y reglas que Windows creó solo.
  red: {
    comprobado: true, perfiles: [{ nombre: 'Red 3', interfaz: 'Ethernet', categoria: 'Public' }], todasPublicas: true,
    reglasPublicas: [
      { nombre: 'Node.js JavaScript Runtime', programa: 'C:\\Program Files\\nodejs\\node.exe', protocolo: 'TCP' },
      { nombre: 'Node.js JavaScript Runtime', programa: 'C:\\Program Files\\nodejs\\node.exe', protocolo: 'UDP' },
      { nombre: 'nexo-gpu-webrtc', programa: 'D:\\nexo-remoto\\bin\\win\\nexo-gpu-webrtc.exe', protocolo: 'TCP' },
      { nombre: 'nexo-gpu-webrtc', programa: 'D:\\nexo-remoto\\bin\\win\\nexo-gpu-webrtc.exe', protocolo: 'UDP' },
    ],
    reglasNexo: 3, reglaHttps: false, puertoHttps: 8443,
  },
  apariencia: { tema: 'reymuerto', modo: 'auto', porDispositivo: false },
  aviso: { metodo: 'ninguno', ntfyServidor: 'https://ntfy.sh', ntfyTema: '', telegramChat: '', tieneTelegramToken: false },
  temporizadores: [],
};

function aplicarEscenario(nombre) {
  escenario = nombre;
  S.temporizadores.forEach(clearTimeout);
  S.temporizadores = [];
  S.ocupado = '';
  S.estado = 'activo';
  S.autoarranque = { instalado: escenario !== 'sin-tarea', activo: escenario !== 'sin-tarea' };
  if (escenario === 'detenido') S.estado = 'detenido';
  if (escenario === 'sin-enlaces') S.estado = 'conectando';
}
aplicarEscenario(escenario);

const elevado = () => escenario !== 'sin-admin';
const espera = (ms, fn) => S.temporizadores.push(setTimeout(fn, ms));

function enlaces() {
  if (S.estado === 'detenido' || escenario === 'sin-enlaces') return { internet: '', local: '', localSeguro: '' };
  const m = S.ajustes.modo;
  return {
    internet: S.estado === 'activo' && m !== 'local' ? `https://${S.dominio}.trycloudflare.com/?token=${S.token}` : '',
    local: m !== 'remote' ? `http://192.168.1.5:8765/?token=${S.token}` : '',
    localSeguro: m !== 'remote' && S.ajustes.httpsLan && !S.ajustesPendientes ? `https://192.168.1.5:8443/?token=${S.token}` : '',
  };
}

// Dispositivos de ejemplo (sólo etiqueta y fechas, como el servidor real; nunca ids ni hashes).
function dispositivos() {
  if (escenario === 'sin-dispositivos') return [];
  const ahora = Date.now(), min = 60000, dia = 24 * 60 * min;
  return [
    { etiqueta: 'Pixel de Letzus · Chrome', ultimaVez: ahora - 2 * min, creado: ahora - 12 * dia },
    { etiqueta: 'Laptop de la oficina · Edge', ultimaVez: ahora - 3 * 60 * min, creado: ahora - 40 * dia },
    { etiqueta: 'iPad · Safari', ultimaVez: ahora - 5 * dia, creado: ahora - 90 * dia },
  ];
}

// Misma validación que apariencia.go (estricta al escribir).
function validarApariencia(a) {
  if (!TEMAS.includes(a.tema)) return 'Esa apariencia no existe: elige Cabina, Nativa, Rey Muerto, Cianotipo o Bloque.';
  if (!['auto', 'claro', 'oscuro'].includes(a.modo)) return 'El modo debe ser automático, claro u oscuro.';
  return '';
}

function estadoJSON() {
  const txt = { activo: 'NEXO · activo', conectando: 'NEXO · conectando…', detenido: 'NEXO · detenido' }[S.estado];
  return {
    estado: S.estado, textoEstado: txt, modo: S.ajustes.modo, enlaces: enlaces(),
    autoarranque: S.autoarranque, elevado: elevado(), ajustes: S.ajustes,
    ajustesPendientes: S.ajustesPendientes, ocupado: S.ocupado, version: '1.0',
  };
}

/* Simula una acción larga: texto «ocupado» durante un rato y luego estado final. */
function accionLarga(texto, ms, intermedio, final, alTerminar) {
  S.ocupado = texto;
  if (intermedio) S.estado = intermedio;
  espera(ms, () => {
    S.ocupado = '';
    S.estado = final;
    if (alTerminar) alTerminar();
  });
}
function reiniciar(texto = 'Reiniciando…', ms = 6000) {
  S.ocupado = texto;
  S.estado = 'detenido';
  espera(1800, () => { S.estado = 'conectando'; });
  espera(ms, () => { S.ocupado = ''; S.estado = 'activo'; S.ajustesPendientes = false; });
}

/* ------------------------------- utilidades ------------------------------- */
function json(res, obj, codigo = 200) {
  const cuerpo = Buffer.from(JSON.stringify(obj));
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': cuerpo.length });
  res.end(cuerpo);
}
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));

function qrSVG(texto) {
  // QR de mentira: 25x25 módulos pseudoaleatorios a partir del texto, con los tres cuadros de esquina.
  const N = 25;
  const h = crypto.createHash('sha256').update(texto).digest();
  let celdas = '';
  const esquina = (x, y) => (x < 8 && y < 8) || (x >= N - 8 && y < 8) || (x < 8 && y >= N - 8);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let on;
    if (esquina(x, y)) {
      const cx = x < 8 ? x : x - (N - 8), cy = y < 8 ? y : y - (N - 8);
      on = cx === 7 || cy === 7 ? false : cx === 0 || cx === 6 || cy === 0 || cy === 6 || (cx >= 2 && cx <= 4 && cy >= 2 && cy <= 4);
    } else {
      const i = (y * N + x) % 256;
      on = ((h[i % 32] >> (i % 8)) & 1) === 1;
    }
    if (on) celdas += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${N + 2} ${N + 2}" shape-rendering="crispEdges"><rect x="-1" y="-1" width="${N + 2}" height="${N + 2}" fill="#fff"/><g fill="#000">${celdas}</g></svg>`;
}

const TEXTO_DOCTOR = () => `NEXO · diagnóstico de Windows
Equipo: PC-LETZUS · Windows 11 Pro 10.0.26200

[ OK ] Permisos de administrador ........ ${elevado() ? 'sí' : 'NO (la bandeja no es administrador)'}
[ OK ] Tarea de inicio automático ....... ${S.autoarranque.instalado ? 'instalada' : 'NO instalada'}
[ OK ] Servidor NEXO (127.0.0.1:8765) ... ${S.estado === 'detenido' ? 'no responde' : 'responde'}
[ OK ] Túnel de Cloudflare ............... ${S.estado === 'activo' ? 'publicado' : 'sin publicar'}
[ OK ] Captura de pantalla (2 monitores) . 1920x1080 + 1920x1080
[ OK ] Codificador NVENC (RTX 3060 Ti) ... disponible
[AVISO] Cable de audio virtual ........... "${S.ajustes.micDispositivo}" encontrado
[ OK ] Regla de firewall (red privada) ... presente
[ OK ] Espacio en disco .................. 412 GB libres

Resultado: sin problemas graves.
`;

function registro() {
  const lineas = [];
  const t0 = Date.now() - 120 * 4000;
  const msgs = [
    'launcher: arrancando server.js (pid 11824)', 'server: escuchando en 0.0.0.0:8765',
    'gpu-stream: NVENC listo, 1920x1080@30', 'cloudflared: registrada conexión con el borde (mad01)',
    'server: cliente conectado desde 192.168.1.23', 'webrtc: pista de vídeo H.264 compartida (1 cliente)',
    'server: portapapeles recibido (31 bytes)', 'microfono: salida "CABLE Input" abierta',
    'server: cliente desconectado (192.168.1.23)',
  ];
  for (let i = 0; i < 120; i++) {
    const d = new Date(t0 + i * 4000);
    const ts = d.toISOString().replace('T', ' ').slice(0, 19);
    lineas.push(`${ts}  ${msgs[i % msgs.length]}`);
  }
  return lineas.join('\n');
}

function codigoAleatorio() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const c = () => abc[crypto.randomInt(abc.length)];
  return Array.from({ length: 4 }, c).join('') + '-' + Array.from({ length: 4 }, c).join('');
}

/* -------------------------------- manejador -------------------------------- */
async function leerCuerpo(req) {
  const trozos = [];
  for await (const t of req) trozos.push(t);
  const s = Buffer.concat(trozos).toString('utf8');
  if (!s) return {};
  try { return JSON.parse(s); } catch { return null; }
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const ruta = url.pathname;
  console.log(new Date().toISOString().slice(11, 19), req.method, req.url);

  /* Utilidades de desarrollo */
  if (ruta === '/dev/escenario') { aplicarEscenario(url.searchParams.get('nombre') || 'normal'); return json(res, { ok: true, escenario }); }
  if (ruta === '/dev/caducar') {
    res.writeHead(200, { 'Set-Cookie': 'nexo_panel=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict', 'Content-Type': 'text/plain' });
    return res.end('cookie borrada');
  }
  if (ruta === '/dev/red') { redCaida = url.searchParams.get('caida') === '1'; return json(res, { ok: true, redCaida }); }

  /* Canje de la clave por la cookie */
  if (ruta === '/' && url.searchParams.has('k')) {
    if (url.searchParams.get('estado')) aplicarEscenario(url.searchParams.get('estado'));
    if (url.searchParams.get('k') !== CLAVE) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Clave del panel incorrecta'); }
    res.writeHead(302, { 'Set-Cookie': 'nexo_panel=ok-dev; Path=/; HttpOnly; SameSite=Strict', Location: '/' });
    return res.end();
  }

  /* Archivos de la interfaz */
  const estatico = req.method === 'GET' ? archivoEstatico(ruta) : null;
  if (estatico) {
    fs.readFile(estatico, (err, datos) => {
      if (err) { res.writeHead(500); return res.end('No se pudo leer ' + estatico); }
      if (path.basename(estatico) === 'index.html') {
        // Igual que conAparienciaInicial en panel.go: el tema llega ya puesto en <html>.
        const a = S.apariencia;
        datos = Buffer.from(datos.toString('utf8').replace('<html lang="es">', `<html lang="es" data-tema="${a.tema}" data-pref="${a.modo}">`));
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(estatico)], 'Cache-Control': 'no-store' });
      res.end(datos);
    });
    return;
  }

  /* API */
  if (ruta.startsWith('/api/')) {
    if (redCaida) return req.socket.destroy();
    if (cookies(req).nexo_panel !== 'ok-dev') return json(res, { error: 'sin sesión' }, 401);

    if (req.method === 'POST') {
      if (req.headers['x-nexo-panel'] !== '1' || !(req.headers['content-type'] || '').includes('application/json')) {
        return json(res, { ok: false, error: 'Falta la cabecera X-NEXO-Panel' }, 403);
      }
    }
    const cuerpo = req.method === 'POST' ? await leerCuerpo(req) : {};
    if (cuerpo === null) return json(res, { ok: false, error: 'JSON inválido' }, 400);
    const retardo = (ms) => new Promise((r) => setTimeout(r, ms));

    if (req.method === 'POST' && escenario === 'errores') {
      await retardo(300);
      return json(res, { ok: false, error: 'No se pudo completar: el componente no respondió (error simulado)' });
    }

    switch (`${req.method} ${ruta}`) {
      case 'GET /api/estado': return json(res, estadoJSON());

      case 'GET /api/apariencia': return json(res, { ok: true, apariencia: S.apariencia });
      case 'POST /api/apariencia': {
        // Los campos que no lleguen conservan su valor (igual que el servidor real).
        const nueva = { ...S.apariencia };
        for (const k of ['tema', 'modo']) if (k in cuerpo) nueva[k] = cuerpo[k];
        if ('porDispositivo' in cuerpo) {
          if (typeof cuerpo.porDispositivo !== 'boolean') return json(res, { ok: false, error: 'La petición no es un JSON válido.' });
          nueva.porDispositivo = cuerpo.porDispositivo;
        }
        const error = validarApariencia(nueva);
        if (error) return json(res, { ok: false, error });
        S.apariencia = nueva;
        return json(res, { ok: true, apariencia: S.apariencia });
      }
      case 'GET /api/dispositivos': return json(res, { ok: true, dispositivos: dispositivos() });

      case 'POST /api/iniciar':
        if (S.estado !== 'detenido') return json(res, { ok: false, error: 'NEXO ya está en marcha' });
        accionLarga('Iniciando…', 1500, 'conectando', 'conectando', () => {
          if (escenario !== 'sin-enlaces') espera(3500, () => { S.estado = 'activo'; });
        });
        return json(res, { ok: true });
      case 'POST /api/detener':
        if (S.estado === 'detenido') return json(res, { ok: false, error: 'NEXO ya está detenido' });
        accionLarga('Deteniendo…', 2200, null, 'detenido');
        return json(res, { ok: true });
      case 'POST /api/reiniciar':
        reiniciar();
        return json(res, { ok: true });

      case 'POST /api/autoarranque':
        await retardo(400);
        if (!S.autoarranque.instalado) return json(res, { ok: false, error: 'La tarea de inicio de Windows no está instalada' });
        if (!elevado()) return json(res, { ok: false, error: 'Se necesitan permisos de administrador' });
        S.autoarranque.activo = !!cuerpo.activo;
        return json(res, { ok: true, autoarranque: S.autoarranque });

      case 'POST /api/ajustes': {
        await retardo(300);
        if (!['both', 'local', 'remote'].includes(cuerpo.modo)) return json(res, { ok: false, error: 'Modo no válido' });
        const mic = String(cuerpo.micDispositivo || '');
        if (mic.length > 80) return json(res, { ok: false, error: 'El nombre del micrófono es demasiado largo (máx. 80)' });
        const nuevos = { modo: cuerpo.modo, gpu: !!cuerpo.gpu, micDispositivo: mic, httpsLan: !!cuerpo.httpsLan };
        const cambio = JSON.stringify(S.ajustes) !== JSON.stringify(nuevos);
        S.ajustes = nuevos;
        if (cambio) S.ajustesPendientes = true;
        return json(res, { ok: true, ajustes: S.ajustes, requiereReinicio: true });
      }

      case 'POST /api/emparejar': {
        await retardo(500);
        const min = Number(cuerpo.minutos) || 10;
        const codigo = codigoAleatorio();
        return json(res, { ok: true, codigo, texto: `Código de emparejamiento: ${codigo}\nVálido ${min} min. Escríbelo en NEXO desde el dispositivo nuevo.` });
      }

      case 'POST /api/rotar':
        S.token = crypto.randomBytes(12).toString('hex');
        reiniciar('Reiniciando con el enlace nuevo…', 9000);
        return json(res, { ok: true, mensaje: 'Enlace rotado. NEXO se está reiniciando (unos 10 segundos).' });

      case 'POST /api/contrasena':
        if (!cuerpo.usuario || !cuerpo.contrasena) return json(res, { ok: false, error: 'Faltan el usuario o la contraseña' });
        reiniciar('Aplicando la contraseña…', 5000);
        return json(res, { ok: true, mensaje: 'Contraseña de «Mi PC» cambiada. NEXO se está reiniciando.' });

      case 'GET /api/aviso': return json(res, S.aviso);
      case 'POST /api/aviso': {
        await retardo(300);
        if (!['ninguno', 'ntfy', 'telegram'].includes(cuerpo.metodo)) return json(res, { ok: false, error: 'Método no válido' });
        const tieneToken = cuerpo.telegramToken ? true : S.aviso.tieneTelegramToken;
        S.aviso = {
          metodo: cuerpo.metodo, ntfyServidor: cuerpo.ntfyServidor || '', ntfyTema: cuerpo.ntfyTema || '',
          telegramChat: cuerpo.telegramChat || '', tieneTelegramToken: tieneToken,
        };
        return json(res, { ok: true });
      }
      case 'POST /api/aviso/prueba':
        await retardo(900);
        if (S.aviso.metodo === 'ninguno') return json(res, { ok: false, error: 'No hay ningún método de aviso configurado' });
        return json(res, { ok: true, texto: 'Aviso de prueba enviado.' });

      case 'GET /api/turn': return json(res, { ok: true, turn: S.turn });
      case 'POST /api/turn': {
        await retardo(300);
        const p = cuerpo.proveedor;
        if (!['ninguno', 'cloudflare', 'manual'].includes(p)) return json(res, { ok: false, error: 'Elige cómo quieres conectar: ninguno, Cloudflare o manual.' });
        if (p === 'cloudflare') {
          if (!/^[A-Za-z0-9_-]{8,64}$/.test((cuerpo.cloudflare || {}).keyId || '')) return json(res, { ok: false, error: 'Escribe el «Key ID» de tu clave TURN de Cloudflare (letras y números, sin espacios).' });
          if (!(cuerpo.cloudflare || {}).apiToken && !S.turn.tieneApiToken) return json(res, { ok: false, error: 'Escribe el «API Token» de esa clave TURN (Cloudflare lo muestra una sola vez al crearla).' });
        }
        if (p === 'manual' && !((cuerpo.manual || {}).urls || []).length) return json(res, { ok: false, error: 'Escribe al menos una dirección de servidor (por ejemplo turn:mi-servidor.net:3478).' });
        const cf = cuerpo.cloudflare || {}, man = cuerpo.manual || {};
        S.turn = {
          proveedor: p, cloudflareKeyId: cf.keyId || '', tieneApiToken: !!cf.apiToken || S.turn.tieneApiToken,
          manualUrls: man.urls || [], manualUsuario: man.usuario || '', tieneCredencial: !!man.credencial || S.turn.tieneCredencial,
        };
        return json(res, { ok: true, turn: S.turn });
      }
      case 'POST /api/turn/prueba':
        await retardo(1500);
        if (S.turn.proveedor === 'ninguno') return json(res, { ok: false, error: 'No hay un TURN configurado: NEXO usa sólo STUN (suficiente en casa; por datos móviles puede caer al respaldo JPEG).' });
        if (S.turn.cloudflareKeyId === 'malo') return json(res, { ok: false, error: 'Cloudflare rechazó el token de API: revisa que sea el «TURN Key API Token» de esa clave.' });
        return json(res, { ok: true, texto: 'TURN funcionando: ofrece 2 ruta(s) de retransmisión (70 ms).' });

      case 'GET /api/red':
        await retardo(900);
        return json(res, { ok: true, red: { ...S.red, elevado: elevado() } });
      case 'POST /api/red/privada':
        await retardo(900);
        if (!elevado()) return json(res, { ok: false, error: 'Windows sólo deja cambiar el firewall y la red a un programa con permisos de administrador.' });
        S.red.perfiles = S.red.perfiles.map((p) => ({ ...p, categoria: 'Private' }));
        S.red.todasPublicas = false;
        return json(res, { ok: true, red: { ...S.red, elevado: elevado() } });
      case 'POST /api/red/cerrar-publicas':
        await retardo(900);
        if (!elevado()) return json(res, { ok: false, error: 'Windows sólo deja cambiar el firewall y la red a un programa con permisos de administrador.' });
        if (S.red.todasPublicas && !cuerpo.forzar) return json(res, { ok: false, error: 'Tu red actual está marcada como Pública: si cierras estas reglas, el celular dejará de entrar por el Wi-Fi de casa. Primero marca tu red como Privada.' });
        S.red.reglasPublicas = [];
        return json(res, { ok: true, red: { ...S.red, elevado: elevado() }, mensaje: 'Listo: se cerraron 4 regla(s) para redes públicas.' });
      case 'POST /api/red/regla-https':
        await retardo(600);
        S.red.reglaHttps = true;
        return json(res, { ok: true, red: { ...S.red, elevado: elevado() } });

      case 'GET /api/doctor':
        await retardo(escenario === 'errores' ? 1500 : 7000);
        if (escenario === 'errores') return json(res, { ok: false, error: 'El diagnóstico no pudo ejecutarse (error simulado)' });
        return json(res, { ok: true, texto: TEXTO_DOCTOR() });
      case 'GET /api/registro': return json(res, { texto: registro() });
      case 'POST /api/abrir-registros': return json(res, { ok: true });

      case 'GET /api/qr': {
        const e = enlaces()[url.searchParams.get('que')];
        if (!e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Sin enlace'); }
        const svg = Buffer.from(qrSVG(e));
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store', 'Content-Length': svg.length });
        return res.end(svg);
      }

      case 'POST /api/salir':
        json(res, { ok: true });
        console.log('Salir solicitado (detener=%s). El mock sigue activo.', cuerpo.detener);
        if (cuerpo.detener) { S.estado = 'detenido'; S.ocupado = ''; }
        return;
    }
    return json(res, { ok: false, error: 'Ruta desconocida' }, 404);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('No encontrado');
});

servidor.listen(PUERTO, '127.0.0.1', () => {
  console.log(`Panel de NEXO (mock) en http://127.0.0.1:${PUERTO}/?k=${CLAVE}   escenario: ${escenario}`);
});
process.on('SIGINT', () => process.exit(0));
