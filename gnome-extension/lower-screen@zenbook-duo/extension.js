import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const ZENBOOK = '/usr/local/bin/zenbook-lower-screen';

const LowerScreenToggle = GObject.registerClass(
class LowerScreenToggle extends QuickToggle {
    _init() {
        super._init({
            title: 'Pantalla inferior',
            iconName: 'video-display-symbolic',
            toggleMode: false,
        });

        this._busy = false;
        this._sync();
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            this._busy = false;
            this._sync();
        });

        this.connect('clicked', () => this._toggle());
    }

    _sync() {
        const on = Main.layoutManager.monitors.length >= 2;
        this.checked = on;
        this.subtitle = on ? 'Encendida' : 'Apagada';
    }

    _toggle() {
        if (this._busy)
            return;
        this._busy = true;
        this.subtitle = '…';
        try {
            const proc = Gio.Subprocess.new([ZENBOOK, 'toggle'],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.wait_async(null, () => {
                this._busy = false;
                this._sync();
            });
        } catch (e) {
            console.error(`lower-screen: ${e}`);
            this._busy = false;
            this._sync();
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

const LowerScreenIndicator = GObject.registerClass(
class LowerScreenIndicator extends SystemIndicator {
    _init() {
        super._init();
        this.quickSettingsItems.push(new LowerScreenToggle());
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

export default class PantallaInferiorExtension extends Extension {
    enable() {
        this._indicator = new LowerScreenIndicator();
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
