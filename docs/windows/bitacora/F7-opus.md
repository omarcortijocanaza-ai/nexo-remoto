# Bitácora Fase F7 — Revisión

- **Veredicto:** **APROBADO CON NOTAS** (falta la prueba 👤 con Discord y el teléfono real)
- `npm test`: **55/55** (dos ejecuciones).

## 1. Verificación (PC real; sin VB-CABLE instalado, sólo Voicemeeter VAIO)

El PC del dueño tiene Voicemeeter (no corriendo) y no «CABLE Input». Para no hacer sonar
nada por sus auriculares se usó `NEXO_MIC_DEVICE="Voicemeeter VAIO3 Input"` (salida
virtual sin motor detrás) y un «celular» simulado (`@roamhq/wrtc` + seno de 440 Hz por la
misma oferta `/microfono/oferta`).

| Comprobación | Resultado |
|---|---|
| Oferta con destino válido | `HTTP 200`, `/microfono/estado`: `conectado: true`, `activo: true`, `nivel ≈ 0,15` (= amplitud del seno) estable 8 s |
| Proceso lanzado | `nexo-agent.exe audio-play --match "Voicemeeter VAIO3 Input" --rate 48000 --channels 1` |
| Silenciar | `nivel = 0`, `silenciado: true`, `activo: true` y el `audio-play` **sigue vivo** («en uso») |
| Un segundo celular desconecta al primero | `reemplazado por otro dispositivo` en el registro; `/microfono/estado` pasa a la etiqueta del nuevo; un solo `audio-play` |
| `NEXO_MIC_DEVICE="NoExiste"` | arranque: aviso en el registro; oferta: `500` con el mensaje de VB-CABLE y el destino buscado; `/health` sigue `ok` |
| Valor por defecto («CABLE Input») sin VB-CABLE | `500 {"error":"VB-CABLE no está instalado: instala VB-Audio Virtual Cable y reinicia (ver PLAN-MIGRACION-WINDOWS.md, F0)"}` |
| Ningún camino al dispositivo por defecto | `audio-play` siempre lleva `--match` (prueba unitaria); un nombre vacío en la variable vuelve a «CABLE Input»; el agente sale con 3 si no hay coincidencia (`findRenderDeviceByMatch` no cae al predeterminado, leído en `audio_play.go`) |

## 2. Defecto encontrado en código común (corregido)

Ver F7-argon §1.2: el `closed` tardío del par viejo cerraba al par nuevo. Reproducido en
vivo (la oferta de reemplazo daba `500 … signalingState is 'closed'`) y corregido; tras el
arreglo el reemplazo da `200` a la primera. **Para la fase L:** el mismo retoque está en la
ruta de Linux (sólo añade `this.par === par`); probar «reconectar el celular mientras la
conexión anterior sigue colgada».

## 3. NO probado

- 👤 **Discord con «CABLE Output» como entrada, desde el celular por la URL de Internet,
  teléfono bloqueado un minuto, y `/microfono` sola.** Requiere instalar VB-CABLE (lo hace
  el dueño, sección 0 del plan) y un celular. Con Voicemeeter instalado puede usarse
  `NEXO_MIC_DEVICE="Voicemeeter Input"` y la entrada «Voicemeeter Out B1».
- Que la voz llegue de verdad al medidor de «CABLE Output»: depende del driver que no está.
  La cadena hasta `audio-play` está verificada; la escritura WASAPI es la de F3.
