#!/usr/bin/gjs -m
/**
 * Parse-check extension JS without GNOME Shell.
 * Strips imports/exports and runs gjs -c; fails only on SyntaxError.
 */
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const files = ARGV;
if (!files.length) {
    printerr('Usage: check-syntax.js <file.js> …');
    imports.system.exit(1);
}

function stripForParseCheck(source) {
    return source
        .replace(/^\s*import\s+\{[\s\S]*?\}\s+from\s+[^;]+;\s*/gm, '')
        .replace(/^\s*import\s+[^;]+;\s*/gm, '')
        .replace(/^export default /gm, '')
        .replace(/^export /gm, '');
}

function checkFile(path) {
    const [, bytes] = GLib.file_get_contents(path);
    const source = stripForParseCheck(new TextDecoder().decode(bytes));

    const proc = Gio.Subprocess.new(
        ['gjs', '-c', source],
        Gio.SubprocessFlags.STDERR_PIPE | Gio.SubprocessFlags.STDOUT_PIPE
    );
    const [, stdout, stderr] = proc.communicate_utf8(null, null);
    const status = proc.get_exit_status();
    const errText = (stderr || stdout || '').trim();

    if (status === 0)
        return true;

    if (/SyntaxError:/i.test(errText)) {
        printerr(`${path}: ${errText}`);
        return false;
    }

    // ReferenceError etc. at runtime — imports stripped; syntax is OK.
    return true;
}

let ok = true;
for (const path of files) {
    if (!checkFile(path))
        ok = false;
}

imports.system.exit(ok ? 0 : 1);
