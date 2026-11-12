# Aplicaciones oficiales del ASUS Zenbook Duo

Software que ASUS suele preinstalar en los Zenbook con Windows y qué función cumple cada uno.

> **Nota:** la lista está escrita de memoria, no se verificó contra la partición de Windows de este
> equipo (no estaba montada). Los nombres y la disponibilidad pueden variar según el modelo y la
> versión.

## Las más importantes en el Zenbook Duo

| Aplicación | Función |
|---|---|
| **ScreenXpert** | La propia del Duo: maneja las dos pantallas. Cambia entre disposiciones (dos pantallas en vertical, modo libro, modo portátil), organiza ventanas arrastrándolas, muestra el teclado en pantalla en la pantalla inferior cuando se quita el teclado y trae atajos de aplicaciones y un panel de control para la pantalla inferior. |
| **ASUS System Control Interface** | Servicio y controladores que hacen funcionar las teclas especiales (Fn, micrófono, brillo, tecla de pantalla inferior). Sin él esas teclas no hacen nada en Windows. |

## Mantenimiento y soporte

| Aplicación | Función |
|---|---|
| **MyASUS** | Actualiza drivers y BIOS, revisa el estado del equipo y la garantía, y ajusta la batería. Desde ahí se activa el límite de carga (p. ej. 80 %) y los modos de energía y de ventilador. |
| **Link to MyASUS** | Conecta el notebook con el teléfono: transferencia de archivos y espejo de pantalla. |

## Audio, cámara y otros

| Aplicación | Función |
|---|---|
| **Dolby Access / Dolby Audio** y **Realtek Audio Console** | Ecualizador y efectos de sonido. |
| **AI Noise-Canceling** y funciones de cámara | Cancelación de ruido del micrófono y efectos de videollamada. |
| **ASUS Pen** | Configuración del lápiz, si el modelo lo trae. |
| **GlideX** | Extender o duplicar la pantalla con otro dispositivo; solo en algunos modelos. |
| **Microsoft 365, McAfee y otras de terceros** | Pruebas comerciales. |

**Armoury Crate** es de la línea gaming (ROG y TUF); no viene en los Zenbook.

## Equivalentes en Linux

No hay equivalentes oficiales. Este proyecto cubre:

| Windows | Linux (este proyecto) |
|---|---|
| ScreenXpert | Pantalla inferior (`zenbook-lower-screen`), rotación (`zenbook-screen-rotation`), `move-window`, `swap-screens`, `drag-to-screen` |
| ASUS System Control Interface | Teclas F4 a F12 (`zenbook-hotkeys`), bloqueo Fn (`zenbook-fn-lock`), micrófono (`zenbook-microphone`), brillo (`zenbook-brightness`, `monitor-brightness`) |
| MyASUS (límite de carga) | Extensión `battery-charge-limit` (UPower) |
| MyASUS (batería de periféricos) | Extensión `bluetooth-battery` |

`asusctl` (`asusd`) existe, pero soporta sobre todo equipos ROG y TUF; en este equipo la batería la
gestiona UPower.
