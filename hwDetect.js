import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const ASUS_KBD_LED = '/sys/class/leds/asus::kbd_backlight';

function subprocessOk(argv) {
    try {
        const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
        proc.wait_check(null);
        return true;
    } catch (_) {
        return false;
    }
}

/** ASUS WMI white keyboard backlight LED (asus-nb-wmi). */
export function detectAsusKbdLed() {
    // Prefer reading max_brightness — works in GJS and matches test-detect-hardware.py.
    if (readSysfsInt(`${ASUS_KBD_LED}/max_brightness`) >= 0)
        return true;
    if (Gio.File.new_for_path(ASUS_KBD_LED).query_exists(null))
        return true;
    return subprocessOk(['test', '-r', `${ASUS_KBD_LED}/max_brightness`]);
}

/** ASUS platform driver (companion check for WMI laptops). */
export function detectAsusNbWmi() {
    return subprocessOk(['test', '-d', '/sys/devices/platform/asus-nb-wmi']);
}

export function readSysfsInt(path) {
    try {
        const [, contents] = Gio.File.new_for_path(path).load_contents(null);
        const val = parseInt(new TextDecoder().decode(contents).trim(), 10);
        if (!Number.isNaN(val))
            return val;
    } catch (_) {}
    try {
        const proc = Gio.Subprocess.new(
            ['cat', path],
            Gio.SubprocessFlags.STDOUT_PIPE
        );
        const [, stdout] = proc.communicate_utf8(null, null);
        const val = parseInt(stdout?.trim() ?? '', 10);
        return Number.isNaN(val) ? -1 : val;
    } catch (_) {
        return -1;
    }
}

/** asus-linux system daemon for Aura RGB (not required for brightness levels). */
export function detectAuraDaemon() {
    try {
        const result = Gio.DBus.system.call_sync(
            'org.freedesktop.DBus', '/',
            'org.freedesktop.DBus', 'ListNames',
            null, null, Gio.DBusCallFlags.NONE, -1, null
        );
        const names = result.get_child_value(0).recursiveUnpack();
        return Array.isArray(names) && names.includes('org.asuslinux.Daemon');
    } catch (_) {
        return false;
    }
}

export function detectAsusctlBinary() {
    return GLib.find_program_in_path('asusctl') !== null;
}

/** Aura RGB via asusctl — separate from white backlight level control. */
export function detectAuraAvailable() {
    return detectAuraDaemon() || detectAsusctlBinary();
}

export function detectAsusctlColourFlag() {
    if (!detectAsusctlBinary())
        return '--colour';
    try {
        const proc = Gio.Subprocess.new(
            ['asusctl', 'aura', '--help'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE
        );
        const [, stdout] = proc.communicate_utf8(null, null);
        const help = stdout ?? '';
        if (help.includes('--colour'))
            return '--colour';
        if (help.includes('--color'))
            return '--color';
    } catch (_) {}
    return '--colour';
}

/**
 * Human-readable hardware status for Settings / panel UI.
 */
export function describeHardware({gsdOk, gsdSteps, maxBrightness}) {
    const asusLed    = detectAsusKbdLed();
    const asusWmi    = detectAsusNbWmi();
    const sysfsMax   = asusLed ? readSysfsInt(`${ASUS_KBD_LED}/max_brightness`) : -1;
    const auraDaemon = detectAuraDaemon();
    const auraBinary = detectAsusctlBinary();

    let kbdBackend;
    if (gsdOk && asusLed)
        kbdBackend = `ASUS WMI (asus::kbd_backlight) via GSD — ${gsdSteps} steps, levels 0–${maxBrightness}`;
    else if (gsdOk && asusWmi)
        kbdBackend = `ASUS WMI (asus-nb-wmi) via GSD — ${gsdSteps} steps, levels 0–${maxBrightness}`;
    else if (gsdOk)
        kbdBackend = `GSD D-Bus — ${gsdSteps} steps, levels 0–${maxBrightness}`;
    else if (asusLed)
        kbdBackend = `ASUS WMI detected (sysfs max ${sysfsMax}) — GSD unavailable`;
    else
        kbdBackend = 'Not detected — check org.gnome.SettingsDaemon.Power.Keyboard';

    let auraBackend;
    if (auraDaemon && auraBinary)
        auraBackend = 'Available (asusctl + org.asuslinux.Daemon)';
    else if (auraDaemon)
        auraBackend = 'Daemon running — install asusctl for RGB control';
    else if (auraBinary)
        auraBackend = 'asusctl found — start org.asuslinux.Daemon for RGB';
    else
        auraBackend = 'Not installed (optional — white backlight still works via GSD)';

    return {
        asusLed: asusLed || asusWmi,
        sysfsMax,
        kbdBackend,
        auraBackend,
        auraAvailable: auraDaemon || auraBinary,
    };
}
