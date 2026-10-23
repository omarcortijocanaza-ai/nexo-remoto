# O3 · Segunda sesión aislada en Windows (investigación)

> **Estado:** investigación terminada el 2026-10-17. **No se implementó nada**: el plan (§ O3, D11) pide
> que la decisión sea de Letzus. Aquí están las opciones, lo que se midió en esta PC y la recomendación.

## Qué se busca

En Linux, «NEXO independiente» es una segunda sesión gráfica (usuario `nexo`, Hyprland aislado): el
dueño sigue usando su escritorio mientras otra persona trabaja en el suyo, y las dos se ven sin tocarse.
Windows 10/11 sólo da **una sesión interactiva** a la vez en una edición de cliente; sin una segunda
sesión, quien controla NEXO desde el celular **comparte** el escritorio con quien está sentado frente a la PC.

**Prohibido** (decisión D11): parchear `termsrv.dll` o usar RDP Wrapper. Rompe la licencia de Windows y
se estropea con cada actualización.

## Lo medido en esta PC (sólo lectura)

| Dato | Valor |
|---|---|
| Windows | 11 Pro (Professional) 25H2, compilación 26200.9711 |
| Virtualización en el firmware | **Activada** (CPU Ryzen 5 3600, con SLAT) |
| Hyper-V | Servicio `vmcompute` **instalado pero detenido**; no hay hipervisor en marcha (hay que activar la característica y reiniciar) |
| Windows Sandbox | **No instalado** |
| RAM | 32 GB |
| GPU | RTX 3060 Ti, controlador 32.0.16.1664 |

Con Windows 11 Pro y la virtualización encendida, Hyper-V es técnicamente posible aquí. No se activó nada.

## Opciones

### A · Monitor virtual en la misma sesión (driver de pantalla indirecto)

Un driver IddCx de código abierto ([Virtual-Display-Driver](https://github.com/itsmikethetech/Virtual-Display-Driver))
crea monitores que Windows cree reales, hasta 8K y 500 Hz según su documentación. NEXO ya sabe capturar
cualquier monitor (`output_idx`) y cambiar de uno a otro sin renegociar (F5).

- **Qué da:** el celular trabaja en un monitor que el dueño no mira (incluso sin monitor físico enchufado). Las ventanas
  que se arrastran allí no estorban en su escritorio. La captura es la misma `ddagrab`/NVENC de siempre.
- **Qué NO da:** aislamiento. Es la misma sesión, el mismo ratón, el mismo teclado y los mismos programas: si el dueño pulsa
  una tecla, la recibe la ventana activa, esté en el monitor que esté. No es una segunda sesión.
- **Coste:** bajo (instalar un driver de terceros y comprobar que `ddagrab` lo captura a 60 FPS). Reversible.
- **Riesgo:** un driver de terceros en el sistema; hay que revisar su firma y su procedencia antes de instalarlo.
- **Sin probar aquí:** instalar un controlador es un cambio de sistema que debe hacer el dueño.

### B · Máquina virtual de Hyper-V (Windows con licencia propia, o Linux)

Aislamiento real: otro sistema, otra sesión, otro escritorio. Dentro puede correr un Windows con su licencia, o el
**NEXO independiente de Linux** que ya existe.

- **Problema principal: la GPU.** El reparto de GPU para máquinas virtuales (GPU-P) lo soporta Microsoft oficialmente en
  Windows Server 2025 y posteriores, no en un host Windows 11 Pro ([fuente secundaria](https://www.thewindowsclub.com/enable-gpu-partitioning-gpu-p-in-hyper-v-on-windows);
  hay que confirmarlo en la documentación de Microsoft). Hay guías de la comunidad ([Easy-GPU-P](https://github.com/vadash/Easy-GPU-P)),
  pero **ninguna fuente consultada confirma NVENC dentro del invitado**. Sin NVENC, el vídeo de la VM iría por CPU
  (el respaldo VP8/JPEG de NEXO), claramente peor que el de hoy.
- **Coste:** alto (activar Hyper-V, crear y mantener la VM, licencia si es Windows, reparto de RAM y CPU con el uso diario).
- **Veredicto:** sólo si hace falta aislamiento de verdad y se acepta vídeo por CPU.

### C · Windows Sandbox

Escritorio desechable que se borra al cerrarlo. Admite GPU virtualizada con `<vGPU>Enable</vGPU>` en un archivo `.wsb`
([documentación de Microsoft](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)).
No está instalado y **no sirve como escritorio de trabajo**: no conserva nada. Útil, como mucho, para probar algo sin riesgo.

### D · Sesiones RDP simultáneas con parche (RDP Wrapper / `termsrv.dll`)

Descartada por la decisión D11: viola la licencia y se rompe en cada actualización de Windows.
Las guías que existen lo reconocen ([ejemplo](https://www.serverwatch.com/guides/multiple-remote-desktop-sessions-windows-10)).

### E · Rutas con licencia (Windows Enterprise multisesión, Azure Virtual Desktop, Windows 365)

Son la forma legal de tener varias sesiones, pero implican suscripción o una edición que esta PC no tiene. Fuera de alcance
para un uso doméstico.

### F · Reiniciar en Linux

Ya existe y funciona (rama `main`): «NEXO independiente» con sesión aislada. No es simultáneo con Windows (arranque dual).

## Recomendación

1. **Probar A** (monitor virtual) si lo que importa es **no estorbar al dueño** y trabajar en un monitor propio del celular.
   Es lo más barato y no cambia la arquitectura. Si el aislamiento total no es imprescindible, probablemente basta.
2. **B sólo con aislamiento real como requisito**, aceptando vídeo por CPU y el coste de mantener una VM.
3. **No hacer** C (no persiste) ni D (licencia).
4. Cuando el dueño decida, esta fase pasa a ser de implementación con su propia bitácora; mientras tanto, no se toca código.

## Qué decide el dueño

- ¿Basta un monitor virtual (A), o hace falta aislamiento real (B)?
- Si A: ¿instalo un driver de terceros? (lo instala él, tras revisar el proyecto y su firma).
- Si B: ¿activar Hyper-V (requiere reiniciar) y con qué sistema dentro?
