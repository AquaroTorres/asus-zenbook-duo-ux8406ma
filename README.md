# ASUS Zenbook Duo (UX8406MA) en Linux

Un script por función para controlar el Zenbook Duo en Manjaro/Arch con GNOME
(Wayland), más siete extensiones de GNOME Shell. Cada script es independiente y
se puede usar solo.

> **Aviso:** probado únicamente en un **ASUS Zenbook Duo UX8406MA** con **Manjaro** y **GNOME 50 (Wayland)**.
> Otros modelos, distribuciones o versiones de GNOME pueden no funcionar, y los instaladores modifican el
> sistema (`/usr/local/bin`, sudoers, udev, y con `install-lower-screen-edid.sh` el initramfs y GRUB). Revisa
> los scripts antes de ejecutarlos. Se ofrece sin garantía, bajo licencia GPL-3.

Detalles técnicos y decisiones de diseño: [AGENTS.md](AGENTS.md).

## Resumen: qué hace cada pieza

### Scripts (`scripts/`)

| Script | Qué hace |
|---|---|
| `zenbook-keyboard-backlight` | Cambia o cicla el nivel de luz del teclado (0 a 3), por USB y Bluetooth, y lo muestra en el indicador inferior |
| `zenbook-keyboard-backlight-sleep` | Hook de suspensión: apaga la luz del teclado al suspender y la restaura al despertar al mismo nivel que tenía |
| `zenbook-lower-screen` | Enciende, apaga o alterna la pantalla inferior |
| `zenbook-keyboard-monitor` | Servicio: apaga la pantalla inferior con el teclado por USB y la enciende con Bluetooth o sin teclado; reaplica el bloqueo Fn y la luz de F9 cuando el teclado aparece. No toca la luz del teclado |
| `zenbook-hotkeys` | Servicio: escucha F4, F5, F6, F8, F9, Fn+Esc y la tecla de pantalla, y ejecuta la acción de cada una |
| `zenbook-brightness` | Sube, baja o fija el brillo de ambas pantallas, o las sincroniza |
| `zenbook-microphone` | Silencia o activa el micrófono y mantiene la luz de F9 sincronizada (servicio con `watch`) |
| `zenbook-fn-lock` | Activa, desactiva, alterna o lee el bloqueo Fn del teclado |
| `zenbook-swap-screens` | Intercambia las ventanas entre las dos pantallas (F8); no hace nada con la inferior apagada |
| `zenbook-screen-rotation` | Rota las pantallas a mano o automáticamente con el acelerómetro (servicio con `auto`) |
| `zenbook-touchscreen` | Asigna cada touchscreen a su pantalla |
| `zenbook-bluetooth` | Enciende, apaga o alterna el Bluetooth |
| `zenbook-bluetooth-keyboard` | Conecta o empareja el teclado Bluetooth |
| `zenbook-bluetooth-windows-sync` | Copia a Linux el emparejamiento del teclado que Windows tiene ahora (dual boot): elige la entrada más reciente y la instala en BlueZ |
| `zenbook-wifi` | Enciende, apaga o alterna el WiFi |
| `zenbook-keymap` | Herramienta de diagnóstico: captura qué envía cada tecla de función (USB y Bluetooth) |

### Extensiones de GNOME Shell (`gnome-extension/`)

| Extensión | Qué hace |
|---|---|
| `on-screen-display` | Muestra el indicador inferior (como el del volumen) cuando cambian la luz del teclado, el brillo, el micrófono, el bloqueo Fn o la pantalla inferior |
| `lower-screen` | Botón "Pantalla inferior" en Ajustes rápidos para encenderla o apagarla |
| `screen-rotation` | Botón con menú en Ajustes rápidos: rotación normal, izquierda, derecha, invertida y automática |
| `auto-brightness` | Botón en Ajustes rápidos para activar o desactivar el brillo automático de GNOME |
| `battery-charge-limit` | Botón en Ajustes rápidos para quitar o volver a poner el límite de carga de la batería, y cargar hasta el 100 % |
| `swap-screens` | Mueve las ventanas entre pantallas cuando `zenbook-swap-screens` se lo pide (sin icono) |
| `drag-to-screen` | Al arrastrar una ventana muestra, unos 100 px debajo del puntero, cuatro disposiciones por pantalla (entera, mitades verticales, mitades horizontales, cuartos); soltarla sobre una zona la manda allí y la redimensiona |

### Servicios (`systemd/user/`)

Son servicios de usuario; `install-scripts-services-extensions.sh` los instala y los deja activos.

| Servicio | Ejecuta | Qué hace |
|---|---|---|
| `zenbook-hotkeys` | `zenbook-hotkeys watch` | Escucha las teclas especiales (F4, F5, F6, F8, F9, Fn+Esc y la tecla de pantalla) y lanza su acción |
| `zenbook-keyboard-monitor` | `zenbook-keyboard-monitor watch` | Vigila la conexión del teclado: apaga o enciende la pantalla inferior y reaplica el bloqueo Fn y la luz de F9 |
| `zenbook-microphone` | `zenbook-microphone watch` | Mantiene la luz de F9 sincronizada con el estado del micrófono |
| `zenbook-screen-rotation` | `zenbook-screen-rotation auto` | Rota las pantallas según el acelerómetro |

## Instalación

Instalación completa, en el orden correcto (es idempotente: se puede repetir):

```bash
./install-all.sh
```

En una instalación limpia se ejecuta **dos veces**:
1. La primera instala todo y el EDID de la pantalla inferior, y pide **reiniciar**.
2. Tras reiniciar y volver a entrar, la segunda habilita las extensiones (GNOME no las conoce
   hasta iniciar sesión de nuevo) y deja el inicio de sesión con tu disposición de pantallas.
   Antes de esa segunda pasada, deja la pantalla inferior debajo de la superior y con la escala que quieras.

Al final lista lo que falte. Orquesta los tres instaladores, que también se pueden usar por separado:

| Instalador | Qué hace |
|---|---|
| `install-scripts-services-extensions.sh` | Scripts, servicios, extensiones, sudoers y regla udev |
| `install-lower-screen-edid.sh` | EDID de la pantalla inferior (initramfs y GRUB); requiere reiniciar |
| `install-login-screen-layout.sh` | Disposición de las pantallas en el inicio de sesión (GDM); repítelo si cambias la escala |

`install-all.sh` además desactiva el brillo automático de GNOME, porque pelea con F5/F6.

`install-scripts-services-extensions.sh` hace lo siguiente:
- instala dependencias con `pacman` (`python-pyusb`, `inotify-tools`, `iio-sensor-proxy`, `xorg-xinput`, `bluez-utils`);
- copia `scripts/zenbook-*` a `/usr/local/bin`;
- crea `/etc/zenbook-duo.conf` (si no existe);
- crea `/etc/sudoers.d/zenbook-duo` (la luz del teclado necesita root);
- instala la regla udev de hidraw y te agrega al grupo `input`;
- instala los servicios de usuario y activa `zenbook-hotkeys`, `zenbook-screen-rotation`, `zenbook-microphone` y `zenbook-keyboard-monitor`;
- instala y habilita las siete extensiones.

No instala el EDID personalizado ni toca GRUB/initramfs: eso lo hace `./install-lower-screen-edid.sh` (ver [Touchscreens](#zenbook-touchscreen)).

## Pantallas en el inicio de sesión (GDM)

El Zenbook Duo tiene las dos pantallas fijas, una sobre la otra, y la de arriba debe ser siempre la
principal. GNOME lo guarda en `~/.config/monitors.xml`, pero la pantalla de inicio de sesión (GDM)
**no lee ese archivo**: sin uno propio, coloca las pantallas una al lado de la otra, y solo al
iniciar sesión pasan a su sitio. Para corregirlo:

```bash
./install-login-screen-layout.sh
```

Toma de tu `monitors.xml` la configuración de exactamente `eDP-1` y `eDP-2` (con el serial del EDID
personalizado de `install-lower-screen-edid.sh`), comprueba que `eDP-1` es la principal y `eDP-2` está justo
debajo, y la copia a `/var/lib/gdm/seat0/config/monitors.xml`. Es idempotente; vuelve a ejecutarlo si
cambias la escala. Se aplica la próxima vez que aparezca el greeter (cierra sesión o reinicia).

## Configuración

Los parámetros que pueden variar entre equipos están en
[`zenbook-duo.conf`](zenbook-duo.conf), que se instala en `/etc/zenbook-duo.conf`.
Todo es opcional: si falta el archivo o una variable, cada script usa su valor
por defecto.

| Variable | Por defecto | Para qué |
|---|---|---|
| `MONITOR_UPPER` / `MONITOR_LOWER` | `eDP-1` / `eDP-2` | Conectores (`gdctl show`) |
| `BRIGHTNESS_STEP` / `BRIGHTNESS_MIN` | `5` / `4` | Paso de F5/F6 (% del máximo) y brillo mínimo (valor crudo) |
| `BACKLIGHT_UPPER` / `BACKLIGHT_LOWER` | `intel_backlight` / `card1-eDP-2-backlight` | Backlights en `/sys/class/backlight/` (el segundo depende del número de `card`) |
| `KB_NAME` | `Zenbook Duo` | Texto que identifica al teclado |
| `KB_USB_ID` | `0b05:1b2c` | Vendor:Product del teclado por USB (`lsusb`) |
| `KB_STATE_FILE` | `/tmp/kb-backlight-level` | Dónde se guarda el nivel de luz |
| `KB_ABSENT_DELAY` | `3` | Segundos extra que `zenbook-keyboard-monitor` espera antes de dar el teclado por desconectado (al despertar tarda en volver). Solo retrasa encender la pantalla inferior al desenchufar el USB sin Bluetooth |
| `KB_EVENT_DELAY` | `0.3` | Segundos que `zenbook-keyboard-monitor` espera tras un evento del teclado antes de decidir USB/BT/desconectado. Menos = más rápido; muy bajo puede actuar a mitad del enchufe |
| `BT_SCAN_SECONDS` | `15` | Duración del escaneo en `zenbook-bluetooth-keyboard` |
| `BT_KB_PATTERN` | `zenbook duo keyboard\|ASUS Keyboard` | Nombre del teclado BT (`grep -i`) |
| `TOUCH_UPPER_NAME` / `TOUCH_LOWER_NAME` | `ELAN9008:00 04F3:425B` / `ELAN9009:00 04F3:425A` | Nombres xinput de los touchscreens |
| `TOUCH_UPPER_ID` / `TOUCH_LOWER_ID` | `04f3:425b` / `04f3:425a` | IDs USB de los touchscreens |
| `PANEL_VENDOR` / `PANEL_PRODUCT` | `SDC` / `419d` | EDID de los paneles |
| `PANEL_LOWER_SERIAL` | `eDP-2` | Serial del EDID personalizado de eDP-2 |

El archivo debe pertenecer a root: `zenbook-keyboard-backlight` lo lee estando como root.

## Funciones

### `zenbook-keyboard-backlight`: luz del teclado
```
zenbook-keyboard-backlight [0|1|2|3|cycle|status]
```
Cambia el nivel (0 apagada, 1 baja, 2 media, 3 alta). `cycle` pasa al siguiente.
`status` muestra si el teclado está conectado y el nivel guardado. Funciona por
USB y por Bluetooth (por hidraw, sin desacoplar el driver del teclado). Se auto-eleva con `sudo -n`, por eso necesita la entrada
de sudoers. Al cambiar el nivel (F4 o cualquier llamada) muestra el indicador inferior
de GNOME: el texto "Luz del teclado" y el nivel en la barra (vía `on-screen-display`).

### `zenbook-keyboard-backlight-sleep`: luz del teclado al suspender
No se ejecuta a mano: `systemd-sleep` lo llama como root al suspender o hibernar (el instalador lo
enlaza en `/usr/lib/systemd/system-sleep/`).

- **Al suspender:** guarda el nivel actual y apaga la luz.
- **Al despertar:** restaura **ese mismo nivel**, no uno fijo. El teclado puede tardar en volver
  (el Bluetooth se reconecta, el USB se reenumera), así que reintenta hasta unos 25 s desde una unidad
  transitoria de systemd (`zenbook-keyboard-backlight-restore`) y no retrasa el despertar.
- Si no conoce el nivel (por ejemplo, tras reiniciar y sin haberlo cambiado), no toca nada.

### `zenbook-lower-screen`: pantalla inferior
```
zenbook-lower-screen [on|off|toggle|status]
```
Enciende o apaga eDP-2 (debajo de eDP-1, con la misma escala). `on` y `off` no hacen nada si la pantalla ya está en ese estado (no reordenan ventanas ni repiten el aviso) y **conservan la rotación actual**: con las pantallas en vertical, apagar y encender la inferior las deja en vertical y dispuestas igual que `zenbook-screen-rotation`. Al encenderla reaplica el mapeo de
touchscreens y muestra "Pantalla inferior: encendida|apagada" (el icono sale atenuado cuando está
apagada). Solo cambia la pantalla: quién decide cuándo es `zenbook-keyboard-monitor`; la tecla
dedicada usa `toggle`.

### `zenbook-keyboard-monitor`: vigilar la conexión del teclado
```
zenbook-keyboard-monitor [watch|status]
```
Servicio de usuario que escucha udev y reacciona a cómo está conectado el teclado:

| Teclado | Pantalla inferior |
|---|---|
| USB (sobre la pantalla) | apagada |
| Bluetooth | encendida |
| Desconectado | encendida |

**No toca la luz del teclado**: se queda como estaba.

Además, cada vez que el teclado aparece (también si reaparece sin cambiar de bus, p. ej. al reanudar
de la suspensión), reaplica lo que el teclado olvida: el bloqueo Fn en `off` (sin él F4, F5, F6, F8
y F9 no llegan como acciones) y la luz de F9. Espera a que exista el nodo hidraw antes de enviar y no
repite más de una vez cada 5 s. Al arrancar sincroniza la pantalla según el bus actual.
`status` imprime `usb`, `bt` o `none`.

### `zenbook-screen-rotation`: rotación
```
zenbook-screen-rotation [normal|left|right|inverted|auto|status]
```
Rota las dos pantallas juntas (en horizontal las ordena una al lado de la
otra). `auto` lee el acelerómetro con `monitor-sensor` y rota solo; se queda
corriendo.

### `zenbook-brightness`: brillo
```
zenbook-brightness [status|set <1|2> <valor>|up [%]|down [%]|sync|watch]
```
Brillo de eDP-1 (1) y eDP-2 (2), valores de 4 a 400. `up` y `down` suben o bajan
ambas pantallas `BRIGHTNESS_STEP` % (5 por defecto) partiendo del brillo de eDP-1.
`sync` iguala eDP-2 a eDP-1; `watch` lo hace automáticamente cada vez que cambia eDP-1. Se aplica por
logind, sin root.

### `zenbook-touchscreen`: mapeo de touchscreens
```
zenbook-touchscreen [setup]
```
Asigna cada touchscreen ELAN a su pantalla con `gsettings` (apps Wayland) y
`xinput` (XWayland). Para que GNOME distinga los paneles hace falta el EDID
personalizado `edp2.bin` (serial `"eDP-2"`), cargado con
`drm.edid_firmware=eDP-2:/lib/firmware/edid/edp2.bin` e incluido en el
initramfs. `./install-lower-screen-edid.sh` lo instala (copia `edid/edp2.bin`, lo incluye en el
initramfs y agrega el parámetro a GRUB); es idempotente y requiere reinicio.

### `zenbook-hotkeys`: teclas especiales
```
zenbook-hotkeys [watch|find]
```
Escucha las teclas que no son `KEY_*` estándar y ejecuta su acción (con el bloqueo Fn
en `off`, las teclas F llegan así):

| Tecla | Acción |
|---|---|
| Tecla de pantalla inferior | `zenbook-lower-screen toggle` |
| F4 | `zenbook-keyboard-backlight cycle` (luz del teclado) |
| F5 / F6 | `zenbook-brightness down` / `up` (indicador con barra de brillo) |
| F9 | `zenbook-microphone toggle` (micrófono + luz de la tecla + indicador) |
| F8 | `zenbook-swap-screens` (intercambia las ventanas entre las dos pantallas) |
| Fn+Esc | `zenbook-fn-lock toggle` (verificado solo por USB) |

F4, F5, F6, F8 y F9 funcionan solo con el bloqueo Fn en `off` (`zenbook-fn-lock off`); con él en
`on` esas teclas emiten `KEY_F4..F6` y la acción es Fn+tecla, que GNOME no maneja.
`watch` funciona; `find` lista los nodos donde se detecta la tecla.
Por Bluetooth llega como evento evdev y por USB como reporte hidraw (necesita
la regla udev). Corre como servicio de usuario.

### `zenbook-bluetooth`: Bluetooth
```
zenbook-bluetooth [on|off|toggle|status]
```

### `zenbook-bluetooth-keyboard`: teclado Bluetooth
```
zenbook-bluetooth-keyboard
```
Conecta el teclado BT. Si no está emparejado lo busca durante
`BT_SCAN_SECONDS` y abre una terminal para el emparejamiento con PIN.

### `zenbook-bluetooth-windows-sync`: emparejamiento compartido con Windows
```
zenbook-bluetooth-windows-sync [--dry-run] [--force] [--name TEXTO]
```
El teclado guarda **un solo** emparejamiento y cambia de dirección cada vez que se empareja de nuevo, así
que al emparejarlo en Windows, Linux lo pierde. Este script lee el registro de Windows (una **copia**: no
escribe en esa partición), elige la entrada con ese nombre de **uso más reciente** (puede haber varias),
convierte las claves y las instala en BlueZ. Antes hace una copia de seguridad (en
`~/.local/state/zenbook/`, se conservan las 3 últimas), y al terminar BlueZ queda encendido pase lo que pase.

- `--dry-run` muestra qué haría. Si ya está sincronizado no hace nada (`--force` reinstala).
- **Otros dispositivos:** `--name TEXTO` elige qué dispositivo de Windows copiar, p. ej.
  `zenbook-bluetooth-windows-sync --name "BT5.0 Mouse"` (el ratón BT5 de Windows). Maneja vínculos Secure
  Connections (teclado) y heredados (ratón); como plantilla usa la entrada actual, una del mismo nombre
  o una del mismo fabricante y producto. Al ratón hay que cambiarlo después al canal correspondiente.
- Reiniciar BlueZ desconecta unos segundos un ratón Bluetooth.
- Después, pulsa una tecla del teclado en modo Bluetooth (sin USB) para que conecte.
- Necesita `chntpw` (lo instala el instalador) y la partición de Windows montada (se detecta sola; si no,
  `WINDOWS_MOUNT` en `/etc/zenbook-duo.conf`).

### `zenbook-wifi`: WiFi
```
zenbook-wifi [on|off|toggle|status]
```

### `zenbook-keymap`: mapa de las teclas de función
```
sudo zenbook-keymap [capture] [--bus usb|bt] [--out DIR] [--timeout S] [--only F1,F4] [--no-grab]
zenbook-keymap devices          # nodos del teclado detectados y bus
zenbook-keymap show ARCHIVO     # tabla de un mapa guardado
```
Primer paso para reasignar las teclas F1..F12: descubre qué envía cada una. Pide,
para cada tecla, la pulsación sola y luego `Fn` + la tecla, y guarda todo lo que
llega por evdev y por hidraw en `DIR/keymap-<bus>.json` (por defecto `./keymap`).

- **Una captura por conexión:** ejecútalo una vez con el teclado por USB y otra por
  Bluetooth. El bus se detecta solo (USB tiene prioridad si están los dos); `--bus`
  fuerza la etiqueta.
- **Usa `sudo`:** el hidraw del teclado Bluetooth solo lo lee root, y por USB algunas
  teclas llegan únicamente por hidraw.
- **No dispara acciones:** mientras captura, el teclado queda agarrado (`EVIOCGRAB`),
  así que no cambia el volumen ni el brillo. `Esc` cancela y guarda lo capturado;
  si no pulsas nada en `--timeout` segundos (15 por defecto) se salta la tecla.
- **Anota el bloqueo Fn** (`Fn+Esc`): cambia qué hace la tecla sola y se guarda en el JSON.
- `--no-grab` desactiva el agarre (las teclas llegan al escritorio).

### `zenbook-microphone`: micrófono y luz de F9
```
zenbook-microphone [toggle|mute|unmute|status|sync [--force]|watch]
```
Silencia o activa el micrófono predeterminado (`wpctl`) y enciende la luz naranja de la
tecla F9 mientras está silenciado (reporte `5a d0 7c <0|1>`, USB y Bluetooth). `toggle`
muestra además el indicador inferior de GNOME: solo el texto "Micrófono" y un icono que indica
si está silenciado o activo, como el del volumen. `watch` mantiene la luz sincronizada cuando el micrófono
cambia por otro medio (GNOME, Discord…); corre como servicio de usuario `zenbook-microphone`.
El teclado no recuerda la luz: `zenbook-hotkeys` la reenvía al detectarlo
(`sync --force`). La luz se envía como root con `sudo -n zenbook-microphone _led on|off`.

### `zenbook-swap-screens`: intercambiar pantallas
```
zenbook-swap-screens
```
Intercambia las ventanas de la pantalla superior con las de la inferior (tecla F8, icono del
cuadrado con flechas arriba y abajo). Mover ventanas solo lo puede hacer GNOME Shell, así que lo hace
la extensión `swap-screens`, que expone `org.zenbook.Screens.Swap` por D-Bus; si no está
cargada (hay que cerrar sesión tras instalarla), avisa con una notificación. Identifica las pantallas
por su conector (`eDP-1` y `eDP-2`), así que un monitor externo no interfiere. **Con la pantalla
inferior apagada (por ejemplo, con el teclado por USB) no hace nada y no avisa**: no hay nada que
intercambiar.

### `zenbook-fn-lock`: bloqueo Fn del teclado
```
zenbook-fn-lock [on|off|toggle|status|init]
```
Cambia y lee el bloqueo Fn del teclado (reporte `5a d0 4e <0|1>`):

| Estado | Tecla F sola | Fn + tecla F |
|---|---|---|
| `off` (bloqueo desactivado) | acción multimedia (F1 = silenciar…) | F1..F12 |
| `on` (bloqueo activado) | F1..F12 | acción multimedia |

- `status` lee el estado del teclado (por USB responde; por Bluetooth, si no responde,
  muestra el último enviado y avisa "sin verificar"). Por USB la lectura desacopla un instante la
  interfaz del teclado: úsalo a mano, no en automático. `toggle` no lee: parte del último estado
  guardado.
- **Fn+Esc:** el teclado no cambia solo; emite un reporte y es el host quien debe reenviar
  el estado. `zenbook-hotkeys` lo escucha (por USB) y ejecuta `zenbook-fn-lock toggle`.
- El último estado se guarda en `/tmp/zenbook-fnlock-state` (`1` = on, `0` = off); sirve de
  respaldo por Bluetooth, donde el teclado no responde a la lectura.
- Se auto-eleva con `sudo -n` (el instalador agrega la regla de sudoers).
- `on`, `off` y `toggle` muestran el indicador inferior de GNOME (solo el texto "Bloqueo Fn"; el
  candado cerrado o abierto indica si está activado), también al cambiar con Fn+Esc.
- El teclado no recuerda el estado al reconectarse: `zenbook-keyboard-monitor` envía `off -q` (sin aviso)
  cada vez que el teclado aparece, para que F4, F5, F6, F8 y F9 lleguen como acciones.
- `init` envía el saludo `ASUS Tech.Inc.` de `hid-asus` (no hizo falta en las pruebas).

## Extensiones de GNOME Shell

Para GNOME Shell 50. Se instalan en `~/.local/share/gnome-shell/extensions/`.

| Extensión | Dónde aparece | Qué hace |
|---|---|---|
| `on-screen-display@zenbook-duo` | Indicador inferior (como el de volumen) | Sin icono. Muestra el indicador de GNOME cuando los scripts cambian la **luz del teclado** (F4) o el **brillo** (F5/F6), con barra de nivel, o el **micrófono** (F9), el **bloqueo Fn** y la **pantalla inferior**, con icono y texto. El texto es fijo ("Luz del teclado", "Brillo", "Micrófono", "Bloqueo Fn") y el estado lo da el icono o la barra, como en el volumen; la pantalla muestra "Pantalla inferior: encendida" o "apagada", con el icono atenuado cuando está apagada, igual que los iconos de mute. Expone `org.zenbook.Osd` por D-Bus; sin ella el micrófono, el bloqueo Fn y la pantalla usan una notificación normal y el resto no avisa. |
| `lower-screen@zenbook-duo` | Ajustes rápidos | Botón "Pantalla inferior" para encender o apagar la pantalla inferior (subtítulo Encendida/Apagada). |
| `swap-screens@zenbook-duo` | Sin icono | Intercambia las ventanas entre las dos pantallas con F8. Expone `org.zenbook.Screens.Swap` por D-Bus; lo llama el script `zenbook-swap-screens`. |
| `drag-to-screen@zenbook-duo` | Debajo del puntero, mientras se arrastra una ventana | Sin icono permanente. Al arrastrar una ventana por su barra de título aparece, **unos 100 px debajo del puntero** y centrado en él, un panel con una fila por pantalla (**Arriba** y **Abajo**) y cuatro iconos por fila: **entera**, **mitades verticales** (izquierda/derecha), **mitades horizontales** (superior/inferior) y **cuartos**. Si no cabe debajo (cerca del borde inferior) aparece por encima, y siempre queda dentro de la pantalla; soltarla sobre «entera» la manda a esa pantalla, como `Super+Shift+flecha`, conservando la posición que tenía antes de arrastrar (o maximizada si lo estaba); sobre cualquier otra zona la des-maximiza, la manda a esa pantalla y la ajusta a esa mitad o cuarto del área de trabajo. Solo actúa si están ambas pantallas del notebook; ignora los monitores externos. |
| `auto-brightness@zenbook-duo` | Ajustes rápidos | Botón que activa o desactiva el brillo automático de GNOME (`ambient-enabled`). Se actualiza si lo cambias desde Configuración. |
| `battery-charge-limit@zenbook-duo` | Ajustes rápidos | Botón "Carga completa": marcado = **sin límite** (la batería carga hasta el 100 %); desmarcado = vuelve el límite de carga (el subtítulo muestra el porcentaje, p. ej. «Límite 80 %»). Usa el límite de UPower, el mismo de Configuración → Energía, por D-Bus: sin root ni contraseña. No aparece si el equipo no tiene batería con límite de carga. |
| `screen-rotation@zenbook-duo` | Ajustes rápidos | Botón con menú: normal, izquierda, derecha, invertida y rotación automática. |

`lower-screen` y `screen-rotation` llaman a `/usr/local/bin/zenbook-lower-screen` y
`zenbook-screen-rotation`. No hay iconos de la luz del teclado ni del bloqueo Fn en la barra superior:
sus avisos son el indicador inferior de `on-screen-display`.

## Servicios

| Servicio | Tipo | Estado tras instalar | Qué hace |
|---|---|---|---|
| `zenbook-hotkeys` | usuario | activo | `zenbook-hotkeys watch` |
| `zenbook-screen-rotation` | usuario | activo | `zenbook-screen-rotation auto` |
| `zenbook-microphone` | usuario | activo | `zenbook-microphone watch` |
| `zenbook-keyboard-monitor` | usuario | activo | `zenbook-keyboard-monitor watch`: apaga la pantalla inferior al conectar el teclado por USB, la enciende al desconectarlo y reaplica el bloqueo Fn y la luz de F9 |

Logs: `journalctl --user -u zenbook-hotkeys -f`.

## Estructura

```
scripts/            un script por función (zenbook-*)
gnome-extension/    las siete extensiones
systemd/user/       servicios de usuario
udev/               regla para leer hidraw sin root
zenbook-duo.conf    configuración (→ /etc/zenbook-duo.conf)
install-all.sh                    instala todo en orden (orquesta los tres siguientes)
install-scripts-services-extensions.sh  scripts, servicios, extensiones, sudoers y udev
install-lower-screen-edid.sh     EDID personalizado de eDP-2 (initramfs + GRUB; aparte, requiere reinicio)
install-login-screen-layout.sh  disposición de las pantallas en el inicio de sesión de GDM (aparte)
edid/               edp2.bin
tools/              capture-input.py (diagnóstico: captura todos los eventos de entrada)
keymap/             mapas capturados de las teclas F (USB y BT)
AGENTS.md           información técnica
```

## Problemas conocidos

- **El brillo vuelve solo al máximo (y F5/F6 no hacen efecto en eDP-1):** desactiva el brillo automático de GNOME:
  `gsettings set org.gnome.settings-daemon.plugins.power ambient-enabled false`.
- **El slider de brillo de eDP-2 no hace nada:** el EDID personalizado no se
  cargó (ver `zenbook-touchscreen`).
- **Teclas de función por Bluetooth:** algunas no llegan al sistema.
