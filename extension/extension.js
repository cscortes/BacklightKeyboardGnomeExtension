import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {
    detectAsusKbdLed,
    detectAsusNbWmi,
    detectAuraAvailable,
    detectAuraDaemon,
    detectAsusctlBinary,
    detectAsusctlColourFlag,
    detectAsusctlCliStyle,
    buildAuraArgv,
    describeHardware,
} from './hwDetect.js';

// ── GSD keyboard brightness D-Bus helpers ──────────────────────────────────
// Uses the same service GNOME's own brightness slider calls.
// Direct session-bus calls mirror exactly what the working gdbus commands do.

const GSD_DEST  = 'org.gnome.SettingsDaemon.Power';
const GSD_PATH  = '/org/gnome/SettingsDaemon/Power';
const GSD_IFACE = 'org.gnome.SettingsDaemon.Power.Keyboard';

function gsdGet(property) {
    const result = Gio.DBus.session.call_sync(
        GSD_DEST, GSD_PATH,
        'org.freedesktop.DBus.Properties', 'Get',
        new GLib.Variant('(ss)', [GSD_IFACE, property]),
        null, Gio.DBusCallFlags.NONE, -1, null
    );
    // result is (v) — unwrap the variant twice
    return result.get_child_value(0).unpack().unpack();
}

function gsdSetBrightness(percentage) {
    Gio.DBus.session.call_sync(
        GSD_DEST, GSD_PATH,
        'org.freedesktop.DBus.Properties', 'Set',
        new GLib.Variant('(ssv)', [
            GSD_IFACE, 'Brightness', new GLib.Variant('i', percentage),
        ]),
        null, Gio.DBusCallFlags.NONE, -1, null
    );
}

/** Convert discrete level (0‥max) to GSD percentage. Safe when max is 0 (Steps=1). */
function levelToPct(level, maxBrightness) {
    if (maxBrightness <= 0)
        return level > 0 ? 100 : 0;
    return Math.round((level / maxBrightness) * 100);
}

/** Convert GSD percentage to nearest discrete level. */
function pctToLevel(pct, maxBrightness) {
    if (maxBrightness <= 0)
        return 0;
    let best = 0, bestDiff = Infinity;
    for (let level = 0; level <= maxBrightness; level++) {
        const diff = Math.abs(pct - levelToPct(level, maxBrightness));
        if (diff < bestDiff) {
            bestDiff = diff;
            best = level;
        }
    }
    return best;
}

function parseSchedules(json) {
    try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed))
            return {schedules: [], error: 'schedules must be a JSON array'};
        return {schedules: parsed, error: null};
    } catch (e) {
        return {schedules: [], error: e.message};
    }
}

// ── Schedule logic ─────────────────────────────────────────────────────────

function nowMinutes() {
    const t = GLib.DateTime.new_now_local();
    return t.get_hour() * 60 + t.get_minute();
}

function toMin(h, m) { return h * 60 + m; }

function isPeriodActive(s, now) {
    const start = toMin(s.start_h, s.start_m);
    const end   = toMin(s.end_h,   s.end_m);
    return start <= end
        ? now >= start && now < end
        : now >= start || now < end;
}

function findActivePeriod(schedules, now) {
    return schedules.find(s => isPeriodActive(s, now)) ?? null;
}

function nextChange(schedules, now) {
    if (!schedules.length) return null;
    const currentLevel = findActivePeriod(schedules, now)?.brightness ?? 0;
    for (let delta = 1; delta <= 1440; delta++) {
        const level = findActivePeriod(schedules, (now + delta) % 1440)?.brightness ?? 0;
        if (level !== currentLevel)
            return {minutes: delta, level};
    }
    return null;
}

// ── Formatting ─────────────────────────────────────────────────────────────

function fmtTime(h, m) {
    const period = h < 12 ? 'AM' : 'PM';
    const h12    = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function fmtDelta(minutes) {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    if (h === 0)  return `${m} min`;
    if (m === 0)  return `${h} hr`;
    return `${h} hr ${m} min`;
}

function dotBar(level, max) {
    return '●'.repeat(level) + '○'.repeat(Math.max(0, max - level));
}

// ── Panel indicator ────────────────────────────────────────────────────────

const KbdIndicator = GObject.registerClass(
class KbdIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.0, 'Keyboard Backlight');
        this._ext = ext;

        this._icon = new St.Icon({
            icon_name: 'input-keyboard-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        this._buildMenu();
        this.menu.connect('open-state-changed', (_m, open) => {
            if (open) this._refresh();
        });
    }

    _buildMenu() {
        // ── Status ────────────────────────────────────────────────
        this._statusItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._statusItem);

        this._nextItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._nextItem.label.add_style_class_name('dim-label');
        this.menu.addMenuItem(this._nextItem);

        this._hwItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._hwItem.label.add_style_class_name('dim-label');
        this.menu.addMenuItem(this._hwItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Schedule periods ──────────────────────────────────────
        const schedHeading = new PopupMenu.PopupMenuItem('Schedule Periods', {reactive: false});
        schedHeading.label.style = 'font-weight: bold;';
        this.menu.addMenuItem(schedHeading);

        this._schedSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._schedSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Test override ─────────────────────────────────────────
        const testLabel = new PopupMenu.PopupMenuItem(
            'Test Override  (click ↺ Resume to restore schedule)', {reactive: false});
        testLabel.label.add_style_class_name('dim-label');
        this.menu.addMenuItem(testLabel);

        const testRow = new PopupMenu.PopupBaseMenuItem({reactive: false});
        const testBox = new St.BoxLayout({
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 6px;',
        });

        this._testBtns = [];
        const maxB = this._ext._maxBrightness;
        for (let i = 0; i <= maxB; i++) {
            const label = i === 0 ? 'Off' : dotBar(i, maxB);
            const btn   = new St.Button({
                label,
                style_class: 'button',
                style: 'min-width: 48px; padding: 4px 8px;',
                reactive: true,
            });
            const level = i;
            btn.connect('clicked', () => {
                this._ext._testOverride = true;
                this._ext._writeBrightness(level);
                this._refresh();
            });
            this._testBtns.push(btn);
            testBox.add_child(btn);
        }
        testRow.add_child(testBox);
        this.menu.addMenuItem(testRow);

        const resumeItem = new PopupMenu.PopupMenuItem('↺  Resume Schedule Now');
        resumeItem.connect('activate', () => {
            this._ext._testOverride = false;
            this._ext._applyNow(true);
            this._refresh();
        });
        this.menu.addMenuItem(resumeItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Mode switcher ─────────────────────────────────────────
        const modeRow = new PopupMenu.PopupBaseMenuItem({reactive: false});
        const modeBox = new St.BoxLayout({
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 6px;',
        });

        this._modeBtns = {};
        for (const {id, label} of [
            {id: 'always-on',  label: 'Always On'},
            {id: 'scheduled',  label: 'Scheduled'},
            {id: 'always-off', label: 'Always Off'},
        ]) {
            const btn = new St.Button({
                label,
                style_class: 'button',
                style: 'padding: 4px 8px;',
                reactive: true,
            });
            btn.connect('clicked', () => {
                this._ext._testOverride = false;
                this._ext._settings.set_string('mode', id);
                this._ext._applyNow(true);
                this._refresh();
            });
            this._modeBtns[id] = btn;
            modeBox.add_child(btn);
        }
        modeRow.add_child(modeBox);
        this.menu.addMenuItem(modeRow);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupMenuItem('Open Settings…');
        settingsItem.connect('activate', () => this._ext.openPreferences());
        this.menu.addMenuItem(settingsItem);

        const ver = this._ext.metadata['version-name'] ?? '?';
        const versionItem = new PopupMenu.PopupMenuItem(`v${ver}`, {reactive: false});
        versionItem.label.add_style_class_name('dim-label');
        this.menu.addMenuItem(versionItem);
    }

    async _refresh() {
        const ext     = this._ext;
        const mode    = ext._settings.get_string('mode');
        const maxB    = ext._maxBrightness;
        const current = ext._currentBrightness;
        const now     = nowMinutes();

        this._icon.opacity = current > 0 ? 255 : 90;

        const modeLabel = {
            'always-on': 'Always On', 'always-off': 'Always Off', 'scheduled': 'Scheduled',
        }[mode] ?? mode;
        const overrideTag = ext._testOverride ? '  [test]' : '';
        const auraErr     = ext._auraError ? '  ⚠ Aura' : '';
        this._statusItem.label.text =
            `Keyboard Backlight  |  ${modeLabel}  |  ${dotBar(current, maxB)}${overrideTag}${auraErr}`;

        if (mode === 'scheduled') {
            const {schedules, error} = parseSchedules(ext._settings.get_string('schedules'));
            const nc = nextChange(schedules, now);
            this._nextItem.label.text = error
                ? `⚠ Schedule data invalid — open Settings to fix`
                : nc
                    ? `Next change in ${fmtDelta(nc.minutes)}: ${nc.level > 0 ? `On (${dotBar(nc.level, maxB)})` : 'Off'}`
                    : schedules.length === 0
                        ? 'No periods configured — open Settings to add some'
                        : 'Schedule loops every 24 h';
            this._nextItem.visible = true;
        } else {
            this._nextItem.visible = false;
        }

        const hw = await describeHardware({
            gsdOk:         ext._gsdOk,
            gsdSteps:      ext._gsdSteps,
            maxBrightness: maxB,
        });
        this._hwItem.label.text = hw.kbdBackend;
        this._hwItem.visible    = true;

        // Rebuild schedule list
        this._schedSection.removeAll();
        const {schedules, error: schedErr} = parseSchedules(ext._settings.get_string('schedules'));

        if (schedErr) {
            const warn = new PopupMenu.PopupMenuItem('⚠  Schedule data is invalid', {reactive: false});
            warn.label.style = 'color: rgba(255, 120, 80, 1);';
            this._schedSection.addMenuItem(warn);
        } else if (schedules.length === 0) {
            const empty = new PopupMenu.PopupMenuItem('(none — add periods in Settings)', {reactive: false});
            empty.label.add_style_class_name('dim-label');
            this._schedSection.addMenuItem(empty);
        } else {
            for (const s of schedules) {
                const active = isPeriodActive(s, now);
                const item   = new PopupMenu.PopupMenuItem(
                    `${active ? '▶' : '   '}  ${fmtTime(s.start_h, s.start_m)} – ${fmtTime(s.end_h, s.end_m)}    ${dotBar(s.brightness, maxB)}`,
                    {reactive: false}
                );
                if (active)
                    item.label.style = 'color: rgba(255, 210, 80, 1); font-weight: bold;';
                this._schedSection.addMenuItem(item);
            }
        }

        this._testBtns.forEach((btn, i) => {
            btn.style = i === current
                ? 'min-width:48px; padding:4px 8px; background-color:rgba(255,255,255,0.25); border-radius:4px;'
                : 'min-width:48px; padding:4px 8px;';
        });

        for (const [id, btn] of Object.entries(this._modeBtns)) {
            btn.style = id === mode
                ? 'padding:4px 8px; background-color:rgba(255,255,255,0.25); border-radius:4px;'
                : 'padding:4px 8px;';
        }
    }
});

// ── Extension ──────────────────────────────────────────────────────────────

export default class KbdBacklightScheduler extends Extension {
    async enable() {
        this._settings = this.getSettings();

        const ver = this.metadata['version-name'] ?? '?';
        console.log(`[KbdBacklight] v${ver} enabled`);

        this._testOverride  = false;
        this._auraError     = null;
        this._gsdOk         = false;
        this._gsdSteps      = 0;
        await this._syncHardware();
        this._syncAura();
        this._asusctlStyle   = detectAsusctlCliStyle();
        this._auraColourFlag = this._auraAvailable ? detectAsusctlColourFlag() : '--colour';

        // Read Steps directly from GSD (Steps=4 → levels 0‥3, maxBrightness=3).
        // Falls back to the stored setting if GSD isn't reachable yet.
        try {
            const steps = gsdGet('Steps');
            this._gsdSteps      = steps;
            this._gsdOk         = true;
            this._maxBrightness = Math.max(0, steps - 1);
            console.log(`[KbdBacklight] GSD Steps=${steps}, maxBrightness=${this._maxBrightness}`);
        } catch (e) {
            this._maxBrightness = this._settings.get_int('max-brightness');
            this._gsdSteps      = this._maxBrightness + 1;
            console.error(`[KbdBacklight] Could not read Steps from GSD: ${e.message}`);
        }
        this._settings.set_int('max-brightness', this._maxBrightness);

        this._currentBrightness = this._readBrightness();

        this._indicator = new KbdIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._applyNow();
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._applyNow();
            return GLib.SOURCE_CONTINUE;
        });

        this._settingsId = this._settings.connect('changed', () => this._applyNow());
    }

    disable() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = null;
        }
        this._indicator?.destroy();
        this._indicator = null;
        this._settings  = null;
    }

    async _syncHardware() {
        const asusLed = await detectAsusKbdLed();
        const asusWmi = detectAsusNbWmi();
        const detected = asusLed || asusWmi;
        this._settings.set_boolean('asus-kbd-detected', detected);
        console.log(`[KbdBacklight] ASUS WMI LED (asus::kbd_backlight): ${asusLed}`);
        console.log(`[KbdBacklight] ASUS platform (asus-nb-wmi): ${asusWmi}`);
    }

    _syncAura() {
        const available = detectAuraAvailable();
        const firstRun  = this._auraAvailable === undefined;
        if (firstRun || available !== this._auraAvailable) {
            this._auraAvailable = available;
            this._settings.set_boolean('aura-available', available);
            if (available)
                this._auraColourFlag = detectAsusctlColourFlag();
            this._asusctlStyle = detectAsusctlCliStyle();
            console.log(`[KbdBacklight] Aura RGB: ${available} ` +
                `(daemon=${detectAuraDaemon()}, asusctl=${detectAsusctlBinary()})`);
        }
    }

    /** Read current brightness from GSD (percentage → level) */
    _readBrightness() {
        try {
            const pct = gsdGet('Brightness');
            return pctToLevel(pct, this._maxBrightness);
        } catch (e) {
            console.error(`[KbdBacklight] read Brightness failed: ${e.message}`);
            return 0;
        }
    }

    /** Write brightness via GSD Properties.Set (level → percentage) */
    _writeBrightness(level) {
        const clamped = Math.min(Math.max(0, level), this._maxBrightness);
        if (clamped === this._currentBrightness)
            return;
        try {
            const pct = levelToPct(clamped, this._maxBrightness);
            gsdSetBrightness(pct);
            this._currentBrightness = clamped;
            console.log(`[KbdBacklight] Set level ${clamped} (${pct}%) via GSD`);
        } catch (e) {
            console.error(`[KbdBacklight] SetBrightness failed: ${e.message}`);
        }
    }

    _applyNow(force = false) {
        if (this._testOverride && !force)
            return;

        this._syncAura();

        const mode = this._settings.get_string('mode');
        let target = 0;

        if (mode === 'always-on') {
            target = this._settings.get_int('brightness');
            if (this._auraAvailable) {
                this._auraApply(
                    this._settings.get_string('always-on-aura-mode'),
                    this._settings.get_string('always-on-aura-color')
                );
            }
        } else if (mode === 'always-off') {
            target = 0;
            if (this._auraAvailable)
                this._auraApply('Static', '#000000');
        } else {
            const {schedules} = parseSchedules(this._settings.get_string('schedules'));
            const now = nowMinutes();
            const active = findActivePeriod(schedules, now);
            target = active?.brightness ?? 0;
            if (this._auraAvailable) {
                this._auraApply(
                    active?.aura_mode ?? 'Static',
                    active ? (active.color ?? '#ffffff') : '#000000'
                );
            }
        }

        target = Math.min(Math.max(0, target), this._maxBrightness);
        this._writeBrightness(target);
        this._indicator?._refresh();
    }

    _auraApply(auraMode, hexColor) {
        const hex  = (hexColor ?? '#ffffff').replace('#', '');
        const argv = buildAuraArgv(
            auraMode, hex, this._asusctlStyle ?? 'v6', this._auraColourFlag ?? '--colour'
        );
        try {
            const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDERR_PIPE);
            proc.wait_async(null, (p, result) => {
                try {
                    p.wait_finish(result);
                    this._auraError = null;
                } catch (e) {
                    const [, stderr] = p.communicate_utf8(null, null);
                    this._auraError = (stderr?.trim() || e.message);
                    console.error(`[KbdBacklight] asusctl failed: ${this._auraError}`);
                }
                this._indicator?._refresh();
            });
            console.log(`[KbdBacklight] Aura ${auraMode} #${hex} (${argv.join(' ')})`);
        } catch (e) {
            this._auraError = e.message;
            console.error(`[KbdBacklight] asusctl failed: ${e.message}`);
            this._indicator?._refresh();
        }
    }

}
