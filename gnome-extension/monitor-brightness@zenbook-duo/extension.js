// Brillo por pantalla: un slider por pantalla en Ajustes rápidos (habilitada por el usuario el 2026-11-09 por comodidad).
//
// Historia (2026-11-09): en una sesión de GNOME 50 (Mutter 50.5, kernel 7.3.0rc6), el
// slider de brillo de eDP-2 movía intel_backlight (el de eDP-1) y no
// card1-eDP-2-backlight: ambos sliders actuaban sobre el panel superior. Se midió con
// org.gnome.Mutter.DisplayConfig.SetBacklight(serial, 'eDP-2', valor): cambiaba
// intel_backlight. El EDID de eDP-2 estaba bien cargado (serial «eDP-2») y los dos
// conectores figuraban `enabled`. Apagar y encender la pantalla inferior NO lo arregló.
// Según el código de Mutter, el backlight se elige por el nombre del conector
// (meta_udev_backlight_find_for_connector: el padre DRM debe terminar en «-eDP-2» y estar
// `enabled`) y, si no coincide, cae al primer backlight «raw» (intel_backlight); esa
// elección se conserva toda la sesión. Tras cerrar sesión y volver a entrar, Mutter eligió
// bien y los sliders de GNOME volvieron a ser independientes, sin tocar nada más. Causa
// exacta: no determinada (probablemente la elección de esa sesión, no el kernel).
//
// Esta extensión reemplaza el slider de GNOME por dos, uno por pantalla, que escriben
// directo en cada backlight vía logind (como zenbook-brightness), sin pasar por Mutter.
// Sigue siendo útil aunque el slider nativo vuelva a funcionar bien (es más cómoda) y
// protege si el problema se repite. El instalador la habilita con las demás. Probado fuera
// del Shell: la escritura por logind; en el Shell real la usa el usuario a diario.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickSlider} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import GObject from 'gi://GObject';

Gio._promisify(Gio.DBusConnection.prototype, 'call', 'call_finish');

const SYSFS = '/sys/class/backlight';
const MIN = 4;                // el mismo mínimo que usa GNOME (400 pasos)
const COLUMNS = 2;            // N_QUICK_SETTINGS_COLUMNS del Shell

// Dispositivo de backlight de cada pantalla. GNOME 50 (mutter) manda el brillo de
// eDP-2 a intel_backlight, por eso aquí se escribe directo en cada dispositivo.
const PANELS = [
    {connector: 'eDP-1', title: 'Superior', match: n => n === 'intel_backlight'},
    {connector: 'eDP-2', title: 'Inferior', match: n => n.endsWith('eDP-2-backlight')},
];

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes).trim() : null;
    } catch (_e) {
        return null;
    }
}

function listDir(path) {
    try {
        const dir = Gio.File.new_for_path(path);
        const en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        const names = [];
        let info;
        while ((info = en.next_file(null)))
            names.push(info.get_name());
        return names;
    } catch (_e) {
        return [];
    }
}

// Escritura vía logind (no requiere root en la sesión activa), como gsd-power
class Logind {
    constructor() {
        this._sessionPath = null;
    }

    async _session() {
        if (this._sessionPath)
            return this._sessionPath;
        const bus = Gio.DBus.system;
        const user = (await bus.call('org.freedesktop.login1', '/org/freedesktop/login1',
            'org.freedesktop.login1.Manager', 'GetUser',
            new GLib.Variant('(u)', [new Gio.Credentials().get_unix_user()]),
            null, Gio.DBusCallFlags.NONE, -1, null)).deepUnpack()[0];
        const res = await bus.call('org.freedesktop.login1', user,
            'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.freedesktop.login1.User', 'Display']),
            null, Gio.DBusCallFlags.NONE, -1, null);
        this._sessionPath = res.deepUnpack()[0].deepUnpack()[1];
        return this._sessionPath;
    }

    async setBrightness(device, value) {
        try {
            const path = await this._session();
            await Gio.DBus.system.call('org.freedesktop.login1', path,
                'org.freedesktop.login1.Session', 'SetBrightness',
                new GLib.Variant('(ssu)', ['backlight', device, value]),
                null, Gio.DBusCallFlags.NONE, -1, null);
        } catch (e) {
            console.error(`monitor-brightness: ${e.message}`);
        }
    }
}

const PanelSlider = GObject.registerClass(
class PanelSlider extends QuickSlider {
    _init(panel, logind) {
        super._init({
            iconName: 'display-brightness-symbolic',
            iconLabel: `Brillo de la pantalla ${panel.title.toLowerCase()}`,
        });
        this._panel = panel;
        this._logind = logind;
        this._device = null;
        this._max = 400;
        this._blocked = false;
        this._monitor = null;

        this.slider.accessible_name = `Brillo ${panel.title.toLowerCase()}`;

        // Etiqueta entre el icono y la barra para saber a qué pantalla corresponde
        const label = new St.Label({
            text: panel.title,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'min-width: 4.5em; padding-right: 6px;',
        });
        this.get_child().insert_child_at_index(label, 1);

        this._sliderId = this.slider.connect('notify::value', () => this._onSlider());
        this.refresh();
    }

    _findDevice() {
        return listDir(SYSFS).find(n => this._panel.match(n)) ?? null;
    }

    // La pantalla está activa si Mutter la tiene como monitor (misma comprobación que move-window)
    _panelEnabled() {
        const mm = global.backend.get_monitor_manager();
        return mm.get_monitor_for_connector(this._panel.connector) >= 0;
    }

    // Actualiza visibilidad y valor del slider desde sysfs
    refresh() {
        const device = this._findDevice();
        if (device !== this._device) {
            this._monitor?.cancel();
            this._monitor = null;
            this._device = device;
            if (device) {
                this._max = parseInt(readText(`${SYSFS}/${device}/max_brightness`)) || 400;
                const file = Gio.File.new_for_path(`${SYSFS}/${device}/brightness`);
                this._monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
                this._monitor.connect('changed', () => this._readValue());
            }
        }
        // Con la pantalla apagada (p. ej. teclado por USB) su slider se oculta y queda uno solo
        this.visible = !!device && this._panelEnabled();
        if (device)
            this._readValue();
    }

    _readValue() {
        const raw = parseInt(readText(`${SYSFS}/${this._device}/brightness`));
        if (Number.isNaN(raw))
            return;
        const v = Math.min(1, Math.max(0, (raw - MIN) / (this._max - MIN)));
        if (Math.abs(this.slider.value - v) < 0.002)
            return;
        this._blocked = true;
        this.slider.value = v;
        this._blocked = false;
    }

    _onSlider() {
        if (this._blocked || !this._device)
            return;
        const value = Math.round(MIN + this.slider.value * (this._max - MIN));
        this._logind.setBrightness(this._device, value);
    }

    destroy() {
        this._monitor?.cancel();
        this._monitor = null;
        super.destroy();
    }
});

export default class MonitorBrightnessExtension extends Extension {
    enable() {
        const qs = Main.panel.statusArea.quickSettings;
        this._qs = qs;
        this._logind = new Logind();
        this._native = qs._brightness?.quickSettingsItems?.[0] ?? null;

        // Los sliders propios se colocan donde estaba el de GNOME, que se oculta
        this._sliders = PANELS.map(p => new PanelSlider(p, this._logind));
        for (const s of this._sliders)
            qs.menu.insertItemBefore(s, this._native, COLUMNS);

        if (this._native) {
            this._native.hide();
            // BrightnessItem vuelve a mostrarse en cada cambio: se vuelve a ocultar
            this._visibleId = this._native.connect('notify::visible', () => {
                if (this._native.visible)
                    this._native.hide();
            });
        }

        // Se actualiza cuando el Shell avisa de que cambiaron las pantallas (encender/apagar la inferior)
        this._monitorsId = Main.layoutManager.connect('monitors-changed',
            () => this._sliders?.forEach(s => s.refresh()));
    }

    disable() {
        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = null;
        }
        if (this._native && this._visibleId) {
            this._native.disconnect(this._visibleId);
            this._visibleId = null;
        }
        this._sliders?.forEach(s => s.destroy());
        this._sliders = null;
        // Restituye el slider de GNOME según su propia lógica
        this._native?._sync?.();
        this._native = null;
        this._logind = null;
        this._qs = null;
    }
}
