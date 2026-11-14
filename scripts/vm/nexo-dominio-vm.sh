#!/usr/bin/env bash
# Publica NEXO (la PC del dueño) en https://nexo.nexussoftware.pe a través de esta VM.
#
#   celular ─HTTPS─▶ Caddy (esta VM) ─▶ 127.0.0.1:5095 ◀─ túnel SSH inverso ─ PC del dueño (NEXO :8765)
#
# Qué hace (idempotente; con respaldo y reversión automática si algo falla):
#   1. Usuario de sistema «nexotunel» sin contraseña ni shell, cuya ÚNICA llave sólo puede abrir un
#      reenvío remoto en 127.0.0.1:5095 (no puede ejecutar órdenes ni abrir otros puertos).
#   2. Bloque «# BEGIN nexo / # END nexo» al final del Caddyfile para nexo.nexussoftware.pe.
#   3. Valida Caddy, recarga sin reiniciar y comprueba que las demás webs siguen respondiendo.
# No toca sshd_config, el DNS (el comodín *.nexussoftware.pe ya apunta aquí) ni otros servicios.
# No crea procesos nuevos: el túnel lo mantiene el sshd que ya existe.
#
# Uso (desde la PC, con la llave de administración de la VM):
#   ssh ubuntu@VM "sudo NEXO_LLAVE='ssh-ed25519 AAAA… nexo-tunel' bash -s" < scripts/vm/nexo-dominio-vm.sh
# Deshacer: scripts/vm/nexo-dominio-vm-quitar.sh
set -Eeuo pipefail

dominio=nexo.nexussoftware.pe
puerto=5095
usuario=nexotunel
caddy=/etc/caddy/Caddyfile
llave="${NEXO_LLAVE:-}"

if [[ ! "$llave" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ [A-Za-z0-9@._-]+)?$ ]]; then
  echo 'NEXO_LLAVE debe ser una llave pública ssh-ed25519 (una sola línea).' >&2
  exit 1
fi
[[ $EUID -eq 0 ]] || { echo 'Ejecuta con sudo.' >&2; exit 1; }

version=$(date -u +%Y%m%dT%H%M%SZ)
backup=/var/backups/nexo/$version
mkdir -p "$backup"
cp -p "$caddy" "$backup/Caddyfile"
cambiado=0
usuario_creado=0
revertir() {
  local codigo=$?
  trap - ERR
  if [[ "$cambiado" == 1 ]]; then
    cp -p "$backup/Caddyfile" "$caddy"
    systemctl reload caddy || true
    echo 'Reversión aplicada: Caddyfile restaurado.' >&2
  fi
  if [[ "$usuario_creado" == 1 ]]; then
    userdel -r "$usuario" 2>/dev/null || true
    echo "Reversión aplicada: usuario $usuario eliminado." >&2
  fi
  exit "$codigo"
}
trap revertir ERR

# --- Comprobaciones previas: abortar antes de cambiar nada ---
# El puerto debe estar libre, salvo que ya lo ocupe el sshd de este mismo túnel (segunda ejecución).
if ss -ltnpH "sport = :$puerto" | grep -q .; then
  if ! ss -ltnpH "sport = :$puerto" | grep -q '"sshd'; then
    echo "127.0.0.1:$puerto ya está en uso por otro servicio:" >&2
    ss -ltnp "sport = :$puerto" >&2
    exit 1
  fi
fi
# sshd debe permitir el reenvío remoto a este usuario. Si su configuración lo impide, no se edita: se avisa.
efectiva=$(sshd -T -C "user=$usuario,host=nexo,addr=127.0.0.1" 2>/dev/null || true)
reenvio=$(awk '$1=="allowtcpforwarding"{print $2}' <<<"$efectiva")
if [[ -n "$efectiva" && "$reenvio" != "yes" && "$reenvio" != "all" && "$reenvio" != "remote" ]]; then
  echo "sshd tiene AllowTcpForwarding=$reenvio: el túnel no funcionaría. No se cambió nada." >&2
  exit 1
fi
if grep -Eiq '^\s*(AllowUsers|AllowGroups)\s' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null; then
  echo 'sshd restringe usuarios (AllowUsers/AllowGroups): añade «nexotunel» a mano o el túnel no entrará. No se cambió nada.' >&2
  exit 1
fi

# --- 1. Usuario del túnel ---
if ! id "$usuario" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/home/$usuario" --shell /usr/sbin/nologin "$usuario"
  usuario_creado=1
fi
install -d -m 700 -o "$usuario" -g "$usuario" "/home/$usuario/.ssh"
# restrict quita todo (pty, agente, X11, reenvíos); port-forwarding devuelve sólo los reenvíos y
# permitlisten limita el remoto a 127.0.0.1:5095. command="/bin/false" impide ejecutar nada.
printf 'restrict,port-forwarding,permitlisten="127.0.0.1:%s",command="/bin/false" %s\n' "$puerto" "$llave" > "$backup/authorized_keys"
install -m 600 -o "$usuario" -g "$usuario" "$backup/authorized_keys" "/home/$usuario/.ssh/authorized_keys"

# --- 2. Bloque de Caddy ---
python3 - "$caddy" "$backup/Caddyfile.candidato" "$dominio" "$puerto" <<'PY'
from pathlib import Path
import re, sys
s = Path(sys.argv[1]).read_text()
s = re.sub(r'\n?# BEGIN nexo\n.*?# END nexo\n', '\n', s, flags=re.S)
dominio, puerto = sys.argv[3], sys.argv[4]
bloque = f'''
# BEGIN nexo
# NEXO (control remoto de la PC del dueño) por túnel SSH inverso. scripts/vm/nexo-dominio-vm.sh
{dominio} {{
    encode zstd gzip
    header X-Content-Type-Options nosniff
    # El enlace de emparejamiento lleva ?token=: que no se filtre a otras webs.
    header Referrer-Policy no-referrer
    reverse_proxy 127.0.0.1:{puerto} {{
        # NEXO limita los intentos de contraseña por IP y cree a Cf-Connecting-Ip cuando la
        # petición llega por el bucle local: aquí no viene de Cloudflare, así que se borra.
        header_up -Cf-Connecting-Ip
        # Vídeo y eventos sin búfer.
        flush_interval -1
    }}
}}
# END nexo
'''
Path(sys.argv[2]).write_text(s.rstrip('\n') + '\n' + bloque)
PY
caddy validate --config "$backup/Caddyfile.candidato" --adapter caddyfile >/dev/null 2>&1
cambiado=1
install -m 644 "$backup/Caddyfile.candidato" "$caddy"
systemctl reload caddy

# --- 3. Comprobaciones ---
# Sin la PC conectada, Caddy responde 502: basta para saber que el certificado y la ruta están.
codigo=000
for _ in $(seq 1 40); do
  codigo=$(curl --resolve "$dominio:443:127.0.0.1" -s -o /dev/null -w '%{http_code}' "https://$dominio/health" || true)
  [[ "$codigo" != 000 ]] && break
  sleep 3
done
printf '%s https://%s/health (502 = falta la PC; 200 = túnel activo)\n' "$codigo" "$dominio"
[[ "$codigo" == 502 || "$codigo" == 200 ]]
comprobar() { local got; got=$(curl --resolve "$1:443:127.0.0.1" -s -o /dev/null -w '%{http_code}' "https://$1$2"); printf '%s https://%s%s\n' "$got" "$1" "$2"; [[ "$got" == "$3" ]]; }
comprobar nexussoftware.pe / 200
comprobar restaurantes.nexussoftware.pe /health/ready 200
comprobar canazas.nexussoftware.pe /canazas-shop/ 200
trap - ERR
echo "OpenSSH: $(ssh -V 2>&1)"
free -m | sed -n 2p
echo "Listo. Respaldo en $backup. Para deshacer: scripts/vm/nexo-dominio-vm-quitar.sh"
