# Arranque sin panel en NEXO-Prueba · 2026-10-17

El dueño instaló 1.0.0 en la VM Windows NEXO-Prueba. El acceso del menú/escritorio
no mostraba ventana. Se diagnosticó mediante PowerShell Direct, con credenciales
introducidas por el dueño en el diálogo de Windows; no se guardaron contraseñas.

## Evidencia real

- Los cuatro componentes consultados existen bajo `C:\Program Files\NEXO`.
- Tarea NEXO: Running, principal Letzus, Interactive, Highest.
- `nexo-tray.exe` PID 7128 y Explorer PID 6332 están ambos en sesión 2.
- No hay proceso Node del servidor. El registro de bandeja sólo contiene:

```text
2026-10-17 11:08:02 nexo-tray arrancando (repo=C:\Program Files\NEXO)
2026-10-17 11:15:16 nexo-tray arrancando (repo=C:\Program Files\NEXO)
```

No se publicó la línea «panel disponible». Se descartó que la tarea estuviera
ejecutando la bandeja en otra sesión. El código iniciaba panel y supervisor sólo
en el callback onReady de systray. La biblioteca no llama ese callback si falla
initInstance/createMenu; escribe el error al logger estándar, que windowsgui no
estaba conservando. El registro viejo no permite afirmar qué llamada Win32 falló.

## Corrección preparada en 1.0.1

- Iniciar panel, supervisor y apertura solicitada de ventana antes de registrar
  la bandeja; un fallo del icono no impide disponer del panel/servidor.
- Conservar los errores de la biblioteca en `nexo-tray.log`, con Writer sincronizado.
- Registrar las etapas de arranque. Avisar si una tarea no publica panel en 40 s
  o si falla la apertura del navegador; ya no ignorar esos errores silenciosamente.
- `go test ./...` y `go vet ./...` pasan en native/tray. Nueva prueba verifica
  que se conserven tanto mensajes de aplicación como errores del logger estándar.

## Alcance y despliegue

El nuevo instalador se construye en dist con el mismo AppId y versión 1.0.1.
No se sustituyó el ejecutable instalado en la VM ni se detuvo su tarea.
Falta validar el arranque corregido en esa VM antes de declarar solucionado el caso.

La revisión automática rechazó un canal elevado de 15 minutos que también permitía
reemplazar el ejecutable: consideró el alcance mayor que el diagnóstico autorizado.
Se descartó ese canal y se continuó con consultas de sólo lectura, aprobadas.
Para probar una reparación concreta debe autorizarse detener únicamente la tarea
atascada de NEXO y actualizar su ejecutable, conservando respaldo y estado privado.
