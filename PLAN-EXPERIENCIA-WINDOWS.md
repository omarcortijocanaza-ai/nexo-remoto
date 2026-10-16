# NEXO · Experiencia familiar para usuarios de Windows

## Objetivo

Hacer que la sesión independiente `nexo` resulte reconocible para una persona que ha
usado Windows toda su vida, sin alterar la sesión Arch/Hyprland de `Letzus`, reducir el
aislamiento ni ocultar que el sistema sigue siendo Linux.

## Diseño

### Escritorio y barra de tareas

- Barra opaca y translúcida en la parte inferior.
- Botón **Inicio** a la izquierda con búsqueda de aplicaciones.
- Cuadro **Buscar** y botón **Vista de tareas** visibles, sin depender de atajos.
- Cuatro **escritorios virtuales** numerados, siempre presentes, con rueda del ratón.
- Explorador, Firefox y Terminal anclados.
- Botones de aplicaciones abiertas con activar y cerrar mediante clic central.
- Accesos a **captura**, **portapapeles** y **configuración rápida** junto a la bandeja.
- Bandeja, red, volumen, notificaciones, calendario y reloj a la derecha.
- Franja **Mostrar escritorio** en el extremo derecho.

### Menú Inicio y diálogos

- Un solo lugar para todo: pestañas **Aplicaciones**, **Ejecutar**, **Ventanas** y
  **Archivos**, con cuadrícula de iconos y contador de resultados.
- Pistas de teclado escritas en el propio menú: la sesión se usa sobre todo desde el
  celular, donde no hay costumbre previa que recordar.
- Paleta única en `windows-colors.rasi`, importada por el menú y por los diálogos, para
  que nada se desincronice al retocar un color.
- Fondo acrílico difuminado por el compositor, esquinas redondeadas y resaltado con
  relleno translúcido y borde de acento, en vez de un bloque de color pleno.
- Iconos reales del tema Papirus en cada acción, no viñetas de texto.
- `-no-config` en todos los diálogos: la apariencia no depende de ningún archivo suelto
  en el hogar del usuario `nexo`.

### Ventanas y entrada

- Ventanas opacas, sin huecos, con borde de 1 px y esquinas de 8 px; ninguna se
  oscurece ni se transparenta al perder el foco.
- Todo se abre flotante, centrado y superponible: nada de mosaico automático.
- Animaciones cortas, sin rebote ni bordes que cambien de color solos.
- Iconos en el Escritorio, con su menú de clic derecho, si el equipo tiene pcmanfm-qt.
- Menú del escritorio con clic derecho sobre el fondo.
- Fondo de pantalla elegible desde la propia sesión, con memoria entre reinicios.
- Avisos abajo a la derecha, encima de la barra de tareas, con la paleta de la sesión.
- Barra superior persistente con título y botones de acomodar a los lados, minimizar,
  maximizar y cerrar, incluso en aplicaciones sin decoración propia como la terminal.
- Identidad de la aplicación activa en esa barra y estado maximizar/restaurar visible.
- Cabecera de pestaña permanente en la terminal, bajo los controles del escritorio.
- Aplicaciones principales flotantes y centradas, en lugar de mosaico automático.
- Acomodos completos: media pantalla, cuartos, centrar, pantalla completa y «siempre
  encima», calculados sobre el área libre del monitor y no con medidas fijas.
- `Alt+Tab`, `Alt+Shift+Tab`, `Alt+F4`, `Alt+Espacio`, `Windows+E`, `Windows+R`,
  `Windows+S`, `Windows+D`, `Windows+I`, `Windows+N`, `Windows+Tab`, `Windows+1/2/3`,
  `Windows+Flechas` y `Windows+Shift+Flechas`.
- `Windows+V` portapapeles, `Windows+Shift+S` e `Impr Pant` capturas,
  `Windows+Ctrl+Flechas` escritorios y `Windows+/` la lista de atajos.
- Inicio accesible desde el botón, `Windows+Espacio` y la tecla Windows cuando el
  navegador/cliente permita capturarla.
- Teclado latinoamericano y cursor convencional.

### Aplicaciones y archivos

- Dolphin como Explorador y Firefox como navegador predeterminado.
- Carpetas Escritorio, Documentos, Descargas, Imágenes, Música y Vídeos.
- Doble clic en Dolphin, iconos Papirus y tema oscuro consistente.
- Interfaz y fecha en español mediante `es_MX.UTF-8`.

### Orientación

- Mensaje de bienvenida mostrado una sola vez, con versión propia: una guía ampliada
  vuelve a mostrarse una única vez tras actualizar.
- Guía permanente en el Escritorio.
- Hoja de atajos buscable que además ejecuta la acción elegida, para quien prefiere no
  memorizar combinaciones.
- Configuración rápida para sonido, red, notificaciones, capturas y portapapeles sin
  abrir terminal, con el estado actual escrito en el propio diálogo.
- «Acerca de esta sesión» con pantalla, ventanas, memoria y espacio libre.
- Reparar la barra de tareas sin reiniciar la sesión ni perder las ventanas abiertas.
- El estado de red es consultable, pero sus cambios se reservan a la sesión principal.

## Seguridad y límites

- No se concede `sudo` al usuario `nexo`.
- No se copian documentos, credenciales ni perfiles del usuario principal.
- Dolphin oculta discos físicos y Polkit impide que `nexo` monte almacenamiento,
  cambie la red o controle la energía del equipo anfitrión.
- Los controles de apagado del equipo físico no se exponen.
- NEXO, PipeWire, límites systemd y el guardián 1920x1080 permanecen sin cambios.

## Validación

1. `WAYLAND-1` y WebRTC permanecen a 1920x1080.
2. Waybar carga sin errores y aparece abajo.
3. Inicio abre aplicaciones y la barra enumera ventanas activas.
4. Dolphin, Firefox, volumen, red, notificaciones y reloj responden.
5. Los atajos familiares funcionan sin afectar la sesión física.
6. Reiniciar conserva carpetas, preferencias y aislamiento.

## Reversión

Los archivos se gestionan mediante `headless/install-headless update`. La configuración
anterior permanece en el historial del proyecto y puede restaurarse volviendo a instalar
otra revisión; desinstalar NEXO sigue conservando el hogar y los documentos del usuario.

## Segunda pasada de interfaz — 2026-08-11 (noche)

Qué cambió y por qué:

- **La tecla Windows abría un lanzador; ahora abre un menú.** Buscar aplicaciones era
  lo único posible; ver las ventanas, ejecutar un comando o entrar a las carpetas exigía
  conocer otro atajo. Las cuatro pestañas ponen todo detrás de la misma tecla.
- **Los colores estaban escritos tres veces** —menú, diálogos y barras— y ya habían
  empezado a divergir. Ahora hay un único archivo de paleta que importan los temas.
- **El resaltado era un bloque de color pleno.** Con selección por puntero, recorrer la
  cuadrícula encendía tiles enteros de cian y tapaba el icono. Relleno translúcido con
  borde de acento: se ve qué está elegido sin que la vista se canse.
- **Las medidas de los acomodos estaban escritas a mano** (`950x988` en `6,40`). Se
  calculan sobre el área libre del monitor, de modo que cambiar el alto de una barra ya
  no descoloca las ventanas.
- **Faltaban cosas que en Windows se dan por hechas**: historial del portapapeles,
  recorte de pantalla, escritorios virtuales visibles y una lista de atajos.
- **Un botón que apunta a un archivo inexistente no da ningún error visible.** El
  instalador ahora copia todos los scripts `windows-*` y falla si alguna barra, atajo o
  menú cita un ayudante que no existe.

Segunda tanda, sobre las ventanas y el escritorio:

- **El escritorio se veía «de Linux» aunque la barra fuera de Windows.** Huecos entre
  ventanas, esquinas muy redondeadas, ventanas translúcidas, la inactiva oscurecida y
  un borde que giraba de color en bucle. Todo eso se fue: opacidad total, sin huecos,
  borde fino y animaciones cortas. La transparencia además costaba ancho de banda,
  porque cada cambio detrás de una ventana obligaba a recodificar esa zona.
- **El mosaico automático era lo más desconcertante.** Abrir la segunda aplicación
  partía la pantalla y movía la primera. Ahora todo se abre flotante y centrado.
- **Los avisos salían arriba y con el tema personal de la sesión principal.** Tienen
  configuración y hoja de estilo propias, y aparecen abajo a la derecha.
- **La terminal era translúcida y sólo copiaba con `Ctrl+Shift+C`.** Opaca, y con
  `Ctrl+C`/`Ctrl+V` como en la Terminal de Windows: copia si hay selección, interrumpe
  si no la hay.
- **Faltaban el clic derecho en el fondo y el fondo de pantalla.** El menú del
  escritorio usa un atajo que no consume el clic, así que el clic derecho dentro de las
  aplicaciones sigue llegándoles; el script comprueba dónde cayó y se aparta. El
  selector de fondo muestra cada imagen como vista previa y recuerda la elección.

Los iconos en el Escritorio quedan fuera: Hyprland no dibuja ninguno y hace falta un
gestor aparte (`pcmanfm-qt --desktop`), que instalarlo toca paquetes del anfitrión.

Validado antes de entregar: los dos temas de rofi compilan y se comprobaron a la vista,
`Hyprland --verify-config` da `config ok`, `bash -n` pasa en los diecinueve scripts, las
dos configuraciones de Waybar son JSON válido, los acomodos se probaron en seco con
`hyprctl` simulado y todos los nombres de icono resuelven en la cadena Papirus-Dark →
breeze-dark → hicolor.

## Estado — validado el 2026-08-11

- Instalado y comprobado visualmente a 1920x1080 en `WAYLAND-1`.
- Inicio, barra de tareas, Explorador, aplicaciones ancladas y ventanas abiertas responden
  a clics remotos.
- Buscar, Vista de tareas, menú de ventana y controles rápidos de volumen forman parte
  de la barra y usan diálogos compactos consistentes.
- `Alt+Tab`, `Alt+F4` y `Windows+D` comprobados sobre aplicaciones reales.
- Dolphin muestra sólo el hogar remoto y oculta los discos del anfitrión.
- Polkit deniega a `nexo` montaje de discos, cambios de red y acciones de energía.
- Servicios, guardián de resolución, actualización y artefactos de desinstalación revisados.
