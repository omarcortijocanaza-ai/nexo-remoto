# Control desde el celular · actualización 1.0.4

Pensado para manejar programas con el celular horizontal. La resolución y la
configuración del escritorio remoto no se cambian: el zoom es sólo de la imagen
que ve cada cliente.

## Controles

- Pellizcar con dos dedos amplía hasta 4×. Mover ambos dedos desplaza el encuadre.
  No se generan clics remotos durante ese gesto ni al levantar el dedo restante.
- **Doble toque con dos dedos** o **Ver todo** restablece zoom y encuadre. Mientras está ampliado indica el porcentaje.
- El botón de modo alterna **Táctil → Touchpad → Directo**.
- **Táctil:** toque para clic, deslizamiento para scroll, pulsación larga para clic derecho.
- **Touchpad:** desliza para mover un cursor relativo; toca para clic. Para arrastrar,
  da dos toques con un dedo y desliza manteniendo el segundo. Mantén pulsado para
  clic derecho. Se retiró la tira flotante de tres controles.
- **Directo:** permite arrastrar objetos tocándolos en la imagen.
- **Más → Scroll táctil:** Suave, Normal o Rápido. La preferencia y el modo se
  conservan en el navegador de ese dispositivo.
- Sonido y micrófono siguen en **Más** en celular. En computadora conservan
  sus controles de barra. La barra horizontal móvil muestra cuatro acciones.

El scroll mantiene como destino el punto donde comenzó el gesto, evita inercia
si se mantuvo quieto antes de soltar y se interrumpe al volver a tocar. Se pueden
descartar órdenes HTTP aún pendientes, pero no retirar eventos ya entregados
al equipo remoto ni eliminar el retraso del vídeo por Internet.

El panel de teclado de NEXO acompaña la rotación manual de 90°, 180° y 270°.
El teclado nativo de Android/iOS depende de la orientación física del dispositivo.
Al abrir el teclado se reserva espacio para él y se conserva el tamaño de lectura
dentro del límite de zoom. Al cerrarlo se restaura el espacio. Ocultar la página,
cancelar el gesto o cambiar de modo libera los botones remotos que mantenía pulsados.

## Actualizar una instalación de la VM

Usa `dist/NEXO-Setup-1.0.4-x64.exe` dentro de la VM, después de salir de NEXO desde
su bandeja. Instala sobre la versión previa y recarga la página del celular.
No es necesario compilar en la VM. No se ha actualizado automáticamente su instalación.

## Validación de esta entrega

- 129 pruebas Node satisfactorias, incluida geometría con DOMRect realista,
  multitáctil, cancelación, destino del scroll, inercia, touchpad y teclado.
- Verificación visual en navegador a 844×390 con escritorio de demostración;
  comprobados teclado girado a 90°, 180° y 270° y ausencia de controles flotantes.
- Paquete final: 2675 archivos íntegros; Node/WebRTC/PowerShell/túnel/ICO comprobados.
- Servidor del paquete: HTTP de salud, cliente, imágenes, CSS, scripts y fuente.

Falta probar ergonomía, teclado del sistema y gestos con dedos reales en Android/iOS,
incluidas conexiones con latencia. La demostración no captura ni controla el escritorio.
