import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const SERVICE = 'zenbook-onedrive.service';
const MOUNT_POINT = `${GLib.get_home_dir()}/OneDrive`;
const POLL_SECONDS = 3;

// Montado = rclone aparece en /proc/self/mountinfo en ~/OneDrive (no basta con que el servicio exista)
function isMounted() {
    try {
        const [, bytes] = GLib.file_get_contents('/proc/self/mountinfo');
        const lines = new TextDecoder().decode(bytes).split('\n');
        return lines.some(line => {
            const [left, right] = line.split(' - ');
            return right?.startsWith('fuse.rclone ') && left.split(' ')[4] === MOUNT_POINT;
        });
    } catch (e) {
        return false;
    }
}

const OneDriveToggle = GObject.registerClass(
class OneDriveToggle extends QuickToggle {
    _init() {
        super._init({
            title: 'OneDrive',
            iconName: 'folder-remote-symbolic',
            toggleMode: false,
        });

        this._busy = false;
        this._sync();
        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
            if (!this._busy)
                this._sync();
            return GLib.SOURCE_CONTINUE;
        });

        this.connect('clicked', () => this._toggle());
    }

    _sync() {
        const on = isMounted();
        this.checked = on;
        this.subtitle = on ? 'Montado' : 'Desmontado';
    }

    _toggle() {
        if (this._busy)
            return;
        const mounting = !isMounted();
        this._busy = true;
        this.subtitle = mounting ? 'Montando…' : 'Desmontando…';
        try {
            const proc = Gio.Subprocess.new(
                ['systemctl', '--user', mounting ? 'start' : 'stop', SERVICE],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE);
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, , stderr] = p.communicate_utf8_finish(res);
                    if (!p.get_successful()) {
                        Main.notifyError('OneDrive',
                            `No se pudo ${mounting ? 'montar' : 'desmontar'}. ${stderr.trim()}\n` +
                            `journalctl --user -u ${SERVICE}`);
                    }
                } catch (e) {
                    console.error(`onedrive-mount: ${e}`);
                }
                this._busy = false;
                this._sync();
            });
        } catch (e) {
            console.error(`onedrive-mount: ${e}`);
            this._busy = false;
            this._sync();
        }
    }

    destroy() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = null;
        }
        super.destroy();
    }
});

const OneDriveIndicator = GObject.registerClass(
class OneDriveIndicator extends SystemIndicator {
    _init() {
        super._init();
        this.quickSettingsItems.push(new OneDriveToggle());
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

export default class OneDriveMountExtension extends Extension {
    enable() {
        this._indicator = new OneDriveIndicator();
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
