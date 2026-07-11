import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';

import {
    detectAsusKbdLed,
    detectAsusNbWmi,
    detectAuraAvailable,
    describeHardware,
} from './hwDetect.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function pad(n) {
    return String(n).padStart(2, '0');
}

function fmtTime(h, m) {
    const period = h < 12 ? 'AM' : 'PM';
    const h12    = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${pad(m)} ${period}`;
}

function rgbaToHex(rgba) {
    const r = Math.round(rgba.red   * 255).toString(16).padStart(2, '0');
    const g = Math.round(rgba.green * 255).toString(16).padStart(2, '0');
    const b = Math.round(rgba.blue  * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
}

function loadSchedules(settings) {
    try {
        const parsed = JSON.parse(settings.get_string('schedules'));
        if (!Array.isArray(parsed))
            return {schedules: [], error: 'schedules must be a JSON array'};
        return {schedules: parsed, error: null};
    } catch (e) {
        console.warn(`[KbdBacklight] Invalid schedules JSON: ${e.message}`);
        return {schedules: [], error: e.message};
    }
}

function saveSchedules(settings, schedules) {
    settings.set_string('schedules', JSON.stringify(schedules));
}

function entryToRanges(entry) {
    const start = entry.start_h * 60 + entry.start_m;
    const end   = entry.end_h   * 60 + entry.end_m;
    if (start === end)
        return [];
    if (start < end)
        return [[start, end]];
    return [[start, 1440], [0, end]];
}

function rangesOverlap(a, b) {
    return a[0] < b[1] && b[0] < a[1];
}

function windowsOverlap(a, b) {
    const ra = entryToRanges(a);
    const rb = entryToRanges(b);
    return ra.some(r => rb.some(s => rangesOverlap(r, s)));
}

/** Returns {a, b} for the first overlapping pair, or null. */
function findFirstOverlap(entries) {
    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            if (windowsOverlap(entries[i], entries[j]))
                return {a: entries[i], b: entries[j]};
        }
    }
    return null;
}

function fmtWindowRange(entry) {
    return `${fmtTime(entry.start_h, entry.start_m)} → ${fmtTime(entry.end_h, entry.end_m)}`;
}

function overlapWarningMessage(a, b) {
    return `Time windows cannot overlap. ${fmtWindowRange(a)} conflicts with ` +
           `${fmtWindowRange(b)}. Adjust the times and try again.`;
}

const AURA_MODES = ['Static', 'Breathe', 'Strobe', 'Rainbow'];

/** Reusable Aura effect + colour picker rows for Settings UI. */
function createAuraWidgets({getMode, setMode, getColor, setColor, onChanged}) {
    const colorDlg = new Gtk.ColorDialog({
        title: 'Backlight Color', modal: true, with_alpha: false,
    });
    const colorBtn = new Gtk.ColorDialogButton({
        dialog: colorDlg, valign: Gtk.Align.CENTER,
    });
    const initRgba = new Gdk.RGBA();
    initRgba.parse(getColor());
    colorBtn.rgba = initRgba;
    colorBtn.connect('notify::rgba', () => {
        setColor(rgbaToHex(colorBtn.rgba));
        onChanged?.();
    });

    const colorRow = new Adw.ActionRow({title: 'Color'});
    colorRow.add_suffix(colorBtn);

    const auraModeList = new Gtk.StringList();
    AURA_MODES.forEach(m => auraModeList.append(m));
    const auraModeDropdown = new Gtk.DropDown({
        model:    auraModeList,
        selected: Math.max(0, AURA_MODES.indexOf(getMode())),
        valign:   Gtk.Align.CENTER,
    });

    const syncColorVisibility = () => {
        colorRow.visible = getMode() !== 'Rainbow';
    };

    auraModeDropdown.connect('notify::selected', () => {
        setMode(AURA_MODES[auraModeDropdown.selected]);
        syncColorVisibility();
        onChanged?.();
    });

    const auraModeRow = new Adw.ActionRow({title: 'Aura Effect'});
    auraModeRow.add_suffix(auraModeDropdown);
    syncColorVisibility();

    return {auraModeRow, colorRow, syncColorVisibility};
}

// ── Schedule row widget ─────────────────────────────────────────────────────

/**
 * A single expandable row representing one scheduled time window.
 *
 * Expands to show:
 *   Start  [HH] : [MM]   End  [HH] : [MM]   Brightness  [0–max]
 *   [Delete this window]
 */
const ScheduleRow = GObject.registerClass({
    GTypeName: 'KbdScheduleRow',
    Signals: {
        'changed': {},
        'deleted': {},
    },
}, class ScheduleRow extends Adw.ExpanderRow {
    _init(entry, maxBrightness, auraAvailable = false) {
        super._init();
        this._entry         = {...entry};
        this._maxB          = maxBrightness;
        this._auraAvailable = auraAvailable;

        this._updateTitle();

        // ── Start time ─────────────────────────────────────────
        const startRow = new Adw.ActionRow({title: 'Start time'});
        const startBox = new Gtk.Box({spacing: 4, valign: Gtk.Align.CENTER});

        this._startH = this._makeTimeSpin(0, 23, entry.start_h);
        this._startH.connect('value-changed', () => this._onTimeChanged());
        startBox.append(this._startH);
        startBox.append(new Gtk.Label({label: ':'}));
        this._startM = this._makeTimeSpin(0, 59, entry.start_m, 5);
        this._startM.connect('value-changed', () => this._onTimeChanged());
        startBox.append(this._startM);
        startRow.add_suffix(startBox);
        this.add_row(startRow);

        // ── End time ───────────────────────────────────────────
        const endRow = new Adw.ActionRow({title: 'End time'});
        const endBox = new Gtk.Box({spacing: 4, valign: Gtk.Align.CENTER});

        this._endH = this._makeTimeSpin(0, 23, entry.end_h);
        this._endH.connect('value-changed', () => this._onTimeChanged());
        endBox.append(this._endH);
        endBox.append(new Gtk.Label({label: ':'}));
        this._endM = this._makeTimeSpin(0, 59, entry.end_m, 5);
        this._endM.connect('value-changed', () => this._onTimeChanged());
        endBox.append(this._endM);
        endRow.add_suffix(endBox);
        this.add_row(endRow);

        // ── Brightness ────────────────────────────────────────
        const brightRow = new Adw.ActionRow({title: 'Brightness'});
        this._brightSpin = Gtk.SpinButton.new_with_range(0, maxBrightness, 1);
        this._brightSpin.value          = entry.brightness;
        this._brightSpin.valign         = Gtk.Align.CENTER;
        this._brightSpin.width_request  = 80;
        this._brightSpin.connect('value-changed', () => this._onBrightChanged());
        brightRow.add_suffix(this._brightSpin);
        brightRow.add_suffix(new Gtk.Label({
            label: `(0 = off, max ${maxBrightness})`,
            css_classes: ['dim-label'],
            valign: Gtk.Align.CENTER,
        }));
        this.add_row(brightRow);

        // ── Aura effect (only when asusctl is available) ──────
        if (auraAvailable) {
            this._entry.aura_mode = entry.aura_mode ?? 'Static';
            this._entry.color     = entry.color     ?? '#ffffff';

            const {auraModeRow, colorRow} = createAuraWidgets({
                getMode:  () => this._entry.aura_mode,
                setMode:  m => { this._entry.aura_mode = m; this._updateTitle(); },
                getColor: () => this._entry.color,
                setColor: c => { this._entry.color = c; this._updateTitle(); },
                onChanged: () => this.emit('changed'),
            });
            this.add_row(auraModeRow);
            this.add_row(colorRow);
        }

        // ── Delete button ─────────────────────────────────────
        const delRow = new Adw.ActionRow();
        const delBtn = new Gtk.Button({
            label: 'Remove this time window',
            css_classes: ['destructive-action'],
            halign: Gtk.Align.CENTER,
            margin_top: 4,
            margin_bottom: 4,
        });
        delBtn.connect('clicked', () => this.emit('deleted'));
        delRow.add_suffix(delBtn);
        this.add_row(delRow);
    }

    _makeTimeSpin(min, max, val, step = 1) {
        const spin = Gtk.SpinButton.new_with_range(min, max, step);
        spin.value           = val;
        spin.orientation     = Gtk.Orientation.HORIZONTAL;
        spin.width_request   = 60;
        spin.valign          = Gtk.Align.CENTER;
        spin.wrap            = true;
        return spin;
    }

    _onTimeChanged() {
        this._entry.start_h = this._startH.value;
        this._entry.start_m = this._startM.value;
        this._entry.end_h   = this._endH.value;
        this._entry.end_m   = this._endM.value;
        this._updateTitle();
        this.emit('changed');
    }

    _onBrightChanged() {
        this._entry.brightness = this._brightSpin.value;
        this._updateTitle();
        this.emit('changed');
    }

    _updateTitle() {
        const {start_h, start_m, end_h, end_m, brightness, aura_mode, color} = this._entry;
        this.title = `${fmtTime(start_h, start_m)}  →  ${fmtTime(end_h, end_m)}`;
        const brightLabel = brightness === 0 ? 'Off' : `${brightness} / ${this._maxB}`;
        let sub = `Brightness ${brightLabel}`;
        if (this._auraAvailable) {
            const m = aura_mode ?? 'Static';
            sub += `   ${m}`;
            if (m !== 'Rainbow') sub += ` ${color ?? '#ffffff'}`;
        }
        this.subtitle = sub;
    }

    getEntry() {
        return {...this._entry};
    }
});

// ── Preferences window ──────────────────────────────────────────────────────

export default class KbdBacklightPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings(
            'org.gnome.shell.extensions.kbd-backlight-scheduler'
        );

        // Re-detect hardware when Settings opens (may differ from last extension enable).
        const asusKbd       = detectAsusKbdLed() || detectAsusNbWmi();
        const auraAvailable = detectAuraAvailable();
        settings.set_boolean('asus-kbd-detected', asusKbd);
        settings.set_boolean('aura-available', auraAvailable);

        const maxB = settings.get_int('max-brightness');
        const hw   = describeHardware({
            gsdOk:         maxB >= 0,
            gsdSteps:      maxB + 1,
            maxBrightness: maxB,
        });

        window.set_default_size(640, 620);

        // ══════════════════════════════════════════════════════
        //  Page 1 – General
        // ══════════════════════════════════════════════════════
        const generalPage = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(generalPage);

        // ── Mode ──────────────────────────────────────────────
        const modeGroup = new Adw.PreferencesGroup({title: 'Control Mode'});
        generalPage.add(modeGroup);

        const modeRow = new Adw.ComboRow({
            title: 'Backlight Mode',
            subtitle: 'How the backlight is controlled',
        });
        const modeModel = new Gtk.StringList();
        ['Always On', 'Scheduled', 'Always Off'].forEach(s => modeModel.append(s));
        modeRow.model = modeModel;

        const modeIds = ['always-on', 'scheduled', 'always-off'];
        modeRow.selected = Math.max(0, modeIds.indexOf(settings.get_string('mode')));

        modeRow.connect('notify::selected', () => {
            settings.set_string('mode', modeIds[modeRow.selected]);
            this._updateVisibility(modeRow.selected, alwaysOnGroup);
        });
        modeGroup.add(modeRow);

        // ── Always-On brightness + Aura ─────────────────────
        const alwaysOnGroup = new Adw.PreferencesGroup({
            title: 'Always On',
            description: auraAvailable
                ? 'Brightness and Aura RGB used in "Always On" mode'
                : 'Brightness level used in "Always On" mode',
        });
        generalPage.add(alwaysOnGroup);

        const brightRow = new Adw.ActionRow({
            title: 'Brightness Level',
            subtitle: `1 (dim) – ${maxB} (full)`,
        });
        const brightScale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: maxB,
                step_increment: 1,
                value: settings.get_int('brightness'),
            }),
            draw_value: true,
            digits: 0,
            hexpand: true,
            valign: Gtk.Align.CENTER,
            width_request: 200,
        });
        for (let i = 1; i <= maxB; i++)
            brightScale.add_mark(i, Gtk.PositionType.BOTTOM, `${i}`);
        brightScale.connect('value-changed', () => {
            settings.set_int('brightness', brightScale.adjustment.value);
        });
        brightRow.add_suffix(brightScale);
        alwaysOnGroup.add(brightRow);

        if (auraAvailable) {
            const {auraModeRow, colorRow} = createAuraWidgets({
                getMode:  () => settings.get_string('always-on-aura-mode'),
                setMode:  m => settings.set_string('always-on-aura-mode', m),
                getColor: () => settings.get_string('always-on-aura-color'),
                setColor: c => settings.set_string('always-on-aura-color', c),
            });
            alwaysOnGroup.add(auraModeRow);
            alwaysOnGroup.add(colorRow);
        }

        // ══════════════════════════════════════════════════════
        //  Page 2 – Schedule
        // ══════════════════════════════════════════════════════
        const schedulePage = new Adw.PreferencesPage({
            title: 'Schedule',
            icon_name: 'x-office-calendar-symbolic',
        });
        window.add(schedulePage);

        const scheduleContent = new Adw.PreferencesGroup({
            title: 'Time Windows',
            description: 'Each period must not overlap another. ' +
                         'End < Start means the window crosses midnight.',
        });
        schedulePage.add(scheduleContent);

        const {schedules: initialSchedules, error: scheduleError} = loadSchedules(settings);

        const overlapBanner = new Adw.Banner({title: '', revealed: false});
        if (scheduleError) {
            overlapBanner.title = 'Schedule data is invalid and could not be loaded. ' +
                                  'Re-add your time windows below.';
            overlapBanner.revealed = true;
        }
        schedulePage.set_banner(overlapBanner);
        this._overlapBanner = overlapBanner;

        // "Add" button row at the bottom of the group
        const addRow = new Adw.ActionRow({title: 'Add a new time window'});
        const addBtn = new Gtk.Button({
            label: '+ Add Window',
            css_classes: ['suggested-action'],
            valign: Gtk.Align.CENTER,
        });
        addBtn.connect('clicked', () => {
            const entry = {start_h: 18, start_m: 0, end_h: 23, end_m: 0, brightness: maxB, aura_mode: 'Static', color: '#ffffff'};
            this._addScheduleRow(entry, scheduleContent, addRow, settings, maxB, auraAvailable);
            this._validateAndSave(overlapBanner, settings);
        });
        addRow.add_suffix(addBtn);
        scheduleContent.add(addRow);

        // Populate existing schedules
        this._scheduleRows = [];
        for (const entry of initialSchedules)
            this._addScheduleRow(entry, scheduleContent, addRow, settings, maxB, auraAvailable);

        this._validateAndSave(overlapBanner, settings);

        // ══════════════════════════════════════════════════════
        //  Page 3 – About
        // ══════════════════════════════════════════════════════
        const aboutPage = new Adw.PreferencesPage({
            title: 'About',
            icon_name: 'help-about-symbolic',
        });
        window.add(aboutPage);

        const aboutGroup = new Adw.PreferencesGroup({title: 'Extension'});
        aboutPage.add(aboutGroup);

        const version = this.metadata['semantic-version'] ?? '—';
        const versionRow = new Adw.ActionRow({
            title: 'Version',
            subtitle: `Keyboard Backlight Scheduler  v${version}`,
        });
        versionRow.add_suffix(new Gtk.Label({
            label: `v${version}`,
            css_classes: ['dim-label'],
            valign: Gtk.Align.CENTER,
        }));
        aboutGroup.add(versionRow);

        const backendRow = new Adw.ActionRow({
            title: 'Keyboard backlight',
            subtitle: hw.kbdBackend,
        });
        aboutGroup.add(backendRow);

        const asusRow = new Adw.ActionRow({
            title: 'ASUS WMI hardware',
            subtitle: asusKbd
                ? 'Detected — asus::kbd_backlight (asus-nb-wmi)'
                : 'Not detected via sysfs',
        });
        asusRow.add_suffix(new Gtk.Label({
            label: asusKbd ? '✓' : '—',
            css_classes: ['dim-label'],
            valign: Gtk.Align.CENTER,
        }));
        aboutGroup.add(asusRow);

        const auraRow = new Adw.ActionRow({
            title: 'Aura RGB (optional)',
            subtitle: hw.auraBackend,
        });
        auraRow.add_suffix(new Gtk.Label({
            label: auraAvailable ? '✓' : '—',
            css_classes: ['dim-label'],
            valign: Gtk.Align.CENTER,
        }));
        aboutGroup.add(auraRow);

        // Set initial visibility
        this._updateVisibility(modeRow.selected, alwaysOnGroup);
    }

    _addScheduleRow(entry, group, addRow, settings, maxB, auraAvailable = false) {
        const row = new ScheduleRow(entry, maxB, auraAvailable);

        row.connect('changed', () => {
            this._validateAndSave(this._overlapBanner, settings);
        });
        row.connect('deleted', () => {
            group.remove(row);
            this._scheduleRows = this._scheduleRows.filter(r => r !== row);
            this._validateAndSave(this._overlapBanner, settings);
        });

        // Insert before the "Add" row by rebuilding order:
        // remove addRow, add this row, re-add addRow
        group.remove(addRow);
        group.add(row);
        group.add(addRow);

        this._scheduleRows.push(row);
    }

    _validateAndSave(overlapBanner, settings) {
        const schedules = this._collectSchedules();
        const conflict = findFirstOverlap(schedules);
        if (conflict) {
            overlapBanner.title = overlapWarningMessage(conflict.a, conflict.b);
            overlapBanner.revealed = true;
            return false;
        }
        overlapBanner.revealed = false;
        saveSchedules(settings, schedules);
        return true;
    }

    _collectSchedules() {
        return this._scheduleRows.map(r => r.getEntry());
    }

    _updateVisibility(modeIndex, alwaysOnGroup) {
        alwaysOnGroup.visible = modeIndex === 0;
    }

}
