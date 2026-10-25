import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Al arrastrar una ventana aparece, en el centro de cada pantalla del notebook (eDP-1 y eDP-2),
// un panel con un icono Arriba y otro Abajo. Al soltar la ventana sobre uno, se manda a esa
// pantalla, igual que Super+Shift+flecha. Solo actúa si están ambas pantallas del notebook;
// los monitores externos se ignoran.
const MOVING = [Meta.GrabOp.MOVING, Meta.GrabOp.MOVING_UNCONSTRAINED];
const POLL_MS = 50;
const PANELS = ['eDP-1', 'eDP-2'];

export default class SoltarEnPantallaExtension extends Extension {
    enable() {
        this._panels = [];
        this._pollId = 0;
        this._window = null;
        this._signals = [
            global.display.connect('grab-op-begin', (_d, window, op) => this._begin(window, op)),
            global.display.connect('grab-op-end', (_d, window, op) => this._end(window, op)),
        ];
    }

    disable() {
        this._signals.forEach(id => global.display.disconnect(id));
        this._signals = [];
        this._hide();
    }

    // Pantallas integradas del notebook (se identifican por conector: con un monitor externo los
    // índices no sirven), ordenadas de arriba a abajo. Un monitor externo se ignora.
    _monitors() {
        const manager = global.backend.get_monitor_manager();
        return PANELS
            .map(c => manager.get_monitor_for_connector(c))
            .filter(i => i >= 0)
            .map(index => ({index, rect: global.display.get_monitor_geometry(index)}))
            .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    }

    _begin(window, op) {
        if (!window || !MOVING.includes(op))
            return;
        const monitors = this._monitors();
        if (monitors.length < 2)
            return;

        this._window = window;
        // Estado previo al arrastre, para devolver la ventana a su sitio antes de cambiarla de pantalla.
        this._origRect = window.get_frame_rect();
        this._origMaximized = window.is_maximized?.() ?? false;
        this._zones = [];
        this._panels = [];
        const names = monitors.length === 2
            ? ['Arriba', 'Abajo']
            : monitors.map((_m, i) => `Pantalla ${i + 1}`);

        // Un panel con un icono por pantalla, repetido y centrado en cada una de ellas.
        for (const host of monitors) {
            const panel = new St.BoxLayout({style_class: 'soltar-panel', vertical: true, reactive: false});
            monitors.forEach((target, i) => {
                const zone = new St.BoxLayout({style_class: 'soltar-zona'});
                // Contenido en una caja que se expande y centra, para que quede en medio del cuadro.
                const content = new St.BoxLayout({
                    vertical: true,
                    x_expand: true,
                    y_expand: true,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                content.add_child(new St.Icon({icon_name: 'video-display-symbolic', icon_size: 36, x_align: Clutter.ActorAlign.CENTER}));
                content.add_child(new St.Label({text: names[i], x_align: Clutter.ActorAlign.CENTER}));
                zone.add_child(content);
                panel.add_child(zone);
                this._zones.push({zone, monitor: target.index});
            });
            Main.layoutManager.addTopChrome(panel);

            // Se recalcula al recibir el tamaño real, porque antes de eso el panel mide 0.
            const {x, y, width, height} = host.rect;
            const center = () => panel.set_position(
                Math.round(x + (width - panel.width) / 2),
                Math.round(y + (height - panel.height) / 2));
            panel.connect('notify::allocation', center);
            center();
            this._panels.push(panel);
        }

        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
            this._highlight(this._zoneAtPointer());
            return GLib.SOURCE_CONTINUE;
        });
    }

    _zoneAtPointer() {
        if (!this._panels?.length)
            return null;
        const [px, py] = global.get_pointer();
        return this._zones.find(({zone}) => {
            const [x, y] = zone.get_transformed_position();
            const [w, h] = zone.get_transformed_size();
            return px >= x && px <= x + w && py >= y && py <= y + h;
        }) ?? null;
    }

    _highlight(hit) {
        this._zones?.forEach(z => {
            z.zone.style_class = hit && z.monitor === hit.monitor ? 'soltar-zona activa' : 'soltar-zona';
        });
    }

    _end(window, op) {
        if (!this._panels?.length || window !== this._window || !MOVING.includes(op))
            return;
        const hit = this._zoneAtPointer();
        const rect = this._origRect;
        const wasMaximized = this._origMaximized;
        this._hide();
        if (hit) {
            // Se mueve fuera del callback para que el grab ya esté liberado. Primero se devuelve
            // la ventana a su posición original y luego se cambia de pantalla, como Super+Shift+flecha.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (wasMaximized) {
                    window.maximize();
                } else {
                    window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
                }
                if (window.get_monitor() !== hit.monitor)
                    window.move_to_monitor(hit.monitor);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _hide() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
        this._panels?.forEach(panel => {
            Main.layoutManager.removeChrome(panel);
            panel.destroy();
        });
        this._panels = [];
        this._zones = [];
        this._window = null;
    }
}
