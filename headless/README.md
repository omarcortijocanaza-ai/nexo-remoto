# Prueba de sesión independiente

Esta carpeta contiene la implementación reversible de la segunda sesión. El instalador
crea un usuario bloqueado llamado `nexo` y pide a Hyprland una salida invisible
`NEXO-HOST` en la sesión local. El segundo Hyprland se ejecuta anidado como cliente
Wayland, a pantalla completa sobre esa salida, con aplicaciones, entrada, audio y hogar
del usuario `nexo`. El servicio aplica límites de CPU y memoria y restaura el foco de la
sesión física al terminar el arranque.

## Se levanta a mano, no con el equipo

Desde el 2026-08-18 el servicio **no está habilitado**: no arranca al encender la PC ni
al levantar NEXO para usar esta misma computadora. Es una pila completa —Hyprland
anidado, dos waybar, pipewire, gpu-stream y cloudflared— y en reposo son recursos
regalados. Se levanta cuando alguien va a entrar de verdad:

```bash
nexo-session-control start
```

y se baja con `nexo-session-control stop`. Los lanzadores «NEXO · sesión invitada» del
menú hacen lo mismo. La sesión de NEXO para usar **esta** computadora es otra cosa
(`nexo-control`, puerto 8765) y nunca dependió de este servicio.

## Instalar

```bash
sudo /home/Letzus/Downloads/teclado-remoto/headless/install-headless
```

## Instalar la revisión anidada

Si ya se instaló una revisión anterior, se ejecuta el mismo comando para actualizar los
scripts y retirar la regla multiseat experimental. El instalador además **deshabilita**
el servicio, para deshacer las instalaciones viejas que lo dejaban arrancando solo con
`graphical.target`.

## Primera prueba

```bash
sudo systemctl start nexo-headless.service
systemctl status nexo-headless.service --no-pager
nexo-session-control link
```

Cuando la prueba termine:

```bash
sudo systemctl stop nexo-headless.service
```

El log de la sesión está en `/var/lib/nexo-session/nexo-runtime.log`. La sesión captura
sólo `WAYLAND-1`, la salida del compositor anidado. `wf-recorder` convierte y codifica
H.264/NVENC directamente con copia segura de buffers; ya no se envían planos NV12 crudos
por un FIFO, porque su stride producía cuadros de colores corruptos. Si la ruta GPU falla,
el respaldo CPU queda limitado a 720p y 30 FPS.

El diagnóstico del compositor, incluyendo usuario, asiento, runtime y tarjeta DRM, se
guarda en `/var/lib/nexo-session/session-bootstrap.log`. Durante la ejecución, el único
permiso compartido con el usuario remoto es acceso al socket Wayland anfitrión; el
servicio lo retira al detenerse y mantiene `/home/Letzus` inaccesible.

La validación local del 2026-08-11 confirmó `WAYLAND-1` a 1920x1080/60, puntero aislado,
túnel externo y límites de recursos. La primera tubería NV12 cruda se descartó al detectar
corrupción cromática; la revisión actual entrega H.264 ya codificado por NVENC.

La instalación actual añade `nexo-display-guard.service`, que comprueba `NEXO-HOST`,
la ventana Aquamarine y pantalla completa cada cinco segundos, reparando una regresión
a 1024x768 después de recargas de Hyprland. El instalador admite `install`, `update`,
`doctor` y `uninstall`.

El perfil remoto conserva la identidad visual NEXO y el fondo Viego, pero organiza el
escritorio como Windows: barra inferior, Inicio con búsqueda, escritorios virtuales,
aplicaciones ancladas, botones de ventanas abiertas, bandeja, red, volumen,
notificaciones, reloj y mostrar escritorio. Dolphin funciona como Explorador, las
ventanas principales aparecen flotantes y centradas, y se crean carpetas conocidas en
español. Incluye historial del portapapeles, capturas de pantalla, hoja de atajos,
configuración rápida y una bienvenida de una sola vez. El diseño completo está en
[`../PLAN-EXPERIENCIA-WINDOWS.md`](../PLAN-EXPERIENCIA-WINDOWS.md).

Las ventanas se abren flotantes, centradas y opacas, sin huecos ni mosaico automático,
y los avisos usan `swaync-config.json` y `swaync-style.css` propios, abajo a la derecha.
El fondo lo aplica `windows-wallpaper apply` al arrancar, con la imagen que se haya
elegido desde la sesión.

Los archivos de esa capa son los `windows-*` de esta carpeta: los scripts van a
`/usr/local/lib/nexo` y los temas y configuraciones a `/etc/nexo`. La paleta está en
`windows-colors.rasi` y la comparten el menú Inicio, los diálogos y —traducida al
formato de GTK— las dos barras de `windows-waybar.css`. El instalador los copia todos
por patrón y se detiene si un botón, atajo o barra cita un ayudante inexistente.

No se copian perfiles de navegador, credenciales ni documentos del usuario local, el
usuario `nexo` continúa sin `sudo` y no se exponen controles para apagar el equipo
físico. Los discos del anfitrión se ocultan en Dolphin y una regla de Polkit impide que
la sesión remota monte almacenamiento, cambie la red o ejecute acciones de energía.

## Desinstalar la integración

```bash
sudo /home/Letzus/Downloads/teclado-remoto/headless/uninstall-headless
```

La desinstalación conserva deliberadamente el directorio personal del usuario remoto,
su estado y la copia instalada del programa.
