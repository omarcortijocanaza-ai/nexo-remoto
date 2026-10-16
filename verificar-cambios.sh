#!/usr/bin/env bash
# Comprueba que todo lo arreglado el 2026-08-19 sigue en pie. Pensado para
# correrlo despues de reiniciar el equipo: dice que sobrevivio y que no.
#
#   ~/Downloads/teclado-remoto/verificar-cambios.sh
set -u

NEXO=$HOME/Downloads/teclado-remoto
HYPR=$HOME/.config/hypr/conf
fallos=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
mal()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fallos=$((fallos + 1)); }
info() { printf '  \033[33m·\033[0m %s\n' "$1"; }

comprobar() { # descripcion, patron, archivo
    if [ -f "$3" ] && grep -q -- "$2" "$3"; then ok "$1"; else mal "$1  ($3)"; fi
}

printf '\n\033[1mTeclado remoto (NEXO)\033[0m\n'
comprobar "Espacio y acentos: detecta Electron por el proceso" "procesoEsElectron" "$NEXO/server.js"
comprobar "Tecleo rapido: restauracion del portapapeles en la misma cola" "CLIPBOARD_RESTORE_MS" "$NEXO/server.js"
comprobar "Tecleo rapido: letras sueltas sin portapapeles" "SEGURO_POR_TECLADO" "$NEXO/server.js"
comprobar "Atajos remotos: mapa del rice" "atajoDelRice" "$NEXO/server.js"
comprobar "AltGr con clientes viejos" "ALTGR_VENTANA_MS" "$NEXO/server.js"
comprobar "Reinicio sin cuelgue (plazo en SIGTERM)" "setTimeout(() => process.exit(0), 1500)" "$NEXO/server.js"
comprobar "Cliente: la tecla Super nativa vuelve a contar" "nativeSuper" "$NEXO/keyboard-translation.js"
[ -x "$NEXO/mapa-atajos.py" ] || [ -f "$NEXO/mapa-atajos.py" ] && ok "Generador del mapa de atajos presente" || mal "Falta mapa-atajos.py"
if [ -f "$NEXO/mapa-atajos.json" ]; then
    ok "Mapa de atajos publicado ($(python3 -c "import json;print(len(json.load(open('$NEXO/mapa-atajos.json'))))" 2>/dev/null || echo '?') atajos)"
else
    info "mapa-atajos.json no existe todavia: el servidor lo genera solo al primer atajo"
fi
[ -f "$NEXO/.traza-teclado" ] && info "Traza de diagnostico ENCENDIDA (borra .traza-teclado para apagarla)"

printf '\n\033[1mAtajos del rice\033[0m\n'
comprobar "Super y AltGr a la vez (espejo)" 'local mods    = { "SUPER", "MOD5" }' "$HYPR/keybinds.lua"
# NEXO ya no se arranca desde la sesion grafica: es un servicio de usuario que
# con linger arranca al encender el equipo, antes del login.
if grep -q "nexo-control start" "$HYPR/autostart.lua" 2>/dev/null; then
    mal "El autostart de Hyprland vuelve a arrancar NEXO: habria dos instancias"
else
    ok "El autostart de Hyprland ya no arranca NEXO (lo hace systemd)"
fi
[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" = yes ] &&
    ok "Linger activo: los servicios de usuario arrancan sin iniciar sesion" ||
    mal "Falta linger: sudo loginctl enable-linger $USER"
for unidad in nexo.service nexo-aviso.service; do
    case "$(systemctl --user is-enabled $unidad 2>/dev/null)" in
        enabled) ok "$unidad habilitado" ;;
        *)       mal "$unidad no habilitado (systemctl --user enable $unidad)" ;;
    esac
done
# El Xsetup usa una variable para el usuario, asi que se comprueban las dos
# piezas que de verdad importan: la copia de la cookie y el xhost de respaldo.
if grep -q "NEXO_COOKIE" /usr/share/sddm/scripts/Xsetup 2>/dev/null &&
   grep -q "localuser" /usr/share/sddm/scripts/Xsetup 2>/dev/null; then
    ok "Xsetup da acceso al display del greeter (cookie + xhost)"
else
    mal "Xsetup sin el permiso del greeter (NEXO no podria servir el login)"
fi
comprobar "Motor X11 para la pantalla de login" "escribirComoWtype" "$NEXO/entrada-x11.js"
comprobar "Detector de pantalla (login o sesion)" "modo: 'x11'" "$NEXO/entorno.js"
comprobar "Captura conmutable (x11grab / wf-recorder)" "Captura X11" "$NEXO/gpu-stream.js"
comprobar "Recorte al monitor primario del greeter" "regionX11" "$NEXO/entorno.js"
comprobar "Xsetup deja registro (antes tragaba los errores)" "nexo-xsetup.log" /usr/share/sddm/scripts/Xsetup
if [ -r /run/nexo-greeter.auth ]; then
    ok "Cookie del greeter accesible ($(stat -c %U:%G /run/nexo-greeter.auth))"
elif [ -e /run/nexo-greeter.auth ]; then
    mal "La cookie del greeter existe pero no se puede leer"
else
    info "Sin cookie del greeter ahora mismo: la crea el Xsetup en cada arranque"
fi

printf '\n\033[1mSesion invitada (usuario nexo)\033[0m\n'
estado=$(systemctl is-enabled nexo-headless.service 2>/dev/null || echo desconocido)
case "$estado" in
    static|disabled) ok "No arranca sola al encender (estado: $estado)" ;;
    enabled)         mal "Vuelve a estar habilitada: sudo systemctl disable --now nexo-headless.service" ;;
    *)               info "Estado desconocido: $estado" ;;
esac
printf '  · ahora mismo: %s\n' "$(systemctl is-active nexo-headless.service 2>/dev/null; true)"

printf '\n\033[1mSin parches temporales\033[0m\n'
sobras=0
for f in /home/Letzus/Downloads/voz-viego-taller/.tools/wtype /home/Letzus/Downloads/voz-viego-taller/.tools/hyprctl; do
    [ -e "$f" ] && { mal "Quedo un shim en el PATH: $f"; sobras=1; }
done
[ "$sobras" = 0 ] && ok "Ningun shim en el PATH (ralentizaban espada y tajo)"

printf '\n\033[1mAviso del enlace al movil\033[0m\n'
comprobar "Script de aviso presente" "NEXO_AVISO" "$HOME/.local/bin/nexo-avisar-enlace.sh"
comprobar "Modo arranque en el avisador" "arranque)" "$HOME/.local/bin/nexo-avisar-enlace.sh"
if [ -f "$HOME/.config/nexo-aviso.conf" ]; then
    metodo=$(grep -m1 '^NEXO_AVISO=' "$HOME/.config/nexo-aviso.conf" | cut -d= -f2)
    case "$metodo" in
        ninguno|"") mal "Configurado pero sin metodo de aviso" ;;
        *)          ok "Metodo de aviso: $metodo" ;;
    esac
    [ "$(stat -c %a "$HOME/.config/nexo-aviso.conf")" = 600 ] || mal "nexo-aviso.conf deberia tener permisos 600"
else
    mal "Falta ~/.config/nexo-aviso.conf"
fi

printf '\n\033[1mEstado en vivo\033[0m\n'
if curl -fsS --max-time 2 http://127.0.0.1:8765/health >/dev/null 2>&1; then
    ok "NEXO respondiendo en el puerto 8765"
else
    info "NEXO no esta levantado ahora (arranca con la sesion, o: nexo-control start)"
fi

printf '\n'
if [ "$fallos" -eq 0 ]; then
    printf '\033[32mTodo en su sitio.\033[0m\n\n'
else
    printf '\033[31m%s cosa(s) fuera de sitio.\033[0m\n\n' "$fallos"
fi
exit "$fallos"
