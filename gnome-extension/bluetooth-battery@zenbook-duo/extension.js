import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Muestra en Ajustes rápidos cada dispositivo Bluetooth conectado que informe su batería
// (nombre, barra y porcentaje). Los datos salen de BlueZ por D-Bus (org.bluez.Battery1), sin
// sondeo: se vuelve a leer cuando BlueZ avisa de un cambio (nivel, conexión, alta o baja).
const BLUEZ = 'org.bluez';
const REFRESH_MS = 300;   // antirrebote: BlueZ emite varias señales seguidas
const LOW = 20;           // por debajo de este nivel la barra se pone roja

Gio._promisify(Gio.DBusConnection.prototype, 'call', 'call_finish');

const BatteryRow = GObject.registerClass(
class BatteryRow extends St.BoxLayout {
    _init() {
        super._init({style: 'spacing: 10px; padding: 3px 0;', x_expand: true});

        this._icon = new St.Icon({icon_name: 'bluetooth-symbolic', icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER});
        this._name = new St.Label({y_align: Clutter.ActorAlign.CENTER, x_expand: true,
            x_align: Clutter.ActorAlign.START});
        this._name.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END

        this._track = new St.Widget({
            style: 'background-color: rgba(128,128,128,0.35); border-radius: 3px; height: 6px; width: 90px;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._fill = new St.Widget({style: 'border-radius: 3px; height: 6px;', width: 0});
        this._track.add_child(this._fill);

        this._pct = new St.Label({y_align: Clutter.ActorAlign.CENTER, style: 'min-width: 3em;',
            x_align: Clutter.ActorAlign.END});

        this.add_child(this._icon);
        this.add_child(this._name);
        this.add_child(this._track);
        this.add_child(this._pct);
    }

    update(name, iconName, percent) {
        this._name.text = name;
        this._icon.icon_name = iconName;
        this._pct.text = `${percent} %`;
        const color = percent <= LOW ? '#e5484d' : '#57c26b';
        this._fill.style = `background-color: ${color}; border-radius: 3px; height: 6px;`;
        this._fill.width = Math.round(90 * Math.min(100, percent) / 100);
    }
});

const BatteryList = GObject.registerClass(
class BatteryList extends St.BoxLayout {
    _init() {
        super._init({vertical: true, x_expand: true, style: 'padding: 4px 12px;', visible: false});
        this._rows = [];
    }

    // devices: [{name, icon, percent}]
    setDevices(devices) {
        while (this._rows.length < devices.length) {
            const row = new BatteryRow();
            this._rows.push(row);
            this.add_child(row);
        }
        while (this._rows.length > devices.length)
            this._rows.pop().destroy();
        devices.forEach((d, i) => this._rows[i].update(d.name, d.icon, d.percent));
        this.visible = devices.length > 0;
    }
});

export default class BluetoothBatteryExtension extends Extension {
    enable() {
        this._list = new BatteryList();
        Main.panel.statusArea.quickSettings.menu.addItem(this._list, 2);

        const bus = Gio.DBus.system;
        this._subs = [
            ['org.freedesktop.DBus.Properties', 'PropertiesChanged', 'org.bluez.Battery1'],
            ['org.freedesktop.DBus.Properties', 'PropertiesChanged', 'org.bluez.Device1'],
            ['org.freedesktop.DBus.ObjectManager', 'InterfacesAdded', null],
            ['org.freedesktop.DBus.ObjectManager', 'InterfacesRemoved', null],
        ].map(([iface, signal, arg0]) => bus.signal_subscribe(BLUEZ, iface, signal, null, arg0,
            Gio.DBusSignalFlags.NONE, () => this._schedule()));
        this._refresh();
    }

    _schedule() {
        if (this._timeout)
            return;
        this._timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REFRESH_MS, () => {
            this._timeout = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _refresh() {
        let devices = [];
        try {
            const reply = await Gio.DBus.system.call(BLUEZ, '/',
                'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects', null, null,
                Gio.DBusCallFlags.NONE, -1, null);
            const [objects] = reply.recursiveUnpack();
            for (const ifaces of Object.values(objects)) {
                const dev = ifaces['org.bluez.Device1'];
                const bat = ifaces['org.bluez.Battery1'];
                if (!dev || !bat || !dev.Connected)
                    continue;
                devices.push({
                    name: dev.Alias ?? dev.Name ?? dev.Address,
                    icon: dev.Icon ? `${dev.Icon}-symbolic` : 'bluetooth-symbolic',
                    percent: bat.Percentage,
                });
            }
            devices.sort((a, b) => a.name.localeCompare(b.name));
        } catch (e) {
            // BlueZ no está (adaptador ausente o servicio parado): se oculta la lista
            devices = [];
        }
        if (this._list)
            this._list.setDevices(devices);
    }

    disable() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = 0;
        }
        this._subs?.forEach(id => Gio.DBus.system.signal_unsubscribe(id));
        this._subs = null;
        this._list?.destroy();
        this._list = null;
    }
}
