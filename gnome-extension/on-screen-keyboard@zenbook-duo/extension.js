import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

// Teclado táctil propio, fijo en la parte inferior de la pantalla inferior (eDP-2; si no existe,
// en la principal). Nació porque el teclado en pantalla de GNOME (2026-11-12) no detectaba el toque
// en la pantalla inferior (la causa real era el mapeo del touchscreen, ya corregido en
// zenbook-touchscreen) y sale en la pantalla donde se toca el campo de texto.
//
// La distribución copia el teclado físico del Zenbook Duo (foto del usuario, 2026-11-12):
// latinoamericano ISO con fila de funciones, ñ, `<` junto a Shift y flechas con Home/PgUp/PgDn/End
// (con Fn). Las teclas se envían como keysyms (Unicode) por un dispositivo virtual de teclado, igual
// que el teclado de GNOME (keyboard.js); Mutter busca la tecla y los modificadores que necesita en la
// distribución activa (latam). Por eso lo dibujado es solo visual: aunque la distribución activa
// cambie, cada tecla produce el carácter que muestra. Ninguna tecla toma el foco (can_focus: false):
// la ventana activa sigue recibiendo el texto.
// Shift, Ctrl, Alt, Win y Fn son de un solo uso (se sueltan tras la siguiente tecla); «Bloq Mayús» es fijo.
const HEIGHT_FRACTION = 0.40;
const FN_ROW_RATIO = 0.62;      // la fila de funciones es más baja que las demás
const GAP = 6;
const PAD = 8;
const REPEAT_DELAY_MS = 400;
const REPEAT_MS = 60;

const K = n => Clutter[`KEY_${n}`];
// Tecla con carácter (y su variante con Shift, que se dibuja pequeña arriba a la izquierda).
// `kv`/`kvShift`: keysym explícito (teclas muertas), si no se usa el del carácter.
const ch = (c, shift = c.toUpperCase(), w = 1, extra = {}) => ({char: c, shift, w, ...extra});
// Tecla especial: `tag` es el rótulo pequeño de la esquina, `main` el símbolo del centro
const sp = (tag, keyval, w, extra = {}) => ({tag, sym: keyval, w, ...extra});
const mod = (tag, name, w, extra = {}) => ({tag, mod: name, w, ...extra});
const fk = n => sp('', K(`F${n}`), 1, {main: `F${n}`, small: true});

const ROWS = [
    {fn: true, keys: [
        sp('', K('Escape'), 1, {main: 'Esc', small: true}),
        ...Array.from({length: 12}, (_, i) => fk(i + 1)),
        {main: '⌨▾', action: 'hide', w: 1, small: true},   // sin equivalente físico: oculta el teclado
        sp('', K('Print'), 1, {main: 'PrtSc', small: true}),
        sp('', K('Delete'), 1, {main: 'Supr', small: true, repeat: true})]},
    {keys: [
        ch('|', '°'), ch('1', '!'), ch('2', '"'), ch('3', '#'), ch('4', '$'), ch('5', '%'), ch('6', '&'),
        ch('7', '/'), ch('8', '('), ch('9', ')'), ch('0', '='), ch("'", '?'), ch('¿', '¡'),
        sp('', K('BackSpace'), 2, {main: '⟵', tag: 'Retroceso', tagRight: true, repeat: true})]},
    {keys: [
        sp('', K('Tab'), 1.5, {main: '⇥', tag: 'Tab'}),
        ch('q'), ch('w'), ch('e'), ch('r'), ch('t'), ch('y'), ch('u'), ch('i'), ch('o'), ch('p'),
        ch('´', '¨', 1, {kv: K('dead_acute'), kvShift: K('dead_diaeresis')}),
        ch('+', '*'), ch('}', ']', 1.5)]},
    {keys: [
        mod('Bloq Mayús', 'caps', 1.9),
        ch('a'), ch('s'), ch('d'), ch('f'), ch('g'), ch('h'), ch('j'), ch('k'), ch('l'), ch('ñ'),
        ch('{', '['),
        sp('', K('Return'), 2.1, {main: '↵', tag: 'Enter', tagRight: true})]},
    {keys: [
        mod('⇧', 'shift', 1.2), ch('<', '>'),
        ch('z'), ch('x'), ch('c'), ch('v'), ch('b'), ch('n'), ch('m'),
        ch(',', ';'), ch('.', ':'), ch('-', '_'),
        mod('Shift ⇧', 'shift', 2.8)]},
    {keys: [
        mod('Ctrl', 'ctrl', 1.3), mod('Fn', 'fn', 1), mod('', 'super', 1, {main: '⊞'}), mod('Alt', 'alt', 1),
        sp('', K('space'), 5.7, {main: '—', repeat: true}),
        mod('Alt Gr', 'alt', 1), mod('Ctrl', 'ctrl', 1),
        sp('', K('Left'), 1, {main: '◀', fnMain: 'Inicio', fnSym: K('Home'), repeat: true}),
        {w: 1, stack: [
            sp('', K('Up'), 1, {main: '▲', fnMain: 'Re Pág', fnSym: K('Page_Up'), repeat: true}),
            sp('', K('Down'), 1, {main: '▼', fnMain: 'Av Pág', fnSym: K('Page_Down'), repeat: true})]},
        sp('', K('Right'), 1, {main: '▶', fnMain: 'Fin', fnSym: K('End'), repeat: true}),
        ]},
];

const MODIFIER_KEYVAL = {
    shift: K('Shift_L'), ctrl: K('Control_L'), alt: K('Alt_L'), super: K('Super_L'),
};

const isLetter = c => c.toLowerCase() !== c.toUpperCase();
const NO_STATE = () => ({shift: false, caps: false, ctrl: false, alt: false, super: false, fn: false});

class Keyboard {
    constructor() {
        const seat = global.stage.context.get_backend().get_default_seat();
        this._device = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._state = NO_STATE();
        this._labels = [];     // {btn, def, main, sub}
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
        this._state = NO_STATE();
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
        const units = ROWS.reduce((s, r) => s + (r.fn ? FN_ROW_RATIO : 1), 0);
        const unitH = (height - 2 * PAD - GAP * (ROWS.length - 1)) / units;
        const fontPx = Math.max(12, Math.round(unitH * 0.3));
        for (const rowDef of ROWS) {
            const rowH = Math.floor(unitH * (rowDef.fn ? FN_ROW_RATIO : 1));
            const keys = rowDef.keys;
            const row = new St.BoxLayout({style: `spacing: ${GAP}px;`, x_expand: true});
            const total = keys.reduce((s, k) => s + k.w, 0);
            const avail = width - 2 * PAD - GAP * (keys.length - 1);
            for (const def of keys) {
                const w = Math.floor(avail * def.w / total);
                if (def.stack) {
                    // Dos teclas apiladas (▲ / ▼), cada una de media altura
                    const col = new St.BoxLayout({vertical: true, style: `spacing: ${GAP}px;`});
                    const half = Math.floor((rowH - GAP) / 2);
                    def.stack.forEach(d => col.add_child(this._makeKey(d, w, half, Math.round(fontPx * 0.75))));
                    row.add_child(col);
                } else {
                    row.add_child(this._makeKey(def, w, rowH, def.small ? Math.round(fontPx * 0.8) : fontPx));
                }
            }
            this._box.add_child(row);
        }
        this._refresh();
    }

    _makeKey(def, w, h, fontPx) {
        const btn = new St.Button({
            style_class: 'zosk-key',
            width: w, height: h, reactive: true, can_focus: false, track_hover: false,
        });
        const content = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
        // Rótulo pequeño de la esquina (símbolo con Shift o nombre de la tecla)
        const sub = new St.Label({
            style: `font-size: ${Math.round(fontPx * 0.5)}px; color: rgba(255,255,255,0.75);`,
            x_align: def.tagRight ? Clutter.ActorAlign.END : Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START, x_expand: true, y_expand: true,
        });
        const main = new St.Label({
            style: `font-size: ${Math.round(fontPx * (def.char !== undefined ? 1.2 : 0.95))}px;`,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
            x_expand: true, y_expand: true,
        });
        content.add_child(sub);
        content.add_child(main);
        btn.set_child(content);
        this._labels.push({btn, def, main, sub});

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

    // Texto de cada tecla según Shift/Bloq Mayús/Fn y marca de los modificadores activos
    _refresh() {
        const {shift, caps, fn} = this._state;
        for (const {btn, def, main, sub} of this._labels) {
            if (def.char !== undefined) {
                const letter = isLetter(def.char);
                const upper = letter ? (shift || caps) : shift;
                main.text = upper ? def.shift : def.char;
                sub.text = letter ? '' : (upper ? def.char : def.shift);
            } else if (fn && def.fnSym) {
                main.text = def.fnMain;
                sub.text = '';
            } else {
                main.text = def.main ?? '';
                sub.text = def.tag ?? '';
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
        // Los modificadores de un solo uso se sueltan tras la tecla; «Bloq Mayús» queda fijo
        for (const m of ['shift', 'ctrl', 'alt', 'super', 'fn'])
            this._state[m] = false;
        this._refresh();
    }

    _send(def) {
        const {shift, caps, ctrl, alt, super: sup, fn} = this._state;
        const anyMod = ctrl || alt || sup;
        let keyval;
        let realShift = false;
        if (def.char !== undefined) {
            const letter = isLetter(def.char);
            if (anyMod) {
                // Con Ctrl/Alt/Super se manda la tecla base y el Shift real
                keyval = def.kv ?? Clutter.unicode_to_keysym(def.char.codePointAt(0));
                realShift = shift || (letter && caps);
            } else {
                const upper = letter ? (shift || caps) : shift;
                keyval = upper
                    ? (def.kvShift ?? Clutter.unicode_to_keysym(def.shift.codePointAt(0)))
                    : (def.kv ?? Clutter.unicode_to_keysym(def.char.codePointAt(0)));
            }
        } else {
            keyval = (fn && def.fnSym) ? def.fnSym : def.sym;
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
