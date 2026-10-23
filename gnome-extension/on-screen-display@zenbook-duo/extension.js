import Gio from 'gi://Gio';
import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Los scripts zenbook-* no pueden mostrar el OSD de GNOME (org.gnome.Shell.ShowOSD
// responde AccessDenied a procesos externos), así que esta extensión expone un
// objeto D-Bus en la conexión del propio Shell:
//
//   gdbus call --session --dest org.gnome.Shell --object-path /org/zenbook/Osd \
//       --method org.zenbook.Osd.Show icono "texto" 0.5       # con barra, nivel 0..1
//   gdbus call ... --method org.zenbook.Osd.ShowText icono "texto"   # sin barra
//   gdbus call ... --method org.zenbook.Osd.ShowState icono "texto" true|false
//                                         # sin barra; con false el icono sale atenuado
//
// "icono" puede ser una lista separada por comas ("preferido,respaldo"): se usa el
// primero que exista en el tema.
const OBJECT_PATH = '/org/zenbook/Osd';
const IFACE = `
<node>
  <interface name="org.zenbook.Osd">
    <method name="Show">
      <arg type="s" direction="in" name="icon"/>
      <arg type="s" direction="in" name="label"/>
      <arg type="d" direction="in" name="level"/>
    </method>
    <method name="ShowText">
      <arg type="s" direction="in" name="icon"/>
      <arg type="s" direction="in" name="label"/>
    </method>
    <method name="ShowState">
      <arg type="s" direction="in" name="icon"/>
      <arg type="s" direction="in" name="label"/>
      <arg type="b" direction="in" name="on"/>
    </method>
  </interface>
</node>`;

// Papirus dibuja sus iconos de mute con opacity .35 dentro del SVG; el icono de
// "apagado" se atenúa igual (0.35 * 255).
const DIM_OPACITY = 89;

class OsdService {
    constructor() {
        this._dim = false;

        // La ventana del OSD es compartida con el volumen nativo: la opacidad del icono
        // se fija en cada aviso (atenuada solo en los nuestros "apagado") para que no
        // se arrastre al siguiente.
        this._injections = new InjectionManager();
        const self = this;
        this._injections.overrideMethod(Object.getPrototypeOf(Main.osdWindowManager), '_showOsdWindow',
            original => function (monitorIndex, ...args) {
                original.call(this, monitorIndex, ...args);
                const window = this._osdWindows[monitorIndex];
                if (window)
                    window._icon.opacity = self._dim ? DIM_OPACITY : 255;
            });
    }

    destroy() {
        this._injections.clear();
        for (const window of Main.osdWindowManager._osdWindows) {
            if (window)
                window._icon.opacity = 255;
        }
    }

    _icon(names) {
        return Gio.ThemedIcon.new_from_names(names.split(',').map(n => n.trim()).filter(Boolean));
    }

    _show(icon, label, level, maxLevel, dim) {
        this._dim = dim;
        try {
            Main.osdWindowManager.showAll(this._icon(icon), label || null, level, maxLevel);
        } finally {
            this._dim = false;
        }
    }

    // El valor de BarLevel está declarado en 0..2 y GNOME lo anima con ease_property,
    // que respeta ese rango: por eso el nivel se normaliza siempre a 0..1.
    Show(icon, label, level) {
        this._show(icon, label, Math.max(0, Math.min(1, level)), 1, false);
    }

    ShowText(icon, label) {
        this._show(icon, label, null, null, false);
    }

    ShowState(icon, label, on) {
        this._show(icon, label, null, null, !on);
    }
}

export default class OsdZenbookExtension extends Extension {
    enable() {
        this._service = new OsdService();
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this._service);
        this._dbus.export(Gio.DBus.session, OBJECT_PATH);
    }

    disable() {
        this._dbus?.unexport();
        this._dbus = null;
        this._service?.destroy();
        this._service = null;
    }
}
