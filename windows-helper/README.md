# Puente de teclado NEXO para Windows

NEXO usa **AltGr (Alt derecho)** como Super remoto. La tecla Windows y Ctrl derecho
conservan su comportamiento normal y el puente no los intercepta. El ejecutable sólo
protege atajos que Windows o Chrome reservan (`Alt+Tab`, `Alt+F4` y
`Ctrl+Shift+C/V`) mientras una ventana cuyo título contenga
`Nexo — Control remoto` esté al frente.

## Uso

1. Descarga `nexo-super-bridge.exe` desde el botón **WIN** de NEXO.
2. Ejecuta el archivo. No necesita permisos de administrador.
3. Mantén abierta la pequeña consola mientras uses NEXO.
4. Enfoca NEXO y usa `AltGr+Espacio`, `AltGr+1`, `AltGr+Q`, etc. El puente no es
   necesario para estas combinaciones.
5. Cierra la consola para desactivar el puente inmediatamente.

Windows o SmartScreen pueden advertir que el ejecutable no tiene firma comercial.
El código fuente completo está en `main.go`. No guarda ni transmite texto o teclas.

El puente también entrega **Alt+Tab** y **Alt+F4** a la sesión remota. Atajos
seguros del sistema como `Ctrl+Alt+Supr` no pueden redirigirse.
