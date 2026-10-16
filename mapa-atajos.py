#!/usr/bin/env python3
"""Publica los atajos del rice para que NEXO pueda ejecutarlos en remoto.

El problema: con la config Lua de Hyprland (0.55+), `hyprctl binds` publica
cada atajo como dispatcher `__lua` mas un id interno de callback. Ese id no se
puede re-despachar por IPC, y Hyprland tampoco dispara sus atajos cuando la
pulsacion llega de un teclado virtual (`wtype`) — comprobado: `wtype -M logo -k
a` no abre nada. Lo unico que el compositor si acepta desde fuera es una
expresion Lua: `hyprctl dispatch 'hl.dsp.exec_cmd("kitty")'`.

Asi que hace falta saber QUE hace cada atajo, y eso solo esta en la fuente.
Este script lee conf/keybinds.lua y escribe mapa-atajos.json:

    "64:q": "hl.dsp.exec_cmd(\\"kitty\\")"      (64 = SUPER, +1 SHIFT, +4 CTRL, +8 ALT)

server.js lo regenera solo cuando keybinds.lua es mas nuevo que el JSON, asi
que cambiar un atajo del rice no deja el mapa desfasado.

Uso directo:  python3 mapa-atajos.py
"""

import json
import pathlib
import re

KEYBINDS = pathlib.Path.home() / ".config/hypr/conf/keybinds.lua"
SALIDA = pathlib.Path(__file__).with_name("mapa-atajos.json")

# Solo se publica la familia SUPER. El rice registra los mismos atajos tambien
# en MOD5 (espejo AltGr del teclado fisico) y server.js consulta las dos
# mascaras: publicar ambas ejecutaria cada atajo dos veces.
SUPER = 64
MODS = {"SHIFT": 1, "CTRL": 4, "ALT": 8}

# Atajos que NO se publican al cliente remoto. Una pulsacion perdida o mal
# interpretada por la red apagaria o cerraria la sesion — y con ella el tunel,
# dejando el equipo inalcanzable. Siguen funcionando en el teclado fisico.
PELIGROSOS = ("systemctl poweroff", "reboot-a-windows.sh", "hl.dsp.exit(")


def cuerpo_de_llamada(linea, inicio):
    """Texto entre el parentesis de bind( y su cierre."""
    profundidad = 0
    en_cadena = None
    for i in range(inicio, len(linea)):
        c = linea[i]
        if en_cadena:
            if c == en_cadena and linea[i - 1] != "\\":
                en_cadena = None
            continue
        if c in "\"'":
            en_cadena = c
        elif c == "(":
            profundidad += 1
        elif c == ")":
            profundidad -= 1
            if profundidad == 0:
                return linea[inicio + 1:i]
    return None


def separar_argumentos(cuerpo):
    """Parte el cuerpo por comas de primer nivel."""
    partes, actual, profundidad, en_cadena = [], "", 0, None
    for i, c in enumerate(cuerpo):
        if en_cadena:
            actual += c
            if c == en_cadena and cuerpo[i - 1] != "\\":
                en_cadena = None
            continue
        if c in "\"'":
            en_cadena = c
        elif c in "([{":
            profundidad += 1
        elif c in ")]}":
            profundidad -= 1
        elif c == "," and profundidad == 0:
            partes.append(actual.strip())
            actual = ""
            continue
        actual += c
    if actual.strip():
        partes.append(actual.strip())
    return partes


def modmask_y_tecla(combo):
    piezas = [p.strip() for p in combo.split("+") if p.strip()]
    if not piezas:
        return None
    tecla = piezas[-1]
    mascara = SUPER
    for pieza in piezas[:-1]:
        if pieza.upper() not in MODS:
            return None
        mascara += MODS[pieza.upper()]
    return f"{mascara}:{tecla.lower()}"


def generar():
    if not KEYBINDS.exists():
        return {}
    texto = KEYBINDS.read_text(encoding="utf-8")
    # keybinds.lua usa variables locales (term, files, browser, menu). El `eval`
    # del compositor no las conoce, asi que se resuelven aqui.
    locales = dict(re.findall(r'^local\s+(\w+)\s*=\s*"([^"]*)"', texto, re.M))
    mapa = {}

    for linea in texto.splitlines():
        limpia = linea.strip()
        if not limpia.startswith("bind("):
            continue
        cuerpo = cuerpo_de_llamada(limpia, limpia.index("("))
        if not cuerpo:
            continue
        args = separar_argumentos(cuerpo)
        if len(args) < 2:
            continue
        combo = args[0].strip()
        if not (combo.startswith('"') and combo.endswith('"')):
            continue  # combos calculados (el bucle de escritorios) van aparte
        accion = re.sub(r"^run\(", "hl.dsp.exec_cmd(", args[1].strip())
        if not accion.startswith("hl."):
            continue
        accion = re.sub(
            r"exec_cmd\((\w+)\)",
            lambda m: f'exec_cmd("{locales[m.group(1)]}")' if m.group(1) in locales else m.group(0),
            accion,
        )
        if re.search(r"exec_cmd\(\w+\)", accion):
            continue  # variable sin resolver: no publicar algo que fallaria
        if any(p in accion for p in PELIGROSOS):
            continue
        clave = modmask_y_tecla(combo.strip('"'))
        if not clave or "mouse" in clave:
            continue
        mapa.setdefault(clave, accion)

    # El bucle de escritorios de keybinds.lua no es una llamada literal.
    for i in range(1, 11):
        tecla = str(i % 10)
        mapa.setdefault(f"{SUPER}:{tecla}", f'hl.dsp.exec_cmd("~/.local/bin/tajo-ws.sh {i}")')
        mapa.setdefault(f"{SUPER + MODS['SHIFT']}:{tecla}", f"hl.dsp.window.move({{ workspace = {i} }})")

    return mapa


if __name__ == "__main__":
    mapa = generar()
    SALIDA.write_text(json.dumps(mapa, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(mapa)} atajos escritos en {SALIDA}")
