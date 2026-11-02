import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Mueve la ventana activa a la otra pantalla (tecla F8). Mover ventanas solo lo puede hacer el
// Shell, así que se expone por D-Bus en la conexión del propio Shell; lo llama el script
// zenbook-move-window:
//   gdbus call --session --dest org.gnome.Shell --object-path /org/zenbook/Windows \
//       --method org.zenbook.Windows.MoveActive
const OBJECT_PATH = '/org/zenbook/Windows';
const IFACE = `
<node>
  <interface name="org.zenbook.Windows">
    <method name="MoveActive"/>
  </interface>
</node>`;
const PANELS = ['eDP-1', 'eDP-2'];
const MOVABLE = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG];

class WindowsService {
    MoveActive() {
        // Se identifican las dos pantallas integradas por su conector: con un monitor externo
        // los índices de monitor no sirven.
        const manager = global.backend.get_monitor_manager();
        const [top, bottom] = PANELS.map(c => manager.get_monitor_for_connector(c));
        if (top < 0 || bottom < 0 || top === bottom) {
            console.log('move-window: omitido (falta una de las dos pantallas)');
            return;
        }

        const window = global.display.focus_window;
        if (!window || !MOVABLE.includes(window.get_window_type())) {
            console.log('move-window: omitido (no hay ventana activa que mover)');
            return;
        }
        const monitor = window.get_monitor();
        if (monitor !== top && monitor !== bottom) {
            console.log('move-window: omitido (la ventana activa está en otro monitor)');
            return;
        }
        window.move_to_monitor(monitor === top ? bottom : top);
        console.log(`move-window: ventana activa movida a ${monitor === top ? PANELS[1] : PANELS[0]}`);
    }
}

export default class MoverVentanaExtension extends Extension {
    enable() {
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, new WindowsService());
        this._dbus.export(Gio.DBus.session, OBJECT_PATH);
    }

    disable() {
        this._dbus?.unexport();
        this._dbus = null;
    }
}
