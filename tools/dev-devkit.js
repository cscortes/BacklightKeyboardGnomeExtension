#!/usr/bin/env node
/**
 * Fast dev loop for testing extension.js / prefs.js changes without
 * touching your real login session.
 *
 * GNOME Shell only discovers new/changed extension code when its own
 * process starts: it scans ~/.local/share/gnome-shell/extensions once at
 * startup, and GJS caches ES modules for the lifetime of the process.
 * `gnome-extensions disable/enable` on an already-running Shell does NOT
 * pick up new code for that reason. On Wayland, restarting the real Shell
 * means logging out.
 *
 * The officially supported way to get a disposable Shell process instead
 * is a "devkit" nested instance (the current replacement for the removed
 * `--nested` flag), running in its own private D-Bus session so it can't
 * collide with your real session's services:
 *
 *   dbus-run-session -- gnome-shell --devkit --wayland
 *
 * This script deploys the extension (reusing install.sh), launches a
 * nested devkit Shell, and enables the extension inside it. Every time a
 * watched source file changes, it kills the nested Shell, redeploys, and
 * relaunches — a fresh process each time means fresh code, with no logout
 * and no effect on your real desktop. Requires the `mutter-devkit` package
 * (`sudo dnf install -y mutter-devkit`).
 */
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const DEVKIT_BIN = '/usr/libexec/mutter-devkit';
const metadata = JSON.parse(fs.readFileSync(path.join(EXT, 'metadata.json'), 'utf8'));
const UUID = metadata.uuid;

const WATCH_TARGETS = [
    'extension.js', 'prefs.js', 'hwDetect.js', 'scheduleLogic.js',
    'metadata.json', 'schemas',
].map(f => path.join(EXT, f));

let nested = null;
let restarting = false;
let pending = false;
let suppressWatch = false;

function log(msg) {
    console.log(`[dev-devkit] ${msg}`);
}

function checkDevkit() {
    if (fs.existsSync(DEVKIT_BIN))
        return true;
    console.error(
        `[dev-devkit] mutter-devkit is not installed (missing ${DEVKIT_BIN}).\n` +
        '             Install it once with:\n' +
        '               sudo dnf install -y mutter-devkit\n' +
        '             then re-run `npm run dev` / `make dev`.'
    );
    return false;
}

function deploy() {
    log('Deploying latest code (validate + install)…');
    const result = spawnSync(path.join(ROOT, 'scripts', 'install.sh'), [], {
        cwd: ROOT,
        stdio: 'inherit',
    });
    if (result.status !== 0) {
        log('Deploy failed — fix the error above and save again.');
        return false;
    }
    return true;
}

function killNested() {
    if (!nested)
        return;
    try {
        process.kill(-nested.pid, 'SIGTERM');
    } catch {
        // already gone
    }
    nested = null;
}

function launchNested() {
    // dbus-run-session gives the nested Shell its own private D-Bus
    // session so it can't collide with your real session's services. It
    // shares $HOME though, so it picks up the extension we just installed
    // and the same GSettings (your real schedule/settings carry over).
    const script = [
        'gnome-shell --devkit --wayland &',
        'shell_pid=$!',
        'for i in $(seq 1 40); do',
        '  sleep 0.5',
        `  gnome-extensions enable "${UUID}" >/dev/null 2>&1 && break`,
        'done',
        'wait "$shell_pid"',
    ].join('\n');

    log('Launching nested devkit Shell…');
    nested = spawn('dbus-run-session', ['--', 'bash', '-c', script], {
        cwd: ROOT,
        stdio: 'inherit',
        detached: true, // own process group so we can kill Shell + helpers together
        env: process.env,
    });
    nested.on('exit', (code, signal) => {
        nested = null;
        if (!restarting)
            log(`Nested Shell exited (code=${code}, signal=${signal}). Waiting for changes… (Ctrl+C to quit)`);
    });
}

async function restart() {
    if (restarting) {
        pending = true;
        return;
    }
    restarting = true;
    // install.sh writes extension/schemas/gschemas.compiled back into the repo, which
    // is itself a watched path — ignore filesystem events we caused ourselves.
    suppressWatch = true;
    killNested();
    // give the old process group a moment to fully die before reusing the bus
    await new Promise(r => setTimeout(r, 300));
    if (deploy())
        launchNested();
    // let any trailing fs events from our own deploy() writes flush out
    // before re-arming the watcher.
    await new Promise(r => setTimeout(r, 500));
    suppressWatch = false;
    restarting = false;
    if (pending) {
        pending = false;
        restart();
    }
}

function watch() {
    let debounce = null;
    const trigger = () => {
        if (suppressWatch)
            return;
        clearTimeout(debounce);
        debounce = setTimeout(restart, 200);
    };
    for (const target of WATCH_TARGETS) {
        if (!fs.existsSync(target))
            continue;
        fs.watch(target, trigger);
    }
    log('Watching for changes — save any source file to redeploy + relaunch.');
}

function main() {
    if (!checkDevkit())
        process.exit(1);

    process.on('SIGINT', () => {
        log('Shutting down…');
        killNested();
        process.exit(0);
    });

    restart();
    watch();
}

main();
