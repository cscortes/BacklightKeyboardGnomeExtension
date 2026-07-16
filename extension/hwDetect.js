import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

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
export async function detectAsusKbdLed() {
    // Prefer reading max_brightness - works in GJS and matches test-detect-hardware.py.
    if (await readSysfsInt(`${ASUS_KBD_LED}/max_brightness`) >= 0)
        return true;
    if (Gio.File.new_for_path(ASUS_KBD_LED).query_exists(null))
        return true;
    return subprocessOk(['test', '-r', `${ASUS_KBD_LED}/max_brightness`]);
}

/** ASUS platform driver (companion check for WMI laptops). */
export function detectAsusNbWmi() {
    return subprocessOk(['test', '-d', '/sys/devices/platform/asus-nb-wmi']);
}

/** Reads an integer from a sysfs file without blocking the compositor's main loop. */
export async function readSysfsInt(path) {
    try {
        const [contents] = await Gio.File.new_for_path(path).load_contents_async(null);
        const val = parseInt(new TextDecoder().decode(contents).trim(), 10);
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

/** Aura RGB via asusctl - separate from white backlight level control. */
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

/** 'v6' = asusctl 6.x subcommands; 'legacy' = older `-m` flag style. */
export function detectAsusctlCliStyle() {
    if (!detectAsusctlBinary())
        return 'legacy';
    try {
        const proc = Gio.Subprocess.new(
            ['asusctl', 'aura', '--help'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE
        );
        const [, stdout] = proc.communicate_utf8(null, null);
        const help = stdout ?? '';
        if (help.includes('effect            led mode') || help.includes('aura effect'))
            return 'v6';
    } catch (_) {}
    return 'legacy';
}

/** Build full argv for an asusctl aura command. */
export function buildAuraArgv(auraMode, hexColor, style, colourFlag = '--colour') {
    const hex = (hexColor ?? '#ffffff').replace('#', '');
    if (style === 'v6') {
        const v6 = {
            Static:  ['aura', 'effect', 'static', '-c', hex],
            Breathe: ['aura', 'effect', 'breathe', '--colour', hex, '--colour2', '000000', '--speed', 'med'],
            Strobe:  ['aura', 'effect', 'flash', '-c', hex],
            Rainbow: ['aura', 'effect', 'rainbow-cycle', '--speed', 'med'],
        };
        return ['asusctl', ...(v6[auraMode] ?? v6.Static)];
    }
    const legacy = {
        Static:  ['aura', '-m', 'static', colourFlag, hex],
        Breathe: ['aura', '-m', 'breathe-single', colourFlag, hex],
        Strobe:  ['aura', '-m', 'strobe', colourFlag, hex],
        Rainbow: ['aura', '-m', 'rainbow-cycle'],
    };
    return ['asusctl', ...(legacy[auraMode] ?? legacy.Static)];
}

/**
 * Human-readable hardware status for Settings / panel UI.
 */
export async function describeHardware({gsdOk, gsdSteps, maxBrightness}) {
    const asusLed    = await detectAsusKbdLed();
    const asusWmi    = detectAsusNbWmi();
    const sysfsMax   = asusLed ? await readSysfsInt(`${ASUS_KBD_LED}/max_brightness`) : -1;
    const auraDaemon = detectAuraDaemon();
    const auraBinary = detectAsusctlBinary();

    let kbdBackend;
    if (gsdOk && asusLed)
        kbdBackend = `ASUS WMI (asus::kbd_backlight) via GSD - ${gsdSteps} steps, levels 0-${maxBrightness}`;
    else if (gsdOk && asusWmi)
        kbdBackend = `ASUS WMI (asus-nb-wmi) via GSD - ${gsdSteps} steps, levels 0-${maxBrightness}`;
    else if (gsdOk)
        kbdBackend = `GSD D-Bus - ${gsdSteps} steps, levels 0-${maxBrightness}`;
    else if (asusLed)
        kbdBackend = `ASUS WMI detected (sysfs max ${sysfsMax}) - GSD unavailable`;
    else
        kbdBackend = 'Not detected - check org.gnome.SettingsDaemon.Power.Keyboard';

    let auraBackend;
    if (auraDaemon && auraBinary)
        auraBackend = 'Available (asusctl + org.asuslinux.Daemon)';
    else if (auraDaemon)
        auraBackend = 'Daemon running - install asusctl for RGB control';
    else if (auraBinary)
        auraBackend = 'asusctl found - start org.asuslinux.Daemon for RGB';
    else
        auraBackend = 'Not installed (optional - white backlight still works via GSD)';

    return {
        asusLed: asusLed || asusWmi,
        sysfsMax,
        kbdBackend,
        auraBackend,
        auraAvailable: auraDaemon || auraBinary,
    };
}
