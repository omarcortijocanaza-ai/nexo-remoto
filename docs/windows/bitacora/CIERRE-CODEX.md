# Cierre de los pendientes de Claude · 2026-10-17

Continuación de REDISENO-PANEL.md y REDISENO-CLIENTE.md. Cambios en el árbol de
trabajo de windows-port, sin commit ni push, conforme a ESPECIFICACION.md §9.

## Trabajo completado

- Página de micrófono con diseño responsive, medidor, estados activo/silenciado/
  conectando/error, foco y movimiento reducido. Su scroll es independiente del
  cliente remoto. Instrucciones válidas para Windows y Linux.
- Retrato de Rey Muerto con proporción 64×72, mostrado a 128×144.
- Barra de controles de PC compacta hasta 1360 px: no se solapa con el monitor
  a 1280 px. Eliminado un selector de Cabina que buscaba el tema en el body.
- Pruebas de apariencia (normalización, caché, inyección), rutas HTTP reales,
  actualización sin reinicio, emparejamiento, lista blanca, traversal, HEAD y
  ETag/304. Las dos pruebas de servidor y módulo las preparó un subagente; se
  revisaron y se ejecutaron otra vez dentro de la suite completa.
- Corregida la recuperación de la preferencia del dispositivo cuando el dueño
  vuelve de «Todos igual» a «Cada dispositivo»; prueba del controlador real con
  DOM simulado, sin conexiones ni captura.
- Corregido HTTPS LAN: Windows PowerShell 5.1 heredaba módulos de PowerShell 7
  desde Node, lo que impedía montar Cert: y generaba errores de tipos duplicados.
  El hijo usa módulos nativos de 5.1 y carga Microsoft.PowerShell.Security.
- build.ps1 acepta -OutputDir para verificar fuera de la instalación. Al publicar
  comprueba primero que los ejecutables de NEXO estén cerrados, evitando una
  actualización parcial. Con salida alternativa no reemplaza windows-helper/dist.
- Instalador Linux headless: incluye ui/ y microfono.html, necesarios para el
  cliente rediseñado. No se ejecutó el instalador ni se modificó un Linux real.
- README-WINDOWS.md describe las seis secciones actuales y la recompilación.

## Evidencia

- npm test: **98 tests, 98 pass, 0 fail**, duración 10,54 s.
- native/tray: go vet ./... y go test ./... → **ok nexo/tray**.
- gpu-webrtc: go vet ./... y go test ./... → **ok nexo/gpu-webrtc**.
- Puente GPU: GOOS=linux GOARCH=amd64 go build → salida correcta.
- build.ps1 -OutputDir en carpeta temporal: **Compilación completada correctamente**;
  generó agente, puente GPU, ayudante y bandeja (9 219 072 bytes), con fuentes,
  imágenes y cinco temas embebidos. No se reemplazó bin/win ni se lanzó el exe temporal.
- sync-recursos-panel.js --verificar → **Recursos del panel al día**.
- Analizador de PowerShell: todos los scripts de scripts/windows sin errores.
- git diff --check: sin errores de espacios.

En navegador integrado, sólo demo con escritorio dibujado y panel con API simulada:

- Panel: **180 comprobaciones DOM** = 6 vistas × 5 temas × 2 modos × 3 tamaños
  (375×812, 812×375 y 1280×800), sin overflow horizontal.
- Cliente: **300 comprobaciones DOM** = acceso/elegir/login/sesión/más/teclado/
  atajos/diagnóstico/compartir/micrófono × 5 temas × 2 modos × esos 3 tamaños,
  sin overflow horizontal. Se confirmaron los tamaños efectivos.
- Revisión por capturas de muestras representativas: micrófono de PC y celular,
  panel Rey Muerto, Diagnóstico a 420 px, menú Más Nativa y sesión de PC Bloque.
  No equivale a inspeccionar visualmente cada una de las 480 combinaciones.
- Barra de PC en los cinco temas a 1280 px: botones dentro de pantalla, sin
  solapar el monitor. Consolas de ambas demos: sin errores.
- Contraste calculado de --tx/--sup, --su/--sup, --su/--sup2 y texto del botón
  principal/fondo: las diez paletas de ambas interfaces superan 4,5:1. Mínimo
  observado 4,69:1 en panel y 4,75:1 en cliente. No es una auditoría completa
  de texto sobre imágenes o transparencias.

Las primeras pruebas dentro del aislamiento fallaron por sus restricciones a
sockets y archivos temporales; se repitieron fuera de él con instancias aisladas.
Los fallos HTTPS sí se reprodujeron fuera del aislamiento y se corrigieron.

## Pendiente de aceptación en el equipo real

- El dueño debe cerrar NEXO y ejecutar build.ps1 para publicar la versión nueva;
  después abrir NEXO desde Inicio o bin/win/nexo-tray.exe --panel y recargar el celular.
- Comprobar el panel elevado, autoarranque después de iniciar sesión/reiniciar,
  vídeo/entrada/audio con celular y conexión por datos móviles.
- TURN externo requiere configurar sus credenciales; HTTPS LAN requiere que el
  dueño gestione la confianza del certificado en el dispositivo.
- Micrófono en Discord con cable virtual y prueba prolongada con teléfono bloqueado.
- Fase L en Arch/Hyprland antes de fusionar a main, incluida la copia headless de
  ui/ y microfono.html. La segunda sesión Windows sigue siendo investigación O3.

No se detuvo el NEXO real, no se cambió firewall/red/autoarranque y no se capturó
el escritorio del usuario. Los puertos de prueba fueron 127.0.0.1:18779 y :18900.
