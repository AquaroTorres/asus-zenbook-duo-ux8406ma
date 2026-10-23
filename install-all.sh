#!/bin/bash
# Instala todo en el orden correcto, usando los otros tres instaladores sin duplicar su lógica.
#
# Es seguro repetirlo: una instalación limpia se reduce a ejecutarlo, reiniciar y ejecutarlo de nuevo.
#   1ª vez   → instala scripts, servicios y extensiones, e instala el EDID (pide reiniciar)
#   2ª vez   → (tras reiniciar y volver a entrar) habilita las extensiones y deja el inicio de
#              sesión con la misma disposición de pantallas que tu sesión
#
# Pasos:
#   1. install-scripts-services-extensions.sh
#   2. install-lower-screen-edid.sh          (toca initramfs y GRUB; puede pedir reinicio)
#   3. desactiva el brillo automático de GNOME (si no, F5/F6 pelean con él)
#   4. install-login-screen-layout.sh        (solo si el EDID ya está cargado y existe tu monitors.xml)
#   5. habilita las extensiones que GNOME ya conoce
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
PENDING=()

step() { echo; echo "════ $* ════"; }

step "1/5 Scripts, servicios y extensiones"
"$DIR/install-scripts-services-extensions.sh"

step "2/5 EDID de la pantalla inferior"
EDID_OUT=$("$DIR/install-lower-screen-edid.sh" 2>&1 | tee /dev/stderr)
[[ "$EDID_OUT" == *"Reinicia"* ]] && PENDING+=("Reiniciar el equipo para que el EDID tome efecto")

step "3/5 Brillo automático de GNOME"
if gsettings set org.gnome.settings-daemon.plugins.power ambient-enabled false 2>/dev/null; then
    echo "Desactivado (F5/F6 y el brillo por pantalla no pelean con GNOME)"
else
    PENDING+=("Desactivar el brillo automático: gsettings set org.gnome.settings-daemon.plugins.power ambient-enabled false")
fi

step "4/5 Disposición de pantallas en el inicio de sesión"
if gdctl show 2>/dev/null | grep -q "Serial: eDP-2" && [[ -r "$HOME/.config/monitors.xml" ]]; then
    "$DIR/install-login-screen-layout.sh" || PENDING+=("Dejar la pantalla inferior debajo de la superior y ejecutar ./install-login-screen-layout.sh")
else
    echo "Omitido: el EDID aún no está cargado o no existe ~/.config/monitors.xml"
    PENDING+=("Tras reiniciar y volver a entrar: ./install-all.sh (o ./install-login-screen-layout.sh)")
fi

step "5/5 Extensiones de GNOME"
for ext in "$DIR"/gnome-extension/*@*; do
    uuid=$(basename "$ext")
    if gnome-extensions list 2>/dev/null | grep -qx "$uuid"; then
        gnome-extensions enable "$uuid" 2>/dev/null && echo "habilitada: $uuid"
    else
        echo "pendiente (GNOME aún no la conoce): $uuid"
        MISSING=1
    fi
done
[[ -n "$MISSING" ]] && PENDING+=("Cerrar sesión y volver a entrar para cargar las extensiones, y ejecutar ./install-all.sh otra vez")

echo
if ((${#PENDING[@]})); then
    echo "Falta:"
    printf '  • %s\n' "${PENDING[@]}"
else
    echo "Todo instalado y habilitado."
fi
