import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Al arrastrar una ventana aparece, debajo del puntero, un panel con una fila por pantalla (Arriba
// y Abajo) y cuatro iconos por fila: pantalla entera, mitades arriba/abajo, mitades izquierda/derecha
// y cuartos. Al soltar la ventana sobre una zona, se manda a esa pantalla y, salvo en «entera»
// (igual que Super+Shift+flecha), se redimensiona a esa fracción del área de trabajo. El panel queda
// unos OFFSET_PX por debajo del puntero (centrado en él), en la pantalla donde empieza el arrastre.
// Solo actúa si están ambas pantallas del notebook; los monitores externos se ignoran.
const MOVING = [Meta.GrabOp.MOVING, Meta.GrabOp.MOVING_UNCONSTRAINED];
const POLL_MS = 50;
const PANELS = ['eDP-1', 'eDP-2'];
const OFFSET_PX = 100;        // distancia entre el puntero y el borde superior del panel
const MARGIN = 12;            // separación mínima con el borde de la pantalla

// Disposiciones: cada una es una rejilla filas × columnas; cada celda es una zona de destino.
// «Entera» no redimensiona (conserva el comportamiento de mover a la otra pantalla).
const LAYOUTS = [
    {name: 'Entera', rows: 1, cols: 1, full: true},
    {name: 'Mitades verticales', rows: 1, cols: 2},
    {name: 'Mitades horizontales', rows: 2, cols: 1},
    {name: 'Cuartos', rows: 2, cols: 2},
];

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
            .map(connector => ({connector, index: manager.get_monitor_for_connector(connector)}))
            .filter(m => m.index >= 0)
            .map(m => ({...m, rect: global.display.get_monitor_geometry(m.index)}))
            .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    }

    // Pantalla del notebook que contiene el puntero (o null: p. ej. está sobre un monitor externo)
    _hostAt(monitors, px, py) {
        return monitors.find(({rect: r}) => px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height) ?? null;
    }

    _begin(window, op) {
        if (!window || !MOVING.includes(op))
            return;
        const monitors = this._monitors();
        if (monitors.length < 2)
            return;
        const [px, py] = global.get_pointer();
        const host = this._hostAt(monitors, px, py);
        if (!host)
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

        // Un solo panel: una fila por pantalla de destino, con una disposición por icono.
        {
            const panel = new St.BoxLayout({style_class: 'soltar-panel', vertical: true, reactive: false});
            monitors.forEach((target, i) => {
                const row = new St.BoxLayout({style_class: 'soltar-fila'});
                row.add_child(new St.Label({text: names[i], style_class: 'soltar-nombre', y_align: Clutter.ActorAlign.CENTER}));
                LAYOUTS.forEach(layout => row.add_child(this._buildTile(layout, target.index)));
                panel.add_child(row);
            });
            Main.layoutManager.addTopChrome(panel);

            // Se recalcula al recibir el tamaño real, porque antes de eso el panel mide 0.
            const place = () => {
                const [left, top] = this._position(host.rect, px, py, panel.width, panel.height);
                panel.set_position(left, top);
            };
            panel.connect('notify::allocation', place);
            place();
            this._panels.push(panel);
        }

        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
            this._highlight(this._zoneAtPointer());
            return GLib.SOURCE_CONTINUE;
        });
    }

    // Icono de una disposición: rejilla de zonas que se registran en this._zones con su fracción.
    _buildTile(layout, monitor) {
        const tile = new St.BoxLayout({style_class: 'soltar-tile', vertical: true, x_expand: false});
        for (let r = 0; r < layout.rows; r++) {
            const line = new St.BoxLayout({style_class: 'soltar-linea', x_expand: true, y_expand: true});
            for (let c = 0; c < layout.cols; c++) {
                const zone = new St.Bin({style_class: 'soltar-zona', x_expand: true, y_expand: true});
                line.add_child(zone);
                this._zones.push({
                    zone,
                    monitor,
                    full: !!layout.full,
                    frac: [c / layout.cols, r / layout.rows, 1 / layout.cols, 1 / layout.rows],
                });
            }
            tile.add_child(line);
        }
        return tile;
    }

    // Esquina superior izquierda del panel: centrado en horizontal sobre el puntero y OFFSET_PX por
    // debajo; si no cabe abajo, por encima. Siempre dentro de la pantalla.
    _position(rect, px, py, pw, ph) {
        const left = Math.max(rect.x + MARGIN, Math.min(px - pw / 2, rect.x + rect.width - pw - MARGIN));
        let top = py + OFFSET_PX;
        if (top + ph > rect.y + rect.height - MARGIN)
            top = py - OFFSET_PX - ph;
        top = Math.max(rect.y + MARGIN, Math.min(top, rect.y + rect.height - ph - MARGIN));
        return [Math.round(left), Math.round(top)];
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
            z.zone.style_class = z === hit ? 'soltar-zona activa' : 'soltar-zona';
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
                if (hit.full) {
                    if (wasMaximized)
                        window.maximize();
                    else
                        window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
                    if (window.get_monitor() !== hit.monitor)
                        window.move_to_monitor(hit.monitor);
                } else {
                    // Fracción de la pantalla: se des-maximiza, se cambia de pantalla y se ajusta
                    // al área de trabajo (sin paneles ni barras) de la pantalla de destino.
                    if (window.is_maximized?.())
                        window.unmaximize();
                    if (window.get_monitor() !== hit.monitor)
                        window.move_to_monitor(hit.monitor);
                    const area = window.get_work_area_for_monitor(hit.monitor);
                    const [fx, fy, fw, fh] = hit.frac;
                    const x0 = area.x + Math.round(fx * area.width);
                    const y0 = area.y + Math.round(fy * area.height);
                    const x1 = area.x + Math.round((fx + fw) * area.width);
                    const y1 = area.y + Math.round((fy + fh) * area.height);
                    window.move_resize_frame(true, x0, y0, x1 - x0, y1 - y0);
                }
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
