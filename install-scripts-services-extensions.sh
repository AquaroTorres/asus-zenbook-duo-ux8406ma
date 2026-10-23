#!/bin/bash
# Instala los scripts zenbook-*, los servicios y las extensiones de GNOME.
#
# Activos por defecto: zenbook-hotkeys, zenbook-screen-rotation, zenbook-microphone, zenbook-keyboard-monitor
# (apaga la pantalla inferior al conectar el teclado por USB, la enciende al desconectarlo y
# reaplica el bloqueo Fn y la luz de F9 al aparecer el teclado).
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Dependencias"
sudo pacman -S --needed --noconfirm \
    python-pyusb inotify-tools iio-sensor-proxy xorg-xinput bluez-utils libpulse

echo "==> Scripts en /usr/local/bin"
for s in "$DIR"/scripts/zenbook-*; do
    sudo install -m 755 "$s" /usr/local/bin/
done
# Hook de suspensión: apaga la luz del teclado al suspender y la restaura al despertar
sudo ln -sf /usr/local/bin/zenbook-keyboard-backlight-sleep /usr/lib/systemd/system-sleep/zenbook-keyboard-backlight-sleep

# Nombres anteriores (los scripts se renombraron con nombres descriptivos en inglés): se retiran
# los ejecutables viejos para no dejar duplicados ni enlaces rotos. zenbook-inicio y zenbook-power se eliminaron.
for old in zenbook-kb zenbook-bt zenbook-bt-kb zenbook-monitor zenbook-inferior-screen zenbook-rotate \
           zenbook-swap zenbook-screenkey zenbook-fnlock zenbook-mic zenbook-inicio zenbook-power; do
    sudo rm -f "/usr/local/bin/$old"
done
sudo rm -f /lib/systemd/system-sleep/zenbook-power /etc/systemd/system/zenbook-boot.service

echo "==> Configuración /etc/zenbook-duo.conf (no se sobrescribe si ya existe)"
[[ -f /etc/zenbook-duo.conf ]] || sudo install -m 644 -o root -g root "$DIR/zenbook-duo.conf" /etc/zenbook-duo.conf

sudo rm -f /etc/sudoers.d/zenbook-kb   # nombre anterior del archivo
echo "==> Sudoers (sin contraseña para zenbook-keyboard-backlight, zenbook-fn-lock y zenbook-microphone)"
echo "$USER ALL=NOPASSWD:/usr/local/bin/zenbook-keyboard-backlight, /usr/local/bin/zenbook-fn-lock, /usr/local/bin/zenbook-microphone" | sudo tee /etc/sudoers.d/zenbook-duo > /dev/null
sudo chmod 440 /etc/sudoers.d/zenbook-duo
sudo visudo -cf /etc/sudoers.d/zenbook-duo

echo "==> Regla udev (hidraw legible sin root)"
sudo install -m 644 "$DIR/udev/99-zenbook-keyboard.rules" /etc/udev/rules.d/
sudo udevadm control --reload-rules
sudo usermod -aG input "$USER"

echo "==> Servicios de usuario"
mkdir -p "$HOME/.config/systemd/user"
# Servicios con nombres anteriores: se detienen y se retiran
for old in zenbook-screenkey zenbook-autorotate zenbook-mic zenbook-monitor zenbook-inicio; do
    systemctl --user disable --now "$old.service" 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/$old.service"
done
cp "$DIR"/systemd/user/*.service "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now zenbook-hotkeys.service zenbook-screen-rotation.service zenbook-microphone.service zenbook-keyboard-monitor.service
# enable --now no reinicia un servicio que ya corre: sin esto seguiría con el script anterior
systemctl --user restart zenbook-hotkeys.service zenbook-screen-rotation.service zenbook-microphone.service zenbook-keyboard-monitor.service

echo "==> Extensiones de GNOME"
# Retiradas: sus avisos pasaron a osd-zenbook (indicador inferior) y se quitó el icono de la barra
for uuid in luz-teclado@atorres bloqueo-fn@atorres pantalla-secundaria@atorres; do
    gnome-extensions disable "$uuid" 2>/dev/null || true
    rm -rf "$HOME/.local/share/gnome-shell/extensions/$uuid"
done
for ext in "$DIR"/gnome-extension/*@*; do
    uuid=$(basename "$ext")
    mkdir -p "$HOME/.local/share/gnome-shell/extensions/$uuid"
    cp "$ext"/* "$HOME/.local/share/gnome-shell/extensions/$uuid/"
    gnome-extensions enable "$uuid" || true
done

echo "Listo. Cierra sesión y vuelve a entrar (Wayland) para ver las extensiones y el grupo input."
