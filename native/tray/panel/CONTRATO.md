# Panel de NEXO · contrato entre la interfaz y la bandeja

El panel es una página web que **sirve `nexo-tray.exe`** en `http://127.0.0.1:<puerto>` y se
abre en una ventana sin barra de direcciones (Edge `--app=`). Está embebida en el
ejecutable (`go:embed`): `index.html`, `panel.css`, `panel.js`, `tema-inicial.js`, `temas/<id>.css`
(los cinco temas), `fuentes/` e `img/` (copias de `assets/`, ver más abajo), **sin recursos externos**
(ni CDN ni fuentes web: tiene que funcionar sin Internet). Sólo se sirve lo embebido (lista cerrada).

## Seguridad (la impone el servidor; la interfaz sólo debe cumplirlo)

- La ventana se abre con `/?k=<clave>`; el servidor la canjea por la cookie `nexo_panel`
  (`HttpOnly`, `SameSite=Strict`) y redirige a `/`. Todas las rutas `/api/*` exigen la cookie.
- Todo `POST` debe llevar la cabecera `X-NEXO-Panel: 1` y `Content-Type: application/json`.
  Un `fetch` normal del mismo origen lo cumple; usa un único helper para todas las llamadas.
- Sin cookie válida el servidor responde `401`; la interfaz debe mostrar «Sesión del panel
  caducada: ciérralo y ábrelo desde el icono de NEXO».

## Convenciones

- JSON UTF-8. Los fallos esperados llegan como **HTTP 200** con `{"ok":false,"error":"mensaje en español"}`.
- Los textos de la interfaz son **español**.
- Los enlaces llevan el token (`?token=…`). Se muestran enmascarados por defecto
  (`…/?token=••••••••`) con un botón «Mostrar»; «Copiar» siempre copia el enlace completo.

## Ajustes (archivo `.nexo-settings.json` que escribe el servidor)

```json
{ "modo": "both", "gpu": true, "micDispositivo": "CABLE Input", "httpsLan": false }
```
`modo`: `both` (local + Internet), `local` (sólo red local) o `remote` (sólo Internet).
`gpu`: `false` fuerza el vídeo por CPU. `micDispositivo`: parte del nombre de la salida del
cable virtual para el micrófono del celular (máx. 80 caracteres). `httpsLan`: `true` añade el
HTTPS de la LAN (puerto 8443, certificado propio) y el enlace `enlaces.localSeguro`; al guardarlo
el panel abre el puerto en el firewall (perfil Privado). **Los cambios se aplican al reiniciar NEXO.**

## Rutas

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /api/estado` | — | ver abajo |
| `POST /api/iniciar` · `/api/detener` · `/api/reiniciar` | `{}` | `{"ok":true}` (la acción continúa en segundo plano; la interfaz sondea `/api/estado`) |
| `POST /api/autoarranque` | `{"activo":true}` | `{"ok":true,"autoarranque":{…}}` |
| `POST /api/ajustes` | `{"modo","gpu","micDispositivo"}` | `{"ok":true,"ajustes":{…},"requiereReinicio":true}` |
| `POST /api/emparejar` | `{"minutos":10}` | `{"ok":true,"codigo":"ABCD-EFGH","texto":"Código de emparejamiento: …\nVálido 10 min…"}` |
| `POST /api/rotar` | `{}` | `{"ok":true,"mensaje":"…"}` — cambia el token y **reinicia NEXO** (tarda ~10 s) |
| `POST /api/contrasena` | `{"usuario","contrasena"}` | `{"ok":true,"mensaje":"…"}` — cambia la contraseña de «Mi PC» y reinicia NEXO |
| `GET /api/aviso` | — | `{"metodo":"ninguno\|ntfy\|telegram","ntfyServidor","ntfyTema","telegramChat","tieneTelegramToken":false}` |
| `POST /api/aviso` | `{"metodo","ntfyServidor","ntfyTema","telegramToken","telegramChat"}` (`telegramToken` vacío = conservar el actual) | `{"ok":true}` |
| `POST /api/aviso/prueba` | `{}` | `{"ok":true,"texto":"Aviso de prueba enviado."}` |
| `GET /api/doctor` | — | `{"ok":true,"texto":"…"}` (tarda 5–15 s; sin colores ANSI) |
| `GET /api/registro` | — | `{"texto":"…últimas ~120 líneas…"}` |
| `POST /api/abrir-registros` | `{}` | `{"ok":true}` (abre la carpeta en el Explorador) |
| `GET /api/qr?que=internet`, `que=local` o `que=localSeguro` | — | `image/png` (404 si no hay enlace) |
| `GET /api/turn` | — | `{"ok":true,"turn":{"proveedor":"ninguno\|cloudflare\|manual","cloudflareKeyId","tieneApiToken","manualUrls":[],"manualUsuario","tieneCredencial"}}` (nunca los secretos) |
| `POST /api/turn` | `{"proveedor","cloudflare":{"keyId","apiToken"},"manual":{"urls":[],"usuario","credencial"},"olvidarSecretos"}` (un secreto vacío conserva el guardado) | `{"ok":true,"turn":{…}}` o `{"ok":false,"error":"…"}` (campos que faltan, en español). Se aplica en la siguiente conexión, sin reiniciar |
| `POST /api/turn/prueba` | `{}` | `{"ok":true,"texto":"TURN funcionando…"}` (tarda hasta ~20 s); si no hay ruta de retransmisión: `ok:false` con el motivo |
| `GET /api/red` | — | `{"ok":true,"red":{…}}` (ver abajo; tarda ~5 s: pedirlo sólo al abrir la sección) |
| `POST /api/red/privada` | `{}` | marca como Privada las redes conectadas que son Públicas; devuelve `{"ok":true,"red":{…}}` |
| `POST /api/red/cerrar-publicas` | `{"forzar":false}` | cierra las reglas de firewall públicas de NEXO; **se niega** (`ok:false`) si ninguna red conectada es Privada y no hay `forzar` |
| `POST /api/red/regla-https` | `{}` | crea la regla del puerto 8443 (perfil Privado) |
| `GET /api/apariencia` | — | `{"ok":true,"apariencia":{"tema","modo","porDispositivo"}}` (defecto `reymuerto`/`auto`/`false`) |
| `POST /api/apariencia` | `{"tema","modo","porDispositivo"}` (lo que falte conserva su valor) | `{"ok":true,"apariencia":{…}}` o `{"ok":false,"error":"…"}` (tema/modo desconocido). Escribe de forma atómica `<estado>\.nexo-apariencia.json`; no hace falta reiniciar |
| `GET /api/dispositivos` | — | `{"ok":true,"dispositivos":[{"etiqueta","ultimaVez","creado"}]}` (ms desde 1970; lee `.nexo-devices.json`, **nunca** id ni hash; sólo lectura) |
| `POST /api/salir` | `{"detener":true}` | `{"ok":true}` — cierra la bandeja (y detiene NEXO si `detener`) |

### `red` (de `GET /api/red`)

```json
{ "comprobado": true, "perfiles": [{"nombre":"Red 3","interfaz":"Ethernet","categoria":"Public"}],
  "todasPublicas": true, "reglasPublicas": [{"nombre":"Node.js JavaScript Runtime","programa":"C:\\…\\node.exe","protocolo":"TCP"}],
  "reglasNexo": 3, "reglaHttps": false, "puertoHttps": 8443, "elevado": true }
```
`categoria`: `Public` | `Private` | `DomainAuthenticated`. Si `comprobado` es false, `error` dice por qué. Las acciones exigen `elevado`.

### `GET /api/estado`

```json
{
  "estado": "activo",
  "textoEstado": "NEXO · activo",
  "modo": "both",
  "enlaces": { "internet": "https://x.trycloudflare.com/?token=…", "local": "http://192.168.1.5:8765/?token=…", "localSeguro": "https://192.168.1.5:8443/?token=…" },
  "autoarranque": { "instalado": true, "activo": true },
  "elevado": true,
  "ajustes": { "modo": "both", "gpu": true, "micDispositivo": "CABLE Input", "httpsLan": false },
  "ajustesPendientes": false,
  "ocupado": "",
  "version": "1.0"
}
```

- `estado`: `activo`, `conectando` (NEXO responde pero falta el túnel) o `detenido`.
- `enlaces.*`: cadena vacía si todavía no existe (p. ej. el túnel aún no publicó).
- `autoarranque.instalado=false` → la tarea de Windows no existe (hay que ejecutar el instalador);
  `activo` = arranca al iniciar sesión.
- `elevado=false` → la bandeja no tiene permisos de administrador: Windows bloquea la entrada
  sobre ventanas de administrador y no se puede cambiar el autoarranque.
- `ajustesPendientes=true` → hay ajustes guardados que NEXO aún no aplica (falta reiniciar).
- `ocupado`: texto no vacío («Reiniciando…», «Deteniendo…») mientras una acción larga está en
  curso; la interfaz deshabilita los botones y lo muestra.

## Pantallas / secciones que debe tener la interfaz

1. **Estado y control**: pastilla de estado grande (verde/ámbar/gris) y botones
   **Iniciar**, **Detener**, **Reiniciar** (habilitados según el estado y `ocupado`).
2. **Enlaces**: Internet y local, cada uno con **Copiar**, **Mostrar/Ocultar** token y **código QR**
   (imagen de `/api/qr`) desplegable; si no hay enlace, un texto «Aún no disponible».
3. **Ajustes**: interruptor **Iniciar NEXO al encender / iniciar sesión** (aviso si
   `instalado=false` o `elevado=false`), **Modo** (3 opciones), **Vídeo por GPU** (interruptor),
   **Micrófono: nombre del cable virtual**, botón **Guardar**; si `ajustesPendientes` o tras guardar,
   un aviso «Reinicia NEXO para aplicar» con botón **Reiniciar ahora**.
4. **Emparejar un dispositivo**: botón **Generar código** (caja grande con el código y su caducidad).
5. **Aviso del enlace al celular**: método (ninguno / ntfy / Telegram), campos según el método,
   **Guardar** y **Enviar prueba**.
6. **Seguridad**: **Cambiar contraseña de «Mi PC»** (usuario, contraseña y repetirla; coincidir y no
   vacía) y **Rotar el enlace** (con confirmación: los enlaces compartidos dejan de valer).
7. **Diagnóstico**: **Ejecutar diagnóstico** (muestra el texto en una caja monoespaciada con
   indicador de carga) y **Ver registro** (últimas líneas, botón **Abrir carpeta de registros**).
8. Pie: **Cerrar el panel** (cierra la ventana) y **Salir de NEXO** (con confirmación: «Detener NEXO y
   cerrar la bandeja» / «Cerrar sólo la bandeja»).

## Requisitos de calidad

- Una sola página con navegación lateral o por pestañas; clara para quien no es técnico.
- Se adapta de ~420 px a ~1100 px de ancho; tema claro/oscuro con `prefers-color-scheme`.
- Sondea `/api/estado` cada 2 s (cada 5 s si la pestaña está oculta) sin parpadeos.
- Confirmaciones para acciones destructivas; avisos (toasts) para resultado de cada acción.
- Teclado y lector de pantalla: botones reales, `aria-live` para avisos, foco visible.
- `navigator.clipboard.writeText` con alternativa (`execCommand('copy')`) si falla.
- Cada archivo < 80 KB; sin dependencias ni compilación.

## Apariencia (rediseño de 2026-10-17)

- Temas: `cabina`, `nativa`, `reymuerto` (defecto), `cianotipo`, `bloque`; modos `auto` | `claro` | `oscuro`.
  Un tema = un archivo `temas/<id>.css` sobre el mismo DOM; se elige con `data-tema` y `data-modo` en `<html>`.
  Variables fijas: `--bg --sup --sup2 --bd --tx --su --ac --ac-tx --ok --av --ml --r --rg --f-t --f-c --f-n --sh`.
- El servidor del panel escribe `data-tema` y `data-pref` en `<html>` al servir `index.html`; `tema-inicial.js`
  (bloqueante, en `<head>`) resuelve `auto` con `prefers-color-scheme` y fija `data-modo` antes de pintar.
  `panel.js` cambia de tema al instante con `NEXO_TEMA.poner(tema, modo)` y guarda con `POST /api/apariencia`.
- CSS en capas `base < tema < ajuste` (un tema siempre gana a `panel.css`; `ajuste` gana a los temas en ventanas estrechas).
- `fuentes/` e `img/` son copias de `assets/fuentes` y `assets/viego`: `node scripts/ui/sync-recursos-panel.js`
  (lo llama `build.ps1`; `--verificar` no escribe). Las copias se versionan y `TestRecursosEmbebidosAlDiaConAssets` avisa si quedan viejas.
- Navegación: Inicio · Dispositivos · Conexión · Apariencia · Ajustes · Diagnóstico (`#inicio`, `#dispositivos`, `#conexion`,
  `#apariencia`, `#ajustes`, `#diagnostico`; `#emparejar`/`#aviso` → Dispositivos y `#seguridad` → Ajustes).
