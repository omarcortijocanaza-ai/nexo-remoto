# Bitácora Fase F10 — Ejecución

- **Fase:** F10 · Documentación y prueba de humo
- **Rama:** `windows-port` · **Inicio:** `f10-start` (`12bf01e`)
- **Quién:** ejecutada directamente por Claude (ver F6).

## 1. Archivos

- `README-WINDOWS.md` (nuevo): requisitos, instalación desde cero, uso diario (bandeja y
  `nexo-control`), emparejar, micrófono con Discord, variables, límites conocidos, solución de
  problemas, dónde viven los datos, pruebas y desinstalación.
- `scripts/windows/smoke.ps1` (nuevo): instancia aparte (estado temporal, otro puerto, modo
  local, credenciales de la prueba por stdin) → empareja por token con cookie → login →
  `/info` → `/diagnostics` (`platform = windows`) → `/screen` JPEG (`FF D8`) → texto por
  `/input` en el Bloc de notas leído por portapapeles → parada ordenada → no quedan procesos
  → registro sin `token=`. `-SinEntrada` omite el paso del Bloc de notas; ese paso **no teclea
  nada si no consigue poner el Bloc de notas al frente**.
- `PROGRESO.md`: sección «Windows» (hecho / pendiente con 👤). `README.md`: párrafo inicial y
  dos filas de la tabla «Qué documento sirve para qué». `PLAN-MIGRACION-WINDOWS.md`: §11.
- `launcher.js`: corrige que la rotación del token se deshacía al apagar (ver F10-opus).

## 2. Dudas

- Ninguna bloqueante.
