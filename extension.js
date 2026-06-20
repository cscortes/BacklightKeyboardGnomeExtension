import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

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

// ── Schedule logic ─────────────────────────────────────────────────────────

function nowMinutes() {
    const t = GLib.DateTime.new_now_local();
    return t.get_hour() * 60 + t.get_minute();
}

function toMin(h, m) { return h * 60 + m; }

function isWindowActive(s, now) {
    const start = toMin(s.start_h, s.start_m);
    const end   = toMin(s.end_h,   s.end_m);
    return start <= end
        ? now >= start && now < end
        : now >= start || now < end;
}

function resolveSchedule(schedules, now) {
    return schedules.reduce((best, s) =>
        isWindowActive(s, now) && s.brightness > best ? s.brightness : best, 0);
}

function nextChange(schedules, now) {
    if (!schedules.length) return null;
    const currentLevel = resolveSchedule(schedules, now);
    for (let delta = 1; delta <= 1440; delta++) {
        const level = resolveSchedule(schedules, (now + delta) % 1440);
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

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Schedule windows ──────────────────────────────────────
        const schedHeading = new PopupMenu.PopupMenuItem('Schedule Windows', {reactive: false});
        schedHeading.label.style = 'font-weight: bold;';
        this.menu.addMenuItem(schedHeading);

        this._schedSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._schedSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Test override ─────────────────────────────────────────
        const testLabel = new PopupMenu.PopupMenuItem(
            'Test Override  (auto-restores at next schedule tick)', {reactive: false});
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
            this._ext._applyNow();
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
                this._ext._settings.set_string('mode', id);
                this._ext._applyNow();
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
    }

    _refresh() {
        const ext     = this._ext;
        const mode    = ext._settings.get_string('mode');
        const maxB    = ext._maxBrightness;
        const current = ext._currentBrightness;
        const now     = nowMinutes();

        this._icon.opacity = current > 0 ? 255 : 90;

        const modeLabel = {
            'always-on': 'Always On', 'always-off': 'Always Off', 'scheduled': 'Scheduled',
        }[mode] ?? mode;
        this._statusItem.label.text =
            `Keyboard Backlight  |  ${modeLabel}  |  ${dotBar(current, maxB)}`;

        if (mode === 'scheduled') {
            let schedules = [];
            try { schedules = JSON.parse(ext._settings.get_string('schedules')); } catch (_) {}
            const nc = nextChange(schedules, now);
            this._nextItem.label.text = nc
                ? `Next change in ${fmtDelta(nc.minutes)}: ${nc.level > 0 ? `On (${dotBar(nc.level, maxB)})` : 'Off'}`
                : schedules.length === 0
                    ? 'No windows configured — open Settings to add some'
                    : 'Schedule loops every 24 h';
            this._nextItem.visible = true;
        } else {
            this._nextItem.visible = false;
        }

        // Rebuild schedule list
        this._schedSection.removeAll();
        let schedules = [];
        try { schedules = JSON.parse(ext._settings.get_string('schedules')); } catch (_) {}

        if (schedules.length === 0) {
            const empty = new PopupMenu.PopupMenuItem('(none — add windows in Settings)', {reactive: false});
            empty.label.add_style_class_name('dim-label');
            this._schedSection.addMenuItem(empty);
        } else {
            for (const s of schedules) {
                const active = isWindowActive(s, now);
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
    enable() {
        this._settings = this.getSettings(
            'org.gnome.shell.extensions.kbd-backlight-scheduler'
        );

        // Read Steps directly from GSD (Steps=4 → levels 0‥3, maxBrightness=3).
        // Falls back to the stored setting if GSD isn't reachable yet.
        try {
            const steps = gsdGet('Steps');
            this._maxBrightness = steps - 1;
            console.log(`[KbdBacklight] GSD Steps=${steps}, maxBrightness=${this._maxBrightness}`);
        } catch (e) {
            this._maxBrightness = this._settings.get_int('max-brightness');
            console.error(`[KbdBacklight] Could not read Steps from GSD: ${e.message}`);
        }

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

    /** Read current brightness from GSD (percentage → level) */
    _readBrightness() {
        try {
            const pct = gsdGet('Brightness');
            return Math.round((pct / 100) * this._maxBrightness);
        } catch (e) {
            console.error(`[KbdBacklight] read Brightness failed: ${e.message}`);
            return 0;
        }
    }

    /** Write brightness via GSD Properties.Set (level → percentage) */
    _writeBrightness(level) {
        try {
            const pct = Math.round((level / this._maxBrightness) * 100);
            gsdSetBrightness(pct);
            this._currentBrightness = level;
            console.log(`[KbdBacklight] Set level ${level} (${pct}%) via GSD`);
        } catch (e) {
            console.error(`[KbdBacklight] SetBrightness failed: ${e.message}`);
        }
    }

    _applyNow() {
        const mode = this._settings.get_string('mode');
        let target = 0;

        if (mode === 'always-on') {
            target = this._settings.get_int('brightness');
        } else if (mode === 'always-off') {
            target = 0;
        } else {
            let schedules = [];
            try { schedules = JSON.parse(this._settings.get_string('schedules')); } catch (_) {}
            target = resolveSchedule(schedules, nowMinutes());
        }

        this._writeBrightness(target);
        this._indicator?._refresh();
    }

}
