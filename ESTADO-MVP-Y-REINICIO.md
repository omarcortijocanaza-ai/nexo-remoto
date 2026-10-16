# NEXO · Estado del MVP y guía de reinicio

Estado del sistema y procedimiento de arranque, actualizado el 11 de agosto de 2026.
Para qué falta y en qué orden, ver `PROGRESO.md`. La carpeta principal y única fuente
vigente es:

```text
/home/Letzus/Downloads/teclado-remoto
```

No hay una copia completa y vigente de este programa en `~/Downloads`. Los documentos
que existen allí pertenecen a otros proyectos. Para evitar versiones divergentes, los
cambios de NEXO deben hacerse en la carpeta indicada arriba.

## Estado actual

NEXO permite controlar desde un celular una sesión Hyprland de esta computadora por
LAN o Internet. Incluye:

- Pantalla remota WebRTC H.264 mediante NVIDIA NVENC.
- Respaldo de vídeo WebRTC/CPU y respaldo JPEG/WebSocket.
- Audio del sistema en el celular.
- Control táctil con modos de navegación y arrastre.
- Scroll con inercia, clic, clic derecho y gestos.
- Teclado móvil en vivo, composición y teclas especiales.
- Rotación controlada desde la interfaz.
- Cambio entre escritorios y monitores.
- Picture-in-Picture y soporte de reproducción en segundo plano cuando el navegador
  móvil lo permite.
- Interfaz visual Letzus/Viego/Rex Mortis.
- Acceso local y túnel remoto TryCloudflare.
- Segunda sesión Hyprland independiente bajo el usuario aislado `nexo`.
- Emparejamiento por dispositivo: el token del enlace se canjea por una cookie y sale
  de la barra de direcciones. Mi PC original pide además usuario y contraseña; NEXO no
  pide contraseña nunca.
- Captura y NVENC en reposo cuando no hay ningún cliente conectado.

El perfil guardado se encuentra en `.nexo-gpu-profile.json`; el monitor seleccionado,
en `.nexo-monitor.json`; el token y últimos accesos, en `.nexo-state.json`; y los
dispositivos emparejados, en `.nexo-devices.json`. Todos tienen estado persistente y no
deben borrarse si se quiere conservar la configuración y los aparatos ya emparejados.

## Arquitectura multimedia

```text
Hyprland/monitor
      │
      ▼
wf-recorder (NV12)
      │ FIFO de un solo cuadro
      ▼
GStreamer → nvh264enc/NVENC → H.264/RTP
      │ UDP local
      ▼
Puente Pion WebRTC (bin/nexo-gpu-webrtc)
      │
      ├── celular 1
      ├── celular 2
      └── demás clientes, compartiendo una codificación
```

`server.js` mantiene por separado audio, teclado, gestos, señalización y el respaldo
CPU. Cuando el cliente confirma vídeo GPU, la captura CPU de vídeo se detiene.

La configuración GPU es global. Una reconexión o pestaña adicional no puede cambiarla;
sólo los botones de FPS y resolución lo hacen explícitamente. Esto evita la antigua
oscilación 720p/1080p que reiniciaba el encoder y congelaba la pantalla.

El puente conserva secuencias y timestamps RTP cuando se cambia monitor o calidad. El
PeerConnection permanece conectado. NVENC usa una cola de un cuadro, sin B-frames,
VBV reducido y cuadros clave aproximadamente cada 250 ms.

## Configuración estable validada

Para interacción táctil desde el celular:

```text
1280x720 · 60 FPS · 4500 kbps
```

Para escritorio remoto desde otra computadora, que es el perfil predeterminado:

```text
1920x1080 · 45 FPS · 10000 kbps
```

El bitrate ya no se elige a mano: lo fija el perfil de resolución —10 Mbps en 1080p,
7 Mbps en 900p y 4.5 Mbps en 720p— para que el túnel no acumule vídeo.

Validaciones realizadas con el perfil táctil:

- Dos clientes simultáneos con preferencias locales diferentes.
- 59–60 FPS decodificados en ambos clientes de prueba.
- 0 paquetes perdidos durante la prueba local.
- Búfer WebRTC aproximado de 3 ms en estado estable.
- Cambio de monitor sin sustituir el puente ni cerrar el PeerConnection.
- Recuperación a 60 FPS después del cambio.
- Ruta local y ruta de Cloudflare verificadas.

El bajo porcentaje de `utilization.encoder` es normal: NVENC es un bloque dedicado y
no necesita marcar 100 % para codificar correctamente.

## Reiniciar la computadora

Sí, la computadora puede reiniciarse. Los archivos, binarios, token, perfil y monitor
quedan guardados. NEXO está configurado para iniciarse automáticamente ocho segundos
después de entrar a la sesión Hyprland, levantando tanto LAN como Internet.

También existe un lanzador en `~/.local/bin/nexo-control` y una entrada en el menú de
aplicaciones llamada `NEXO · Control remoto`. `Super/Windows + A` conserva el dashboard
general; dentro de **Ajustes rápidos** está el botón **NEXO remoto**, que levanta LAN e
Internet, y **Copiar rutas**, que coloca ambos enlaces completos en el portapapeles. Si
NEXO ya está activo, no crea otro proceso y sólo muestra los accesos.

Ejecutar:

```bash
/home/Letzus/.local/bin/nexo-control start
```

El lanzador inicia automáticamente:

1. `server.js` en el puerto 8765.
2. `gpu-stream.js` y el puente Pion/NVENC.
3. `cloudflared` para acceso externo.

No es necesario iniciar `gpu-stream.js`, GStreamer ni Cloudflare por separado. Para
consultar, reiniciar, detener o seguir el registro:

```bash
nexo-control status
nexo-control restart
nexo-control stop
nexo-control log
```

La dirección principal abre un portal previo con **Mi PC original** y **NEXO**. Tras
reiniciar, la sesión independiente se inicia mediante `nexo-headless.service`; el
portal mantiene su opción deshabilitada sólo mientras aparece el nuevo túnel temporal
y la habilita sin recargar la página cuando está listo.

Mantener esa terminal abierta. Para detener el programa limpiamente, pulsar `Ctrl+C`.

## Accesos después del reinicio

La URL LAN depende de la IP entregada por el router. La URL TryCloudflare es temporal y
normalmente cambiará después de apagar o reiniciar la computadora. El token sí se
conserva.

Al iniciar, el programa imprime un bloque `NEXO · ACCESOS` con ambas direcciones. También
se pueden consultar en otra terminal:

```bash
cat /home/Letzus/Downloads/teclado-remoto/.nexo-state.json
```

Usar siempre la URL completa con `?token=...`. Quien posea ese enlace puede controlar
la computadora; no debe compartirse públicamente.

## Comprobación rápida

Después de iniciar:

```bash
curl http://127.0.0.1:8765/health
curl http://127.0.0.1:9090/health
pgrep -af 'launcher.js|server.js|gpu-stream.js|nexo-gpu-webrtc|cloudflared'
nvidia-smi
```

Los dos `curl` deben indicar `"ok":true`. En el celular, la cabecera debe mostrar
`GPU` cuando el vídeo acelerado esté reproduciéndose.

Si el acceso remoto deja de funcionar pero el local funciona, revisar la nueva URL en
`.nexo-state.json`; no reutilizar una dirección antigua de TryCloudflare.

## Dependencias instaladas

- Node.js y npm.
- `@roamhq/wrtc` instalado en `node_modules`.
- Go, necesario sólo para recompilar el puente Pion.
- GStreamer con plugins base/good/bad y soporte `nvh264enc`.
- `wf-recorder`.
- Controlador NVIDIA y `nvidia-smi`.
- `wtype`, PipeWire y utilidades Wayland utilizadas por el servidor.
- `bin/cloudflared`, incluido localmente en el proyecto.
- `bin/wlrctl`, incluido localmente en el proyecto.
- `bin/nexo-gpu-webrtc`, puente ya compilado.

Para verificar NVENC:

```bash
gst-inspect-1.0 nvh264enc
```

## Archivos principales

- `launcher.js`: arranque, supervisión y túnel.
- `server.js`: HTTP, autenticación, entrada, monitores, audio y señalización.
- `index.html`: interfaz móvil completa.
- `webrtc-host.js`: WebRTC CPU, audio y canales de control.
- `gpu-stream.js`: captura, perfil, GStreamer y NVENC.
- `gpu-webrtc/main.go`: puente RTP/WebRTC Pion.
- `bin/nexo-gpu-webrtc`: ejecutable compilado del puente.
- `auth-manager.js`: contraseña de Mi PC original y sesiones de login.
- `device-manager.js`: dispositivos emparejados y códigos de emparejamiento.
- `headless/`: instalador y configuración de la sesión independiente.
- `README.md`: guía resumida y punto de entrada.
- `PROGRESO.md`: qué está hecho, qué falta y en qué orden.
- `THIRD_PARTY_NOTICES.md`: licencias de terceros.

## Problemas conocidos y siguientes mejoras

- TryCloudflare ofrece una URL temporal. Para una URL permanente se necesita un túnel
  administrado y dominio propio.
- Android/iOS pueden limitar vídeo o audio en segundo plano según navegador y ahorro de
  batería.
- `wf-recorder` todavía copia y escala cuadros usando CPU. Una futura ruta
  PipeWire/DMA-BUF/CUDA podría reducir carga y algunos milisegundos adicionales.
- El perfil es global para todos los clientes porque se comparte una sola codificación.
  Perfiles diferentes por cliente requerirían simulcast o varias codificaciones.

El inventario vigente de lo pendiente está en `PROGRESO.md`; este documento describe el
estado del MVP y cómo reiniciar, no el plan de trabajo.

## Seguridad y respaldo

Antes de cambios grandes puede respaldarse la carpeta completa. No subir públicamente
`.nexo-state.json`, porque contiene el token de control. Los avisos de licencias deben
acompañar cualquier distribución.
