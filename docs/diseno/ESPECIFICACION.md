# Rediseño de NEXO · especificación

> Fuente de verdad para las dos sesiones que reescriben las interfaces **en paralelo**: el **panel del servidor**
> (`native/tray/panel/`, Go + HTML) y el **cliente** web (`index.html`, `microfono.html`, servido por `server.js`).
> Redactada el 2026-10-17 tras elegir el dueño (Letzus) en la galería de bosquejos. **Léela entera antes de tocar nada.**
> Además: `AGENTS.md` (reglas del repositorio) y `native/tray/panel/CONTRATO.md` (API del panel).

## 1. Qué pidió el dueño

- Las interfaces «se ven demasiado hechas por IA» y hay que mejorar **usabilidad y diseño**, en celular y en PC.
- Elegió **las cinco apariencias** de la galería: **Cabina, Nativa, Rey Muerto, Cianotipo y Bloque**. El dueño del servidor
  elige cuál ven los dispositivos (como en muchas webs); hay claro/oscuro/automático.
- **Apariencia por defecto: Rey Muerto.** Su marca (Letzus · Rex Mortis) vive **sólo** en Rey Muerto y se enfoca en **Viego, el Rey
  Arruinado de League of Legends**: más inspiración visible, imágenes difuminadas y pixel art (ver § 7).
- Se trabajan **el panel y el cliente a la vez** (dos sesiones; ver § 10 para no pisarse).

## 2. Referencias que ya existen (úsalas, no las reinventes)

| Qué | Dónde |
|---|---|
| Galería con las 5 direcciones (HTML final y fuentes) | `docs/diseno/bosquejos.html`, `docs/diseno/fuentes/` (`mock-base.css`, `tema-*.css`, `mock.js`) · reconstruir: `node docs/diseno/construir.js` |
| Fuentes WOFF2 (OFL) y su `fuentes.css` | `assets/fuentes/` (sin Internet; ya descargadas) |
| Pixel art de Viego (fan art propio) | `assets/viego/rey-pixel.svg`, `corona-pixel.svg`, `cadena-pixel.svg` · generador: `docs/diseno/pixel/generar-rey.js` |
| Fondo de Viego del dueño (para difuminar) | `assets/viego-wallpaper.webp` / `.jpg`, `assets/viego-mist-keyboard.webp` |
| Cliente actual | `index.html` (85 KB: CSS ≈ 16 KB + script ≈ 55 KB), `microfono.html`, `microfono-cliente.js`, `keyboard-translation.js` |
| Panel actual | `native/tray/panel/{index.html,panel.css,panel.js,CONTRATO.md,dev/mock-server.js}`, Go en `native/tray/` |

**Las pantallas de la galería son la intención de diseño**: estructura (qué va dónde), copy en español, tipografías, paletas,
formas y densidad de cada dirección. Cámbialas sólo para mejorarlas o por razones de usabilidad que expliques en tu bitácora.
La galería usa un solo DOM para los cinco temas; **un tema = un archivo CSS** sobre el mismo HTML. Mantén esa idea.

## 3. Temas: contrato

- Ids exactos: `cabina`, `nativa`, `reymuerto`, `cianotipo`, `bloque`. Cada uno tiene modo `claro` y `oscuro`; el modo `auto`
  sigue a `prefers-color-scheme` del dispositivo. Modo original de cada uno: cabina=oscuro, nativa=claro, reymuerto=oscuro,
  cianotipo=claro, bloque=claro (sólo para la muestra; en la app «auto» manda).
- Variables CSS (nombres **fijos**, ya usados en `docs/diseno/fuentes/`): `--bg --sup --sup2 --bd --tx --su --ac --ac-tx --ok --av --ml
  --r --rg --f-t --f-c --f-n --sh` y las propias de cada tema (`--oro`, `--lapiz`, `--rej`, `--am`, `--rosa`, `--esp`…).
- Selección en el HTML: atributos `data-tema="<id>"` y `data-modo="claro|oscuro"` en `<html>`; el CSS de cada tema se
  escribe como `[data-tema="x"][data-modo="y"] { variables }` + reglas de forma bajo `[data-tema="x"] …`.
  Con `modo=auto` un script mínimo (inline, antes del primer pintado) pone `data-modo` según `matchMedia('(prefers-color-scheme: dark)')`
  y reacciona a sus cambios. **Sin parpadeo**: el atributo debe estar puesto antes de pintar.
- Fuentes: `@font-face` de `assets/fuentes/fuentes.css` (rutas relativas). Nada de Google Fonts ni de recursos externos.
- Movimiento: respeta `prefers-reduced-motion`. Contraste mínimo AA en texto, y foco visible en todos los controles.

## 4. Apariencia elegida: archivo y API (no necesita reiniciar NEXO)

Archivo `<estado>\.nexo-apariencia.json` (carpeta privada del estado; lo escribe el panel, lo lee el servidor Node):

```json
{ "tema": "reymuerto", "modo": "auto", "porDispositivo": false }
```

- `tema`: uno de los cinco ids (defecto `reymuerto`). `modo`: `auto` | `claro` | `oscuro` (defecto `auto`).
  `porDispositivo`: `false` = todos los dispositivos usan `tema`; `true` = cada dispositivo puede elegir el suyo (se
  recuerda en `localStorage.nexoApariencia = {tema, modo}` de ese navegador) y `tema` es sólo el valor inicial.
- Falta el archivo o es inválido → valores por defecto (nunca error). Escritura **atómica**. Validación idéntica en Go y en Node.
- **Node (`server.js`/`lib/apariencia.js`)**: lee el archivo en cada petición de página (con caché por `mtime`), inyecta en
  `GET /` y `GET /microfono` los atributos `data-tema`/`data-modo` en `<html>` y el `<link>` al CSS del tema (y el script de modo
  automático / de preferencia por dispositivo). `GET /apariencia` (dispositivo emparejado) devuelve
  `{"tema","modo","porDispositivo","temas":[{"id","nombre","descripcion"}]}`. Los CSS, las fuentes y las imágenes se sirven con rutas
  explícitas y lista blanca (nunca `path.join` con la ruta pedida sin validar); caché razonable (`ETag`/`Cache-Control`).
- **Panel (Go)**: `GET /api/apariencia` → `{"ok":true,"apariencia":{…}}` y `POST /api/apariencia` con los mismos campos
  (errores en español como `{"ok":false,"error":…}`); el propio panel se pinta con el tema elegido y cambia al instante. Documentar en `CONTRATO.md`.

## 5. Cliente (celular y PC): lo que debe quedar

Pantallas (ver la galería): **acceso** (primera vez: código de emparejamiento `XXXX-XXXX`), **elegir** («Mi PC» con vista previa y estado;
«Sólo micrófono»), **sesión** en celular (horizontal; también debe usarse vertical) y **sesión en PC** (navegador de escritorio).
Mejoras de uso pedidas (iguales en los cinco): entrar directo a «Mi PC»; **cinco acciones** al alcance del pulgar (Teclado, Mover, Sonido,
Micrófono, Más) y lo demás en la hoja «Más»; estado con palabras («En vivo · 58 FPS · 24 ms · 1080p»); un solo juego de iconos
(SVG con el mismo trazo; **ningún emoji**); textos para personas (sin «nexo-control pair»); objetivos táctiles ≥ 44 px; zonas seguras
(`env(safe-area-inset-*)`); sin desplazamiento horizontal.

**Conserva todo el comportamiento actual** (es lógica probada; se re-viste y se re-ubica, no se reescribe). Funciones y controles actuales
que deben seguir existiendo (ids de `index.html`): `previous`/`next` (escritorio anterior/siguiente), `monitor`, `client-mode` (celular/PC),
`touch-mode` (mover/directo), `keyboard` + panel de teclado (`#panel`, atajos, Super), `super-key`, `windows-bridge`, `audio`, `mic`/`mic-mute`,
`rotate`, `quality` (30/45/60), `resolution` (720/900/1080), `pip`, `share-open` (portapapeles y archivos), `diagnostics-open` (+ lista de dispositivos,
revocar), `fullscreen`, `hide-ui`, banners `secure-banner` y `desktop-assist`, portal `session-gate` con sus tres caminos, formularios de
emparejar y de inicio de sesión. Al mover un botón a la hoja «Más» **conserva su id y su manejador**.

> **Este `index.html` también lo usa el host Linux** (Arch/Hyprland, «Mi PC original» y «NEXO independiente», portal con dos sesiones).
> No se puede probar Linux aquí: lee `server.js` (rutas `/session*`, `chooser`…) y el script para no romper ese camino; el portal con dos
> sesiones debe seguir funcionando aunque se vea distinto. Cualquier duda, anótala en la bitácora, no la adivines.

**Modo demo para probar sin ver el escritorio real**: `?demo=1` (sólo en la URL) hace que el cliente use el escritorio dibujado de
`docs/diseno/fuentes/sprite.svg.html` (`#escritorio`) y cifras de ejemplo, **sin abrir** WebSocket, WebRTC ni micrófono, y sin enviar entrada.
Úsalo en todas las pruebas con navegador: **no captures ni mires el escritorio real del dueño** (es su PC diaria; ver la memoria del proyecto).

## 6. Panel del servidor: lo que debe quedar

Navegación (6 entradas, como en la galería): **Inicio · Dispositivos · Conexión · Apariencia · Ajustes · Diagnóstico**.
- **Inicio**: estado grande, Reiniciar/Detener y **conectar el celular** (QR grande, tres pasos, selector Internet / Casa / Casa segura, enlace
  con copiar) y los cuatro datos (Internet, red de casa, vídeo, dispositivos).
- **Dispositivos**: generar código de emparejamiento, **aviso del enlace** (ntfy/Telegram) y rotar el enlace. (Opcional si cabe sin
  riesgo: lista de dispositivos emparejados leyendo `.nexo-devices.json`, **sólo etiqueta y última vez visto, nunca secretos**.)
- **Conexión**: lo ya hecho (red y firewall, HTTPS en la LAN, TURN); sólo se re-viste y se mueve el HTTPS aquí si mejora el flujo.
- **Apariencia**: tarjetas de los cinco temas con vista previa, «quién elige», claro/oscuro/automático (ver `elegirApariencia()` en `mock.js`).
- **Ajustes**: inicio automático, modo, vídeo por GPU, micrófono, contraseña de «Mi PC».
- **Diagnóstico**: doctor y registro.
Todo lo que hoy hace el panel debe seguir siendo alcanzable y con los mismos endpoints (`CONTRATO.md`); no se eliminan funciones.
Sin recursos externos: todo embebido con `go:embed` (HTML, CSS de los 5 temas, fuentes, imágenes). Cada archivo < 80 KB salvo fuentes/imágenes.

## 7. «Rey Muerto» y Viego (el tema del dueño)

Inspiración: **Viego, el Rey Arruinado**: melena plateada, ojos que brillan, corona hueca de púas oscuras, armadura negra violácea con púas,
**cadenas espectrales azules**, enorme **espada carmesí**, **Niebla Negra**. El fondo del dueño (`assets/viego-wallpaper.*`) tiene justo esa paleta.
Paleta de Rey Muerto (sustituye a la de la galería, que era más «verde y oro»):

| Token | Oscuro | Claro («plata») |
|---|---|---|
| `--bg` | `#0b0a14` (violeta casi negro) | `#ebe8f2` |
| `--sup` / `--sup2` | `#141223` / `#1d1a31` | `#f6f4fb` / `#dedaec` |
| `--bd` | `#2c2846` | `#c6c0da` |
| `--tx` / `--su` | `#ebe8f5` (plata) / `#9d99b8` | `#1a1626` / `#5f5a78` |
| `--ac` (acción principal, espada) | `#e0354f` (carmesí), `--ac-tx` `#ffffff` | `#b8213b` |
| `--esp` (cadenas, foco, enlaces, ojos) | `#8fd3ff` | `#2a78b8` |
| `--ok` (niebla negra) / `--av` / `--ml` | `#5fd3b0` / `#e3b45a` / `#ff6b7d` | `#1f8f74` / `#9a6d12` / `#c2263d` |

Motivos: **corona de púas** (`assets/viego/corona-pixel.svg`) como marca; **cadena** (`cadena-pixel.svg`) como separador entre secciones y
borde del enlace; **busto en pixel art** (`rey-pixel.svg`, `image-rendering: pixelated`, escala entera) en el panel (junto al estado o en la
pantalla vacía), en el acceso y en «elegir»; **fondo difuminado** del wallpaper del dueño detrás de todo, con `blur` fuerte, oscurecido y baja
opacidad (vigila el rendimiento en celulares: una versión pequeña y ya difuminada pesa menos que `filter: blur` sobre 1920×1080).
Tipografía: Cinzel (marca y títulos) + Atkinson Hyperlegible. Nada de neón ni de degradados brillantes: sobrio, con carácter.
Texto legal ya añadido en `THIRD_PARTY_NOTICES.md` (arte propio de aficionado; Viego y LoL son marcas de Riot Games).
Puedes **mejorar el pixel art** (`docs/diseno/pixel/generar-rey.js`; v1 es un busto de 56×64) y añadir piezas (niebla en tile, icono de espada),
generándolas con el mismo estilo; **no uses ni trazas** ilustraciones de Riot más allá del wallpaper que el dueño ya tiene en el repo.

## 8. Pruebas y verificación (obligatorias)

- Node: `npm test` sigue en verde (hoy 88). Añade pruebas para `lib/apariencia.js` y las rutas nuevas (parte del cliente).
- Go: `go vet ./... && go test ./...` en `native/tray` (parte del panel); prueba la validación de apariencia y las rutas con los falsos de `panel_test.go`.
- Navegador integrado (panel: `node native/tray/panel/dev/mock-server.js`; cliente: instancia **aislada** como `scripts/windows/smoke.ps1` con
  puerto y estado temporales, **`REMOTE_KEYBOARD_HOST=127.0.0.1`**, y la URL con `?demo=1`):
  los cinco temas × claro/oscuro, a 375×812, 812×375 y 1280×800; consola sin errores; sin desplazamiento horizontal; foco visible; el cliente
  y el panel cambian de tema sin recargar el programa. Anota en la bitácora lo que **no** pudiste probar (celular real, Linux, Edge del panel real).
- Los portales de Linux: comprobar por lectura (§ 5).

## 9. Reglas de trabajo (de `AGENTS.md` y del dueño)

1. Comentarios en **español** que expliquen el porqué. Textos de la interfaz en español claro, sin jerga.
2. **No hagas commit**, no cambies de rama ni hagas push: el dueño pedirá el commit cuando quiera (la sesión que te lanzó lo hará). Deja el trabajo en el árbol.
3. **No toques el firewall, la red de Windows, el registro ni el autoarranque.** No escuches en puertos distintos de `127.0.0.1` (un ejecutable nuevo que
   escucha en todas las interfaces crea una regla de firewall permanente en la PC del dueño). No ejecutes binarios copiados a carpetas temporales
   que abran sockets en la red.
4. **No recompiles encima de `bin\win\*`** mientras NEXO corra (compila a una carpeta temporal para probar; el dueño recompila al final).
   No detengas ni reinicies el NEXO real; no uses su token ni sus dispositivos; no teclees ni hagas clic sobre su escritorio.
5. Sin secretos en git; no imprimas tokens. Sin dependencias nuevas sin motivo fuerte (npm o Go).
6. Si algo no está en este documento y cambia el comportamiento, **anótalo en tu bitácora como duda** y sigue con lo demás.
7. Al terminar: bitácora (`docs/windows/bitacora/REDISENO-PANEL.md` o `REDISENO-CLIENTE.md`) con qué se hizo, cómo se verificó (salidas reales)
   y qué queda sin probar; y actualiza `PROGRESO.md` (sección Windows) en una línea sin pisar lo de la otra sesión.

## 10. Reparto de archivos (para no pisarse)

**Sesión «Cliente» posee:** `index.html`, `microfono.html`, `microfono-cliente.js`, `server.js`, `lib/apariencia.js` (nuevo), `ui/**` (nuevo: CSS base y
`temas/*.css` del cliente), `test/*apariencia*`, y los cambios en `assets/` **de su parte**; la bitácora `REDISENO-CLIENTE.md`.
**Sesión «Panel» posee:** `native/tray/**` (HTML/CSS/JS del panel, Go, `dev/mock-server.js`), `scripts/ui/sync-recursos-panel.js` (nuevo, copia fuentes/imágenes al
directorio embebido), el ajuste mínimo de `scripts/windows/build.ps1` para llamarlo, y la bitácora `REDISENO-PANEL.md`; actualiza `native/tray/panel/CONTRATO.md`.
**Compartido (sólo lectura para ambas):** este documento, `assets/fuentes/**`, `assets/viego/**` y `docs/diseno/**`. Si necesitas cambiar un archivo compartido
(p. ej. mejorar el pixel art), cámbialo **tú** pero avisa en tu bitácora; la otra sesión lo recogerá al releer.
**Contrato entre las dos:** el archivo `.nexo-apariencia.json` y los ids de tema/modo de § 4 (el panel lo escribe, el servidor lo lee). Nada más se comparte.
