# Rediseño del cliente web · bitácora (sesión «Cliente») — INCOMPLETO

> Actualización 2026-10-17: Codex cerró los pendientes de implementación y
> verificación local; ver [CIERRE-CODEX.md](CIERRE-CODEX.md). Lo siguiente conserva
> el traspaso original de Claude. Falta la aceptación con el celular real y en Linux.

Estado al cortarse la sesión por límite de uso (2026-10-17). **Nada está en commit** (como pide el § 9 de `docs/diseno/ESPECIFICACION.md`).
Lo que sigue dice con franqueza qué está hecho, qué se vio funcionar y qué falta.

## Hecho (archivos nuevos o cambiados)

- `lib/apariencia.js` (nuevo): temas y modos, `normalizar` (campo inválido → su valor por defecto; `porDispositivo` sólo si es `true`),
  lector con caché por `mtime` de `<estado>\.nexo-apariencia.json`, `inyectar()` (atributos en `<html>`, script de modo sin parpadeo, fuentes,
  CSS base y CSS del tema; los cinco temas si `porDispositivo`), colores de `theme-color`.
- `lib/estaticos.js` (nuevo): lista blanca de `/ui/*`, `/assets/fuentes/*`, `/assets/viego/*` (regex cerradas + comprobación de carpeta),
  ETag/304, `?v=` inmutable, plantilla HTML releída si cambia el archivo.
- `server.js`: usa ambos módulos; `GET /` y `GET /microfono` con la apariencia inyectada; `GET /apariencia` (dispositivo emparejado);
  manifiesto con el color del tema; `session-options` ahora trae `original.host` (nombre del equipo).
- `index.html`: marcado nuevo (portal con código en casillas, tarjeta «Mi PC» con vista previa, barra de 5 acciones, hoja «Más», estado en
  palabras, iconos SVG propios sin emoji). El script original se conservó con **48 reemplazos exactos** (armado por script que falla si un
  «antes» no aparece una sola vez) más un bloque nuevo al final. Todos los ids del § 5 siguen existiendo; el portal de dos sesiones de Linux
  (`#choose-original`, `#choose-nexo`, `#choose-mic`) se conserva.
- `ui/cliente.css` (base), `ui/temas/{reymuerto,cabina,nativa,cianotipo,bloque}.css`, `ui/apariencia.js`, `ui/demo/escritorio.svg`, `ui/icono.svg`.
- `microfono.html` (marcado nuevo, mismos ids) y `microfono-cliente.js` (clase `MicrofonoDemo` para `?demo=1`; `&vista=activo|silenciado|error`).
- `scripts/ui/servir-cliente.js` + `.claude/launch.json` (instancia aislada en 127.0.0.1:18777, estado temporal, sin GPU ni micrófono).
- Modo `?demo=1` (+ `&vista=acceso|elegir|login|sesion|mas|teclado|atajos|diagnostico|compartir`, `&cliente=celular|pc`, `&tema=…&modo=…`): escritorio
  dibujado, cifras de ejemplo, `fetch` bloqueado salvo `/ui`, `/assets` y `/apariencia`; `WebSocket` y `RTCPeerConnection` anulados; sin entrada.

## Cambios de comportamiento deliberados (revisar)

1. `resume()` (en `pageshow`/`visibilitychange`) ya no abre vídeo mientras el portal sigue en pantalla (`&&clientStarted`): antes, con cookie de sesión
   válida, el vídeo arrancaba por debajo aunque eligieras «Sólo micrófono». Con el portal visible las teclas del modo PC tampoco viajan a la PC (`overlayAbierto()`).
2. `#quality` pasó de botón cíclico a tres segmentos (30/45/60) con el mismo id; el cambio de monitor muestra «Monitor N».
3. `#audio-label`, `#touch-label` y `#mic-label` ahora son palabras («Sonido», «Mover/Directo», «Micrófono/Silenciado»).
4. `Rey Muerto`: `--ac-fill:#c92b45` (botones rellenos) porque `#e0354f` con texto blanco da 4,4:1 (< AA); el resto de la paleta es la del § 7.
   Cabina claro: `--ac:#a85f00` (en vez de `#b36600`) por la misma razón.

## Verificado (salida real)

- Instancia aislada arrancada con `preview_start cliente-demo`; navegador integrado a 375×812 y 1280×800, **sólo con `?demo=1`**.
- Rey Muerto oscuro: acceso, elegir, sesión (celular vertical), hoja «Más» (celular) y sesión en PC se ven correctos; consola **sin errores** tras corregir
  (a) el vídeo del portal, (b) la precarga de fuentes con `?v=` distinta de la del `@font-face`, (c) el sondeo de `/apariencia` sin permiso.
- `node --check` limpio en `server.js`, `microfono-cliente.js` y los dos scripts inline de `index.html`.

## NO verificado / pendiente (hay que hacerlo)

- **`npm test` no se ha vuelto a correr** tras los cambios (hoy 88 pruebas). **Faltan las pruebas nuevas**: `test/apariencia.test.js` (normalizar, lector con
  `mtime`, inyección) y `test/server-apariencia.test.js` (atributos en `/` y `/microfono`, cambio del archivo sin reiniciar, `/apariencia` 403 sin
  emparejar, lista blanca: `/ui/../server.js`, `%2f`, temas inexistentes → 404, ETag/304).
- **Sin revisar visualmente**: Cabina, Nativa, Cianotipo y Bloque (los CSS están escritos pero nunca se abrieron en el navegador); claro y oscuro de los cinco;
  812×375 (celular horizontal); teclado y atajos; diagnóstico y portapapeles; banners; sin scroll horizontal; foco visible; `prefers-reduced-motion`.
- **`microfono.html` sin estilos**: falta añadir a `ui/cliente.css` la sección de la página de micrófono (`.pagina-mic`, `.mic-pagina`, `.mic-cuerpo`, `.mic-izq/.mic-der`,
  `.mic-boton` con `#aro`, `#medidor`, `.ficha`, estados `body.activo/.silenciado/.conectando/.con-fallo`) y retoques por tema. Hasta entonces esa página se ve sin formato.
- Posibles detalles de CSS por pulir: en Cabina, `gap` de la barra en modo PC; selector sobrante `body.computer-mode[data-tema="cabina"]` en `cabina.css`.
- Mejora del pixel art (`docs/diseno/pixel/generar-rey.js`) no hecha; el busto v1 se ve bien en el portal.
- Probar el cambio de tema sin recargar con un navegador **emparejado** (`?sincronizar=1` activa el sondeo en demo) y el modo `porDispositivo` (sección «Apariencia» de «Más»).
- Línea en `PROGRESO.md` (sección Windows): **no escrita**.
- Sin probar nunca: celular real, host Linux (el portal de dos sesiones se conservó por lectura, no por ejecución), Edge del panel real.

## Dudas para el dueño

- La vista previa de «Mi PC» en el portal es un dibujo/marcador, no una captura real (antes de iniciar sesión no hay `/screen` y no se quiso capturar el escritorio sólo para decorar).
- «Olvidar este dispositivo» (que aparece en el bosquejo) no existe hoy en el servidor y no se inventó.

## Para retomar

`node scripts/ui/servir-cliente.js` (o `preview_start cliente-demo`) y abrir `http://127.0.0.1:18777/?demo=1`. El script que armó `index.html` vivía en el directorio
temporal de la sesión; si hay que tocar el script de `index.html`, se edita el archivo directamente (los reemplazos ya están aplicados).
