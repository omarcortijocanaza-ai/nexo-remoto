# NEXO · Matriz y prueba manual de teclado

## Matriz de compatibilidad

| Cliente | Keyboard Lock | Super remoto | Respaldo |
|---|---|---|---|
| Chrome/Edge · Windows | Compatible en pantalla completa, con atajos reservados por Windows | **AltGr (Alt derecho)** | Botón **SUPER** |
| Chrome/Edge · Linux | Compatible en pantalla completa | **AltGr (Alt derecho)** | Botón **SUPER** |
| Chrome/Edge · macOS | Compatible, sujeto a atajos reservados por macOS | Alt derecho | Botón **SUPER** |
| Firefox · Windows/Linux/macOS | Keyboard Lock no disponible | Alt derecho cuando el navegador lo entrega | Botón **SUPER** |

El panel **Diagnóstico** muestra el resultado real del navegador: `concedido`,
`no soportado`, `denegado` o `no solicitado`.

## Prueba manual M1

1. Abrir NEXO con su enlace autenticado y pulsar pantalla completa.
2. Abrir **Diagnóstico** y confirmar transporte, FPS, RTT, monitor y permiso de teclado.
3. Ejecutar `AltGr+Espacio`, `AltGr+Q`, `AltGr+E`, `AltGr+B`, `AltGr+1/2/3`
   y `AltGr+C` (cierra la ventana activa).
4. Confirmar que Windows/Super y Ctrl derecho siguen funcionando localmente. Como
   respaldo táctil, pulsar **SUPER** en la barra y luego la tecla.
5. Confirmar en Diagnóstico que cambia “Último evento”, sin que aparezca la tecla ni
   ningún texto escrito.

Las pruebas automatizadas se ejecutan con `npm test`.
