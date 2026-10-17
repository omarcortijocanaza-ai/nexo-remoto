# Bitácora Fase F8 — Revisión

- **Veredicto:** **APROBADO CON NOTAS** (faltan las pruebas 👤 por datos móviles y la
  del reinicio/cierre de sesión de Windows)
- `npm test`: **61/61** (dos ejecuciones). Incluye una prueba de integración que arranca
  el lanzador real, lanza un segundo, comprueba el registro y hace `--stop`.

## 1. Verificación (estado y registros temporales, PC real)

| Comprobación | Resultado |
|---|---|
| `nexo-control start → status → link → pair → restart → stop` | todo OK; `start` muestra accesos, `pair` da `XXXX-XXXX`, `status` sale 1 si está detenido |
| Tras `stop` (modo local y modo both) | 0 procesos de NEXO (node, agente, puente, ffmpeg, cloudflared) |
| **Matar sólo el lanzador a lo bruto** | los hijos mueren solos en < 5 s (cierre del canal IPC); el siguiente `start` arranca sin `EADDRINUSE` |
| **Matar lanzador + servidor + GPU a la vez** (`-Force`, sin árbol) | ninguno sobrevive (agente y puente por stdin EOF; ffmpeg por el RTP sin destino) |
| Huérfano fabricado (`nexo-agent.exe serve` suelto) | el siguiente arranque: «Limpieza: matando nexo-agent.exe huérfano (PID …)» |
| Dos `nexo-control start` seguidos / segundo `node launcher.js` a mano | un solo lanzador; el segundo imprime «NEXO ya está activo», sale 0 y **no borra** el archivo de PIDs del primero |
| `Select-String … -Pattern 'token=(?!\*\*\*)'` sobre los registros | **sin resultados**; las líneas «LOCAL/INTERNET» quedan `?token=***` |
| **Modo remoto real** (TryCloudflare) | URL publicada en el estado; `https.get(url/health)` → **200**; el vigilante ya no depende de una IP fija |
| `nexo-doctor` | tabla de OK/AVISO/FALLA; no imprime el token; detecta ACL, firewall Público, tarea, VB-CABLE, cadena GPU, elevación, puertos reservados |
| `nexo-avisar-enlace.ps1` contra un servidor ntfy falso | `prueba` (sin enlace), `ahora` y `vigilar` (avisa una vez, no repite); el registro lleva `token=***` |
| `credentials set` | la contraseña viaja por stdin: el proceso hijo muestra `auth-manager.js set Letzus` sin ella; se verificó el hash resultante. **La entrada interactiva (`Read-Host -AsSecureString`) no se pudo ejercitar sin terminal**; no entra en el historial de PSReadLine por construcción |

## 2. Defectos propios corregidos durante la revisión

- `Start-Process` no admite el mismo destino para stdout y stderr → stderr a un archivo
  vaciado en cada arranque.
- Un segundo lanzador borraba el archivo de PIDs del primero al salir → sólo limpia quien
  tomó el bloqueo.
- Sin consola, «NEXO ya está activo» no salía por una tubería → `respuesta()` siempre a stdout.
- El doctor confundía las reglas «nexo-gpu-webrtc» que crea el aviso de Windows (perfil
  Público) con las «NEXO …» del instalador → comparación sensible a mayúsculas.

## 3. Para la fase L (Linux)

`launcher.js` cambia en Linux sólo en: (a) salida enmascarada si stdout no es TTY,
(b) vigilante del túnel sin IP fija, (c) `windowsHide` (ignorado), (d) reorganización a
`emit/linea/lineaError`. Comprobar: `nexo-control start/stop`, enlaces completos en una
terminal, `nexo-runtime.log` sin token, y que `server.js` sigue apagándose con SIGTERM.

## 4. NO probado

- 👤 **Datos móviles** (Wi-Fi apagado): abrir el enlace de Internet y anotar si dice GPU o
  respaldo JPEG (decide O1). No hay celular aquí.
- Reinicio de Windows con NEXO activo y cierre de sesión (estado sucio): no se reinicia el
  PC del dueño; el estado sucio se simuló matando procesos (arriba).
- `curl` de Windows no alcanzó el túnel desde esta PC (IPv6 primero, sin salida IPv6);
  Node y el navegador sí. No es un fallo de NEXO, pero conviene saberlo al diagnosticar.
