# Teclado remoto

> **Migración a Windows en curso:** el contexto para agentes está en
> [`AGENTS.md`](AGENTS.md) y el plan completo, con sus prompts, en
> [`PLAN-MIGRACION-WINDOWS.md`](PLAN-MIGRACION-WINDOWS.md).

> **¿Usas NEXO en un host Windows?** Esta página describe el host Linux (Hyprland). La
> instalación, el uso diario y la solución de problemas del host Windows están en
> [`README-WINDOWS.md`](README-WINDOWS.md); el cliente web es el mismo.

NEXO permite ver y controlar una sesión Hyprland desde el celular, con vídeo, audio,
entrada táctil, teclado y escritorios. Puede publicar acceso local, remoto o ambos.
Cuando hay varias pantallas, usa por defecto la salida situada en `(0,0)` como monitor
principal y el botón de monitores permite cambiar la captura y el mapeo táctil.

Desde otra PC, el cliente detecta el puntero fino y cambia automáticamente a control
de escritorio: el mouse mueve el cursor remoto, sus botones se mantienen al arrastrar,
la rueda hace scroll y el teclado físico escribe directamente en la ventana remota sin
abrir el panel móvil. El panel de teclado y los perfiles NAV/DRAG se conservan para
celulares y pantallas táctiles.

Desde una PC, **AltGr (Alt derecho) + tecla** se envía como **Super + tecla** al host.
NEXO suprime los bits `Ctrl+Alt` que Windows añade a AltGr, por lo que el escritorio
remoto recibe únicamente Super. **Windows/Super y Ctrl derecho ya no se capturan** y
conservan su función local, evitando conflictos con Windows y otras aplicaciones.
Pulsar AltGr solo abre el menú Inicio remoto (equivale a `Super+Espacio`).

El ayudante descargable queda disponible únicamente para combinaciones reservadas por
Windows o Chrome, como `Alt+Tab`, `Alt+F4` y `Ctrl+Shift+C/V`. El código fuente y las
instrucciones están en [`windows-helper/`](windows-helper/README.md).

La ruta principal usa WebRTC con perfiles HD 720p, HD+ 900p y Full HD 1080p, además
de 30/45/60 FPS seleccionables. El audio Opus y los controles permanecen en dos canales:
uno confiable para teclado/clics y otro sin retransmisiones para movimiento. La ruta
H.264/NVENC es la ruta de vídeo preferida y se inicia automáticamente. Los selectores
de resolución y FPS reconfiguran también NVENC. `wf-recorder` convierte los buffers
Wayland con stride seguro y codifica una sola vez en la GPU; GStreamer empaqueta el
H.264 resultante y el puente Pion comparte ese RTP entre los clientes;
al reproducirse, la captura VP8 por CPU se apaga y se reactiva ante un fallo.
Sin ningún cliente conectado, la captura y NVENC se detienen tras un minuto y vuelven
solos en cuanto llega la primera oferta; `NEXO_GPU_IDLE_STOP_MS` cambia esa espera.
El perfil recomendado para escritorio remoto es 1080p a 45 FPS. NVENC usa H.264 High,
preset P1 y ajuste de latencia ultrabaja. Los perfiles usan 10 Mbps en 1080p, 7 Mbps en
900p y 4.5 Mbps en 720p para evitar que el túnel acumule vídeo; la calidad automática
queda activa de forma predeterminada y baja el perfil cuando detecta congestión.
El perfil es global: una reconexión nunca lo sobrescribe y sólo los botones de calidad
lo cambian. El puente conserva la secuencia RTP durante cambios de monitor o perfil para
que las sesiones conectadas no se congelen ni tengan que renegociarse.
El navegador muestra el video directamente, sin copiar
cada cuadro a Canvas. Si WebRTC
no logra negociar la red, el cliente vuelve automáticamente al stream JPEG/WebSocket.
La cabecera muestra `GPU`, FPS y RTT cuando está acelerado.

El cliente ofrece modos explícitos `CEL` y `PC`. En celular, `MOVER` hace clic al tocar
y scroll real con inercia al deslizar; `DIRECTO` permite dibujar, mover sliders o
reordenar elementos. En computadora, mouse y teclado actúan directamente y fullscreen
oculta la interfaz para mostrar sólo el escritorio remoto. El scroll
Wayland utiliza el binario incluido `bin/wlrctl`; su licencia está documentada en
`THIRD_PARTY_NOTICES.md`.

La sesión WebRTC permanece conectada cuando la página pasa a segundo plano hasta quince
minutos sin actividad; después libera captura, audio y codificadores, y se reconecta al
volver. `NEXO_BACKGROUND_IDLE_MS` permite cambiar ese plazo. Al cerrar o abandonar la
página, las conexiones se liberan de inmediato. Con el
audio activado, Media Session permite continuar escuchando y mostrar controles del
sistema. El botón `PiP` abre el video WebRTC en una ventana flotante cuando el navegador
móvil soporta Picture-in-Picture. Las restricciones finales de ejecución en segundo
plano dependen de Android/iOS, el navegador y el ahorro de batería.

```bash
npm start                    # local + Internet
npm run local                # sólo LAN
npm run remote               # sólo Internet
```

El lanzador conserva el token en `.nexo-state.json` (permisos `0600`) y muestra dos URL.
El acceso remoto rápido usa un subdominio temporal de TryCloudflare. Para producción,
define `NEXO_TUNNEL_TOKEN` con el token de un túnel administrado de Cloudflare.

Variables: `NEXO_MODE`, `NEXO_TUNNEL_TOKEN`, `CLOUDFLARED_PATH`,
`REMOTE_KEYBOARD_PORT`, `REMOTE_KEYBOARD_TOKEN`, `NEXO_RECREATE_TUNNEL`, `NEXO_GPU`,
`NEXO_GPU_IDLE_STOP_MS` y `NEXO_MICROFONO`.
Define `NEXO_GPU=0` para desactivar NVENC y usar solamente el respaldo CPU. La ruta GPU
requiere GStreamer con `gst-plugins-good`, `gst-plugins-bad` y `nvcodec`.
La URL rápida se conserva mientras el proceso esté vivo. Define
`NEXO_RECREATE_TUNNEL=1` sólo si prefieres recrear el túnel ante fallos de salud,
aunque esto puede cambiar la URL.
El token sigue protegiendo el portal y la sesión NEXO independiente; Mi PC original
exige además credenciales. No compartas la URL.

## Emparejar un dispositivo

El token del enlace dejó de ser la credencial: ahora se canjea. La primera vez que
abres una dirección con `?token=`, el servidor entrega una cookie de dispositivo de
treinta días y quita el token de la barra de direcciones, de modo que no queda en el
historial, en una captura ni en el mensaje donde compartiste el enlace. Los enlaces
antiguos siguen funcionando exactamente igual.

Para dar de alta un aparato sin pasar el enlace, genera un código en la PC:

```bash
nexo-control pair
```

Imprime algo como `WBJZ-T6P2`, válido diez minutos y para un solo dispositivo. En el
celular se abre la dirección de NEXO sin token y se escribe allí; da igual si lo
escribes en minúsculas, con guion o con un espacio. Cinco intentos fallidos bloquean
ese origen quince minutos sin afectar a los demás. `nexo-control pair 30` cambia la
validez en minutos.

Para invalidar los enlaces que ya compartiste:

```bash
nexo-control rotate
```

Genera un token nuevo y reinicia NEXO. **Los aparatos ya emparejados siguen entrando
sin hacer nada**, porque se identifican con su cookie y no con el token; lo único que
deja de funcionar son las direcciones repartidas antes, que hasta entonces seguían
siendo credenciales válidas de forma indefinida. El enlace nuevo sirve igual que
siempre para emparejar más aparatos. Pide confirmación; `nexo-control rotate -y` la
omite. La dirección de Internet cambia, como en cualquier reinicio.

El botón **ⓘ** lista los dispositivos emparejados con su última conexión y permite
revocarlos uno a uno o todos menos el actual. Conviene mirar esa lista antes de rotar. Revocar es inmediato: la cookie deja de
valer aunque el aparato la conserve. Los archivos `.nexo-devices.json` y
`.nexo-pairing.json` guardan sólo resúmenes, con permisos `0600`, y sobreviven a un
reinicio del servidor para no cerrar la sesión de todos los aparatos.

## Acceso, portapapeles y archivos

Hay dos niveles distintos y no conviene confundirlos. El **emparejamiento** es la
puerta común: sin un dispositivo emparejado no se ve nada de ninguna de las dos
sesiones. La **contraseña** es sólo de **Mi PC original**, porque ahí están tus
ventanas, tus archivos y tu sesión física.

**NEXO independiente nunca pide contraseña**: es un escritorio aislado bajo otro
usuario, y esa es su razón de ser. Desde el portal se entra directo.

La contraseña de Mi PC no se guarda en texto plano; se deriva con `scrypt` y el
navegador recibe una cookie `HttpOnly` de ocho horas. Tras cinco intentos fallidos, ese
origen queda bloqueado quince minutos sin afectar a los demás. Para consultar o cambiar
las credenciales:

```bash
nexo-control credentials status
nexo-control credentials set Letzus
nexo-control doctor
```

El botón **⇄** abre el portapapeles manual y la transferencia de archivos. Los archivos
se limitan a 100 MiB y quedan en `.nexo-files` dentro del estado privado de cada sesión.
El botón **ⓘ** permite ver/revocar sesiones, cerrar el login, activar calidad adaptativa
y exportar un diagnóstico sin tokens ni contraseñas.

## El micrófono del celular como micrófono de la PC

El botón **🎤** de la barra usa el micrófono del teléfono como entrada del
equipo. NEXO publica en PipeWire una fuente llamada **Micrófono del celular
(NEXO)** —`nexo_micro`— y Discord, OBS, Meet o cualquier otro programa la ven
como un micrófono más. El botón contiguo silencia y reactiva; mientras habla, la
barrita inferior del botón se mueve, que es la única forma de comprobar sin
mirar la PC que la voz está saliendo de verdad.

La fuente se publica **al arrancar NEXO**, no al conectar el teléfono, para que
puedas dejarla elegida en Discord de antemano y no tengas que volver a
seleccionarla en cada reinicio. `NEXO_MICROFONO=0` desactiva esa publicación.

El portal de acceso tiene una tercera opción, **🎤 Sólo micrófono**, debajo de
los dos escritorios. También se llega manteniendo pulsado el botón de la barra o
entrando directamente en **`/microfono`**. Es la interfaz que sólo es micrófono: un círculo, un medidor de nivel y nada más. No
abre vídeo ni captura de pantalla, así que gasta muchísimo menos batería y datos
cuando lo único que quieres es hablar. El emparejamiento y el inicio de sesión se
hacen desde la página principal; esa página sólo pide micrófono.

**Puedes bloquear el teléfono.** El audio sigue enviándose, apoyado en tres cosas
a la vez porque ninguna basta sola: la captura de micrófono en curso, que impide
a Chrome congelar la pestaña; un audio inaudible en bucle con Media Session, que
saca una notificación persistente en Android; y Wake Lock mientras la pantalla
está encendida. Si aun así el sistema corta la conexión, el cliente reintenta con
espera creciente y al volver a mirar la pantalla se reconecta solo. La
notificación de NEXO en la barra de Android es la señal de que sigue vivo: si la
cierras, Android puede dormir la pestaña.

Dos detalles que hacen que esto funcione y que es fácil romper al tocar el
código. El audio de sostén **tiene que arrancar en el mismo manejador del toque**,
antes del primer `await`: la política de reproducción automática sólo lo permite
mientras dura la activación del usuario, y si se lanza después, `play()` se
rechaza en silencio, Android no saca notificación y la pestaña muere al bloquear.
Y en la PC un ICE en `disconnected` **no se cierra al momento**: al bloquear la
pantalla Android pone el wifi en ahorro de energía y ese estado aparece siempre,
recuperándose solo a los pocos segundos; hay treinta segundos de tolerancia antes
de dar la conexión por perdida.

Si se corta, `GET /microfono/estado` incluye `ultimoCierre` con el motivo y
cuánto duró la sesión: dice si fue la PC quien cerró y por qué.

**Entra por el enlace de Internet, no por la IP de la red local.** El navegador
sólo entrega el micrófono en contextos seguros, y la URL de LAN va en HTTP: ahí
el botón avisará de que hace falta HTTPS. La dirección del túnel de Cloudflare sí
lo es y funciona con normalidad, también estando en casa.

En la PC el micrófono viaja por una conexión WebRTC propia, separada de la del
escritorio: cerrar la pantalla compartida, cambiar de monitor o renegociar el
vídeo no lo apagan. Sólo un aparato puede hablar a la vez; si conectas un
segundo, el primero se desconecta para no mezclar dos voces en la misma fuente.

Para quitar el micrófono virtual del sistema —descarga los módulos por su
identificador, sin tocar los de otros programas:

```bash
node -e 'require("./microfono-virtual").descargarDispositivo()'
```

## Sesión independiente experimental

El diseño y la implementación reversible para ejecutar un segundo Hyprland bajo un
usuario separado están en [`PLAN-SESION-INDEPENDIENTE.md`](PLAN-SESION-INDEPENDIENTE.md)
y [`headless/README.md`](headless/README.md). La adaptación visual y de uso para una
persona acostumbrada a Windows está detallada en
[`PLAN-EXPERIENCIA-WINDOWS.md`](PLAN-EXPERIENCIA-WINDOWS.md). Sólo afecta al usuario
aislado `nexo`; la sesión principal conserva su configuración.

La URL del Nexo principal presenta primero un portal con dos destinos: **Mi PC
original** y **NEXO**. La segunda opción usa el enlace temporal vigente de la sesión
independiente; si todavía está arrancando, el botón se habilita automáticamente cuando
su túnel queda listo. Pulsarlo entra directo, sin contraseña. El servicio independiente está habilitado para iniciar con el
entorno gráfico, mientras el Nexo principal conserva su autoinicio en Hyprland.

La sesión NEXO ofrece barra de tareas inferior con **Buscar**, **Vista de tareas**,
cuatro escritorios virtuales y accesos directos a captura, portapapeles y configuración;
una barra superior que identifica la aplicación activa y permite acomodar a los lados,
minimizar, maximizar, restaurar y cerrar; menú Inicio, Explorador Dolphin, una Terminal
con cabecera propia y las aplicaciones abiertas en la barra.

La tecla **Windows** abre un menú Inicio con cuatro pestañas —**Aplicaciones**,
**Ejecutar**, **Ventanas** y **Archivos**—, cuadrícula de iconos, contador de resultados
y las pistas de teclado a la vista. Los diálogos de la sesión comparten paleta con él:
los colores viven en un único archivo, `headless/windows-colors.rasi`, que importan
tanto el menú como el resto de los cuadros.

Las ventanas también se comportan como allí: se abren flotantes y centradas, se
superponen, son opacas —ninguna deja ver la de atrás ni se oscurece al perder el foco—,
no dejan huecos entre ellas y llevan borde fino con esquinas discretas. El Escritorio muestra sus iconos —carpetas y archivos— cuando el equipo tiene
`pcmanfm-qt`. El clic derecho
sobre el fondo abre el menú del escritorio, con nueva carpeta, terminal, fondo de
pantalla y configuración. Los avisos salen abajo a la derecha, encima de la barra. El
fondo de pantalla se cambia desde la propia sesión y se recuerda entre reinicios.

Atajos familiares: `Alt+Tab` y `Alt+Shift+Tab`, `Alt+F4`, `Alt+Espacio`, `Windows+E`,
`Windows+R`, `Windows+S`, `Windows+D`, `Windows+I`, `Windows+N`, `Windows+Tab`,
`Windows+1/2/3` para lo anclado en la barra, `Windows+Flechas` para media pantalla y
`Windows+Shift+Flechas` para un cuarto. Además: **`Windows+V`** abre el historial del
portapapeles, **`Windows+Shift+S`** recorta la pantalla —`Impr Pant` la captura entera y
`Alt+Impr Pant` sólo la ventana, guardando en `Imágenes/Capturas` y en el portapapeles—,
**`Windows+Ctrl+Flechas`** cambia de escritorio virtual y **`Windows+/`** abre una lista
buscable de todos los atajos, desde la que se puede ejecutar cada uno. La primera
conexión muestra una guía breve y deja una copia permanente en el Escritorio.

El enlace vigente se consulta sin reiniciar NEXO ni recrear el túnel con:

```bash
nexo-control link
```

## Qué documento sirve para qué

| Documento | Para qué | Vigencia |
|---|---|---|
| [`README.md`](README.md) | Cómo se usa. Punto de entrada. | Vigente |
| [`README-WINDOWS.md`](README-WINDOWS.md) | Instalar y usar NEXO en un host Windows. | Vigente |
| [`PLAN-MIGRACION-WINDOWS.md`](PLAN-MIGRACION-WINDOWS.md) | Contratos y fases de la migración a Windows; bitácoras en `docs/windows/bitacora/`. | Vigente |
| [`PROGRESO.md`](PROGRESO.md) | Qué está hecho, qué falta y en qué orden. | Vigente |
| [`ESTADO-MVP-Y-REINICIO.md`](ESTADO-MVP-Y-REINICIO.md) | Arquitectura multimedia, dependencias y cómo arrancar tras reiniciar. | Vigente |
| [`PROYECTO-NEXO-EVOLUCION.md`](PROYECTO-NEXO-EVOLUCION.md) | Plan por fases y registro de cada cambio con su motivo. | Vigente |
| [`PLAN-SESION-INDEPENDIENTE.md`](PLAN-SESION-INDEPENDIENTE.md) | Diseño de la segunda sesión bajo el usuario `nexo`. | Vigente |
| [`PLAN-EXPERIENCIA-WINDOWS.md`](PLAN-EXPERIENCIA-WINDOWS.md) | Adaptación visual de NEXO para quien viene de Windows. | Vigente |
| [`DIAGNOSTICO-TECLADO.md`](DIAGNOSTICO-TECLADO.md) | Matriz de teclado y prueba manual de atajos. | Vigente |
| [`headless/README.md`](headless/README.md) | Instalar y desinstalar la sesión independiente. | Vigente |
| [`windows-helper/README.md`](windows-helper/README.md) | Puente de la tecla Windows para clientes Windows. | Vigente |
| [`PROYECTO-FUTURO.md`](PROYECTO-FUTURO.md) | Visión comercial y migración a Windows. | Histórico: su backlog técnico está superado |
| [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) | Licencias de terceros. | Vigente |

El botón **ⓘ** abre un diagnóstico autenticado con navegador, transporte, FPS, RTT,
monitor, Keyboard Lock y último tipo de evento. Su registro circular no conserva texto,
teclas, tokens ni direcciones. El botón fijo **SUPER** arma Super para la siguiente
tecla y el panel de atajos incluye accesos directos de validación. La matriz y el
procedimiento están en [`DIAGNOSTICO-TECLADO.md`](DIAGNOSTICO-TECLADO.md); las pruebas
de traducción se ejecutan con `npm test`.
