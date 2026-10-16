# Nexo: sesión remota independiente

## Objetivo

Permitir que una persona use físicamente el equipo y otra use Nexo al mismo tiempo,
con usuarios Linux, escritorios Hyprland, ventanas, entrada, audio y archivos
independientes. Las dos sesiones compartirán el hardware, con límites de CPU y RAM
para proteger la capacidad de respuesta de la sesión local.

## Arquitectura elegida

La implementación usa una segunda sesión Hyprland anidada bajo un usuario dedicado
(`nexo`). El Hyprland físico crea la salida invisible `NEXO-HOST` con
`hyprctl output create headless`; el segundo compositor aparece allí a pantalla completa
y ofrece su propia salida `WAYLAND-1`.
Nexo se ejecuta dentro del entorno hijo y captura e inyecta entrada únicamente en él.

La versión anterior usaba una tarjeta VKMS anclada a `seat0` para esa salida. Se
descartó el 2026-08-11: sobre NVIDIA el compositor recibe búferes `external-only`,
no puede copiarlos a VKMS y reintenta el modeset cientos de veces por segundo, con la
pantalla física corrupta, la carga por encima de 8 y el registro de Hyprland creciendo
150 KB/s en tmpfs. Una salida headless de Hyprland no pasa por DRM y no tiene ese
problema.

```text
Usuario local (Letzus)             Usuario remoto (nexo)
  Hyprland físico                    Hyprland anidado (usuario nexo)
  monitores + NEXO-HOST               WAYLAND-1 y entrada propia
             \                       /
              CPU, RAM, disco y RTX 3060 Ti compartidos
                      systemd/cgroups
```

No se usará inicialmente una máquina virtual ni se crearán particiones de disco. La
RTX 3060 Ti puede compartirse entre procesos, pero no ofrece una partición vGPU oficial;
por ello no habrá un límite rígido de VRAM por sesión.

## Resultado esperado

- Directorio personal y configuración propios para el usuario remoto.
- Ventanas remotas invisibles en el monitor físico.
- Mouse y teclado remotos sin mover ni escribir en la sesión local.
- Audio remoto independiente mediante PipeWire.
- Inicio, estado, enlace y apagado desde el control de Nexo.
- Límites iniciales de CPU y memoria mediante systemd.
- Conservación del modo actual de Nexo para compartir la sesión física.

## Fases

### 1. Prueba de concepto anidada

1. Crear el usuario de sistema interactivo `nexo`, sin permisos administrativos.
2. Crear una configuración Hyprland mínima y separada.
3. Iniciar Hyprland con el backend Wayland de Aquamarine sobre la sesión física.
4. Confirmar una salida `WAYLAND-1` a 1920x1080 sobre `NEXO-HOST`.
5. Validar captura e entrada primero localmente.
6. Confirmar que la sesión física no cambia.

### 2. Adaptación de Nexo

1. Separar el directorio de código del estado mutable.
2. Admitir selección explícita de instancia Hyprland, salida y puerto.
3. Ejecutar Nexo dentro del entorno del usuario remoto.
4. Capturar únicamente la salida `WAYLAND-1`.
5. Mantener el modo de sesión compartida existente.

### 3. Audio y periféricos virtuales

1. Usar PipeWire del usuario remoto.
2. Crear una salida de audio virtual si la sesión no proporciona una.
3. Capturar sólo el audio de la sesión remota.
4. Mantener portapapeles y entrada separados.
5. Dejar micrófono y cámara virtuales como ampliaciones posteriores.

### 4. Reparto de recursos

Perfil inicial propuesto para Ryzen 5 3600 y 32 GiB:

- `CPUQuota=400%` como máximo sostenido para la sesión remota.
- `CPUWeight=50` para favorecer la sesión física cuando exista competencia.
- `MemoryHigh=8G` y `MemoryMax=12G`.
- `TasksMax` acotado y prioridad de I/O moderada.
- GPU compartida sin cuota rígida.

Los valores se ajustarán después de medir 720p, 1080p/30 y 1080p/45.

### 5. Seguridad y ciclo de vida

- El usuario remoto no tendrá `sudo` ni pertenecerá a grupos administrativos.
- El servicio web nunca se ejecutará como `root`.
- Código común de sólo lectura; tokens, estado y logs privados por usuario.
- Puerto de sesión ligado a localhost y publicado únicamente por el transporte seguro.
- Token distinto para la sesión independiente y cierre por inactividad configurable.
- Al apagar la sesión se terminarán Hyprland, Nexo y sus aplicaciones.

### 6. Integración del menú

El menú podrá exponer, sin retirar el control actual:

- Nexo · Compartir mi sesión
- Nexo · Iniciar sesión independiente
- Nexo · Copiar enlace independiente
- Nexo · Estado de sesión independiente
- Nexo · Cerrar sesión independiente

### 7. Validación

- Cursores, teclado, escritorios y audio independientes.
- Dos usuarios trabajando simultáneamente durante al menos una hora.
- Reconexión después de pérdida de red.
- Inicio y cierre sin procesos huérfanos.
- Restricciones de lectura sobre `/home/Letzus`.
- Respuesta bajo presión de CPU, RAM y GPU.
- Regresión completa del modo compartido actual.

## Alternativa

Si el controlador NVIDIA no permite dos compositores/capturas estables, la alternativa
será KVM/QEMU. Con una sola RTX 3060 Ti y un Ryzen 5 3600 sin GPU integrada, el passthrough
de la GPU dejaría al host sin salida gráfica; una VM con aislamiento y alto rendimiento
gráfico requeriría una segunda GPU. Hasta entonces, Virtio-GPU/virgl sería funcional
para escritorio pero tendría menor rendimiento.

## Criterio de avance

No se integrará el arranque automático ni se expondrá la nueva sesión a Internet hasta
que la prueba local demuestre que la sesión física permanece intacta y que captura,
entrada, audio y cierre funcionan correctamente.

## Estado de implementación — 2026-08-11

Completado:

- Estado, token, monitor y perfil de Nexo separables mediante `NEXO_STATE_DIR`.
- Configuración Hyprland independiente validada con Hyprland 0.56.1.
- Backend anidado de Aquamarine validado a 1920x1080 sobre la salida invisible.
- Usuario dedicado bloqueado, sin `sudo` y sin acceso a `/home/Letzus`.
- PipeWire, salida de audio virtual y Nexo iniciados dentro de la sesión remota.
- Servicio systemd con límites aplicados también a `user-UID.slice`.
- Puerto independiente 8766 y estado legible sólo por `nexo` y el usuario local.
- Accesos de aplicación para prender, copiar enlace y apagar.
- Instalador y desinstalador reversibles en `headless/`.
- Prueba de regresión del Nexo actual en un puerto alterno.
- La salida invisible la crea Hyprland y no toca DRM; no se crea un greeter multiseat
  ni se disputa DRM entre dos compositores.
- Runtime privado `/run/nexo-session` y acceso ACL temporal sólo al socket Wayland
  anfitrión, retirado al apagar la sesión.
- Colocación automática en el espacio 11, pantalla completa y restauración del foco
  de la sesión física.

Validado el 2026-08-11:

- Revisión anidada instalada y regla multiseat anterior retirada.
- Servicio iniciado, detenido y reiniciado de forma controlada.
- `WAYLAND-1` estable a 1920x1080/60 y ventana anfitriona fullscreen en el espacio 11.
- Captura JPEG real de 1920x1080 y salud local/remota correctas.
- Entrada de puntero aceptada sin mover el cursor de la sesión física.
- Foco físico restaurado y límites de CPU/RAM aplicados a `user-1001.slice`.
- PipeWire, WirePlumber, salida nula y túnel ejecutándose bajo el usuario `nexo`.
- Servicio habilitado en `graphical.target` y selector de dos sesiones en la URL
  principal: **Mi PC original** o **NEXO**.
- Perfil familiar para usuarios de Windows: barra inferior, Inicio, Explorador,
  aplicaciones abiertas, bandeja y atajos habituales, manteniendo el aislamiento.
- Guía de bienvenida y carpetas de usuario en español, según
  [`PLAN-EXPERIENCIA-WINDOWS.md`](PLAN-EXPERIENCIA-WINDOWS.md).

Pendiente desde otro dispositivo:

1. Comprobar vídeo WebRTC, clics, teclado y audio en uso real.
2. Mantener ambas sesiones simultáneas durante al menos una hora.
3. Habilitar y medir NVENC sólo después de superar esas pruebas.
