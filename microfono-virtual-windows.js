'use strict';

// El micrófono del celular necesita un destino real dentro de Windows, porque
// ningún programa sabe recibir audio de una pestaña. Windows no deja crear un
// micrófono virtual sin un driver firmado, así que se usa VB-CABLE (gratuito, lo
// instala el dueño): NEXO reproduce la voz en la salida «CABLE Input» y Discord,
// OBS o el navegador eligen «CABLE Output» como micrófono.
//
// Regla que no se negocia: la voz NUNCA puede caer en el dispositivo de salida
// por defecto, o sonaría el micrófono del celular por los altavoces de la casa.
// Por eso `nexo-agent.exe audio-play` busca el dispositivo por nombre y, si no
// existe, sale con código 3 en vez de usar el predeterminado.
//
// Misma API que microfono-virtual.js (Linux) para que microfono-host.js no
// distinga plataformas.

const { spawn, spawnSync } = require('node:child_process');
const { agentCommand } = require('./platform/windows/agent-client');

const NOMBRE_SINK = 'CABLE Input';
const NOMBRE_FUENTE = 'CABLE Output';
const DESCRIPCION = 'CABLE Output (micrófono del celular)';

// El agente sale con este código cuando no hay ningún dispositivo de salida que
// coincida con --match (contrato 4.2).
const CODIGO_SIN_DISPOSITIVO = 3;
const MS_CACHE_ENCONTRADO = 30000;
// Si falta VB-CABLE, cada bloque de audio (100 por segundo) volvería a preguntar:
// se recuerda el fallo unos segundos. Corto, para que al instalar el driver
// baste con reintentar.
const MS_CACHE_AUSENTE = 5000;
// Audio en vivo: si el agente no consume, lo viejo se tira en vez de acumular
// retardo. 96 000 bytes = 1 s de 48 kHz mono s16.
const MAX_PENDIENTE_BYTES = 96000;
const MS_ENTRE_AVISOS = 10000;

let cache = { hasta: 0, resultado: null, error: '' };

function destinoConfigurado() {
  const valor = process.env.NEXO_MIC_DEVICE || process.env.NEXO_MIC_DEVICE_MATCH || NOMBRE_SINK;
  return String(valor).trim() || NOMBRE_SINK;
}

function mensajeSinCable(destino) {
  const base = 'VB-CABLE no está instalado: instala VB-Audio Virtual Cable y reinicia (ver PLAN-MIGRACION-WINDOWS.md, F0)';
  return destino === NOMBRE_SINK ? base : `${base}. No hay ninguna salida que contenga «${destino}» (NEXO_MIC_DEVICE)`;
}

// Idempotente y con caché, como la versión de Linux: se llama al arrancar (para
// avisar pronto en el registro) y otra vez en cada reinicio del proceso de audio.
function asegurarDispositivo() {
  const ahora = Date.now();
  if (cache.hasta > ahora) {
    if (cache.error) throw new Error(cache.error);
    return cache.resultado;
  }
  const destino = destinoConfigurado();
  const { command, args } = agentCommand(['audio-devices']);
  const salida = spawnSync(command, args, { encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 });
  if (salida.error || salida.status !== 0) {
    // No cachear un fallo del propio agente: puede ser transitorio.
    throw new Error(`No se pudo listar los dispositivos de audio: ${String(salida.error?.message || salida.stderr || `código ${salida.status}`).trim().slice(0, 200)}`);
  }
  let dispositivos;
  try { dispositivos = JSON.parse(salida.stdout).outputs || []; }
  catch { throw new Error('nexo-agent devolvió una lista de dispositivos ilegible'); }
  const buscado = destino.toLowerCase();
  const existe = dispositivos.some(dispositivo => String(dispositivo.name || '').toLowerCase().includes(buscado));
  if (!existe) {
    const error = mensajeSinCable(destino);
    cache = { hasta: ahora + MS_CACHE_AUSENTE, resultado: null, error };
    throw new Error(error);
  }
  const resultado = { sink: NOMBRE_SINK, fuente: NOMBRE_FUENTE };
  cache = { hasta: ahora + MS_CACHE_ENCONTRADO, resultado, error: '' };
  return resultado;
}

// El driver lo gestiona el dueño: NEXO no instala ni quita nada.
function descargarDispositivo() {}

class MicrofonoVirtual {
  constructor({ onLog = () => {} } = {}) {
    this.onLog = onLog;
    this.proceso = null;
    this.formato = null;
    this.silenciado = false;
    this.disponible = false;
    this.ultimoAudio = 0;
    this.muestrasEscritas = 0;
    this.nivel = 0;
    this.error = '';
    // Mismo mecanismo que en Linux: si el destino falla, cada bloque volvería a
    // lanzar el proceso. A la tercera se deja de intentar y el error queda a la
    // vista; conectar de nuevo (reiniciarFallos) vuelve a intentarlo.
    this.fallosDeEnlace = 0;
    this.bloqueado = false;
    this.ultimoAviso = { texto: '', cuando: 0 };
  }

  // Lo llama microfono-host.js al aceptar una oferta: si VB-CABLE falta, el
  // celular recibe un error claro («VB-CABLE no está instalado…») en vez de
  // conectarse a un micrófono que nunca llegará a ningún programa.
  comprobarDestino() {
    asegurarDispositivo();
  }

  avisar(texto) {
    const ahora = Date.now();
    if (texto === this.ultimoAviso.texto && ahora - this.ultimoAviso.cuando < MS_ENTRE_AVISOS) return;
    this.ultimoAviso = { texto, cuando: ahora };
    this.onLog(`Micrófono virtual: ${texto}`);
  }

  asegurarProceso(sampleRate, channelCount) {
    const frecuencia = Math.max(8000, Math.min(192000, Math.round(Number(sampleRate)) || 48000));
    const canales = Number(channelCount) === 2 ? 2 : 1;
    const clave = `${frecuencia}:${canales}`;
    if (this.proceso && this.formato === clave) return true;
    if (this.bloqueado) return false;
    if (this.proceso) this.detenerProceso();
    asegurarDispositivo();

    const { command, args } = agentCommand([
      'audio-play', '--match', destinoConfigurado(), '--rate', String(frecuencia), '--channels', String(canales)
    ]);
    const hijo = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    this.proceso = hijo;
    this.formato = clave;
    this.disponible = true;
    this.error = '';
    let textoError = '';
    hijo.stderr.on('data', datos => { if (textoError.length < 4096) textoError += datos; });
    hijo.stdin.on('error', () => {});
    hijo.on('error', error => {
      this.error = error.message;
      this.avisar(error.message);
      if (this.proceso === hijo) { this.proceso = null; this.formato = null; this.disponible = false; }
    });
    hijo.on('close', codigo => {
      if (this.proceso !== hijo) return;
      this.proceso = null;
      this.formato = null;
      this.disponible = false;
      if (codigo === CODIGO_SIN_DISPOSITIVO) {
        // El dispositivo existía hace un instante (caché) y ya no: se invalida.
        cache = { hasta: 0, resultado: null, error: '' };
        this.fallosDeEnlace++;
        this.error = mensajeSinCable(destinoConfigurado());
        this.avisar(this.error);
        if (this.fallosDeEnlace >= 3) this.bloqueado = true;
      } else if (codigo) {
        this.avisar(`terminó (${codigo}): ${textoError.trim().slice(-300) || 'sin detalle'}`);
      }
    });
    return true;
  }

  escribir({ samples, sampleRate = 48000, channelCount = 1 }) {
    if (!samples || !samples.length) return;
    try { this.asegurarProceso(sampleRate, channelCount); }
    catch (error) { this.error = error.message; this.avisar(error.message); return; }
    const proceso = this.proceso;
    if (!proceso || !proceso.stdin.writable) return;
    this.ultimoAudio = Date.now();
    this.muestrasEscritas += samples.length;
    // Tirar lo que el agente no alcanza a consumir: mejor un salto que un
    // micrófono que se va quedando segundos atrás.
    if (proceso.stdin.writableLength > MAX_PENDIENTE_BYTES) return;
    // Silenciar escribiendo ceros en vez de cortar el flujo: un dispositivo sin
    // datos se marca como inactivo y algunos programas lo ven como desconectado.
    if (this.silenciado) {
      this.nivel = 0;
      proceso.stdin.write(Buffer.alloc(samples.length * 2));
      return;
    }
    let pico = 0;
    const bloque = Buffer.allocUnsafe(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      const valor = samples[i];
      bloque.writeInt16LE(valor, i * 2);
      const absoluto = valor < 0 ? -valor : valor;
      if (absoluto > pico) pico = absoluto;
    }
    // Caída suave para que la barra del cliente no parpadee entre sílabas.
    this.nivel = Math.max(pico / 32768, this.nivel * 0.7);
    proceso.stdin.write(bloque);
  }

  // Conectar de nuevo es la señal de que alguien está mirando: se vuelve a
  // intentar aunque el destino hubiera fallado tres veces seguidas (quizá el
  // dueño acaba de instalar VB-CABLE).
  reiniciarFallos() {
    this.fallosDeEnlace = 0;
    this.bloqueado = false;
    this.error = '';
    cache = { hasta: 0, resultado: null, error: '' };
  }

  silenciar(valor) {
    this.silenciado = Boolean(valor);
    if (this.silenciado) this.nivel = 0;
    return this.silenciado;
  }

  detenerProceso() {
    const proceso = this.proceso;
    this.proceso = null;
    this.formato = null;
    this.disponible = false;
    this.nivel = 0;
    if (!proceso) return;
    try { proceso.stdin.end(); } catch {}
    try { proceso.kill(); } catch {}
  }

  estado() {
    return {
      activo: Boolean(this.proceso),
      bloqueado: this.bloqueado,
      silenciado: this.silenciado,
      nivel: Number(this.nivel.toFixed(3)),
      fuente: NOMBRE_FUENTE,
      descripcion: DESCRIPCION,
      msSinAudio: this.ultimoAudio ? Date.now() - this.ultimoAudio : null,
      error: this.error
    };
  }

  cerrar() {
    this.detenerProceso();
  }
}

module.exports = { MicrofonoVirtual, asegurarDispositivo, descargarDispositivo, NOMBRE_FUENTE, NOMBRE_SINK };
