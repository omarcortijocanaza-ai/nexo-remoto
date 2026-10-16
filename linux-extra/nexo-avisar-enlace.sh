#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Avisa al movil con el enlace de NEXO en cuanto la PC arranca.
#
# El tunel de cloudflared es efimero: la direccion de Internet CAMBIA en cada
# arranque, asi que si el equipo se reinicia estando fuera de casa no hay forma
# de saber la nueva. Este script espera a que el tunel publique su enlace y lo
# manda al movil; despues se queda vigilando y vuelve a avisar si cambia
# (cloudflared reconecta con otra direccion de vez en cuando).
#
# Uso:
#   nexo-avisar-enlace.sh            vigila y avisa (lo que corre al arrancar)
#   nexo-avisar-enlace.sh ahora      manda el enlace actual y termina
#   nexo-avisar-enlace.sh prueba     manda un aviso de prueba, SIN el enlace
#
# Configuracion en ~/.config/nexo-aviso.conf (permisos 600):
#   NEXO_AVISO=ntfy|telegram|ninguno
#   NTFY_SERVIDOR=https://ntfy.sh
#   NTFY_TEMA=<tema secreto>
#   TELEGRAM_TOKEN=<token del bot>
#   TELEGRAM_CHAT=<id del chat>
# ─────────────────────────────────────────────────────────────────────────────
set -u

CONFIG=${NEXO_AVISO_CONF:-$HOME/.config/nexo-aviso.conf}
ESTADO=$HOME/Downloads/teclado-remoto/.nexo-state.json
REGISTRO=$HOME/.cache/nexo-aviso.log
ULTIMO=$HOME/.cache/nexo-ultimo-enlace.txt
ESPERA_MAX=${NEXO_AVISO_ESPERA:-300}   # segundos esperando al tunel al arrancar
INTERVALO=${NEXO_AVISO_INTERVALO:-60}  # cada cuanto se revisa si cambio

NEXO_AVISO=ninguno
NTFY_SERVIDOR=https://ntfy.sh
NTFY_TEMA=
TELEGRAM_TOKEN=
TELEGRAM_CHAT=
# shellcheck disable=SC1090
[ -f "$CONFIG" ] && . "$CONFIG"

apuntar() { printf '%s  %s\n' "$(date '+%F %T')" "$1" >>"$REGISTRO"; }

enlace_actual() {
    [ -f "$ESTADO" ] || return 1
    /usr/bin/node -e '
        try {
            const s = require(process.argv[1]);
            if (!s.remoteUrl || !s.token) process.exit(1);
            process.stdout.write(`${String(s.remoteUrl).replace(/\/$/, "")}/?token=${s.token}`);
        } catch { process.exit(1); }
    ' "$ESTADO" 2>/dev/null
}

enlace_local() {
    [ -f "$ESTADO" ] || return 1
    /usr/bin/node -e '
        try {
            const s = require(process.argv[1]);
            if (!s.localUrl || !s.token) process.exit(1);
            process.stdout.write(`${String(s.localUrl).replace(/\/$/, "")}/?token=${s.token}`);
        } catch { process.exit(1); }
    ' "$ESTADO" 2>/dev/null
}

mandar() { # titulo, cuerpo
    case "$NEXO_AVISO" in
        ntfy)
            [ -n "$NTFY_TEMA" ] || { apuntar 'ntfy sin tema configurado'; return 1; }
            curl -fsS --max-time 15 \
                -H "Title: $1" -H 'Tags: computer' -H 'Priority: default' \
                -d "$2" "${NTFY_SERVIDOR%/}/$NTFY_TEMA" >/dev/null
            ;;
        telegram)
            [ -n "$TELEGRAM_TOKEN" ] && [ -n "$TELEGRAM_CHAT" ] || { apuntar 'telegram sin token o chat'; return 1; }
            curl -fsS --max-time 15 \
                --data-urlencode "chat_id=$TELEGRAM_CHAT" \
                --data-urlencode "text=$1
$2" \
                "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" >/dev/null
            ;;
        *)
            apuntar 'sin metodo de aviso configurado (NEXO_AVISO=ninguno)'
            return 1
            ;;
    esac
}

avisar_enlace() { # enlace
    local cuerpo
    cuerpo="$1"
    local local_url
    local_url=$(enlace_local) && cuerpo="$cuerpo

En casa: $local_url"
    if mandar "NEXO listo en ${HOSTNAME:-$(uname -n)}" "$cuerpo"; then
        printf '%s\n' "$1" >"$ULTIMO"
        apuntar "avisado: $1"
        return 0
    fi
    apuntar "fallo al avisar: $1"
    return 1
}

case "${1:-vigilar}" in
    arranque)
        # Lo lanza un servicio del sistema, ANTES de que nadie inicie sesion.
        # No hay enlace de NEXO todavia — NEXO vive dentro de la sesion — pero
        # saber que el equipo ya esta arriba es justo lo que hace falta tras
        # reiniciar desde fuera: es el momento de entrar por RustDesk.
        # La red puede no estar lista del todo aunque systemd la de por buena.
        for intento in 1 2 3 4 5 6; do
            mandar "PC encendida · ${HOSTNAME:-$(uname -n)}" \
                'El equipo arranco y RustDesk ya acepta conexiones (pantalla de inicio de sesion).
Cuando inicies sesion, NEXO se levanta y te llega aqui su enlace.' && {
                apuntar 'avisado: arranque del equipo'
                exit 0
            }
            sleep 10
        done
        apuntar 'no se pudo avisar del arranque'
        exit 1
        ;;
    prueba)
        # A proposito NO manda el enlace: sirve para confirmar que el aviso
        # llega al movil antes de publicar nada sensible.
        mandar "NEXO · prueba desde ${HOSTNAME:-$(uname -n)}" 'Si ves esto, los avisos funcionan. El enlace real se manda al arrancar la PC.' &&
            { echo 'Aviso de prueba enviado.'; exit 0; }
        echo 'No se pudo enviar el aviso de prueba. Revisa ~/.config/nexo-aviso.conf' >&2
        exit 1
        ;;
    ahora)
        enlace=$(enlace_actual) || { echo 'El tunel todavia no publico su enlace.' >&2; exit 1; }
        avisar_enlace "$enlace" && echo "Enviado: $enlace"
        exit $?
        ;;
esac

# ── Modo vigilancia (el del arranque) ────────────────────────────────────────
inicio=$SECONDS
enlace=
while [ $((SECONDS - inicio)) -lt "$ESPERA_MAX" ]; do
    enlace=$(enlace_actual) && [ -n "$enlace" ] && break
    sleep 5
done

if [ -z "$enlace" ]; then
    apuntar "el tunel no publico enlace en ${ESPERA_MAX}s; se sigue vigilando"
else
    avisar_enlace "$enlace"
fi

# El enlace puede cambiar sin reiniciar: cloudflared reconecta y publica otra
# direccion. Se avisa solo cuando de verdad cambia, no en cada vuelta.
anterior=$(cat "$ULTIMO" 2>/dev/null || true)
while sleep "$INTERVALO"; do
    actual=$(enlace_actual) || continue
    [ -n "$actual" ] || continue
    [ "$actual" = "$anterior" ] && continue
    avisar_enlace "$actual" && anterior=$actual
done
