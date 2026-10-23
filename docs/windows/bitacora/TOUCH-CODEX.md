# Incidencia: 166 ms y gestos deficientes en Wi-Fi · 2026-10-17

El dueño informa de peor deslizamiento y arrastre tras actualizar, usando el Wi-Fi
de casa. No está confirmado si abrió Casa o Internet ni qué transporte ve en su
diagnóstico. No se atribuye aún la latencia a una causa concreta.

## Comprobado

- Comparación con HEAD: point, pointerdown/move/up y rotación conservaban la
  lógica previa al rediseño. No se modificó la sensibilidad ni los umbrales.
- Configuración local consultada sin imprimir secretos: vídeo GPU activo,
  perfil 720p/45, escala cuda-scale y ningún TURN configurado.
- El cliente descartaba eventos marcados como lossy al no tener canal rápido;
  esto incluía TODOS los movimientos y deltas de scroll en respaldo HTTP.
- El timeout de vídeo CPU cerraba la conexión de controles a los 6,5 segundos
  si transport no era rtc, incluso con vídeo GPU o canal de control sano.
- RTT no se limpiaba al cerrar esa conexión, mostrando una medición antigua.

## Correcciones

- Scroll relativo por canal fiable (sus deltas no son posiciones reemplazables).
- Respaldo HTTP serializado: agrupa movimientos consecutivos y suma scroll,
  conserva las barreras down/up/clic y divide el scroll acumulado en tramos
  aceptados por el servidor. No crea una petición por cada muestra táctil.
- Canal que se cierra durante send también usa el respaldo.
- El timeout respeta el vídeo GPU, los controles sanos y la generación vigente.
- RTT se limpia al cerrar y caduca si pasan cinco segundos sin pong.

## Pruebas y límites

- test/client-input.test.js: seis pruebas que ejecutan el bloque real del cliente
  con canales y HTTP simulados: transporte, ráfagas, acumulación de 1000 unidades
  de scroll, down/move/up, teclado, errores, demo y timeout.
- npm test: **104 aprobadas, 0 fallos**.
- No se capturó el escritorio ni se reinició NEXO real. No se compiló ningún exe
  porque este arreglo sólo modifica el cliente servido por index.html.
- Falta aceptación del dueño tras recargar el celular. Los 166 ms aún requieren
  saber enlace usado, transporte y FPS; no se promete una reducción medida.

Cambios sin commit, como el rediseño que está en el árbol de trabajo.
