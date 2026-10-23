#!/bin/bash
# Hace que la pantalla de inicio de sesión (GDM) use la misma disposición que tu sesión:
# pantalla superior (eDP-1) principal y la inferior (eDP-2) justo debajo.
#
# GDM no lee ~/.config/monitors.xml: su greeter tiene su propia configuración en
# /var/lib/gdm/seat0/config/ (su XDG_CONFIG_HOME; GDM usa usuarios dinámicos). Sin un
# monitors.xml ahí, Mutter coloca las pantallas por defecto una al lado de la otra, y solo al
# iniciar sesión pasan a su sitio.
#
# Toma de tu ~/.config/monitors.xml la configuración de exactamente eDP-1 + eDP-2 (con el serial
# del EDID personalizado de eDP-2, ver install-lower-screen-edid.sh) y la copia al greeter. Es idempotente.
# Vuelve a ejecutarlo si cambias la escala de las pantallas.
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

new = ET.Element('monitors', version=root.get('version', '2'))
new.append(chosen)
ET.indent(new)
ET.ElementTree(new).write(out, encoding='unicode', xml_declaration=False)
open(out, 'a').write('\n')
print(f"Configuración elegida: {upper} principal en ({x(m,'x')},{x(m,'y')}), "
      f"{lower} en ({x(s,'x')},{x(s,'y')}), escala {m.find('scale').text}")
PYEOF

OWNER=$(sudo stat -c '%u:%g' "$DEST_DIR")
if sudo test -f "$DEST" && sudo cmp -s "$TMP" "$DEST"; then
    echo "Ya estaba configurado: $DEST"
    exit 0
fi
sudo test -f "$DEST" && sudo cp -p "$DEST" "$DEST.bak"
sudo install -m 644 -o "${OWNER%%:*}" -g "${OWNER##*:}" "$TMP" "$DEST"
echo "Instalado $DEST (propietario $OWNER). Se aplica en el próximo arranque del greeter (cierra sesión)."
