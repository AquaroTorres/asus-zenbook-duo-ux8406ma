# AGENTS.md — información técnica

Contexto para quien modifique este proyecto (personas o agentes). El uso está
en [README.md](README.md).

## Resumen

Scripts bash (y algo de Python embebido) para el **ASUS Zenbook Duo UX8406MA**
(`/sys/class/dmi/id/product_name` = `ASUS Zenbook Duo UX8406MA_UX8406MA`) en
**Manjaro/Arch, GNOME 50 sobre Wayland**. Idioma de mensajes, comentarios y
documentación: español (el usuario es chileno; tuteo, no voseo).

Hay un script por función, sin librería común: los helpers pequeños
(`_scale`, `_count`, `_kb_bus_type`) están duplicados a propósito. Los scripts
se llaman entre sí por `PATH` (`/usr/local/bin`).

## Hardware

| Elemento | Detalle |
|---|---|
| Pantallas | Dos paneles SDC `419d`, conectores `eDP-1` (arriba) y `eDP-2` (abajo). EDID idéntico y sin serial. |
| Teclado | Desmontable. USB `0b05:1b2c` (nombre `Primax Electronics Ltd. ASUS Zenbook Duo Keyboard`) o Bluetooth (`ASUS Zenbook Duo Keyboard`). |
| Touchscreens | `ELAN9008:00 04F3:425B` → eDP-1, `ELAN9009:00 04F3:425A` → eDP-2 (más sus `Stylus`). |
| Backlights | `/sys/class/backlight/intel_backlight` (eDP-1) y `card1-eDP-2-backlight` (eDP-2, el número de `card` puede cambiar). Máximo 400. |

## Protocolos del teclado

### Luz del teclado
HID Feature Report de 16 bytes: `5A BA C5 C4 <nivel> 00 …` (nivel 0-3).
- **USB:** se envía con `HIDIOCSFEATURE` sobre el hidraw de la **interfaz 4** (`HID_PHYS=…/input4`), igual que por BT: verificado el 2026-10-23 leyendo el estado de vuelta (`00 → 01 → 00`). Respaldo: `ctrl_transfer(0x21, 0x09, 0x035A, 4, data)` (pyusb), que exige desacoplar el driver. **Sobre otras interfaces (p. ej. la 1) el hardware ignora el SET aunque el kernel lo acepte.**
- **Bluetooth (y respaldo USB):** `ioctl(fd, HIDIOCSFEATURE(16) = 0xC0104806, data)` sobre el `/dev/hidrawN` del teclado.

### Detectar el bus
Se lee `HID_ID=` en `/sys/class/hidraw/*/device/uevent`: `0003:…` = USB,
`0005:…` = Bluetooth. Se filtran los hidraw cuyo `DRIVER=` es `hid-multitouch`
o `hid-sensor-hub`. Por USB el hidraw útil es el de `HID_PHYS=…/input4`.

### Tecla de pantalla inferior
- **Bluetooth:** no es un `KEY_*`. Es `EV_ABS` (tipo 3), código 40 (`ABS_MISC`), valor **106** al presionar y 0 al soltar, en un nodo evdev cuyo `capabilities/abs` tiene el bit 40.
- **USB:** no genera evento evdev. Es un reporte HID en el hidraw de la interfaz 4: `5a 6a 00 00 00 00` al presionar y `5a 00 …` al soltar.
- El número de `/dev/input/eventN` y `/dev/hidrawN` **cambia tras cada suspensión o reconexión**: nunca fijarlo; buscar por nombre y capacidades, y escuchar **todos** los nodos candidatos (`select`). Si un nodo desaparece, el lector Python sale y el bucle bash vuelve a buscar.
- Antirrebote de 0,5 s.
- La regla udev usa `ATTRS{product}=="*Zenbook Duo Keyboard*"`; con `ATTRS{name}` nunca coincidía.

## Archivos y responsabilidades

| Ruta | Rol |
|---|---|
| `scripts/zenbook-keyboard-backlight` | Luz. Único script que corre como root (se auto-eleva con `sudo -n "$0" <nivel>`). Escribe `KB_STATE_FILE`. |
| `scripts/zenbook-lower-screen` | Pantalla inferior: `on\|off\|toggle\|status` con `gdctl set` (eDP-2 debajo de eDP-1) y aviso `ShowState`. Solo cambia la pantalla; no decide cuándo. Antes se llamaba `zenbook-monitor` y también contenía el `watch`. |
| `scripts/zenbook-keyboard-monitor` | Servicio `watch`: `udevadm monitor --subsystem-match=hid`, antirrebote `KB_EVENT_DELAY`, compara el bus (`usb`/`bt`/`none`, USB gana) con `/tmp/zenbook-kb-bus`; USB → `zenbook-lower-screen off`, BT/none → `on`. **No toca la luz del teclado** (decisión del usuario: «el teclado debe quedarse con la luz que estaba»; antes ponía un nivel fijo al cambiar el bus y 0 sin teclado). Tareas de conexión (`_connect_tasks`): espera al nodo hidraw (`_kb_ready`: USB interfaz 4 o BT), luego `zenbook-fn-lock off -q` y `zenbook-microphone sync --force`; se ejecutan al arrancar, en cada cambio de bus y en cada `add` del teclado aunque el bus no cambie (flag `/tmp/zenbook-kb-added`), con límite de 1 vez/5 s (`/tmp/zenbook-kb-connect`). |
| `scripts/zenbook-screen-rotation` | `gdctl set` con `--transform` 90/270/180; `auto` usa `monitor-sensor --accel`. |
| `scripts/zenbook-brightness` | `busctl call org.freedesktop.login1 … Session SetBrightness`. `up`/`down` parten del brillo de eDP-1 y escalan al máximo de eDP-2. |
| `scripts/zenbook-touchscreen` | `gsettings` + `xinput map-to-output`. |
| `scripts/zenbook-hotkeys` | Detecta la tecla de pantalla (→ `zenbook-lower-screen toggle`) y Fn+Esc por USB, reporte `5a 4e` (→ `zenbook-fn-lock toggle`). Ya no hace tareas de conexión: las reaplica `zenbook-keyboard-monitor`. |
| `scripts/zenbook-microphone` | `toggle\|mute\|unmute\|status\|sync\|watch` con `wpctl`; luz de F9 con `_led` (root). Estado de la luz en `/tmp/zenbook-mic-led` para no reenviar si no cambió. |
| `install-all.sh` | Orquesta los otros tres instaladores sin duplicar su lógica: 1) scripts/servicios/extensiones, 2) EDID (detecta «Reinicia» en su salida), 3) `ambient-enabled=false`, 4) disposición de GDM solo si `gdctl` ya muestra `Serial: eDP-2` y existe `~/.config/monitors.xml`, 5) habilita las extensiones que `gnome-extensions list` ya conoce. Acumula lo pendiente y lo lista al final. Probado re-ejecutándolo sobre el sistema ya instalado; **no probado en una instalación limpia**. |
| `install-login-screen-layout.sh` | Copia al greeter de GDM (`/var/lib/gdm/seat0/config/monitors.xml`, propietario = el uid dinámico del directorio) la configuración de exactamente eDP-1 + eDP-2 con serial `eDP-2` extraída de `~/.config/monitors.xml`; valida que eDP-1 sea primaria en (0,0) y eDP-2 esté justo debajo. Idempotente, hace `.bak` del anterior. |
| `install-lower-screen-edid.sh` | EDID de eDP-2: copia a `/lib/firmware/edid`, `FILES=` de mkinitcpio y `drm.edid_firmware` en GRUB. Idempotente; avisa si hay que reiniciar. |
| `tools/capture-input.py` | Diagnóstico: vuelca todos los eventos evdev/hidraw (`sudo python3 tools/capture-input.py [--all]`, log junto al script). |
| `scripts/zenbook-swap-screens` | F8: llama a `org.zenbook.Screens.Swap` (D-Bus, extensión `intercambio-pantallas`) para intercambiar las ventanas de las dos pantallas; con `eDP-2` apagada (`/sys/class/drm/card*-eDP-2/enabled` ≠ `enabled`, p. ej. teclado por USB) sale sin hacer nada ni avisar; sin la extensión cargada, notificación. |
| `scripts/zenbook-fn-lock` | Bloqueo Fn: `on\|off\|toggle\|status\|init`. Escribe `5a d0 4e <0\|1>` y lee el estado con GET_REPORT (`5a d0 4e <estado>`), por USB (ctrl_transfer, interfaz 4) o hidraw (`HIDIOCSFEATURE`/`HIDIOCGFEATURE` = `0xC0104806`/`0xC0104807`). Se auto-eleva con `sudo -n`. Publica el estado en `FNLOCK_STATE_FILE` (`/tmp/zenbook-fnlock-state`, 1/0). |
| `scripts/zenbook-keymap` | Python. Descubre qué emite cada F1..F12 (sola y con Fn) por evdev y hidraw; salida `keymap/keymap-<bus>.json`. Primer paso de la reasignación de teclas de función (pendiente). |
| `scripts/zenbook-bluetooth`, `-bt-kb`, `-wifi` | `rfkill`, `bluetoothctl`, `nmcli`. |
| `gnome-extension/*` | Extensiones ESM para GNOME Shell 50 (`shell-version: ["50"]`). |
| `zenbook-duo.conf` | Parámetros variables; ver README. |

## Configuración

Cada script define sus valores por defecto y luego hace
`[[ -r /etc/zenbook-duo.conf ]] && source /etc/zenbook-duo.conf`. Por eso el
archivo es **bash** y no se debe poner nada ejecutable en él.

**Seguridad:** `zenbook-keyboard-backlight` corre como root vía `sudo` (sudoers
`NOPASSWD` para `/usr/local/bin/zenbook-keyboard-backlight`, `zenbook-fn-lock` y `zenbook-microphone`). Por eso la configuración está
en `/etc` (propiedad de root) y **no** hay override por variable de entorno ni
por archivo en `$HOME`: eso permitiría a un usuario ejecutar código como root.
No agregar esos mecanismos. Dentro de `zenbook-keyboard-backlight`, `KB_USB_ID` se pasa a Python
por variable de entorno ya siendo root.

## Gotchas

- **gdctl y el brillo de eDP-2:** `gdctl prefs --backlight` aplica en eDP-1 pero es un no-op silencioso (exit 0) en eDP-2 por el bug de mutter con EDID clonado. Por eso se usa logind.
- **Disposición de pantallas en el greeter de GDM (2026-10-23):** el greeter no lee `~/.config/monitors.xml`; sin un `monitors.xml` propio Mutter coloca las pantallas por defecto una al lado de la otra y solo tras iniciar sesión pasan a su sitio. GDM 50 usa usuarios dinámicos: la ruta clásica `/var/lib/gdm/.config/` **no existe**; su `XDG_CONFIG_HOME` es `/var/lib/gdm/seat0/config/` (modo 700, propietario un uid dinámico estable, p. ej. `60585:65534`; ahí viven `dconf/`, `ibus/`, `pulse/`). `install-login-screen-layout.sh` instala allí el archivo. La clave de coincidencia de Mutter incluye `connector`, `vendor`, `product` y `serial`: si el EDID personalizado de eDP-2 no se carga (serial `0x00000000`) la configuración no coincide y vuelve la disposición por defecto. **No verificado en el greeter real** (requiere cerrar sesión). No se controla la consola del kernel/Plymouth anterior al greeter.
- **EDID personalizado:** para que GNOME distinga los paneles y asigne bien los touchscreens, `edp2.bin` (serial `"eDP-2"`, checksum recalculado) se carga con `drm.edid_firmware=eDP-2:/lib/firmware/edid/edp2.bin`. i915 lo pide antes de montar el rootfs real, así que además debe estar en el initramfs (`FILES=(/lib/firmware/edid/edp2.bin)` en `/etc/mkinitcpio.conf`, luego `mkinitcpio -P`). Sin eso falla en silencio (`dmesg | grep -i edid` muestra `error -2`) y el slider de brillo de eDP-2 mueve `intel_backlight`. `install-lower-screen-edid.sh` lo instala (idempotente); `install-scripts-services-extensions.sh` no lo toca. En GRUB el valor tras `eDP-2:` es **relativo** a `/lib/firmware/` (`edid/edp2.bin`); con ruta absoluta se duplica y falla con error -2.
- **Brillo automático de GNOME:** `ambient-enabled` pelea con cualquier cambio manual de brillo. Desactivarlo.
- **`$0` en `zenbook-keyboard-backlight`:** el sudo re-ejecuta `"$0"`, que debe ser la ruta absoluta instalada para que coincida con sudoers. Si se ejecuta con ruta relativa desde el repo, `sudo -n` pedirá contraseña.
- **Ruta del hidraw:** se obtiene con `basename "$(dirname "$(dirname "$uevent")")"`. El `grep -o 'hidraw[0-9]*'` del script original devolvía `hidraw hidraw1` (coincide también con `class/hidraw`).
- **Notificaciones y root:** `zenbook-fn-lock` y `zenbook-microphone` necesitan root para hablar con el teclado, pero root no llega al bus de sesión. Por eso el proceso del usuario llama a la parte privilegiada (`sudo -n zenbook-fn-lock _root ...`, `sudo -n zenbook-microphone _led ...`) y envía él la notificación. Formato común: `notify-send -a <app> -i <icono> -h string:x-canonical-private-synchronous:<id> -t 1500 <texto>` (la pista `synchronous` hace que cada aviso reemplace al anterior). Ejecutado directamente como root no hay notificación.
- **Estado de la luz en `/tmp`:** se pierde al reiniciar. `zenbook-keyboard-backlight` lo compara antes y después de cambiar el nivel y solo muestra el OSD si cambió.
- **Permisos de hidraw:** la regla udev usa `ATTRS{product}`, que solo existe en el teclado por USB. El hidraw del teclado **Bluetooth** queda `root:root 0600`, así que sin root solo se lee evdev. `zenbook-keymap` avisa y sigue con lo que pueda abrir.
- **Nodos del teclado:** por BT aparecen varios `event*` con el mismo nombre (`ASUS Zenbook Duo Keyboard`) y dos `hidraw` (uno es `hid-multitouch`, el touchpad; se descarta). Algunas teclas Fn podrían salir por `Asus WMI hotkeys`, que `zenbook-keymap` también escucha.
- **`zenbook-keymap` y el agarre:** `EVIOCGRAB` (`0x40044590`) impide que el escritorio reciba las teclas durante la captura; se libera al cerrar el fd, también si el proceso muere. Como el teclado agarrado tampoco llega a la terminal, `Ctrl+C` no funciona: se cancela con `Esc` o esperando el `--timeout`. El resultado cambia según el bloqueo Fn (`Fn+Esc`).
- **F10 sola por Bluetooth no emite nada:** verificado el 2026-10-23 con `tools/capture-input.py --all` (todos los dispositivos, incluidos todos los nodos del teclado, WMI y Intel HID): cero eventos. Por USB emite `5a 3d 64 01` por hidraw. Con el teclado BT esa tecla no se puede reasignar; `Fn+F10` sí llega (`KEY_F10`). Queda como `[]` en `keymap/keymap-bt.json`.
- **NUNCA desacoplar la interfaz 4 por USB en automático (bucle de reinicios, 2026-10-23):** `pyusb` hace `detach_kernel_driver`/`attach_kernel_driver`, y reacoplar **recrea el dispositivo HID**: nuevo `HID_ID` y nuevo nodo hidraw (`dmesg`: `hid-generic …input4` con `.012E`, `.012F`, `.0130`… cada 0,2–1,3 s). `zenbook-hotkeys` escucha ese nodo, así que al desaparecer sale y su bucle de bash lo reinicia; si en cada arranque ejecuta algo que desacopla (antes: `zenbook-fn-lock status` y `zenbook-microphone sync`), se genera un bucle infinito. Síntomas: F1–F3 (teclas estándar) funcionan y F4/F5/F6/F9 (reportes `5a`) no; el servicio listaba solo nodos BT; `GET_REPORT` daba `Input/Output Error` y `dmesg` mostraba `probe … failed with error -110`. Solución: enviar siempre por hidraw (`HIDIOCSFEATURE`, no desacopla) y dejar pyusb de respaldo; no leer el estado en los caminos automáticos (`toggle` usa el último estado guardado; `status` es manual). La lectura por hidraw (`HIDIOCGFEATURE`) devuelve ceros: la lectura real solo sale por `ctrl_transfer(0xA1, 0x01, 0x035A, 4, 16)`.
- **Bloqueo Fn por USB (verificado 2026-10-23):** recién conectado, el teclado USB emite `KEY_Fn` tanto sola como con Fn (indistinguibles). Tras `zenbook-fn-lock off` (`5a d0 4e 00`, ctrl_transfer a la interfaz 4) F1 sola emite `KEY_MUTE` (scancode `0xc00e2`, hidraw `03 e2 00 00`) y Fn+F1 emite `KEY_F1`, igual que por Bluetooth. El reporte viene de `hid-asus` (`QUIRK_HID_FN_LOCK`); el driver no atiende este teclado, así que nadie lo envía. Hay que reenviarlo al reconectar o reanudar (aún no confirmado cuánto dura; no está automatizado).
  - **Lectura:** GET_REPORT `ctrl_transfer(0xA1, 0x01, 0x035A, 4, 16)` devuelve `5a d0 4e 00|01`.
  - **Fn+Esc no alterna el estado en el firmware:** emite `5a 4e 00 00 00 00` (y `5a 00 …` al soltar) por el hidraw de la interfaz 4, y las F siguen igual. Como en `hid-asus`, el host debe alternar y reenviar: `zenbook-hotkeys` lo hace con `zenbook-fn-lock toggle`. Verificado por USB; **por Bluetooth Fn+Esc no está capturado** (pendiente). Por BT las teclas ya vienen en modo multimedia.
- **Agarrar el teclado con una tecla abajo:** `EVIOCGRAB` con una tecla presionada deja la suelta sin entregar al escritorio y la tecla se repite sin fin (pasó con Enter al responder un prompt). `zenbook-keymap` espera con `EVIOCGKEY` (`0x80604518`) a que no haya teclas abajo antes de agarrar y antes de soltar.
- **Teclas F4/F5/F6 (con el bloqueo Fn en off):** llegan como `EV_ABS 40 = <código>` por BT y reporte hidraw `5a <código>` (BT hidraw1, USB interfaz 4): F4 = `0xc7`, F5 = `0x10`, F6 = `0x20`, igual que la tecla de pantalla `0x6a` y Fn+Esc `0x4e`. `zenbook-hotkeys` tiene la tabla código → comando. Verificados por BT; **por USB en modo multimedia no se capturaron**: se asume el mismo código porque la tecla de pantalla y Fn+Esc coinciden entre buses. Con el bloqueo en `on` esas teclas emiten `KEY_F4..F6` y GNOME no hace nada.
- **F8 = intercambiar pantallas (código `0x9c`):** BT verificado (`EV_ABS 40 = 156`, hidraw `5a 9c`); por USB se asume el mismo código. Los códigos vendor sin acción se registran en el diario (`código sin acción: 0x..`), p. ej. F11 = `0x7e` (selector de emojis) y F12 = `0x86`. La acción vive en su propia extensión, `intercambio-pantallas@atorres` (separada de `pantalla-inferior`, que solo tiene el botón de encender/apagar): objeto D-Bus `/org/zenbook/Screens`, `org.zenbook.Screens.Swap`. Con la pantalla inferior apagada no hace nada (guarda doble: `zenbook-swap-screens` mira DRM y la extensión omite si `get_monitor_for_connector` devuelve -1; DRM `enabled`/`disabled` sigue el estado de `gdctl`, verificado). Identifica las pantallas con `global.backend.get_monitor_manager().get_monitor_for_connector('eDP-1'|'eDP-2')` (los índices no sirven con un monitor externo), decide el destino de todas las ventanas NORMAL/DIALOG/MODAL_DIALOG antes de moverlas y las mueve con `window.move_to_monitor()` (API que usa el propio Shell en `main.js`). **No probado en el Shell real**: requiere reiniciar sesión.
- **F9 y la luz del micrófono:** F9 (modo multimedia) = código `0x7c` (BT verificado: `EV_ABS 40=124`, hidraw `5a 7c`; USB asumido). La luz naranja de la tecla es el feature report `5a d0 7c <0|1>` (de zakstam/zenbook-duo-linux PR #40, capturado del driver de Windows en UX8406MA; el mismo transporte que el bloqueo Fn). El teclado no la recuerda: hay que reenviarla tras cada reconexión (`zenbook-hotkeys` llama a `zenbook-microphone sync --force`) y `zenbook-microphone watch` (servicio) la mantiene sincronizada con `pactl subscribe`. No existe un LED `micmute` en `/sys/class/leds` ni usos de la página LED en los descriptores del teclado. Enviar la luz es root: `zenbook-microphone _led on|off` se auto-eleva con `sudo -n`. El mute usa `@DEFAULT_AUDIO_SOURCE@` (hoy el micrófono del monitor HP, no el interno).
- **Brillo (F5/F6) y brillo automático de GNOME:** con `ambient-enabled = true`, `gsd-power` devuelve eDP-1 (`intel_backlight`) al valor del sensor tras cada cambio manual (verificado: `zenbook-brightness down` dejó eDP-1 en 400 y eDP-2 en 360). Hay que desactivarlo: `gsettings set org.gnome.settings-daemon.plugins.power ambient-enabled false` (hecho el 2026-10-23; la extensión `brillo-automatico@atorres` lo alterna con un botón, leyendo y escribiendo esa clave con `Gio.Settings`).
- **OSD (indicador abajo):** `org.gnome.Shell.ShowOSD` responde `AccessDenied` a procesos externos y solo una extensión puede mostrarlo (`Main.osdWindowManager.showAll(gicon, label, level, maxLevel)`, API de `osdWindow.js` en GNOME Shell 50; `icon` es un `Gio.Icon`). Por eso `osd-zenbook@atorres` exporta un objeto D-Bus en la conexión del propio Shell (`Gio.DBusExportedObject.wrapJSObject(...).export(Gio.DBus.session, '/org/zenbook/Osd')`), alcanzable con `--dest org.gnome.Shell`: `org.zenbook.Osd.Show(icono, texto, nivel 0..1)` (con barra) y `ShowText(icono, texto)` (sin barra) y `ShowState(icono, texto, on)` (sin barra; con `false` el icono se atenúa al 35 %, la opacidad que Papirus usa en sus iconos de mute, `style="opacity:.35"` en el SVG); `icono` admite una lista separada por comas (`preferido,respaldo`, `Gio.ThemedIcon.new_from_names`) para tener respaldo si el tema no trae el preferido (el tema Papirus-Dark no tiene un icono de «pantalla apagada»; se usa el par dos pantallas / una pantalla). Los scripts llaman con `gdbus call --session ...`: `zenbook-keyboard-backlight` (luz, con barra), `zenbook-brightness` (barra), `zenbook-microphone` y `zenbook-fn-lock` (texto fijo; el estado lo da el icono: micrófono tachado, candado cerrado/abierto) y `zenbook-lower-screen` (`ShowState`: icono `video-display-symbolic` y texto «Pantalla inferior: encendida|apagada»; apagada sale atenuado). **Una extensión ya cargada no se recarga**: si se agrega un método D-Bus nuevo, el Shell en ejecución sigue sin él hasta reiniciar sesión (`UnknownMethod`). Por eso `zenbook-lower-screen` encadena `ShowState` → `ShowText` → `notify-send`: sin ese respaldo el aviso caía a la notificación normal, que sale arriba y no abajo. Sin la extensión cargada la llamada falla (`UnknownMethod`, código 1): `zenbook-microphone`, `zenbook-fn-lock` y `zenbook-lower-screen` caen a `notify-send`; `zenbook-keyboard-backlight` y `zenbook-brightness` no avisan. La ventana del OSD se comparte con el volumen nativo, por eso la extensión fija la opacidad del icono en cada aviso (`InjectionManager` sobre `OsdWindowManager._showOsdWindow`) y la restaura a 255 en los demás. **El nivel de la barra se normaliza a 0..1** (`Show` lo recorta a ese rango): `BarLevel` declara `value` en 0..2 y `maximum-value` en 1..2, y con el OSD ya visible el valor se anima con `ease_property`, que respeta ese rango; con 0..3 el nivel 3 se recortaba a 2 y se veía igual que el 2. Probado con un servicio gjs de prueba con la misma interfaz; **no con el Shell real** (requiere reiniciar sesión). Los iconos de la barra superior para la luz y el bloqueo Fn se retiraron el 2026-10-23 (extensiones `luz-teclado` y `bloqueo-fn`); `install-scripts-services-extensions.sh` las elimina si existen.
- **Atajo GNOME antiguo de F4:** existe un custom keybinding `kb-backlight` (`F4` → `zenbook kb cycle`). Con el bloqueo en `off`, F4 sola ya no emite `KEY_F4`, así que ese atajo solo se activaba con Fn+F4. **Eliminado el 2026-10-23** (de `custom-keybindings` y de dconf).
- **Tercer backlight:** `/sys/class/backlight/asus_screenpad` también existe; no se usa (el de eDP-2 es `card1-eDP-2-backlight`).
- **Extensiones en Wayland:** no se pueden recargar sin cerrar sesión.
- **Nombres de scripts, servicios y extensiones (2026-10-23):** todos en inglés descriptivo y `zenbook-<qué controla>`. Antes: `zenbook-kb`→`keyboard-backlight`, `bt`→`bluetooth`, `bt-kb`→`bluetooth-keyboard`, `monitor`→`inferior-screen`→`lower-screen` (inglés: «inferior» significa «de mala calidad»), `rotate`/`autorotate`→`screen-rotation`, `swap`→`swap-screens`, `screenkey`→`hotkeys`, `fnlock`→`fn-lock`, `mic`→`microphone`; `inicio` se eliminó. Los archivos de estado en `/tmp` (`zenbook-kb-bus`, `zenbook-mic-led`, `zenbook-fnlock-state`…) conservan su nombre. El sudoers pasó de `/etc/sudoers.d/zenbook-kb` a `zenbook-duo`. `install-scripts-services-extensions.sh` retira los ejecutables, servicios y sudoers con los nombres antiguos. **Hasta reiniciar sesión** hay enlaces temporales `/usr/local/bin/zenbook-monitor` y `zenbook-rotate` porque las extensiones `pantalla-inferior` y `rotacion-pantalla` ya cargadas en el Shell aún llaman a esos nombres (el interruptor «Automática» de la rotación apunta además al servicio antiguo `zenbook-autorotate`); el siguiente `./install-scripts-services-extensions.sh` tras reiniciar sesión los elimina.
- **`zenbook-screen-rotation.service`:** `Restart=always` (no `on-failure`): si `monitor-sensor` no reclama el acelerómetro (`Failed to claim accelerometer: timeout`, visto el 2026-10-23) el script sale con código 0 y el servicio quedaba muerto sin reiniciarse.
- **`zenbook-keyboard-monitor.service`:** reacciona en vivo a la conexión del teclado. Reemplazó a `zenbook-inicio` (que solo revisaba una vez al iniciar sesión y se eliminó el 2026-10-23) y antes era `zenbook-monitor.service`. Escucha `udevadm monitor --subsystem-match=hid` con antirrebote `KB_EVENT_DELAY` (0,3 s; con 2 s la pantalla tardaba ~3 s en apagarse: 2 s de espera + ~0,2 s de `gdctl show` + `gdctl set`), compara el bus con `/tmp/zenbook-kb-bus` y solo actúa si cambió. Al arrancar sincroniza la pantalla según el bus. Probado con un arnés que simula los cambios de bus (usb → bt → usb → none) y con el servicio real; **no se probó desconectando el cable de verdad tras el cambio a `zenbook-keyboard-monitor`**.

## Historia

Este proyecto reemplazó a un clon de `Fmstrat/zenbook-duo-linux` con un script monolítico
(`zenbook.sh` → `/usr/local/bin/zenbook`) y scripts sueltos. El 2026-10-23 se repuntó todo lo
instalado a los scripts `zenbook-*` de aquí y se retiraron los restos instalados:
`/usr/local/bin/zenbook{,.bak,.bak2}`, `~/bin/zenbook-inicio`, `/etc/sudoers.d/zenbook`,
`/etc/systemd/user/zenbook-monitor.service` y el atajo F4 de GNOME. El directorio
`~/zenbook-duo-linux` **se conserva sin cambios** (ya no hay nada instalado que lo use).
Aquí se migraron `edid/edp2.bin` (+ `install-lower-screen-edid.sh`), la licencia GPL-3 y
`tools/capture-input.py`. Se eliminaron después `zenbook-power` + `zenbook-boot.service` (apagaban y restauraban la luz del
teclado; nunca se activaron y contradecían que el teclado conserve su luz) y `docs/SCREENKEY.md` (nota histórica con
nombres de comandos de la época; el protocolo vive en este archivo).

## Dependencias

`python-pyusb` (luz por USB), `inotify-tools` (`brightness watch`),
`iio-sensor-proxy` (`rotate auto`), `xorg-xinput` (`touchscreen`),
`bluez-utils` (`bt-kb`), `libpulse` (`pactl`, para `zenbook-microphone watch`). Además se usan `gdctl` (mutter), `rfkill`, `nmcli`,
`busctl`, `loginctl`, `udevadm`, `lsusb`, `notify-send`, `gsettings`.

## Pruebas

No hay tests automáticos. Comprobaciones seguras (solo lectura):

```bash
bash -n scripts/zenbook-*                # sintaxis
zenbook-keyboard-backlight status                        # teclado conectado y nivel
zenbook-hotkeys find                   # nodos que emiten la tecla
zenbook-lower-screen status
zenbook-brightness status
zenbook-screen-rotation status
zenbook-keymap devices                   # nodos y bus del teclado
```
Verificación funcional (cambia estado): `zenbook-keyboard-backlight cycle`, `zenbook-lower-screen toggle`,
presionar la tecla de pantalla y revisar
`journalctl --user -u zenbook-hotkeys -n 5`.

Para extensiones: `gnome-extensions list --enabled` y
`journalctl --user -b | grep -i "osd-zenbook\|pantalla-inferior\|intercambio-pantallas\|rotacion-pantalla\|brillo-automatico"`.

## Convenciones

- Bash, `function nombre() { … }` para helpers con prefijo `_`.
- Texto al usuario en español, tuteo.
- Cada script muestra `Uso: …` y sale con 1 ante argumentos desconocidos.
- Solo Manjaro/Arch: no hay versión para Ubuntu.
