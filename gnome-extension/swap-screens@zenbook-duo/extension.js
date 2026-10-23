import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Intercambio de ventanas entre las dos pantallas (tecla F8). Mover ventanas solo lo puede
// hacer el Shell, así que se expone por D-Bus en la conexión del propio Shell; lo llama el
// script zenbook-swap-screens:
//   gdbus call --session --dest org.gnome.Shell --object-path /org/zenbook/Screens \
//       --method org.zenbook.Screens.Swap
const OBJECT_PATH = '/org/zenbook/Screens';
const IFACE = `
<node>
  <interface name="org.zenbook.Screens">
    <method name="Swap"/>
  </interface>
</node>`;
const PANELS = ['eDP-1', 'eDP-2'];
const SWAPPABLE = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG];

class ScreensService {
    Swap() {
        // Se identifican las dos pantallas integradas por su conector: con un monitor externo
        // los índices de monitor no sirven.
        const manager = global.backend.get_monitor_manager();
        const [top, bottom] = PANELS.map(c => manager.get_monitor_for_connector(c));
        if (top < 0 || bottom < 0 || top === bottom) {
            console.log('swap-screens: omitido (falta una de las dos pantallas)');
            return;
        }

        // Primero se decide el destino de cada ventana y después se mueven todas, para no
        // intercambiar dos veces las que acaban de cambiar de pantalla.
        const moves = [];
        for (const actor of global.get_window_actors()) {
            const window = actor.meta_window;
            if (!window || !SWAPPABLE.includes(window.get_window_type()))
                continue;
            const monitor = window.get_monitor();
            if (monitor === top)
                moves.push([window, bottom]);
            else if (monitor === bottom)
                moves.push([window, top]);
        }
        moves.forEach(([window, target]) => window.move_to_monitor(target));
        console.log(`swap-screens: ${moves.length} ventanas intercambiadas`);
    }
}

export default class IntercambioPantallasExtension extends Extension {
    enable() {
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, new ScreensService());
        this._dbus.export(Gio.DBus.session, OBJECT_PATH);
    }

    disable() {
        this._dbus?.unexport();
        this._dbus = null;
    }
}
