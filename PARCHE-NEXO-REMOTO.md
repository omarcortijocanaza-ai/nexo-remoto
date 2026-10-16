# NEXO remoto · espacio, atajos Super y tecla Super del cliente (2026-08-18)

Tres fallos distintos, arreglados en el codigo. **Ya no hay shims**: hubo una
version intermedia con envoltorios de `wtype` y `hyprctl` puestos delante en el
PATH, y salio cara — ver la nota del final.

## 1 · No se podia escribir el espacio en Claude Desktop

`inputAction` manda el espacio a `runChromiumAwareSpace()`, que usa el truco del
portapapeles **solo** si la ventana activa casa con
`/brave|chrom(?:e|ium)|electron/i`; si no, envia `wtype -k space`, y
Electron/Chromium bajo Wayland lo descarta.

Claude Desktop se anuncia como `com.anthropic.Claude`, titulo `Claude`: no casa.
Por eso las letras entraban (van por `wtype -- "texto"`) y el espacio no.

**Arreglo** (`server.js`): cuando el nombre no delata nada se mira el proceso.
`procesoEsElectron(pid)` resuelve `/proc/<pid>/exe` y busca al lado
`chrome_crashpad_handler`, `libffmpeg.so` o `resources.pak`, que todo empaquetado
Electron/Chromium lleva. El resultado se cachea por PID. Asi no hay que ir
ampliando una lista de nombres cada vez que aparece una app nueva.

## 2 · Ningun atajo con Super funcionaba desde el cliente

`runHyprShortcut()` leia `hyprctl binds` y reenviaba `dispatch <dispatcher>
<arg>`. Desde que la config de Hyprland es **Lua** (0.55+), los binds se
publican como `dispatcher: __lua` + un id interno, y ese reenvio llega al
compositor como `hl.dispatch(__lua 6)` → *')' expected near '6'*. El log estaba
lleno de ese error. No era cosa de Super vs AltGr: con config Lua,
`dispatch <nombre> <arg>` no funciona para nada. Comprobado:

```bash
hyprctl dispatch exec "notify-send x"                  # error de sintaxis
hyprctl keyword bind "SUPER, F12, exec, x"             # "can't work with non-legacy parsers"
hyprctl dispatch 'hl.dsp.exec_cmd("notify-send x")'    # ok
```

**Primer intento, descartado**: inyectar la pulsacion con
`wtype -M logo -k <tecla>` y dejar que el compositor dispare su propio atajo.
**No funciona**: Hyprland no atiende sus binds cuando la pulsacion viene de un
teclado virtual. La primera comprobacion («`wtype -M logo -k a` abre el
dashboard») fue un falso positivo — el demonio de eww ya estaba levantado. Con
una prueba antes/despues de verdad (`eww active-windows`, ventanas kitty) no
abre nada.

**Arreglo** (`server.js` + `mapa-atajos.py`): lo unico que el compositor acepta
desde fuera es una expresion Lua, asi que hay que saber que hace cada atajo, y
eso solo esta en la fuente del rice. `mapa-atajos.py` lee
`~/.config/hypr/conf/keybinds.lua` y publica `mapa-atajos.json`
(`"64:q": "hl.dsp.exec_cmd(\"kitty\")"`). `atajoDelRice()` lo consulta y lo
regenera solo cuando `keybinds.lua` es mas nuevo que el JSON, asi que cambiar
un atajo del rice no deja el mapa desfasado. Verificado de punta a punta: la
expresion del mapa para `64:q` abre kitty, por las dos formas
(`dispatch <expr>` y `eval hl.dispatch(<expr>)`, que es la que usa el codigo).

Solo se publica la familia SUPER: el rice registra cada atajo tambien en MOD5
(espejo AltGr del teclado fisico) y ejecutar ambos lo haria dos veces.

De paso arregla el duplicado: los atajos estan registrados en SUPER y en MOD5 a
la vez (espejo AltGr del teclado fisico), y el reenvio por lista los ejecutaba
**dos veces**. Una pulsacion inyectada solo dispara uno.

Se mantiene el reenvio clasico para configs `.conf`, cuyos binds si publican un
dispatcher real.

**Atajos bloqueados en remoto** (`BLOQUEADOS` en `runHyprShortcut`):
`Super+Shift+Supr` (apagar), `Super+Ctrl+Shift+Supr` (reiniciar a Windows) y
`Super+Shift+M` (cerrar la sesion). Una pulsacion mal interpretada por la red se
llevaria por delante el tunel y no habria forma de volver a entrar. En el teclado
fisico siguen funcionando; vaciar el Set devuelve el comportamiento literal.

## 3 · La tecla Super del cliente no valia, solo AltGr

`index.html` hacia `if(isNativeSuper(e)||e.metaKey)return;` y `browserEvent`
calculaba `meta` solo desde `altGrSuper`/`virtualSuper`. AltGr se habia añadido
como alternativa para cuando el sistema del cliente se queda la tecla Windows,
pero acabo **sustituyendola**: en los equipos que si entregan Super no habia
manera de lanzar un atajo con la tecla de verdad. Es el mismo error que se
cometio en la config de Hyprland del rice, en otro sitio.

**Arreglo**: `meta` vuelve a aceptar las tres vias a la vez —
`event.metaKey || nativeSuper || altGrSuper || virtualSuper`— y el cliente
vuelve a seguir la tecla nativa (pulsacion, acorde, soltar y `blur`), con el
mismo trato que AltGr. Cubierto por la prueba «la tecla Super del cliente sigue
valiendo, no solo AltGr».

## 4 · AltGr desde clientes viejos, y el cuelgue al reiniciar

Dos cosas que salieron al probar lo anterior:

- **La pagina se queda cargada en la pestaña durante dias.** Un cliente viejo no
  conoce AltGr: manda la tecla en crudo (`AltGraph`), que acababa en «Entrada
  inválida», y la tecla siguiente llegaba sin Super. Arreglar el cliente no
  basta si nadie recarga. Ahora el **servidor** arma Super al ver `AltGraph` y
  se lo aplica a la pulsacion siguiente (ventana de 3 s), traduciendo tambien
  el simbolo latam al codigo fisico (AltGr+Q llega como `@`, no como `q`) y
  retirando los bits Ctrl+Alt con los que Windows expone AltGr.

- **`SIGTERM` colgaba el servidor.** El manejador hacia `server.close()`, que
  espera a que terminen las conexiones abiertas — y un cliente remoto mantiene
  la suya indefinidamente. El proceso se quedaba vivo sin puerto, el launcher no
  podia relevarlo y la sesion remota se caia hasta matarlo a mano (paso, dos
  minutos). Ahora hay un plazo de 1,5 s que fuerza la salida.

## 5 · Letras cambiadas al escribir rapido

Sintoma: escribiendo rapido desde el cliente salian letras distintas a las
pulsadas. Reproducido en una ventana Chromium de prueba, entregando
«abcdefghij» tecla a tecla como hacia el servidor:

```
esperado: abcdefghij
llego:    á csbcdefghij      (una entrega por caracter)
llego:    abcdefghij         (una sola entrega para toda la rafaga)
```

Dos carreras, una por camino:

- **Portapapeles**: `startCommandInput` resuelve tras un plazo fijo de 25 ms, no
  cuando `wl-copy` es dueño del portapapeles de verdad. Escribiendo rapido, el
  Ctrl+V pegaba el contenido del turno anterior.
- **`wtype`**: cada llamada crea un teclado virtual con su propio mapa de teclas.
  Una llamada por tecla es un cambio de mapa por tecla, y las que se solapan se
  resuelven con el mapa equivocado.

**Arreglo**: las pulsaciones de texto se agrupan en una sola entrega
(`encolarTexto`, 30 ms, ajustable con `NEXO_AGRUPAR_MS`), asi que una rafaga de
tecleo se convierte en un unico `wl-copy`+Ctrl+V — o un unico `wtype` fuera de
Chromium. Antes de pegar se comprueba que el portapapeles ya contiene el texto
(hasta 3 intentos de 15 ms) en vez de confiar en el plazo fijo. Cualquier
entrada que no sea texto —Enter, flechas, atajos, un clic— vacia primero lo
pendiente, para que no se adelante a lo que se estaba escribiendo.

## Por que no hay shims

La version intermedia puso envoltorios de `wtype` y `hyprctl` en
`~/Downloads/voz-viego-taller/.tools`, la primera entrada del PATH del servidor.
Funcionaba sin reiniciar el tunel, pero ese PATH **es el de toda la sesion
grafica**, no solo el de NEXO: cada llamada a `hyprctl` pasaba a costar ~30 ms
en vez de ~5 ms. El cambio de espada (Super+Z) y el tajo de escritorio
(Super+1..4) hacen ~20 llamadas encadenadas cada uno, asi que se notaba muchisimo
— medio segundo extra en una animacion de 0,4 s.

Leccion: un shim en el PATH no es gratis ni esta acotado al proceso que se
queria parchear. Si vuelve a hacer falta un arreglo en caliente, que el
envoltorio viva en un directorio propio y se le pase al proceso, nunca en un
PATH compartido.
