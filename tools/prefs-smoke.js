#!/usr/bin/gjs -m
/**
 * Headless prefs smoke test — runs fillPreferencesWindow with real Gtk/Adw.
 * Catches API mistakes (wrong property names, invalid widget parenting, etc.)
 * without reloading GNOME Shell.
 *
 * Expects to be run from the repo root (cwd = repository root).
 */
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';

const ROOT = GLib.get_current_dir();
const EXT = `${ROOT}/extension`;

function readJson(path) {
    const [, bytes] = GLib.file_get_contents(path);
    return JSON.parse(new TextDecoder().decode(bytes));
}

function prepareSmokePrefs() {
    const buildDir = `${ROOT}/build`;
    GLib.mkdir_with_parents(buildDir, 0o755);

    const [, srcBytes] = GLib.file_get_contents(`${EXT}/prefs.js`);
    let src = new TextDecoder().decode(srcBytes);
    src = src.replace(
        /^import \{ExtensionPreferences\} from 'resource:\/\/\/org\/gnome\/Shell\/Extensions\/js\/extensions\/prefs\.js';/m,
        "import {ExtensionPreferences} from '../tools/stubs/extension-preferences.js';"
    );
    src = src.replace(
        /from '\.\/hwDetect\.js'/,
        "from '../extension/hwDetect.js'"
    );
    src = src.replace(
        /from '\.\/scheduleLogic\.js'/,
        "from '../extension/scheduleLogic.js'"
    );
    for (const [pkg, ver] of [['Gtk', '4.0'], ['Gdk', '4.0'], ['Adw', '1'], ['GObject', '2.0']]) {
        src = src.replaceAll(`from 'gi://${pkg}'`, `from 'gi://${pkg}?version=${ver}'`);
    }

    const outPath = `${buildDir}/prefs-smoke.js`;
    GLib.file_set_contents(outPath, src);
    return outPath;
}

async function main() {
    const schemaDir = `${EXT}/schemas`;
    Gio.Subprocess.new(
        ['glib-compile-schemas', schemaDir],
        Gio.SubprocessFlags.NONE
    ).wait_check(null);

    GLib.setenv('GSETTINGS_SCHEMA_DIR', schemaDir, true);

    Gtk.init();
    Adw.init();

    prepareSmokePrefs();

    const metadata = readJson(`${EXT}/metadata.json`);
    const mod = await import(`file://${ROOT}/build/prefs-smoke.js`);
    const PrefsClass = mod.default;

    const prefs = new PrefsClass();
    prefs.metadata = metadata;
    prefs.getSettings = () => new Gio.Settings({
        schema_id: 'org.gnome.shell.extensions.kbd-backlight-scheduler',
    });

    const win = new Adw.PreferencesWindow({title: 'Smoke test'});
    await prefs.fillPreferencesWindow(win);

    print('prefs smoke test OK');
}

try {
    await main();
} catch (e) {
    printerr(`prefs smoke test FAILED: ${e.message}`);
    if (e.stack)
        printerr(e.stack);
    imports.system.exit(1);
}
