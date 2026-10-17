# Bitácora Fase F7 — Ejecución

- **Fase:** F7 · Micrófono del celular con VB-CABLE
- **Rama:** `windows-port` · **Inicio:** `f7-start` (`838cfc5`)
- **Quién:** ejecutada directamente por Claude (ver F6).

## 1. Archivos

- `microfono-virtual-windows.js` (reescrito): misma API que `microfono-virtual.js`
  (`MicrofonoVirtual` con `asegurarProceso`, `escribir`, `reiniciarFallos`, `silenciar`,
  `detenerProceso`, `estado`, `cerrar`; `asegurarDispositivo`, `descargarDispositivo`,
  `NOMBRE_FUENTE`, `NOMBRE_SINK`).
  - `asegurarDispositivo()`: `nexo-agent.exe audio-devices` (síncrono), busca una salida
    cuyo nombre contenga `NEXO_MIC_DEVICE` (por defecto «CABLE Input»); si no, lanza
    `VB-CABLE no está instalado: instala VB-Audio Virtual Cable y reinicia (ver
    PLAN-MIGRACION-WINDOWS.md, F0)` (con la variable personalizada añade el nombre
    buscado). Caché 30 s si existe y **5 s si falta** (si no, 100 consultas por segundo).
  - `asegurarProceso`: `nexo-agent.exe audio-play --match "<destino>" --rate <sr>
    --channels <ch>` (frecuencia acotada a 8 000–192 000, canales 1 ó 2). Código 3 →
    error claro, `fallosDeEnlace++`, a la tercera `bloqueado = true`.
  - `escribir`/`silenciar`/nivel: lógica de Linux copiada; el silencio escribe ceros.
  - Añadidos: tope de 96 000 bytes pendientes (si el agente no consume, se tira audio en
    vez de acumular retardo) y un aviso al registro como máximo cada 10 s por mensaje.
  - `comprobarDestino()` (sólo Windows): lo llama `microfono-host.js`.
- `microfono-host.js` (común, dos retoques):
  1. `this.microfono.comprobarDestino?.()` al aceptar una oferta: sin VB-CABLE el celular
     recibe `500 {"error":"VB-CABLE no está instalado…"}`, que `microfono-cliente.js` ya
     muestra («…Reintentando…»). En Linux el método no existe: sin cambios.
  2. **Defecto previo corregido (afecta a Linux)**: `pc.onconnectionstatechange` cerraba
     `this.par` aunque ya fuera *otro* par. Al reemplazar un celular por otro, el
     `closed` tardío del par viejo cerraba al par nuevo en plena negociación
     (`signalingState is 'closed'` → 500 y el celular debía reintentar). Ahora sólo cierra
     si `this.par === par`.
- `test/microfono-windows.test.js` (nuevo, 8 pruebas) con un agente falso en Node.

## 2. Desviaciones

- El informe de traspaso hablaba de `NEXO_MIC_DEVICE_MATCH`; el plan dice `NEXO_MIC_DEVICE`.
  Manda el plan y se acepta la otra como alias.

## 3. Dudas

- Ninguna.
