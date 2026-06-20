import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';

// ── Helpers ────────────────────────────────────────────────────────────────

function pad(n) {
    return String(n).padStart(2, '0');
}

function fmtTime(h, m) {
    const period = h < 12 ? 'AM' : 'PM';
    const h12    = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${pad(m)} ${period}`;
}

function loadSchedules(settings) {
    try {
        return JSON.parse(settings.get_string('schedules')) ?? [];
    } catch (_) {
        return [];
    }
}

function saveSchedules(settings, schedules) {
    settings.set_string('schedules', JSON.stringify(schedules));
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
    _init(entry, maxBrightness) {
        super._init();
        this._entry      = {...entry};
        this._maxB       = maxBrightness;

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
        this._brightSpin = Gtk.SpinButton.new_with_range(1, maxBrightness, 1);
        this._brightSpin.value          = entry.brightness;
        this._brightSpin.valign         = Gtk.Align.CENTER;
        this._brightSpin.width_request  = 80;
        this._brightSpin.connect('value-changed', () => this._onBrightChanged());
        brightRow.add_suffix(this._brightSpin);
        brightRow.add_suffix(new Gtk.Label({
            label: `(max ${maxBrightness})`,
            css_classes: ['dim-label'],
            valign: Gtk.Align.CENTER,
        }));
        this.add_row(brightRow);

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
        const {start_h, start_m, end_h, end_m, brightness} = this._entry;
        this.title    = `${fmtTime(start_h, start_m)}  →  ${fmtTime(end_h, end_m)}`;
        this.subtitle = `Brightness ${brightness} / ${this._maxB}`;
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
        const maxB = settings.get_int('max-brightness');

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

        // ── Always-On brightness ──────────────────────────────
        const alwaysOnGroup = new Adw.PreferencesGroup({
            title: 'Always-On Brightness',
            description: 'Brightness level used in "Always On" mode',
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

        // ── About ─────────────────────────────────────────────
        const aboutGroup = new Adw.PreferencesGroup({title: 'About'});
        generalPage.add(aboutGroup);

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
            title: 'Brightness backend',
            subtitle: 'org.gnome.SettingsDaemon.Power.Keyboard (GSD D-Bus)',
        });
        aboutGroup.add(backendRow);

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
            description: 'The backlight turns on at the brightest matching level. ' +
                         'End < Start means the window crosses midnight.',
        });
        schedulePage.add(scheduleContent);

        // "Add" button row at the bottom of the group
        const addRow = new Adw.ActionRow({title: 'Add a new time window'});
        const addBtn = new Gtk.Button({
            label: '+ Add Window',
            css_classes: ['suggested-action'],
            valign: Gtk.Align.CENTER,
        });
        addBtn.connect('clicked', () => {
            const entry = {start_h: 18, start_m: 0, end_h: 23, end_m: 0, brightness: maxB};
            this._addScheduleRow(entry, scheduleContent, addRow, settings, maxB);
            saveSchedules(settings, this._collectSchedules());
        });
        addRow.add_suffix(addBtn);
        scheduleContent.add(addRow);

        // Populate existing schedules
        this._scheduleRows = [];
        for (const entry of loadSchedules(settings))
            this._addScheduleRow(entry, scheduleContent, addRow, settings, maxB);

        // Set initial visibility
        this._updateVisibility(modeRow.selected, alwaysOnGroup);
    }

    _addScheduleRow(entry, group, addRow, settings, maxB) {
        const row = new ScheduleRow(entry, maxB);

        row.connect('changed', () => {
            saveSchedules(settings, this._collectSchedules());
        });
        row.connect('deleted', () => {
            group.remove(row);
            this._scheduleRows = this._scheduleRows.filter(r => r !== row);
            saveSchedules(settings, this._collectSchedules());
        });

        // Insert before the "Add" row by rebuilding order:
        // remove addRow, add this row, re-add addRow
        group.remove(addRow);
        group.add(row);
        group.add(addRow);

        this._scheduleRows.push(row);
    }

    _collectSchedules() {
        return this._scheduleRows.map(r => r.getEntry());
    }

    _updateVisibility(modeIndex, alwaysOnGroup) {
        alwaysOnGroup.visible = modeIndex === 0;
    }

}
