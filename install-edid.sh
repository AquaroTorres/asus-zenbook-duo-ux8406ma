#!/bin/bash
# Instala el EDID personalizado de eDP-2 (arregla el mapeo de touchscreens y el brillo por panel).
#
# Ambos paneles traen el mismo EDID (SDC:419d, sin serial), así que GNOME no puede
# distinguirlos y manda los dos touchscreens y los dos sliders de brillo a eDP-1.
# edid/edp2.bin es el EDID de eDP-2 con serial "eDP-2". Es idempotente; requiere reinicio.
#
# Pasos: copia el binario a /lib/firmware/edid, lo incluye en el initramfs (i915 lo pide
# antes de montar el rootfs real; sin esto la carga falla en silencio con error -2) y
# agrega drm.edid_firmware a GRUB.
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
# El valor tras "eDP-2:" es relativo a /lib/firmware/: con ruta absoluta se duplica y falla.
EDID_PARAM="drm.edid_firmware=eDP-2:edid/edp2.bin"
REBOOT=""

echo "==> /lib/firmware/edid/edp2.bin"
sudo mkdir -p /lib/firmware/edid
sudo install -m 644 "$DIR/edid/edp2.bin" /lib/firmware/edid/edp2.bin

echo "==> initramfs (mkinitcpio FILES=)"
if grep -q "edp2.bin" /etc/mkinitcpio.conf; then
    echo "ya configurado"
else
    sudo sed -i "s|^FILES=()|FILES=(/lib/firmware/edid/edp2.bin)|" /etc/mkinitcpio.conf
    grep -q "edp2.bin" /etc/mkinitcpio.conf || { echo "Error: edita FILES= en /etc/mkinitcpio.conf a mano (no estaba vacío)" >&2; exit 1; }
    sudo mkinitcpio -P
    REBOOT=1
fi

echo "==> GRUB ($EDID_PARAM)"
if grep -q "$EDID_PARAM" /etc/default/grub; then
    echo "ya configurado"
else
    sudo sed -i "s|GRUB_CMDLINE_LINUX_DEFAULT='\(.*\)'|GRUB_CMDLINE_LINUX_DEFAULT='\1 ${EDID_PARAM}'|" /etc/default/grub
    grep -q "$EDID_PARAM" /etc/default/grub || { echo "Error: agrega $EDID_PARAM a GRUB_CMDLINE_LINUX_DEFAULT a mano" >&2; exit 1; }
    sudo update-grub
    REBOOT=1
fi

[[ -n "$REBOOT" ]] && echo "Listo. Reinicia para que el EDID tome efecto y luego ejecuta: zenbook-touchscreen setup" \
    || echo "Todo estaba configurado."
