import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const SCHEMA = 'org.gnome.settings-daemon.plugins.power';
const KEY = 'ambient-enabled';

const AutoBrightnessToggle = GObject.registerClass(
class AutoBrightnessToggle extends QuickToggle {
    _init(settings) {
        super._init({
            title: 'Brillo automático',
            iconName: 'display-brightness-symbolic',
            toggleMode: true,
        });

        this._settings = settings;
        this._sync();

        // El valor también cambia desde Configuración o con gsettings.
        this._settingsId = this._settings.connect(`changed::${KEY}`, () => this._sync());

        this.connect('clicked', () => this._settings.set_boolean(KEY, this.checked));
    }

    _sync() {
        const on = this._settings.get_boolean(KEY);
        if (this.checked !== on)
            this.checked = on;
        this.subtitle = on ? 'Activado' : 'Desactivado';
    }

    destroy() {
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = null;
        }
        super.destroy();
    }
});

const AutoBrightnessIndicator = GObject.registerClass(
class AutoBrightnessIndicator extends SystemIndicator {
    _init(settings) {
        super._init();
        this.quickSettingsItems.push(new AutoBrightnessToggle(settings));
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

export default class BrilloAutomaticoExtension extends Extension {
    enable() {
        const source = Gio.SettingsSchemaSource.get_default();
        if (!source?.lookup(SCHEMA, true)) {
            console.error(`brillo-automatico: no existe el esquema ${SCHEMA}`);
            return;
        }
        this._settings = new Gio.Settings({schemaId: SCHEMA});
        this._indicator = new AutoBrightnessIndicator(this._settings);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
