import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

// Teclado táctil propio, fijo en la parte inferior de la pantalla inferior (eDP-2; si no existe,
// en la principal). Nació porque el teclado en pantalla de GNOME (2026-11-12) no detectaba el toque
// en la pantalla inferior (solo el lápiz) y sale en la pantalla donde se toca el campo de texto.
//
// Las teclas se envían como keysyms (Unicode) por un dispositivo virtual de teclado, igual que el
// teclado de GNOME (keyboard.js); Mutter busca la tecla y los modificadores que necesita en la
// distribución activa (aquí latam). Por eso la disposición dibujada solo es visual.
// Ninguna tecla toma el foco (can_focus: false): la ventana activa sigue recibiendo el texto.
// Shift, Ctrl, Alt y Super son de un solo uso (se sueltan tras la siguiente tecla); «Mayús» es fijo.
const HEIGHT_FRACTION = 0.42;
const GAP = 6;
const PAD = 8;
const REPEAT_DELAY_MS = 400;
const REPEAT_MS = 60;

const K = n => Clutter[`KEY_${n}`];
const ch = (c, shift = c.toUpperCase(), w = 1) => ({char: c, shift, w});
const sym = (label, keyval, w = 1, extra = {}) => ({label, sym: keyval, w, ...extra});
const mod = (label, name, w = 1) => ({label, mod: name, w});

const ROWS = [
    [sym('Esc', K('Escape'), 1.2, {fn: true}),
        ...Array.from({length: 12}, (_, i) => sym(`F${i + 1}`, K(`F${i + 1}`), 1, {fn: true})),
        sym('Supr', K('Delete'), 1.2, {fn: true, repeat: true}),
        {label: '⌨▾', action: 'hide', w: 1.2, fn: true}],
    [ch('|', '°'), ch('1', '!'), ch('2', '"'), ch('3', '#'), ch('4', '$'), ch('5', '%'), ch('6', '&'),
        ch('7', '/'), ch('8', '('), ch('9', ')'), ch('0', '='), ch("'", '?'), ch('¿', '¡'),
        sym('⌫', K('BackSpace'), 1.8, {repeat: true})],
    [sym('Tab', K('Tab'), 1.5), ch('q'), ch('w'), ch('e'), ch('r'), ch('t'), ch('y'), ch('u'), ch('i'),
        ch('o'), ch('p'), ch('+', '*'), ch('á'), ch('é')],
    [mod('Mayús', 'caps', 1.8), ch('a'), ch('s'), ch('d'), ch('f'), ch('g'), ch('h'), ch('j'), ch('k'),
        ch('l'), ch('ñ'), ch('í'), sym('Enter', K('Return'), 1.8)],
    [mod('⇧', 'shift', 2.2), ch('z'), ch('x'), ch('c'), ch('v'), ch('b'), ch('n'), ch('m'),
        ch(',', ';'), ch('.', ':'), ch('-', '_'), ch('ó'), ch('ú'), mod('⇧', 'shift', 1.4)],
    [ch('@', '@'), ch('~', '~'), ch('^', '^'), ch('`', '`'), ch('{', '{'), ch('}', '}'), ch('[', '['),
        ch(']', ']'), ch('\\', '\\'), ch('<', '>'), ch('ü'), ch('/', '/'), ch('|', '|')],
    [mod('Ctrl', 'ctrl', 1.4), mod('Super', 'super', 1.2), mod('Alt', 'alt', 1.2),
        sym('Espacio', K('space'), 6, {repeat: true}),
        sym('←', K('Left'), 1.2, {repeat: true}), sym('↑', K('Up'), 1.2, {repeat: true}),
        sym('↓', K('Down'), 1.2, {repeat: true}), sym('→', K('Right'), 1.2, {repeat: true})],
];

const MODIFIER_KEYVAL = {
    shift: K('Shift_L'), ctrl: K('Control_L'), alt: K('Alt_L'), super: K('Super_L'),
};

const isLetter = c => c.toLowerCase() !== c.toUpperCase();

class Keyboard {
    constructor() {
        const seat = global.stage.context.get_backend().get_default_seat();
        this._device = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._state = {shift: false, caps: false, ctrl: false, alt: false, super: false};
        this._labels = [];     // {actor, def}
        this._buttons = {};    // modificadores, para marcarlos
        this._repeatId = 0;
        this._box = null;
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._place());
    }

    get visible() {
        return !!this._box;
    }

    show() {
        if (this._box)
            return;
        this._box = new St.BoxLayout({style_class: 'zosk-box', vertical: true, reactive: true});
        Main.layoutManager.addTopChrome(this._box, {affectsStruts: true});
        this._place();
    }

    hide() {
        this._stopRepeat();
        if (!this._box)
            return;
        Main.layoutManager.removeChrome(this._box);
        this._box.destroy();
        this._box = null;
        this._labels = [];
        this._buttons = {};
        this._state = {shift: false, caps: false, ctrl: false, alt: false, super: false};
    }

    destroy() {
        this.hide();
        Main.layoutManager.disconnect(this._monitorsId);
        this._device = null;
    }

    // Monitor de destino: eDP-2 si está encendida; si no, la principal
    _monitor() {
        const manager = global.backend.get_monitor_manager();
        let index = manager.get_monitor_for_connector('eDP-2');
        if (index < 0)
            index = Main.layoutManager.primaryIndex;
        return Main.layoutManager.monitors[index];
    }

    _place() {
        if (!this._box)
            return;
        const m = this._monitor();
        const height = Math.round(m.height * HEIGHT_FRACTION);
        this._box.set_position(m.x, m.y + m.height - height);
        this._box.set_size(m.width, height);
        this._build(m.width, height);
    }

    _build(width, height) {
        this._box.destroy_all_children();
        this._labels = [];
        this._buttons = {};
        const rowH = Math.floor((height - 2 * PAD - GAP * (ROWS.length - 1)) / ROWS.length);
        const fontPx = Math.max(12, Math.round(rowH * 0.36));
        for (const keys of ROWS) {
            const row = new St.BoxLayout({style: `spacing: ${GAP}px;`, x_expand: true});
            const total = keys.reduce((s, k) => s + k.w, 0);
            const avail = width - 2 * PAD - GAP * (keys.length - 1);
            for (const def of keys)
                row.add_child(this._makeKey(def, Math.floor(avail * def.w / total), rowH, fontPx));
            this._box.add_child(row);
        }
        this._refresh();
    }

    _makeKey(def, w, h, fontPx) {
        const btn = new St.Button({
            style_class: `zosk-key${def.fn ? ' fn' : ''}`,
            style: `font-size: ${fontPx}px;`,
            width: w, height: h, reactive: true, can_focus: false, track_hover: false,
            label: def.label ?? '',
        });
        this._labels.push({btn, def});
        if (def.mod)
            this._buttons[def.mod] = [...(this._buttons[def.mod] ?? []), btn];

        let pressed = false;
        const down = () => {
            if (pressed)
                return;
            pressed = true;
            btn.add_style_pseudo_class('active');
            this._activate(def);
            if (def.repeat)
                this._startRepeat(def);
        };
        const up = () => {
            if (!pressed)
                return;
            pressed = false;
            btn.remove_style_pseudo_class('active');
            this._stopRepeat();
        };
        btn.connect('button-press-event', () => { down(); return Clutter.EVENT_STOP; });
        btn.connect('button-release-event', () => { up(); return Clutter.EVENT_STOP; });
        btn.connect('touch-event', (_a, event) => {
            switch (event.type()) {
            case Clutter.EventType.TOUCH_BEGIN:
                down();
                return Clutter.EVENT_STOP;
            case Clutter.EventType.TOUCH_END:
            case Clutter.EventType.TOUCH_CANCEL:
                up();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        return btn;
    }

    // Texto de cada tecla según Shift/Mayús y marca de los modificadores activos
    _refresh() {
        const {shift, caps} = this._state;
        for (const {btn, def} of this._labels) {
            if (def.char !== undefined) {
                const upper = isLetter(def.char) ? (shift || caps) : shift;
                btn.label = upper ? def.shift : def.char;
            }
            if (def.mod) {
                if (this._state[def.mod])
                    btn.add_style_class_name('on');
                else
                    btn.remove_style_class_name('on');
            }
        }
    }

    _now() {
        return GLib.get_monotonic_time();
    }

    _press(keyval) {
        this._device.notify_keyval(this._now(), keyval, Clutter.KeyState.PRESSED);
    }

    _release(keyval) {
        this._device.notify_keyval(this._now(), keyval, Clutter.KeyState.RELEASED);
    }

    _activate(def) {
        if (def.action === 'hide') {
            this.onHide?.();
            return;
        }
        if (def.mod) {
            this._state[def.mod] = !this._state[def.mod];
            this._refresh();
            return;
        }
        this._send(def);
        // Los modificadores de un solo uso se sueltan tras la tecla; «Mayús» queda fijo
        for (const m of ['shift', 'ctrl', 'alt', 'super'])
            this._state[m] = false;
        this._refresh();
    }

    _send(def) {
        const {shift, caps, ctrl, alt, super: sup} = this._state;
        const anyMod = ctrl || alt || sup;
        let keyval;
        let realShift = false;
        if (def.char !== undefined) {
            const letter = isLetter(def.char);
            if (anyMod) {
                // Con Ctrl/Alt/Super se manda la tecla base y el Shift real
                keyval = Clutter.unicode_to_keysym(def.char.codePointAt(0));
                realShift = shift || (letter && caps);
            } else {
                const upper = letter ? (shift || caps) : shift;
                keyval = Clutter.unicode_to_keysym((upper ? def.shift : def.char).codePointAt(0));
            }
        } else {
            keyval = def.sym;
            realShift = shift;
        }

        const held = [];
        if (ctrl) held.push(MODIFIER_KEYVAL.ctrl);
        if (alt) held.push(MODIFIER_KEYVAL.alt);
        if (sup) held.push(MODIFIER_KEYVAL.super);
        if (realShift) held.push(MODIFIER_KEYVAL.shift);
        held.forEach(k => this._press(k));
        this._press(keyval);
        this._release(keyval);
        held.reverse().forEach(k => this._release(k));
    }

    _startRepeat(def) {
        this._stopRepeat();
        this._repeatId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REPEAT_DELAY_MS, () => {
            this._repeatId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REPEAT_MS, () => {
                this._send(def);
                return GLib.SOURCE_CONTINUE;
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopRepeat() {
        if (this._repeatId) {
            GLib.source_remove(this._repeatId);
            this._repeatId = 0;
        }
    }
}

const KeyboardToggle = GObject.registerClass(
class KeyboardToggle extends QuickToggle {
    _init(keyboard) {
        super._init({title: 'Teclado', iconName: 'input-keyboard-symbolic', toggleMode: true});
        this._keyboard = keyboard;
        this.connect('clicked', () => {
            if (this.checked)
                keyboard.show();
            else
                keyboard.hide();
        });
        keyboard.onHide = () => { this.checked = false; keyboard.hide(); };
    }
});

const KeyboardIndicator = GObject.registerClass(
class KeyboardIndicator extends SystemIndicator {
    _init(keyboard) {
        super._init();
        this.quickSettingsItems.push(new KeyboardToggle(keyboard));
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

export default class OnScreenKeyboardExtension extends Extension {
    enable() {
        this._keyboard = new Keyboard();
        this._indicator = new KeyboardIndicator(this._keyboard);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._keyboard?.destroy();
        this._keyboard = null;
    }
}
