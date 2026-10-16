# Proyecto NEXO Evolución

## Objetivo

Convertir el prototipo actual —dos sesiones seleccionables, WebRTC, H.264/NVENC,
audio, entrada remota y acceso web— en una herramienta personal estable, segura y
fácil de mantener. Este proyecto sustituye el backlog técnico desactualizado de
`PROYECTO-FUTURO.md`; ese documento conserva la visión comercial y multiplataforma.

## Línea base validada

- Portal con **Mi PC original** y sesión Hyprland independiente **NEXO**.
- Inicio automático de ambas rutas después de reiniciar.
- Vídeo WebRTC y ruta H.264/NVENC para la sesión principal.
- Mouse, tacto, teclado, audio, monitores, resolución y FPS.
- Sesión independiente bajo el usuario aislado `nexo`.
- Acceso externo mediante un Quick Tunnel temporal.

## Principios

1. Seguridad y recuperación antes de agregar comodidad.
2. Cada función nueva debe tener estado visible, diagnóstico y degradación segura.
3. La ruta LAN debe funcionar aunque Internet o Cloudflare fallen.
4. Las capacidades del navegador deben detectarse; nunca se debe anunciar una función
   como activa si el permiso o la API no fueron concedidos.
5. Los cambios del instalador deben poder deshacerse sin borrar datos personales.

## Fase 0 — Confiabilidad de entrada y diagnóstico (prioridad inmediata)

- [x] Mantener el estado de Windows/Super entre `keydown` y `keyup`.
- [x] Aceptar `Meta`, `OS`, `MetaLeft/Right` y `OSLeft/Right`.
- [x] Mostrar si Keyboard Lock fue concedido, no soportado o denegado.
- [x] Sustituir el respaldo Ctrl derecho por AltGr, dejando Win y Ctrl derecho libres;
  el puente de Windows queda limitado a atajos reservados.
  cuando la ventana de NEXO está activa.
- [x] Añadir una pantalla **Diagnóstico** con navegador, transporte, FPS, RTT,
  monitor, permiso de teclado y último evento recibido.
- [x] Crear pruebas automatizadas de traducción para Super, Ctrl, Alt, Shift,
  caracteres internacionales y teclas especiales.
- [x] Ofrecer una tecla Super virtual fija en la barra como respaldo táctil.

**Aceptación:** `Super+Espacio`, `Super+Q`, `Super+E` y `Super+B` funcionan en
Chrome/Edge compatible; cuando el sistema cliente no permite capturarlos, NEXO lo
explica y ofrece el respaldo sin ambigüedad.

## Fase 1 — Acceso estable y seguro

- [ ] Sustituir TryCloudflare por un túnel nombrado y un hostname estable.
- [x] Mover el secreto fuera de la URL: emparejamiento inicial y cookie de sesión
  `HttpOnly`, `Secure` y de duración limitada.
- [x] Lista de sesiones autenticadas con navegador, última conexión y botón para
  revocar los demás dispositivos.
- [x] Código de emparejamiento de corta duración y un solo uso. El QR sigue
  pendiente; el código se escribe a mano.
- [x] Límites de intentos, cierre de sesiones y registro local de accesos.
- [ ] Permisos por conexión: ver, controlar, audio, portapapeles y archivos.

**Aceptación:** reiniciar no cambia la dirección; copiar accidentalmente la URL no
entrega control permanente; el dueño puede ver y revocar todos los dispositivos.

## Fase 2 — Funciones cotidianas

- [x] Portapapeles bidireccional de texto con activación explícita.
- [x] Transferencia de archivos con selector, progreso, límites y directorio de
  destino controlado.
- [x] PWA instalable con manifiesto, icono y caché limitada a recursos estáticos.
- [ ] Selector de sesión con miniatura, estado, consumo y botón reiniciar.
- [ ] Reconexión que conserve sesión, monitor, escala, audio y controles.
- [ ] Perfiles de entrada: escritorio, táctil, dibujo, multimedia y presentación.

**Aceptación:** copiar texto y mover un archivo no requiere abrir otra aplicación;
la PWA se recupera de cambio de red y bloqueo del dispositivo.

## Fase 3 — Calidad adaptativa y red

- [x] Usar estadísticas WebRTC/RTCP para adaptar bitrate, resolución y FPS según
  pérdida, jitter y ancho de banda, sin intervención manual.
- [ ] Preferir conexión directa en LAN y usar relay/TURN solo cuando sea necesario.
- [ ] Unificar la ruta GPU y la ruta de respaldo bajo una máquina de estados visible.
- [ ] Cambiar de monitor sin reiniciar captura ni renegociar la sesión completa.
- [ ] Evaluar AV1/HEVC solo tras medir soporte real de decodificación por cliente.
- [x] Añadir perfiles adaptativos `Texto`, `Equilibrado` y `Movimiento`.

**Aceptación:** ante una red degradada NEXO baja calidad antes de congelarse y vuelve
a subirla cuando se recupera; la entrada mantiene prioridad sobre el vídeo.

## Fase 4 — Operación y mantenimiento

- [x] Instalador idempotente con `install`, `update`, `doctor` y `uninstall`.
- [ ] Actualización atómica con copia anterior y rollback automático.
- [ ] Pruebas de reinicio, suspensión, caída de túnel y caída de captura.
- [ ] Métricas locales de latencia de captura, codificación, red y entrada.
- [x] Exportación de diagnóstico sin tokens, contraseñas ni datos personales.
- [x] Matriz soportada de navegador, sistema cliente y tipo de teclado.

**Aceptación:** una actualización fallida vuelve a la versión funcional; `doctor`
identifica servicio, túnel, captura, audio, GPU y permisos en una sola ejecución.

## Orden recomendado

| Hito | Entrega | Dependencia |
|---|---|---|
| M1 | Diagnóstico y pruebas de teclado | Ninguna |
| M2 | Túnel estable y emparejamiento | M1 |
| M3 | Portapapeles, archivos y PWA | M2 |
| M4 | Calidad adaptativa y TURN | M1 |
| M5 | Instalador/actualizador recuperable | M1–M4 |

No se recomienda comenzar transferencia de archivos antes del modelo de permisos y
emparejamiento: amplía demasiado el impacto de una URL filtrada.

## Investigación que sustenta el proyecto

- Los Quick Tunnels están destinados a pruebas, cambian de hostname al reiniciar y no
  ofrecen SLA; Cloudflare recomienda un túnel nombrado para uso estable:
  <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/>
- Cloudflare Tunnel permite hostname persistente, conexiones salientes y políticas de
  Access sin abrir puertos entrantes:
  <https://developers.cloudflare.com/tunnel/>
- Keyboard Lock está pensado para escritorio remoto en pantalla completa, pero depende
  del navegador y de las teclas que el sistema operativo permita capturar:
  <https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock>
- RustDesk confirma como expectativas del segmento el portapapeles, transferencia de
  archivos, múltiples plataformas, códecs por hardware y controles de permisos:
  <https://rustdesk.com/docs/en/client/>
- La API de estadísticas de WebRTC expone métricas para observar calidad y fundamentar
  adaptación de transporte:
  <https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/getStats>

## Primera iteración ejecutable

La primera iteración fue **M1**. Sus entregables concretos son:

1. [x] Módulo puro de traducción de teclado compartido por cliente y pruebas.
2. [x] Panel de diagnóstico local, protegido por autenticación.
3. [x] Registro circular en memoria, sin texto escrito ni secretos.
4. [x] Matriz Chrome/Edge/Firefox y Windows/Linux/macOS.
5. [x] Prueba manual documentada de los cuatro atajos NEXO.

M1 quedó implementado el 2026-08-11. La comprobación perceptual de esos atajos en cada
sistema cliente sigue siendo una prueba manual, documentada en `DIAGNOSTICO-TECLADO.md`.

## Avance posterior — 2026-08-11

- La sesión **Mi PC original** requiere usuario/contraseña y usa una cookie `HttpOnly`
  de ocho horas. La sesión independiente **NEXO** permanece sin ese segundo login.
- Contraseñas derivadas con `scrypt`, bloqueo temporal tras cinco fallos, cierre de
  sesión, sesiones visibles/revocables y auditoría local sin IP ni secretos.
- Portapapeles manual bidireccional, archivos limitados a 100 MiB en un directorio
  privado, PWA y exportación de diagnóstico.
- Estadísticas de bitrate, pérdida y jitter, con adaptación opcional de calidad.
- `nexo-doctor` y vigilancia de `Virtual-1`/fullscreen para autorrecuperar 1920x1080.
  Esa salida se sustituyó horas después por `NEXO-HOST`, ver más abajo.

Continúan pendientes el emparejamiento por QR, permisos granulares, actualización
atómica, pruebas de fallos y la infraestructura TURN. El túnel nombrado se pospone por
decisión del usuario; se mantiene el Quick Tunnel sin costo.

## Correcciones de seguridad y consumo — 2026-08-11 (tarde)

Auditoría sobre el sistema en marcha. Cinco defectos reales, ya corregidos:

- `/session-options` entregaba la URL con el token de la sesión independiente a
  cualquiera que tuviera el enlace principal. La primera corrección exigió login, pero
  eso contradecía el diseño: NEXO no debe pedir contraseña nunca. La solución
  definitiva llegó con el emparejamiento: el estado sigue siendo público, la dirección
  se entrega sólo a un dispositivo emparejado y la contraseña queda reservada para la
  sesión física.
- El bloqueo tras cinco intentos **nunca se activaba**: `loginBlocked` borraba el
  registro en cada petición y el contador volvía a uno. Verificado con pruebas.
- El límite se llevaba por dirección de socket y, como el túnel entrega todo desde
  `127.0.0.1`, era un único cubo compartido: cinco fallos de un desconocido bloqueaban
  al dueño. Ahora se distingue el origen real por cabecera, y sólo cuando llega por el
  bucle local, es decir desde cloudflared.
- Un fallo de `listen` mataba el proceso y perdía todas las sesiones autenticadas; el
  lanzador reintentaba cada segundo sin fin (diez caídas registradas). El servidor
  reintenta escuchar sin morir y el lanzador espera cada vez más, hasta medio minuto.
- La captura y NVENC seguían codificando sin ningún cliente: 3,9 GB y 140 000 cuadros
  medidos con `peers:0`, en dos cadenas simultáneas. Ahora se detienen tras un minuto
  de inactividad y vuelven en menos de dos segundos ante la primera oferta.

Además, `nexo-control restart` no reiniciaba nada cuando el archivo de PID estaba
caducado: mandaba la señal a un proceso inexistente y volvía a imprimir los enlaces del
proceso viejo. Ahora comprueba que el PID sea el lanzador y espera a que el puerto deje
de responder.

Endurecimiento posterior, en la misma revisión:

- El token del enlace se compara en tiempo constante sobre su resumen `sha256`, tanto
  en HTTP como en la promoción a WebSocket.
- Un par en segundo plano conserva sus horas de gracia sólo mientras su transporte
  siga `connected`; si ya no lo está se cierra en quince segundos, porque mantenía viva
  la captura de vídeo y el audio sin destinatario. La espera es configurable con
  `NEXO_BACKGROUND_IDLE_MS` y baja de doce a dos horas.
- Las sesiones caducadas se barren cada diez minutos en lugar de esperar a que alguien
  las consulte, con prueba automatizada.

`/opt/nexo` se sincroniza con `sudo headless/install-headless update` seguido de
`sudo systemctl restart nexo-headless.service`.

## El token sale de la URL — 2026-08-11 (noche)

Primer entregable de la Fase 1. El token del enlace pasa de ser la credencial
permanente a un vale de un solo canje:

- La primera visita con `?token=` recibe una cookie de dispositivo `HttpOnly`,
  `SameSite=Lax` y de treinta días, y una redirección que limpia la barra de
  direcciones. Los enlaces existentes siguen funcionando sin cambios.
- `nexo-control pair [minutos]` genera un código de ocho caracteres —sin O, 0, I ni 1,
  para poder dictarlo— válido diez minutos y para un solo dispositivo. El servidor lo
  lee del estado local, así que emparejar no expone ningún endpoint nuevo hacia fuera.
  El código se guarda derivado con `scrypt`, nunca en claro.
- Quien llega sin credencial sólo recibe la página, que muestra la pantalla de
  emparejamiento. Cinco intentos fallidos bloquean ese origen quince minutos.
- Los dispositivos se guardan como resumen `sha256` en `.nexo-devices.json` (`0600`) y
  sobreviven al reinicio del servidor. El panel **ⓘ** los lista con su última conexión
  y permite revocarlos uno a uno o todos menos el actual.
- El puerto WebSocket acepta la cookie además del token heredado.

`SameSite=Lax` y no `Strict` porque la primera visita suele llegar desde un enlace
pegado en otra aplicación, y `Strict` no enviaría la cookie en esa navegación.

Verificado con seis pruebas automatizadas nuevas y, en una instancia aislada, con el
navegador: pantalla de emparejamiento, código en minúsculas con espacio, entrada al
escritorio sin token en la URL, reinicio del servidor sin perder el dispositivo,
WebSocket aceptado sólo con cookie y revocación efectiva.

Pendiente de esta fase: el QR, los permisos por conexión y el túnel con nombre fijo.

## Segunda pasada de la experiencia Windows — 2026-08-11 (noche)

La primera pasada dejó la sesión NEXO reconocible: barra inferior, barra de título,
Inicio y atajos. Lo que faltaba no era decoración, sino que la tecla Windows llevara a
algún sitio y que lo cotidiano estuviera al alcance sin abrir una terminal.

- **El menú Inicio pasa de lanzador a menú.** Cuatro pestañas —Aplicaciones, Ejecutar,
  Ventanas y Archivos— detrás de la misma tecla, con cuadrícula de iconos, contador de
  resultados y las pistas de teclado escritas dentro del propio menú, porque la sesión
  se usa sobre todo desde el celular y ahí no hay costumbre previa que recordar.
- **Una sola paleta.** Los colores estaban repetidos en el tema del menú, en el de los
  diálogos y en el CSS de las barras, y ya habían empezado a separarse. Ahora viven en
  `headless/windows-colors.rasi`, que importan los dos temas; el CSS los repite en el
  formato de GTK con los mismos valores y el mismo comentario.
- **El resaltado deja de ser un bloque de color.** Con selección por puntero, recorrer
  la cuadrícula encendía tiles enteros de cian sobre texto oscuro. Relleno translúcido
  con borde de acento: se distingue igual de bien y no cansa.
- **`-no-config` en todos los diálogos.** Un `config.rasi` cualquiera en el hogar del
  usuario `nexo` bastaba para cambiar colores, fuente y geometría de todo el escritorio.
  Se descubrió al probar el tema en la sesión principal, donde el `@theme` personal se
  mezcló con el nuestro y el menú salió con otra apariencia.
- **Las medidas de los acomodos se calculan.** Estaban escritas a mano —`950x988` en
  `6,40`— y sólo eran correctas mientras la barra superior midiera exactamente 40 px.
  Ahora se derivan del área libre del monitor, con medias pantallas, cuartos, centrar,
  pantalla completa y «siempre encima».
- **Lo que en Windows se da por hecho y aquí no existía**: historial del portapapeles
  con `Windows+V`, recorte y captura con `Windows+Shift+S` e `Impr Pant`, cuatro
  escritorios virtuales visibles en la barra, configuración rápida con estado de
  volumen, red y avisos, y una hoja de atajos buscable que además ejecuta lo elegido.
- **Un botón roto no avisa.** Si un menú llama a un ayudante que no se instaló, no hay
  error: el clic simplemente no hace nada, y desde el celular eso es indiagnosticable.
  El instalador copia ahora todos los scripts `windows-*` y falla si alguna barra,
  atajo o menú cita una ruta de `/usr/local/lib/nexo` que no existe.

Salir de la pantalla completa antes de acomodar usaba `fullscreen 1`, que en una ventana
realmente a pantalla completa no salía: la dejaba maximizada y el acomodo se ignoraba.
Se cambió por `fullscreenstate 0 -1`, que devuelve el modo normal sin tocar lo que la
aplicación cree de sí misma.


### Segunda tanda: las ventanas

La barra ya parecía de Windows, pero el escritorio no. Lo que delataba que aquello era
otra cosa no eran los iconos, sino cómo se comportaban las ventanas:

- **Huecos, transparencias y oscurecimiento.** Separación entre ventanas y contra los
  bordes, opacidad 0.92 en la inactiva, `dim_inactive` y un borde que giraba de color en
  bucle. Todo eso es lenguaje de escritorio de mosaico. Ahora: sin huecos, borde de
  1 px, esquinas de 8 px, opacidad total y animaciones cortas sin rebote. La
  transparencia además tenía un coste medible por vídeo: cada cambio detrás de una
  ventana translúcida obliga a recodificar esa zona.
- **El mosaico automático.** Abrir la segunda aplicación partía la pantalla en dos y
  movía la primera de sitio. Es lo que más desconcierta a quien no lo espera. Todo se
  abre flotante y centrado, y se superpone.
- **Los avisos.** Heredaban el tema personal del usuario anfitrión y salían arriba a la
  derecha. Tienen configuración y hoja de estilo propias, con la paleta de la sesión, y
  aparecen abajo a la derecha, encima de la barra de tareas.
- **La terminal.** Translúcida y con `Ctrl+Shift+C` para copiar. Ahora opaca, y
  `Ctrl+C`/`Ctrl+V` funcionan como en la Terminal de Windows: copian si hay selección e
  interrumpen si no la hay.
- **El clic derecho en el fondo.** Se resolvió con `bindn`, que no consume el evento:
  el clic derecho dentro de una aplicación le sigue llegando, y el script comprueba si
  el puntero estaba sobre una ventana o sobre una barra antes de mostrar nada.
- **El fondo de pantalla** dejó de estar escrito en la configuración de Hyprland. Se
  elige desde la sesión, con vista previa de cada imagen, y se recuerda entre reinicios.

Queda fuera, y conviene decirlo: los iconos en el Escritorio. Hyprland no dibuja
ninguno y hace falta un gestor aparte —`pcmanfm-qt --desktop`—, que exige instalar un
paquete en el anfitrión y esa decisión no es del instalador.

Se aplica con `sudo headless/install-headless update` y `sudo systemctl restart
nexo-headless.service`.

### Lo que se vio al instalarlo

Con la sesión ya corriendo aparecieron tres cosas que sólo se ven en pantalla:

- **Faltaban iconos en la barra**: Inicio, Buscar, Explorador y Terminal salían vacíos,
  y también los de la barra superior. Al reescribir los archivos, esos glifos —del área
  de uso privado de la fuente— se perdieron y quedaron cadenas vacías. Se repusieron con
  glifos Material Design, comprobando cada punto de código contra la fuente instalada en
  lugar de confiar en que estuviera. El botón Inicio lleva ahora el logotipo de Windows.
- **Los cuadros de aviso salían en tema claro.** `gtk-application-prefer-dark-theme` no
  basta: zenity lo ignora. `GTK_THEME=Adwaita:dark` en el entorno de la sesión lo
  resuelve para todo lo que use GTK.
- **Iconos en el Escritorio, ya posibles.** Se probó `pcmanfm-qt --desktop` en un
  compositor anidado desechable antes de tocar la sesión: crea su capa y dibuja archivos
  y carpetas. Se integra de forma opcional —si el paquete no está, la sesión arranca
  igual— y como su capa tapa el fondo de awww, el selector de fondo cambia los dos y el
  menú del escritorio cede el clic derecho al suyo, que es más completo.

La imagen de fondo se guarda además como JPEG porque Qt no lee WebP sin
`qt6-imageformats`, y el escritorio de pcmanfm-qt habría mostrado un color liso.

### Tres fallos que sólo se vieron con la sesión instalada

- **La regla de aislamiento de polkit no cargaba.** `polkitd[9200]: Error loading
  script /etc/polkit-1/rules.d/49-nexo-session-isolation.rules`, desde la primera
  instalación. polkit 127 evalúa las reglas con duktape y rechazaba el archivo por los
  acentos de sus comentarios. Una regla que no carga se ignora en silencio: el
  aislamiento parecía configurado y no lo estaba, y cualquier acción de udisks o de
  NetworkManager desde la sesión remota volvía a la política por omisión, que pide
  contraseña de administrador. Reescrita en ASCII, y el instalador ahora recarga polkit
  y falla si vuelve a rechazarla, en lugar de dejarlo pasar.
- **El escritorio salía de un color liso, sin fondo.** `WallpaperMode=crop` no existe en
  pcmanfm-qt; con un modo desconocido no dibuja imagen y pinta el color de fondo, que
  además tapa el de awww. Es `zoom`.
- **El menú Inicio salía sin iconos**, con los nombres sobre un hueco vacío. La sesión
  arranca desde systemd sin pasar por ningún perfil de shell, así que `XDG_DATA_DIRS` y
  `XDG_DATA_HOME` no existían: rofi encontraba los `.desktop` por la ruta por omisión
  pero no llegaba a ningún directorio de iconos. Se definen ahora en el entorno de la
  sesión, y los diálogos piden el tema de iconos también por línea de órdenes.

Los avisos de zenity, que salían en tema claro, se arreglan con `GTK_THEME=Adwaita:dark`:
`gtk-application-prefer-dark-theme` no basta porque zenity lo ignora.

### El clic que no abría, y el cuadro de contraseña

Dos síntomas que parecían inconexos y ambos venían de la sesión remota.

**El menú Inicio no abría al hacer clic.** Se dibujaba con `-normal-window`, y en ese
modo el clic cerraba el menú sin lanzar nada. Antes de tocar nada se midió: con rofi
como capa, un clic sintético sobre una casilla concreta —puntero virtual, el mismo
camino que usa el cliente remoto— devuelve exactamente esa casilla. Dos hipótesis
previas quedaron descartadas por medición: las opciones de ratón eran correctas
(`-me-select-entry ''` con `-me-accept-entry MousePrimary` acepta con clic simple; las
de fábrica exigen doble clic) y la cuadrícula mapea bien el clic a su celda. Se pasó a
capa y se aceptan los dos gestos, simple y doble, por si el cliente envía el clic sin
movimiento previo.

**El cuadro «Authentication required» del llavero, en la pantalla física.** El registro
del bus de la sesión remota lo explicó: `org.freedesktop.secrets` pedido por
`/opt/brave-bin/brave` con uid 1001, y a continuación `org.gnome.keyring.SystemPrompter`.
Brave, dentro de NEXO, quería el llavero; como esa sesión no tiene ningún prompter
propio, gcr recurre al del sistema, que dibuja en la sesión físicamente activa. De ahí
que el cuadro apareciera en la computadora, sin contexto y a media faena. Brave y
Chromium usan ahora `--password-store=basic`, con lo que guardan sus secretos cifrados
en su propio perfil y no piden nada.

Conviene anotar el patrón: la primera lectura fue «esto no puede venir de NEXO, son
usuarios y buses distintos». Era cierto para el bus, y aun así el aviso llegaba a la
pantalla física por un camino que no pasa por el bus de sesión.
