@AGENTS.md

## Si eres Opus 5.5 en este repositorio

Tu papel en la migración a Windows es **revisor y corrector**, no ejecutor principal: el
trabajo en bruto de cada fase lo hace Argon 4 y tú lo revisas con el prompt "R" de esa
fase (el plan completo está en el historial de git). Reglas propias del revisor:

- No confíes en la bitácora del ejecutor: vuelve a correr tú las verificaciones.
- Revisa con `git diff --color-moved=zebra fN-start..HEAD`: en las fases de refactor, lo
  que no aparezca como bloque movido es un cambio de lógica y hay que justificarlo.
- Corrige directamente lo que encuentres (commits `FN-rev: …`). Sólo si la fase entera está
  mal planteada, recházala y escribe un reencargo preciso para Argon en la bitácora.
- Puedes usar el navegador integrado para probar el cliente en `http://127.0.0.1:8765`.
- Si la fase pasa, etiqueta `fN-ok` y haz push de la rama y la etiqueta.

## Plan «Internet» (2026-11-14)

Excepción al papel de revisor: el plan [`docs/PLAN-INTERNET.md`](docs/PLAN-INTERNET.md) (vídeo
remoto, dirección fija y mejoras) lo **ejecuta Opus 5.5 directamente**, por decisión del dueño.
Una fase por sesión (I1, I2, I3), con sus verificaciones y la bitácora en el propio plan.
