import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
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
const HEIGHT_FRACTION = 0.50;   // tope de alto; las teclas son cuadradas, así que el alto real sale del ancho disponible
const FN_ROW_RATIO = 0.62;      // la fila de funciones es más baja que las demás
const GAP = 6;
const PAD = 8;
const ROW_UNITS = 15;           // ancho de cada fila en teclas (todas las filas suman lo mismo)
const REPEAT_DELAY_MS = 400;
const REPEAT_MS = 60;

const K = n => Clutter[`KEY_${n}`];
const U = c => Clutter.unicode_to_keysym(c.codePointAt(0));
// Tecla con carácter: `shift` es la variante con Shift (pequeña arriba a la izquierda) y `alt` la de
// Alt Gr (pequeña abajo a la derecha), como en el teclado físico. `kv`/`kvShift`: keysym explícito
// (teclas muertas), si no se usa el del carácter.
const ch = (c, shift = c.toUpperCase(), w = 1, extra = {}) => ({char: c, shift, w, ...extra});
// Tecla especial: `tag` es el rótulo pequeño de la esquina, `main` el símbolo del centro
const sp = (tag, keyval, w, extra = {}) => ({tag, sym: keyval, w, ...extra});
const mod = (tag, name, w, extra = {}) => ({tag, mod: name, w, ...extra});
// Tecla de la fila de funciones. Sin Fn hace lo mismo que la física (multimedia o comando del
// proyecto, igual que zenbook-hotkeys); con Fn manda F1..F12.
const fk = (n, icons, extra = {}) => ({fnum: n, tag: `F${n}`, tagRight: true, icons, small: true, w: 1, ...extra});

const ROWS = [
    {fn: true, keys: [
        sp('', K('Escape'), 1, {main: 'Esc', small: true}),
        fk(1, ['audio-volume-muted-symbolic'], {media: K('AudioMute')}),
        fk(2, ['audio-volume-low-symbolic'], {media: K('AudioLowerVolume'), repeat: true}),
        fk(3, ['audio-volume-high-symbolic'], {media: K('AudioRaiseVolume'), repeat: true}),
        fk(4, ['keyboard-brightness-symbolic', 'input-keyboard-symbolic'], {cmd: ['zenbook-keyboard-backlight', 'cycle']}),
        fk(5, ['display-brightness-low-symbolic', 'display-brightness-symbolic'], {cmd: ['zenbook-brightness', 'down']}),
        fk(6, ['display-brightness-high-symbolic', 'display-brightness-symbolic'], {cmd: ['zenbook-brightness', 'up']}),
        fk(7, ['video-joined-displays-symbolic', 'video-display-symbolic'], {combo: ['super', 'p']}),
        fk(8, ['view-dual-symbolic', 'video-display-symbolic'], {cmd: ['zenbook-move-window']}),
        fk(9, ['microphone-disabled-symbolic', 'audio-input-microphone-symbolic'], {cmd: ['zenbook-microphone', 'toggle']}),
        fk(10, ['bluetooth-symbolic'], {cmd: ['zenbook-bluetooth', 'toggle']}),
        fk(11, ['face-smile-symbolic'], {combo: ['ctrl', '.']}),
        fk(12, ['applications-system-symbolic'], {}),
        {icons: ['input-keyboard-symbolic'], main: '▾', action: 'hide', w: 1, small: true},   // sin equivalente físico: oculta el teclado
        sp('', K('Print'), 1, {main: 'Prt Sc', small: true}),
        sp('Ins', K('Delete'), 1, {main: 'Delete', small: true, repeat: true, tagRight: true, fnSym: K('Insert'), fnMain: 'Ins'})]},
    {keys: [
        ch('|', '°', 1, {alt: '¬'}), ch('1', '!'), ch('2', '"'), ch('3', '#'), ch('4', '$'), ch('5', '%'), ch('6', '&'),
        ch('7', '/'), ch('8', '('), ch('9', ')'), ch('0', '='), ch("'", '?', 1, {alt: '\\'}), ch('¿', '¡'),
        sp('', K('BackSpace'), 2, {main: '⟵', repeat: true})]},
    {keys: [
        sp('', K('Tab'), 1.5, {main: '⇆'}),
        ch('q', 'Q', 1, {alt: '@'}), ch('w'), ch('e'), ch('r'), ch('t'), ch('y'), ch('u'), ch('i'), ch('o'), ch('p'),
        ch('´', '¨', 1, {kv: K('dead_acute'), kvShift: K('dead_diaeresis')}),
        ch('+', '*', 1, {alt: '~'}), ch('}', ']', 1.5, {alt: '`'})]},
    {keys: [
        mod('Bloq mayús', 'caps', 1.9),
        ch('a'), ch('s'), ch('d'), ch('f'), ch('g'), ch('h'), ch('j'), ch('k'), ch('l'), ch('ñ'),
        ch('{', '[', 1, {alt: '^'}),
        sp('', K('Return'), 2.1, {main: '↵'})]},
    {keys: [
        mod('', 'shift', 1.2, {main: '⇧'}), ch('<', '>'),
        ch('z'), ch('x'), ch('c'), ch('v'), ch('b'), ch('n'), ch('m'),
        ch(',', ';'), ch('.', ':'), ch('-', '_'),
        mod('', 'shift', 2.8, {main: '⇧'})]},
    {keys: [
        mod('Ctrl', 'ctrl', 1.3), mod('Fn+Esc', 'fn', 1, {main: 'Fn'}), mod('', 'super', 1, {main: '⊞'}), mod('Alt', 'alt', 1),
        sp('', K('space'), 5.7, {repeat: true}),
        mod('Alt Gr', 'altgr', 1), mod('Ctrl', 'ctrl', 1),
        {w: 1, bottom: true, keys: [sp('', K('Left'), 1, {main: '◁', tag: 'Inicio', fnMain: 'Inicio', fnSym: K('Home'), repeat: true})]},
        {w: 1, stack: [
            sp('', K('Up'), 1, {main: '△ Re pág', fnMain: 'Re pág', fnSym: K('Page_Up'), repeat: true}),
            sp('', K('Down'), 1, {main: '▽ Av pág', fnMain: 'Av pág', fnSym: K('Page_Down'), repeat: true})]},
        {w: 1, bottom: true, keys: [sp('', K('Right'), 1, {main: '▷', tag: 'Fin', fnMain: 'Fin', fnSym: K('End'), repeat: true})]},
        ]},
];

const MODIFIER_KEYVAL = {
    shift: K('Shift_L'), ctrl: K('Control_L'), alt: K('Alt_L'), super: K('Super_L'),
};

const isLetter = c => c.toLowerCase() !== c.toUpperCase();
const NO_STATE = () => ({shift: false, caps: false, ctrl: false, alt: false, altgr: false, super: false, fn: false});

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
        this._box = new St.BoxLayout({style_class: 'zosk-box', vertical: true, reactive: true, style: `spacing: ${GAP}px;`});
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
        // Lado de una tecla cuadrada: el menor entre lo que cabe a lo ancho y a lo alto
        const units = ROWS.reduce((n, r) => n + (r.fn ? FN_ROW_RATIO : 1), 0);
        const fromW = (m.width - 2 * PAD + GAP) / ROW_UNITS - GAP;
        const fromH = (m.height * HEIGHT_FRACTION - 2 * PAD - GAP * (ROWS.length - 1)) / units;
        const side = Math.floor(Math.min(fromW, fromH));
        const height = Math.round(units * side + GAP * (ROWS.length - 1) + 2 * PAD);
        this._box.set_position(m.x, m.y + m.height - height);
        this._box.set_size(m.width, height);
        this._build(side);
    }

    _build(side) {
        this._box.destroy_all_children();
        this._labels = [];
        const fontPx = Math.max(12, Math.round(side * 0.3));
        for (const rowDef of ROWS) {
            const rowH = Math.floor(side * (rowDef.fn ? FN_ROW_RATIO : 1));
            const keys = rowDef.keys;
            // Las filas centradas: el teclado queda con teclas cuadradas y no ocupa todo el ancho
            const row = new St.BoxLayout({style: `spacing: ${GAP}px;`, x_expand: true, x_align: Clutter.ActorAlign.CENTER});
            const total = keys.reduce((n, k) => n + k.w, 0);
            const scale = ROW_UNITS / total;
            for (const def of keys) {
                // Ancho = unidades × (lado + hueco) − hueco: las teclas anchas absorben los huecos que cubren
                const w = Math.round(def.w * scale * (side + GAP) - GAP);
                if (def.stack) {
                    // Dos teclas apiladas (△ Re pág / ▽ Av pág), cada una de media altura
                    const col = new St.BoxLayout({vertical: true, style: `spacing: ${GAP}px;`});
                    const half = Math.floor((rowH - GAP) / 2);
                    def.stack.forEach(d => col.add_child(this._makeKey(d, w, half, Math.round(fontPx * 0.8))));
                    row.add_child(col);
                } else if (def.bottom) {
                    // Tecla de media altura pegada abajo (◁ Inicio, Fin ▷)
                    const col = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.END});
                    const half = Math.floor((rowH - GAP) / 2);
                    col.add_child(this._makeKey(def.keys[0], w, half, Math.round(fontPx * 0.8)));
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
        const smallStyle = `font-size: ${Math.round(fontPx * 0.68)}px; color: rgba(255,255,255,0.8);`;
        const inset = Math.max(5, Math.round(fontPx * 0.35));   // separación con el borde de la tecla
        // Rótulo pequeño de la esquina superior (símbolo con Shift o nombre de la tecla)
        const sub = new St.Label({
            style: smallStyle,
            x_align: def.tagRight ? Clutter.ActorAlign.END : Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START, x_expand: true, y_expand: true,
            margin_left: inset, margin_right: inset, margin_top: Math.round(inset * 0.7),
        });
        // Rótulo pequeño de abajo a la derecha (símbolo de Alt Gr)
        const alt = new St.Label({
            style: smallStyle,
            x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.END, x_expand: true, y_expand: true,
            margin_right: inset, margin_bottom: Math.round(inset * 0.7),
        });
        let main;
        if (def.icons) {
            main = new St.Icon({
                gicon: Gio.ThemedIcon.new_from_names(def.icons),
                icon_size: Math.round(fontPx * 1.3),
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
                x_expand: true, y_expand: true,
            });
        } else {
            main = new St.Label({
                style: `font-size: ${Math.round(fontPx * (def.char !== undefined ? 1.2 : 0.95))}px;`,
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
                x_expand: true, y_expand: true,
            });
        }
        content.add_child(sub);
        content.add_child(alt);
        content.add_child(main);
        btn.set_child(content);
        this._labels.push({btn, def, main, sub, alt});

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

    // Texto de cada tecla según Shift/Bloq Mayús/Alt Gr/Fn y marca de los modificadores activos
    _refresh() {
        const {shift, caps, altgr, fn} = this._state;
        for (const {btn, def, main, sub, alt} of this._labels) {
            if (def.char !== undefined) {
                const letter = isLetter(def.char);
                const upper = letter ? (shift || caps) : shift;
                if (altgr && def.alt) {
                    main.text = def.alt;
                    sub.text = '';
                    alt.text = '';
                } else {
                    main.text = upper ? def.shift : def.char;
                    sub.text = letter ? '' : (upper ? def.char : def.shift);
                    alt.text = def.alt ?? '';
                }
            } else if (fn && def.fnSym) {
                if (!def.icons)
                    main.text = def.fnMain;
                sub.text = '';
            } else if (!def.icons && def.main === undefined && def.tag) {
                // Solo nombre (Ctrl, Alt, Alt Gr, Bloq mayús): va centrado
                main.text = def.tag;
                sub.text = '';
            } else {
                if (!def.icons)
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
        for (const m of ['shift', 'ctrl', 'alt', 'altgr', 'super', 'fn'])
            this._state[m] = false;
        this._refresh();
    }

    _send(def) {
        const {shift, caps, ctrl, alt, altgr, super: sup, fn} = this._state;
        const anyMod = ctrl || alt || sup;
        let keyval;
        let realShift = false;
        const held = [];

        if (def.fnum !== undefined && !fn) {
            // Fila de funciones sin Fn: lo mismo que la tecla física (comando del proyecto o multimedia)
            if (def.cmd) {
                try {
                    Gio.Subprocess.new(def.cmd.map((p, i) => (i === 0 ? `/usr/local/bin/${p}` : p)),
                        Gio.SubprocessFlags.NONE);
                } catch (e) {
                    console.error(`on-screen-keyboard: ${def.cmd.join(' ')}: ${e}`);
                }
                return;
            }
            if (def.combo) {
                const [m, c] = def.combo;
                held.push(MODIFIER_KEYVAL[m]);
                keyval = U(c);
            } else if (def.media) {
                keyval = def.media;
            } else {
                return;     // F12 (MyASUS): sin acción, como en Linux
            }
        } else if (def.fnum !== undefined) {
            keyval = K(`F${def.fnum}`);
            realShift = shift;
        } else if (def.char !== undefined) {
            const letter = isLetter(def.char);
            if (altgr && def.alt) {
                keyval = U(def.alt);
            } else if (anyMod) {
                // Con Ctrl/Alt/Super se manda la tecla base y el Shift real
                keyval = def.kv ?? U(def.char);
                realShift = shift || (letter && caps);
            } else {
                const upper = letter ? (shift || caps) : shift;
                keyval = upper ? (def.kvShift ?? U(def.shift)) : (def.kv ?? U(def.char));
            }
        } else {
            keyval = (fn && def.fnSym) ? def.fnSym : def.sym;
            realShift = shift;
        }

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
