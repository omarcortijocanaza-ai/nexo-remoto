# NEXO · Progreso

Inventario único de qué está hecho, qué falta y en qué orden. Actualizado el
**11 de agosto de 2026**.

Si un documento contradice a este, manda este. El plan por fases y el motivo de cada
decisión están en `PROYECTO-NEXO-EVOLUCION.md`; aquí sólo el estado.

## Cómo está el sistema hoy

Dos escritorios accesibles desde el celular o desde otra computadora:

- **Mi PC original**: la sesión física. Pide dispositivo emparejado **y** contraseña.
- **NEXO**: segunda sesión Hyprland bajo el usuario aislado `nexo`. Pide dispositivo
  emparejado y **nunca** contraseña. Así fue pensado desde el principio.

Vídeo H.264 por NVENC con respaldo WebRTC/CPU y respaldo JPEG, audio del sistema,
teclado, mouse, tacto, portapapeles, archivos, monitores, escritorios y PWA.

## Terminado

### Entrada y diagnóstico
- [x] Estado de Windows/Super entre `keydown` y `keyup`, con todas las variantes.
- [x] Puente reversible para la tecla Windows en clientes Windows.
- [x] Panel de diagnóstico autenticado y registro circular sin secretos.
- [x] Pruebas automatizadas de traducción de teclado.

### Acceso
- [x] Contraseña de Mi PC original derivada con `scrypt` y cookie `HttpOnly`.
- [x] **El token salió de la URL.** Se canjea por una cookie de dispositivo de treinta
      días y la barra de direcciones queda limpia. Los enlaces antiguos siguen valiendo.
- [x] Código de emparejamiento de ocho caracteres, un solo uso, diez minutos:
      `nexo-control pair`. Sin O, 0, I ni 1, para poder dictarlo.
- [x] Lista de dispositivos con última conexión, revocables uno a uno o todos menos el
      actual, desde el botón **ⓘ**.
- [x] `nexo-control rotate`: invalida los enlaces ya compartidos generando un token
      nuevo. Los aparatos emparejados siguen entrando, porque se identifican con su
      cookie y no con el token. Verificado: tras rotar, el dispositivo previo entra sin
      hacer nada, el enlace viejo queda sin acceso y el nuevo empareja con normalidad.
- [x] Límite de cinco intentos por origen real, distinguiendo el que llega por el túnel.
- [x] Registro local de accesos sin IP ni secretos.

### Funciones cotidianas
- [x] Portapapeles bidireccional y transferencia de archivos hasta 100 MiB.
- [x] PWA instalable con caché limitada a recursos estáticos.
- [x] Calidad adaptativa por estadísticas WebRTC y perfiles Texto/Equilibrado/Movimiento.
- [x] Barra superior con título y controles visibles de minimizar, maximizar y cerrar.
- [x] Carcasa de escritorio coherente: la barra superior identifica la aplicación
      activa, maximizar cambia visualmente a restaurar y la Terminal conserva una
      cabecera propia bajo los controles universales.
- [x] Buscar y Vista de tareas en la barra inferior, menús compactos para Ejecutar y
      acciones de ventana, ajuste por bordes y controles directos de volumen.
- [x] Limpieza al abandonar la página, latido del respaldo WebSocket y caducidad de
      pestañas ocultas para evitar captura y audio acumulados en sesiones largas.

### Experiencia Windows de la sesión NEXO
- [x] Menú Inicio con pestañas **Aplicaciones · Ejecutar · Ventanas · Archivos**,
      cuadrícula de iconos, contador de resultados y pistas de teclado a la vista.
      La tecla Windows deja de abrir sólo un lanzador y pasa a ser la puerta a todo.
- [x] Paleta única en `headless/windows-colors.rasi`: menú, diálogos y las dos barras
      comparten fondo acrílico, acento y estados. Antes cada archivo repetía los
      colores y ya habían empezado a separarse.
- [x] Resaltado con relleno translúcido y borde de acento en lugar del bloque de color
      pleno anterior, que con selección por puntero inundaba la cuadrícula.
- [x] `-no-config` en todos los diálogos: un `config.rasi` suelto en el hogar de `nexo`
      ya no puede cambiar colores, fuente ni geometría del escritorio.
- [x] Historial del portapapeles con `Windows+V`, incluidas imágenes, con vaciado.
- [x] Capturas: `Windows+Shift+S` recorta, `Impr Pant` toma la pantalla y
      `Alt+Impr Pant` sólo la ventana. Quedan en `Imágenes/Capturas` y en el
      portapapeles, con avisos que ofrecen abrir, editar o ir a la carpeta.
- [x] Cuatro escritorios virtuales permanentes en la barra, con rueda para cambiar,
      `Windows+Ctrl+Flechas` y un diálogo que muestra cuántas ventanas hay en cada uno.
- [x] Configuración rápida ampliada a diecisiete acciones con iconos y línea de estado
      —volumen, red y avisos—, incluida la reparación de la barra de tareas sin
      reiniciar la sesión.
- [x] Acomodos completos: media pantalla, cuartos, centrar, pantalla completa y
      «siempre encima», desde `Windows+Flechas`, el menú de la ventana o los dos
      botones nuevos de la barra superior. Las medidas se calculan sobre el área libre
      del monitor, así que siguen encajando si cambia el alto de las barras.
- [x] Hoja de atajos buscable con `Windows+/` que además ejecuta lo que se elige.
- [x] El instalador copia todos los scripts `windows-*` y falla si algún botón apunta
      a un ayudante que no existe: un botón sin destino no daba ningún error visible.
- [x] Ventanas como las de Windows: sin huecos entre ellas ni contra los bordes, borde
      de 1 px, esquinas de 8 px, **ninguna translúcida** y sin oscurecer la inactiva.
      Además de ser lo esperado, la transparencia costaba ancho de banda: cada cambio
      detrás de una ventana obligaba a recodificar esa zona.
- [x] Todo se abre flotante y centrado, superponible. El mosaico automático partía la
      pantalla y movía de sitio la ventana anterior al abrir la segunda aplicación.
- [x] Animaciones cortas y sin rebote; fuera el borde que giraba de color en bucle.
- [x] Notificaciones con tema propio y **abajo a la derecha**, encima de la barra de
      tareas. Antes heredaban el tema personal de la sesión principal y salían arriba.
- [x] Terminal opaca y con `Ctrl+C`/`Ctrl+V`: copia si hay selección, interrumpe si no,
      igual que la Terminal de Windows.
- [x] Menú del escritorio con **clic derecho sobre el fondo**: abrir el Escritorio,
      nueva carpeta, terminal aquí, fondo de pantalla, configuración y actualizar.
      El atajo no consume el clic, así que dentro de las aplicaciones sigue funcionando.
- [x] Fondo de pantalla cambiable desde la sesión, con vista previa de cada imagen,
      selector de archivos y memoria entre reinicios.
- [x] **Iconos en el Escritorio** con `pcmanfm-qt --desktop`, con su propio menú de clic
      derecho. Es opcional: si el equipo no tiene el paquete, la sesión arranca igual.
      Su capa tapa el fondo de awww, así que el selector de fondo cambia los dos.
- [x] Los cuadros de aviso salían en tema claro: `gtk-application-prefer-dark-theme` no
      basta para zenity. `GTK_THEME=Adwaita:dark` deja el escritorio oscuro sin excepción.
- [x] **La regla de polkit que aísla a `nexo` no cargaba desde el principio**: polkit 127
      la rechazaba por los acentos de sus comentarios y la ignoraba en silencio, así que
      udisks y NetworkManager volvían a la política por omisión —pedir contraseña de
      administrador—. Reescrita en ASCII; el instalador recarga polkit y falla si la
      vuelve a rechazar.
- [x] El escritorio salía de color liso: `WallpaperMode=crop` no existe en pcmanfm-qt y
      con un modo desconocido no dibuja imagen. Es `zoom`.
- [x] **Clic en el menú Inicio que no abría nada.** El menú se dibujaba como ventana
      normal (`-normal-window`); en ese modo el clic cerraba el menú sin lanzar la
      aplicación. Ahora rofi se dibuja como capa, su modo nativo en Wayland, y acepta
      con clic simple **y** con doble clic. Comprobado con clics sintéticos sobre
      casillas concretas usando puntero virtual, que es el mismo camino por el que
      llegan los clics del cliente remoto.
- [x] **El cuadro del llavero que aparecía en la pantalla física.** Era Brave dentro de
      NEXO: pedía `org.freedesktop.secrets`, y como la sesión remota no tiene quien
      pregunte, gcr recurría al «prompter del sistema», que dibuja en la sesión
      físicamente activa. Brave y Chromium usan ahora almacén básico dentro de su
      propio perfil.
- [x] El menú Inicio salía sin iconos: la sesión arranca desde systemd sin perfil de
      shell y no existían `XDG_DATA_DIRS` ni `XDG_DATA_HOME`, así que rofi encontraba
      las aplicaciones pero ningún directorio de iconos.
- [x] Iconos perdidos de Inicio, Buscar, Explorador y Terminal, y de la barra superior:
      al reescribir los archivos quedaron cadenas vacías. Se repusieron con glifos
      Material Design comprobados uno a uno contra la fuente instalada, incluido el
      logotipo de Windows en el botón Inicio.

### Latencia
- [x] Medición completa de la ruta de vídeo: el software intermedio suma **7.5 ms**
      (cola GStreamer 0.65, `h264parse` 0.20, RTP 0.05, jitter 5.5, decodificación 0.8).
      Dos hipótesis quedaron refutadas por medición: `--no-dmabuf` no cuesta nada
      (155.8 % contra 157.2 % de un núcleo) y la cadena GStreamer suma menos de 1 ms.
- [x] 60 FPS a 1080p resultó gratis: mismo consumo (61.8 % → 63.8 % de un núcleo),
      encoder al 9 %, y de 22 cuadros descartados a **0**. Baja el periodo entre
      cuadros de 22.2 a 16.7 ms.
- [x] Escribir un espacio dentro de Chromium bloqueaba la cola de entrada **182 ms**
      por el rodeo del portapapeles. Ahora sólo el pegado ocupa la cola: **31 ms** el
      primero y **1 ms** los siguientes mientras el portapapeles siga siendo nuestro.
      Cinco espacios seguidos pasaron de 907 ms a 35 ms de bloqueo.

### Operación
- [x] Instalador idempotente con `install`, `update`, `doctor` y `uninstall`.
- [x] Exportación de diagnóstico sin tokens ni datos personales.
- [x] Captura y NVENC en reposo tras un minuto sin clientes; vuelven en menos de dos
      segundos ante la primera oferta.

### Defectos corregidos el 11 de agosto
- [x] `/session-options` entregaba el enlace de NEXO a cualquiera con la URL principal.
- [x] El bloqueo tras cinco intentos fallidos **nunca llegaba a activarse**.
- [x] El límite de intentos era un cubo único: cinco fallos ajenos bloqueaban al dueño.
- [x] Un fallo de `listen` mataba el servidor y el lanzador reintentaba sin pausa.
- [x] NVENC codificaba las veinticuatro horas sin ningún cliente conectado.
- [x] `nexo-control restart` no reiniciaba nada si el archivo de PID estaba caducado.
- [x] VKMS provocaba cientos de modesets por segundo sobre NVIDIA, con la pantalla
      corrupta y la carga por encima de 8. La salida invisible ahora la crea Hyprland.
- [x] El instalador copiaba una lista de archivos escrita a mano y omitió un módulo
      nuevo, dejando la sesión independiente en bucle de reinicios. Ya copia todo y
      verifica que ningún `require` quede sin destino.
- [x] Una consola no tenía controles de ventana visibles en la parte superior. La
      corrección inicial era sólo una barra global; ahora identifica explícitamente
      **Terminal**, muestra su propia cabecera y mantiene la × universal destacada.
- [x] WebSockets medio abiertos y pestañas abandonadas podían mantener capturas y audio
      activos, sumando carga y latencia con el paso del tiempo.
- [x] Reinicios solapados podían dejar dos runtimes NEXO compitiendo por el puerto 8766;
      un bloqueo de instancia única evita duplicar PipeWire, Waybar y el servidor.

## Pendiente

### Requiere una acción tuya
| Qué | Cómo |
|---|---|
| Llevar a NEXO el fondo, el espacio y la interfaz nueva | `sudo headless/install-headless update` y reiniciar `nexo-headless.service` |
| Emparejar tus aparatos habituales | Entrar una vez con el enlace, o `nexo-control pair` |

La pausa de NVENC quedó verificada con navegador real: el codificador estaba detenido,
reactivó al conectar y entregó 45 y luego 60 FPS completos sin cuadros perdidos.

### Callejones sin salida, ya medidos
No volver a intentarlos sin datos nuevos:

- **`--no-dmabuf`**: 155.8 % contra 157.2 % de un núcleo. No cuesta nada.
- **Cadena GStreamer**: 0.92 ms sumando cola, `h264parse`, RTP y caps. No hay nada ahí.
- **`jitterBufferTarget = 0`**: implementado y medido; el búfer siguió entre 5.5 y
  7.6 ms, idéntico. En bucle local el navegador ya está en su mínimo, así que la mejora
  es nula justo donde era seguro activarla. Revertido. Sólo tendría sentido evaluarlo
  junto con la medición por red móvil, donde el búfer automático sí crece.
- **Acortar la espera de `wl-copy`**: tarda 17.3 ms de mediana y 23.7 en el p95 en
  tomar el portapapeles. La espera fija de 25 ms está bien elegida; recortarla
  arriesgaría pegar contenido viejo.

### Latencia, lo que queda
- [ ] Medir la ruta remota real desde datos móviles. Todo lo medido es de bucle local;
      si por Internet ICE no logra ruta directa y cae al respaldo JPEG, eso pesa más
      que cualquier ajuste de los anteriores.
- [ ] Salida anidada de NEXO a 120 Hz: el cuadro más nuevo pasaría de 16.7 a 8.3 ms de
      antigüedad. Unos 4 ms de media, sólo en la sesión independiente.
- [ ] Sustituir el rodeo del portapapeles por inyección `uinput`. Quitaría los 31 ms
      restantes del primer espacio y haría más fiable toda la entrada. Comprobado que
      es viable **sólo para Mi PC original**: `/dev/uinput` ya concede acceso al usuario
      local por ACL, sin instalar nada. **No sirve para NEXO**: `uinput` inyecta a nivel
      de sistema, no de compositor, así que los eventos de la sesión aislada acabarían
      en la sesión física y romperían el aislamiento. Implica reescribir el mapeo de
      teclas a códigos de Linux, que hoy está cubierto por pruebas contra `wtype`.
- [ ] Evaluar PipeWire/DMA-BUF sólo si la CPU llega a molestar: capturar la pantalla
      física cuesta 156 % de un núcleo contra 62 % de la anidada, pero es coste de CPU,
      no de latencia.

### Siguiente en la cola
- [ ] Permisos por conexión: ver, controlar, audio, portapapeles y archivos por separado.
- [ ] QR de emparejamiento. **Descartado por ahora** por decisión propia: el uso
      previsto sigue siendo repartir el enlace, no escanear códigos.

### Fase de acceso, lo que queda
- [ ] Túnel con nombre fijo y hostname estable. Pospuesto por decisión propia: el Quick
      Tunnel es gratuito y su dirección cambia en cada arranque.

### Red y calidad
- [ ] Preferir conexión directa en LAN y usar TURN sólo cuando haga falta.
- [ ] Unificar ruta GPU y respaldo bajo una máquina de estados visible.
- [ ] Cambiar de monitor sin renegociar la sesión completa.
- [ ] Evaluar AV1/HEVC midiendo antes el soporte real de cada cliente.

### Comodidad
- [ ] Reconexión que conserve también escala y audio (monitor y controles ya se conservan).
- [ ] Selector de sesión con miniatura, estado, consumo y botón de reinicio.
- [ ] Perfiles de entrada: escritorio, táctil, dibujo, multimedia y presentación.
- [ ] Anclar y desanclar aplicaciones en la barra desde la propia sesión: hoy la lista
      —Explorador, Firefox, Terminal— está fija en `waybar.jsonc`.
- [ ] Acomodar arrastrando la ventana contra un borde, como el Aero Snap de Windows.
      Hyprland no lo implementa; hoy se hace con `Windows+Flechas` o el menú de ventana.

### Mantenimiento
- [ ] Actualización atómica con copia anterior y rollback automático.
- [ ] Pruebas de reinicio, suspensión, caída de túnel y caída de captura.
- [ ] Métricas locales de latencia de captura, codificación, red y entrada.

## Límites conocidos que no son defectos

- La dirección de TryCloudflare cambia en cada arranque. Se consulta con
  `nexo-control link`; para NEXO, con `nexo-session-control link`.
- Android e iOS limitan vídeo y audio en segundo plano según navegador y ahorro de
  batería. No es algo que NEXO pueda forzar.
- El perfil de calidad es global porque se comparte una sola codificación. Perfiles por
  cliente exigirían simulcast o varias codificaciones simultáneas.
- `wf-recorder` todavía copia y escala cuadros con CPU. Una ruta PipeWire/DMA-BUF/CUDA
  ahorraría carga y algunos milisegundos.
- El CSP permite `script-src 'unsafe-inline'`, inevitable mientras `index.html` sea un
  archivo único con su script incrustado.
- El proyecto no está bajo control de versiones, por decisión propia. Sin él no hay
  historial ni forma de revertir un cambio, y la actualización atómica con rollback
  cubriría sólo el despliegue, no el código fuente.

## Antes de distribuirlo a terceros

Emparejamiento por QR, permisos granulares, TLS administrado con dominio propio,
actualizaciones firmadas, empaquetado reproducible y los avisos de licencia de
`THIRD_PARTY_NOTICES.md`.
