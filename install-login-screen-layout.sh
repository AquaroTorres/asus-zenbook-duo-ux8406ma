#!/bin/bash
# Deja la pantalla inferior (eDP-2) APAGADA en la pantalla de inicio de sesión (GDM): solo la
# superior (eDP-1) muestra el cuadro de inicio de sesión. Al iniciar sesión, tu
# ~/.config/monitors.xml vuelve a encender las dos.
#
# GDM no lee ~/.config/monitors.xml: su greeter tiene su propia configuración en
# /var/lib/gdm/seat0/config/ (su XDG_CONFIG_HOME; GDM usa usuarios dinámicos). Sin un
# monitors.xml ahí, Mutter coloca las pantallas por defecto una al lado de la otra, ambas encendidas.
#
# Toma de tu ~/.config/monitors.xml la configuración de exactamente eDP-1 + eDP-2 (con el serial
# del EDID personalizado de eDP-2, ver install-lower-screen-edid.sh), valida que sea la esperada y
# escribe en el greeter una con solo eDP-1 y eDP-2 en <disabled> (la clave de coincidencia de Mutter
# es el conjunto de pantallas conectadas, así que eDP-2 debe figurar como desactivada). Es idempotente.
# Vuelve a ejecutarlo si cambias la escala de las pantallas.
# No controla lo anterior al greeter (GRUB, Plymouth, consola del kernel).
set -e

SRC="$HOME/.config/monitors.xml"
DEST_DIR="/var/lib/gdm/seat0/config"
DEST="$DEST_DIR/monitors.xml"
[[ -r /etc/zenbook-duo.conf ]] && source /etc/zenbook-duo.conf
MONITOR_UPPER="${MONITOR_UPPER:-eDP-1}"
MONITOR_LOWER="${MONITOR_LOWER:-eDP-2}"
PANEL_LOWER_SERIAL="${PANEL_LOWER_SERIAL:-eDP-2}"

[[ -r "$SRC" ]] || { echo "No existe $SRC: ajusta las pantallas en GNOME (o con zenbook-lower-screen on) primero." >&2; exit 1; }
sudo test -d "$DEST_DIR" || { echo "No existe $DEST_DIR: ¿GDM con usuarios dinámicos?" >&2; exit 1; }

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

python3 - "$SRC" "$TMP" "$MONITOR_UPPER" "$MONITOR_LOWER" "$PANEL_LOWER_SERIAL" << 'PYEOF'
import copy
import sys
import xml.etree.ElementTree as ET

src, out, upper, lower, serial = sys.argv[1:6]
root = ET.parse(src).getroot()

def spec(lm):
    s = lm.find('monitor/monitorspec')
    return s.find('connector').text, s.find('serial').text

chosen = None
for conf in root.findall('configuration'):
    lms = conf.findall('logicalmonitor')
    specs = [spec(lm) for lm in lms]
    # Exactamente las dos pantallas integradas y con el serial del EDID personalizado
    if sorted(c for c, _ in specs) == sorted([upper, lower]) and (lower, serial) in specs:
        chosen = conf
        break
if chosen is None:
    sys.exit(f"No hay en {src} una configuración con solo {upper} y {lower} (serial {serial}).")

by = {spec(lm)[0]: lm for lm in chosen.findall('logicalmonitor')}
m, s = by[upper], by[lower]
x = lambda lm, t: int(lm.find(t).text)
problems = []
if m.find('primary') is None:
    problems.append(f"{upper} no es la principal")
if x(m, 'x') != x(s, 'x') or x(s, 'y') <= x(m, 'y'):
    problems.append(f"{lower} no está justo debajo de {upper}")
if problems:
    sys.exit("La configuración encontrada no es la esperada: " + "; ".join(problems) +
             ". Arréglala con `zenbook-lower-screen on` y vuelve a ejecutar.")

# Greeter: solo la pantalla superior; la inferior queda desactivada
greeter = ET.Element('configuration')
ET.SubElement(greeter, 'layoutmode').text = chosen.find('layoutmode').text
greeter.append(m)
disabled = ET.SubElement(greeter, 'disabled')
disabled.append(s.find('monitor/monitorspec'))

# Con el kernel apagando eDP-2 (video=eDP-2:d) en el greeter solo hay una pantalla conectada y la
# clave de coincidencia es {eDP-1}; sin ese kernel (o si se reconecta) son las dos, con eDP-2 desactivada.
solo = ET.Element('configuration')
ET.SubElement(solo, 'layoutmode').text = chosen.find('layoutmode').text
solo.append(copy.deepcopy(m))

new = ET.Element('monitors', version=root.get('version', '2'))
new.append(solo)
new.append(greeter)
ET.indent(new)
ET.ElementTree(new).write(out, encoding='unicode', xml_declaration=False)
open(out, 'a').write('\n')
print(f"Greeter: {upper} principal en ({x(m,'x')},{x(m,'y')}), escala {m.find('scale').text}; {lower} apagada")
PYEOF

OWNER=$(sudo stat -c '%u:%g' "$DEST_DIR")
if sudo test -f "$DEST" && sudo cmp -s "$TMP" "$DEST"; then
    echo "Ya estaba configurado: $DEST"
    exit 0
fi
sudo test -f "$DEST" && sudo cp -p "$DEST" "$DEST.bak"
sudo install -m 644 -o "${OWNER%%:*}" -g "${OWNER##*:}" "$TMP" "$DEST"
echo "Instalado $DEST (propietario $OWNER). Se aplica en el próximo arranque del greeter (cierra sesión)."
