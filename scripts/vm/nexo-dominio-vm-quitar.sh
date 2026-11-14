#!/usr/bin/env bash
# Deshace scripts/vm/nexo-dominio-vm.sh: quita el bloque de Caddy de NEXO y el usuario del túnel.
#   ssh ubuntu@VM 'sudo bash -s' < scripts/vm/nexo-dominio-vm-quitar.sh
set -Eeuo pipefail
caddy=/etc/caddy/Caddyfile
[[ $EUID -eq 0 ]] || { echo 'Ejecuta con sudo.' >&2; exit 1; }
backup=/var/backups/nexo/quitar-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$backup"
cp -p "$caddy" "$backup/Caddyfile"
python3 - "$caddy" "$backup/Caddyfile.candidato" <<'PY'
from pathlib import Path
import re, sys
s = Path(sys.argv[1]).read_text()
Path(sys.argv[2]).write_text(re.sub(r'\n?# BEGIN nexo\n.*?# END nexo\n', '\n', s, flags=re.S))
PY
caddy validate --config "$backup/Caddyfile.candidato" --adapter caddyfile >/dev/null 2>&1
install -m 644 "$backup/Caddyfile.candidato" "$caddy"
systemctl reload caddy
# Cierra el túnel que pudiera estar abierto y borra el usuario (su llave se va con él).
pkill -u nexotunel 2>/dev/null || true
userdel -r nexotunel 2>/dev/null || true
echo "NEXO quitado de la VM. Respaldo del Caddyfile en $backup"
