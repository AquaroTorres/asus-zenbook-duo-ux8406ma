import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

// El límite de carga lo gestiona UPower (el mismo que usa Configuración → Energía): se apaga y
// se enciende con EnableChargeThreshold, sin root. Con el límite apagado el umbral real pasa a 100.
const UPOWER = 'org.freedesktop.UPower';
const UPOWER_PATH = '/org/freedesktop/UPower';
const BATTERY_TYPE = 2;

const ManagerIface = `
<node>
  <interface name="org.freedesktop.UPower">
    <method name="EnumerateDevices"><arg type="ao" direction="out" name="devices"/></method>
  </interface>
</node>`;

const DeviceIface = `
<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="Type" type="u" access="read"/>
    <property name="ChargeThresholdSupported" type="b" access="read"/>
    <property name="ChargeThresholdEnabled" type="b" access="read"/>
    <property name="ChargeEndThreshold" type="u" access="read"/>
    <method name="EnableChargeThreshold"><arg type="b" direction="in" name="enabled"/></method>
  </interface>
</node>`;

const ManagerProxy = Gio.DBusProxy.makeProxyWrapper(ManagerIface);
const DeviceProxy = Gio.DBusProxy.makeProxyWrapper(DeviceIface);

const FullChargeToggle = GObject.registerClass(
class FullChargeToggle extends QuickToggle {
    _init(device) {
        super._init({
            title: 'Carga completa',
            iconName: 'battery-level-100-charged-symbolic',
            toggleMode: false,
        });

        this._device = device;
        this._busy = false;
        this._sync();

        // El valor también cambia desde Configuración → Energía o con otra herramienta
        this._changedId = this._device.connect('g-properties-changed', () => this._sync());
        this.connect('clicked', () => this._toggle());
    }

    // Marcado = sin límite (carga hasta el 100 %)
    _sync() {
        const limited = this._device.ChargeThresholdEnabled;
        this.checked = !limited;
        this.subtitle = limited ? `Límite ${this._device.ChargeEndThreshold} %` : 'Sin límite';
    }

    async _toggle() {
        if (this._busy)
            return;
        this._busy = true;
        try {
            await this._device.EnableChargeThresholdAsync(!this._device.ChargeThresholdEnabled);
        } catch (e) {
            console.error(`battery-charge-limit: ${e}`);
        }
        this._busy = false;
        this._sync();
    }

    destroy() {
        if (this._changedId) {
            this._device.disconnect(this._changedId);
            this._changedId = null;
        }
        super.destroy();
    }
});

const FullChargeIndicator = GObject.registerClass(
class FullChargeIndicator extends SystemIndicator {
    _init(device) {
        super._init();
        this.quickSettingsItems.push(new FullChargeToggle(device));
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

export default class CargaCompletaExtension extends Extension {
    enable() {
        this._cancelled = false;
        this._findBattery();
    }

    // Busca la batería que admite límite de carga; si no hay (sobremesa), no agrega nada
    async _findBattery() {
        try {
            const manager = await new Promise((resolve, reject) =>
                new ManagerProxy(Gio.DBus.system, UPOWER, UPOWER_PATH,
                    (proxy, error) => (error ? reject(error) : resolve(proxy))));
            const [paths] = await manager.EnumerateDevicesAsync();
            for (const path of paths) {
                const device = await new Promise((resolve, reject) =>
                    new DeviceProxy(Gio.DBus.system, UPOWER, path,
                        (proxy, error) => (error ? reject(error) : resolve(proxy))));
                if (device.Type === BATTERY_TYPE && device.ChargeThresholdSupported) {
                    if (this._cancelled)
                        return;
                    this._indicator = new FullChargeIndicator(device);
                    Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
                    return;
                }
            }
            console.log('battery-charge-limit: no hay batería con límite de carga');
        } catch (e) {
            console.error(`battery-charge-limit: ${e}`);
        }
    }

    disable() {
        this._cancelled = true;
        this._indicator?.destroy();
        this._indicator = null;
    }
}
