# Omisión de recursos en instaladores 1.0.0/1.0.1 · 2026-10-17

El dueño aportó el error real del servidor instalado en la VM:
`ENOENT assets/viego-mist-keyboard.webp`, server.js:63. La lista positiva del
empaquetador copiaba assets/fuentes y assets/viego, pero omitía dos archivos
que server.js lee obligatoriamente al arrancar:

- assets/viego-mist-keyboard.webp
- assets/viego-wallpaper.webp

Es un fallo de empaquetado. La integridad del manifiesto sólo probaba archivos
incluidos; no detectaba los omitidos. Las pruebas HTTP del checkout tampoco
detectaban que el instalador carecía de recursos existentes en el repositorio.

## Corrección 1.0.2

Se incluyen explícitamente ambos archivos. El empaquetador ejecuta antes de ISCC
verify-package.js y la nueva smoke-package.js, arrancando server.js DEL PAQUETE
con su Node/dependencias reales. Se exige 200 en salud, cliente, imágenes, CSS,
JS y fuente. Se simula sólo el adaptador del escritorio para no acceder a la PC
real; estado y puerto son temporales. El hijo se cierra al terminar.

La prueba se ejecutó primero sobre el paquete 1.0.1 SIN alterarlo y reprodujo
el mismo ENOENT con salida 1. La nueva construcción debe superar esa prueba
automáticamente; no basta con que Go compile o npm test pase.

No se modificó ni detuvo la instalación de la VM. La aceptación multimedia real
queda a continuación de la actualización; esta comprobación valida arranque HTTP
y recursos, no captura de vídeo, audio, túnel ni GPU del invitado.
