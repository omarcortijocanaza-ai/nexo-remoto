'use strict';

// El micrófono del celular necesita un destino real dentro de PipeWire, porque
// ningún programa sabe recibir audio de una pestaña. Un null-sink recoge lo que
// llega por WebRTC y un remap-source publica su monitor como fuente de captura:
// Discord, OBS o el navegador ven "Micrófono del celular (NEXO)" en su lista y
// no distinguen si detrás hay un jack, una webcam o una radio.
//
// El monitor a secas no basta: muchos programas filtran las entradas cuyo
// nombre acaba en `.monitor` para no ofrecer "grabar lo que suena". El remap
// crea una fuente de pleno derecho y evita ese descarte.

const { spawn, spawnSync } = require('child_process');
const { entornoDe } = require('./entorno');

const NOMBRE_SINK = 'nexo_mic_sink';
const NOMBRE_FUENTE = 'nexo_micro';
const NODO_ESCRITURA = 'nexo-microfono-celular';

// El nombre que verá el usuario en Discord, OBS o el navegador. pactl parte el
// valor por los espacios aunque vaya entre comillas, así que hacen falta las
// dos cosas a la vez: comillas *y* espacios escapados. Con sólo una de ellas la
// descripción queda cortada en la primera palabra.
const DESCRIPCION_FUENTE = 'device.description="Micrófono\\ del\\ celular\\ (NEXO)"';
const DESCRIPCION_SINK = 'device.description="NEXO\\ ·\\ puente\\ de\\ micrófono"';

// pw-play acepta el destino, pero el gestor de sesión puede ignorarlo y mandar
// el audio a la salida por defecto. Eso sonaría por los altavoces del PC en vez
// de entrar al micrófono virtual, así que el enlace se comprueba y, si no cayó
// donde debía, el proceso se mata antes de reproducir nada audible.
const MS_VERIFICAR_ENLACE = 900;

function pactl(args, tamano = 65536) {
  return spawnSync('pactl', args, { env: entornoDe(), maxBuffer: tamano, encoding: 'utf8' });
}

function modulosCargados() {
  const salida = pactl(['list', 'short', 'modules']);
  if (salida.status !== 0) throw new Error(`pactl no respondió: ${String(salida.stderr || '').trim() || 'sin detalle'}`);
  const texto = String(salida.stdout || '');
  return {
    sink: texto.includes(`sink_name=${NOMBRE_SINK}`),
    fuente: texto.includes(`source_name=${NOMBRE_FUENTE}`)
  };
}

// Idempotente a propósito: NEXO puede reiniciarse mil veces y los módulos ya
// cargados de la sesión anterior siguen siendo válidos. Cargarlos dos veces
// crearía micrófonos duplicados en la lista de todos los programas.
function asegurarDispositivo() {
  const cargados = modulosCargados();
  if (!cargados.sink) {
    const carga = pactl(['load-module', 'module-null-sink',
      `sink_name=${NOMBRE_SINK}`, `sink_properties=${DESCRIPCION_SINK}`,
      'format=s16le', 'rate=48000', 'channels=1']);
    if (carga.status !== 0) throw new Error(`No se pudo crear el puente de audio: ${String(carga.stderr || '').trim()}`);
  }
  if (!cargados.fuente) {
    const carga = pactl(['load-module', 'module-remap-source',
      `master=${NOMBRE_SINK}.monitor`, `source_name=${NOMBRE_FUENTE}`,
      `source_properties=${DESCRIPCION_FUENTE}`,
      'channels=1', 'master_channel_map=mono', 'channel_map=mono']);
    if (carga.status !== 0) throw new Error(`No se pudo publicar el micrófono: ${String(carga.stderr || '').trim()}`);
  }
  return { sink: NOMBRE_SINK, fuente: NOMBRE_FUENTE };
}

function descargarDispositivo() {
  const salida = pactl(['list', 'short', 'modules']);
  if (salida.status !== 0) return;
  for (const linea of String(salida.stdout || '').split('\n')) {
    if (!linea.includes(`sink_name=${NOMBRE_SINK}`) && !linea.includes(`source_name=${NOMBRE_FUENTE}`)) continue;
    pactl(['unload-module', linea.split('\t')[0]]);
  }
}

// Devuelve true si el nodo llegó al puente, false si acabó en otro sitio y null
// si no se puede saber: sin respuesta de pw-dump vale más seguir sonando en el
// micrófono virtual que cortar por una sospecha.
//
// El nodo se busca por `node.name`, no por PID: PipeWire no publica el proceso
// de un pw-play, así que el nombre propio es la única identificación fiable.
function enlazadoAlPuente(nombreNodo) {
  const salida = spawnSync('pw-dump', [], { env: entornoDe(), maxBuffer: 24 * 1024 * 1024, encoding: 'utf8' });
  if (salida.status !== 0) return null;
  let objetos;
  try { objetos = JSON.parse(salida.stdout); } catch { return null; }
  const porId = new Map(objetos.map(objeto => [objeto.id, objeto]));
  const nuestro = objetos.find(objeto => objeto.info?.props?.['node.name'] === nombreNodo);
  if (!nuestro) return null; // Aún no apareció; el siguiente bloque lo verá.
  let enlazado = false;
  for (const objeto of objetos) {
    if (objeto.type !== 'PipeWire:Interface:Link') continue;
    const props = objeto.info && objeto.info.props;
    if (!props || Number(props['link.output.node']) !== nuestro.id) continue;
    const destino = porId.get(Number(props['link.input.node']));
    if (destino?.info?.props?.['node.name'] === NOMBRE_SINK) enlazado = true;
  }
  return enlazado;
}

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
    this.contador = 0;
    // Si el enrutado falla, cada bloque de audio volvería a lanzar pw-play y la
    // comprobación volvería a matarlo: un bucle de arranques cada 10 ms. A la
    // tercera se deja de intentar y el error queda a la vista en el estado.
    this.fallosDeEnlace = 0;
    this.bloqueado = false;
  }

  // El formato lo manda el celular, no NEXO: WebRTC entrega 48 kHz mono casi
  // siempre, pero un navegador raro puede dar otra cosa. Adaptar el proceso al
  // primer bloque sale más barato y más limpio que remuestrear a mano.
  asegurarProceso(sampleRate, channelCount) {
    const clave = `${sampleRate}:${channelCount}`;
    if (this.proceso && this.formato === clave) return true;
    if (this.bloqueado) return false;
    if (this.proceso) this.detenerProceso();
    asegurarDispositivo();
    // Nombre distinto en cada arranque: si quedara un pw-play agonizando del
    // intento anterior, la comprobación de enlace miraría al nodo equivocado.
    const nombreNodo = `${NODO_ESCRITURA}-${++this.contador}`;
    const hijo = spawn('pw-play', [
      `--target=${NOMBRE_SINK}`,
      '-P', `{ node.name = "${nombreNodo}", media.name = "NEXO microfono del celular" }`,
      '--format=s16', `--rate=${sampleRate}`, `--channels=${channelCount}`,
      '--latency=20ms', '--raw', '-'
    ], { stdio: ['pipe', 'ignore', 'pipe'], env: entornoDe() });
    this.proceso = hijo;
    this.formato = clave;
    this.disponible = true;
    this.error = '';
    let textoError = '';
    hijo.stderr.on('data', datos => { if (textoError.length < 4096) textoError += datos; });
    hijo.stdin.on('error', () => {});
    hijo.on('error', error => {
      this.error = error.message;
      this.onLog(`Micrófono virtual: ${error.message}`);
      if (this.proceso === hijo) { this.proceso = null; this.formato = null; this.disponible = false; }
    });
    hijo.on('close', codigo => {
      if (this.proceso !== hijo) return;
      this.proceso = null;
      this.formato = null;
      this.disponible = false;
      if (codigo) this.onLog(`Micrófono virtual terminó (${codigo}): ${textoError.trim().slice(-300) || 'sin detalle'}`);
    });
    // Si el audio acabó en los altavoces en vez de en el puente, sonaría el
    // micrófono del celular por toda la casa. Vale más cortar y avisar.
    const verificacion = setTimeout(() => {
      if (this.proceso !== hijo) return;
      if (enlazadoAlPuente(nombreNodo) !== false) { this.fallosDeEnlace = 0; return; }
      this.fallosDeEnlace++;
      this.error = 'El audio no llegó al puente; PipeWire lo desvió a la salida por defecto';
      this.onLog(`Micrófono virtual: ${this.error}`);
      this.detenerProceso();
      if (this.fallosDeEnlace >= 3) this.bloqueado = true;
    }, MS_VERIFICAR_ENLACE);
    verificacion.unref();
    return true;
  }

  escribir({ samples, sampleRate = 48000, channelCount = 1 }) {
    if (!samples || !samples.length) return;
    try { this.asegurarProceso(sampleRate, channelCount); }
    catch (error) { this.error = error.message; this.onLog(`Micrófono virtual: ${error.message}`); return; }
    const proceso = this.proceso;
    if (!proceso || !proceso.stdin.writable) return;
    this.ultimoAudio = Date.now();
    this.muestrasEscritas += samples.length;
    // Silenciar escribiendo ceros en vez de cortar el flujo: un pw-play que se
    // queda sin datos deja el dispositivo en suspensión y algunos programas lo
    // interpretan como micrófono desconectado. Con ceros sigue "abierto".
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
  // intentar aunque el enrutado hubiera fallado tres veces seguidas, porque
  // entre medias pueden haber cambiado los dispositivos o el perfil de audio.
  reiniciarFallos() {
    this.fallosDeEnlace = 0;
    this.bloqueado = false;
    this.error = '';
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
    proceso.kill('SIGTERM');
  }

  estado() {
    return {
      activo: Boolean(this.proceso),
      bloqueado: this.bloqueado,
      silenciado: this.silenciado,
      nivel: Number(this.nivel.toFixed(3)),
      fuente: NOMBRE_FUENTE,
      descripcion: 'Micrófono del celular (NEXO)',
      msSinAudio: this.ultimoAudio ? Date.now() - this.ultimoAudio : null,
      error: this.error
    };
  }

  cerrar() {
    this.detenerProceso();
  }
}

module.exports = { MicrofonoVirtual, asegurarDispositivo, descargarDispositivo, NOMBRE_FUENTE, NOMBRE_SINK };
