import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const ZENBOOK = '/usr/local/bin/zenbook-screen-rotation';
const AUTO_SERVICE = 'zenbook-screen-rotation.service';

// clave de `zenbook-screen-rotation` → [etiqueta, ícono, valor de Transform en gdctl]
const ORIENTATIONS = {
    normal:   ['Normal',    'object-rotate-left-symbolic', 'normal'],
    left:     ['Izquierda', 'object-rotate-left-symbolic', '90'],
    right:    ['Derecha',   'object-rotate-right-symbolic', '270'],
    inverted: ['Invertida', 'view-refresh-symbolic', '180'],
};

const RotationToggle = GObject.registerClass(
class RotationToggle extends QuickMenuToggle {
    _init() {
        super._init({
            title: 'Rotación',
            iconName: 'object-rotate-left-symbolic',
            toggleMode: false,
        });

        this.menu.setHeader('object-rotate-left-symbolic', 'Rotación de pantalla');

        this._current = 'normal';
        this._lastRotated = 'left';
        this._busy = false;
        this._items = {};

        for (const [key, [label]] of Object.entries(ORIENTATIONS)) {
            const item = this.menu.addAction(label, () => this._apply(key));
            this._items[key] = item;
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._autoItem = new PopupMenu.PopupSwitchMenuItem('Automática', false);
        this._autoItem.connect('toggled', (_item, state) => this._setAuto(state));
        this.menu.addMenuItem(this._autoItem);
        this._readAuto();

        this._updateUi();
        this._readCurrent();
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            this._busy = false;
            this._readCurrent();
        });

        // Clic en el botón: alterna entre normal y la última rotación usada.
        this.connect('clicked', () =>
            this._apply(this._current === 'normal' ? this._lastRotated : 'normal'));
    }

    _updateUi() {
        this.checked = this._current !== 'normal';
        this.subtitle = ORIENTATIONS[this._current][0];
        for (const [key, item] of Object.entries(this._items))
            item.setOrnament(key === this._current ? 4 : 0); // 4 = CHECK
    }

    _systemctl(args, callback) {
        try {
            const proc = Gio.Subprocess.new(['systemctl', '--user', ...args],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.wait_async(null, (p, res) => {
                try {
                    p.wait_finish(res);
                    callback?.(p.get_successful());
                } catch (e) {
                    console.error(`rotacion-pantalla: ${e}`);
                }
            });
        } catch (e) {
            console.error(`rotacion-pantalla: ${e}`);
        }
    }

    _readAuto() {
        this._systemctl(['is-active', '--quiet', AUTO_SERVICE],
            active => this._autoItem.setToggleState(active));
    }

    _setAuto(state) {
        this._systemctl([state ? 'enable' : 'disable', '--now', AUTO_SERVICE],
            () => this._readAuto());
    }

    _readCurrent() {
        try {
            const proc = Gio.Subprocess.new(['gdctl', 'show'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, out] = p.communicate_utf8_finish(res);
                    const m = out.match(/Transform:\s*(\S+)/);
                    if (!m)
                        return;
                    const key = Object.keys(ORIENTATIONS)
                        .find(k => ORIENTATIONS[k][2] === m[1]);
                    if (key) {
                        this._current = key;
                        if (key !== 'normal')
                            this._lastRotated = key;
                        this._updateUi();
                    }
                } catch (e) {
                    console.error(`rotacion-pantalla: ${e}`);
                }
            });
        } catch (e) {
            console.error(`rotacion-pantalla: ${e}`);
        }
    }

    _apply(key) {
        if (this._busy || key === this._current)
            return;
        this._busy = true;
        this.menu.close();
        try {
            const proc = Gio.Subprocess.new([ZENBOOK, key],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.wait_async(null, () => {
                this._busy = false;
                this._readCurrent();
            });
        } catch (e) {
            console.error(`rotacion-pantalla: ${e}`);
            this._busy = false;
        }
    }

    destroy() {
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }
        super.destroy();
    }
});

const RotationIndicator = GObject.registerClass(
class RotationIndicator extends SystemIndicator {
    _init() {
        super._init();
        this.quickSettingsItems.push(new RotationToggle());
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

export default class RotacionPantallaExtension extends Extension {
    enable() {
        this._indicator = new RotationIndicator();
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
