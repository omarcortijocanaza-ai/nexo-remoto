# Rediseño del panel (sesión «Panel») · bitácora

> Actualización 2026-10-17: ver [CIERRE-CODEX.md](CIERRE-CODEX.md) para la
> comprobación posterior de temas, contraste y compilación. El informe de abajo
> conserva el estado exacto del traspaso de Claude.

Fecha: 2026-10-17 · Rama `windows-port` · **Sin commit** (todo en el árbol de trabajo). La sesión se cortó por límite
de uso: lo hecho y lo que **falta** están separados abajo, sin adornos.

## Hecho

- **Panel nuevo** (`native/tray/panel/`): `index.html` con las seis vistas; `panel.css` (capas `base < tema < ajuste`);
  `temas/{cabina,nativa,reymuerto,cianotipo,bloque}.css` (claro y oscuro); `tema-inicial.js` (resuelve «automático»
  antes de pintar, por eso es un archivo y no un script en línea: la política del panel es `script-src 'self'`);
  `panel.js` reescrito conservando la lógica de antes. Todo lo anterior sigue alcanzable con los mismos endpoints:
  autoarranque, ajustes (modo/GPU/micrófono), HTTPS de la LAN (ahora en Conexión, con su propio «Guardar» que manda
  los ajustes ya guardados + `httpsLan`, así un formulario no pisa al otro), emparejar, aviso, contraseña de «Mi PC»,
  rotar enlace («Cambiar el enlace»), red y firewall, TURN, doctor, registro y salir. «Cerrar el panel» y «Salir»
  pasaron al final de Ajustes (antes estaban en el pie de cada página).
- **Inicio**: estado grande con Iniciar/Reiniciar/Detener, QR grande, tres pasos, selector Internet / Casa / Casa segura
  (con flechas del teclado), enlace enmascarado con Mostrar y Copiar, y los cuatro datos con valores reales (sin cifras
  inventadas: de FPS/ms no hay dato en la API del panel, así que no se muestran).
- **Apariencia**: cinco tarjetas con vista previa que usa las variables reales de cada tema, «Quién elige» y
  Claro/Oscuro/Automático. Cambia al instante y guarda con `POST /api/apariencia` (si falla, revierte).
- **Go**: `apariencia.go` (`.nexo-apariencia.json`, lectura indulgente campo a campo, validación estricta al escribir,
  escritura atómica), `dispositivos.go` (lista de sólo lectura: etiqueta y fechas, nunca id ni hash), rutas
  `GET/POST /api/apariencia` y `GET /api/dispositivos`, inyección de `data-tema`/`data-pref` en el HTML, y servicio de
  `temas/`, `fuentes/`, `img/` por lista cerrada con ETag. Interfaz `Operaciones` ampliada (también `falsas` en pruebas).
- **Recursos**: `scripts/ui/sync-recursos-panel.js` (copia `assets/fuentes` y `assets/viego` a `panel/fuentes` y
  `panel/img`; `--verificar`), llamado desde `scripts/windows/build.ps1`. Las copias se versionan (así `go test` funciona
  en un clon nuevo). `scripts/ui/generar-fondo-niebla.js` genera `assets/viego/fondo-niebla.webp` (2 KB, ffmpeg).
- **Dev**: `dev/mock-server.js` con apariencia, dispositivos (escenario `sin-dispositivos`), lista blanca de estáticos e
  inyección del tema.
- **Pixel art v2** (`docs/diseno/pixel/generar-rey.js`, **archivos compartidos cambiados**: `assets/viego/*.svg`):
  retrato 64×72 (antes 56×64), corona 32×12 con filo de luz azulada (antes se perdía sobre fondo oscuro) y cadena de 12×6
  que encadena sin cortes; SVG con un `<path>` por color (rey: 49 KB → 20 KB). **Aviso para la sesión Cliente**: el
  retrato ahora mide 64×72 (`reymuerto.css` ya lo muestra a 64×72).
  Nuevo archivo compartido: `assets/viego/fondo-niebla.webp`.

## Verificación (salidas reales)

- `go vet ./... && go test -count=1 ./...` en `native/tray` → `ok  nexo/tray` (incluye 19 pruebas nuevas: validación,
  lectura indulgente, escritura atómica, rutas, cookie/cabecera/Origin, inyección del tema, ETag/304, sin recursos
  externos, referencias embebidas, variables de los 5 temas en 2 modos, copias al día con `assets/`).
- Navegador integrado con `node native/tray/panel/dev/mock-server.js` a ~1040 px, consola sin errores: se revisaron
  **Inicio en los cinco temas** (Cabina oscuro, Nativa claro y oscuro, Cianotipo claro, Bloque claro, Rey Muerto oscuro)
  y la vista **Apariencia** (cinco tarjetas en una fila, tarjeta activa marcada). Sin desplazamiento horizontal (1024/1024).
  Se corrigieron dos fallos hallados ahí: «Copiar» blanco sobre blanco en Nativa (la capa del tema pisaba `.btn.pri`) y
  los cuatro datos que no pasaban a lista en Nativa (variable `--datos-cols`).

## Falta (no se hizo ni se probó)

1. (Hecho al final: `.busto` ya mide 64×72 y `.grande` 128×144.) Falta mirarlo en pantalla.
   El rostro sigue siendo ancho: el pixel art admite otra pasada.
2. **Revisión visual pendiente**: vistas Dispositivos, Conexión, Ajustes y Diagnóstico en los cinco temas; claro/oscuro de
   Cabina, Cianotipo, Bloque y Rey Muerto claro; **a 420 px** (barra inferior de seis iconos: comprobar que no se corten
   «Dispositivos»/«Diagnóstico»); foco visible; barra superior de Rey Muerto/Bloque entre 761 y 940 px.
3. **Contraste AA**: no se corrió el cálculo. Se ajustó a mano `--ac` de Rey Muerto oscuro a `#d8304a` (la paleta del § 7,
   `#e0354f`, da 4,38:1 con texto blanco); falta verificar el resto de paletas y los textos sobre el fondo difuminado.
4. **Compilar a una carpeta temporal** para confirmar `go:embed` en el binario (las pruebas ya leen el FS embebido,
   pero no se generó el `.exe`). No se ejecutó ningún `nexo-tray.exe`; no se tocó firewall, red, registro ni autoarranque.
5. No se probó el Edge real del panel elevado ni Linux. `build.ps1` quedó editado pero no se ejecutó.
6. Dudas: «Cerrar el panel»/«Salir» sólo en Ajustes (antes en todas las páginas); la lista de dispositivos no permite
   revocar (el servidor Node reescribe ese archivo mientras corre; se indica cómo hacerlo desde un dispositivo emparejado).
