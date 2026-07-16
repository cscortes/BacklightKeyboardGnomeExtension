import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import Adw from 'gi://Adw?version=1';

import {
    detectAsusKbdLed,
    detectAsusNbWmi,
    detectAuraAvailable,
    describeHardware,
} from './hwDetect.js';
import {
    entriesEqual,
    findFirstOverlap,
    findOverlapWith,
    nextDefaultEntry,
    planScheduleSave,
} from './scheduleLogic.js';

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
        return {schedules: [], error: e.message};
    }
}

function saveSchedules(settings, schedules) {
    settings.set_string('schedules', JSON.stringify(schedules));
}

function fmtPeriodRange(entry) {
    return `${fmtTime(entry.start_h, entry.start_m)} → ${fmtTime(entry.end_h, entry.end_m)}`;
}

function overlapEditBannerMessage(a, b) {
    return `Time periods overlap: ${fmtPeriodRange(a)} and ${fmtPeriodRange(b)}. ` +
           'Change the times to resolve it, or Cancel/Revert to discard the edit.';
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

    const syncToWidgets = () => {
        auraModeDropdown.selected = Math.max(0, AURA_MODES.indexOf(getMode()));
        const rgba = new Gdk.RGBA();
        rgba.parse(getColor());
        colorBtn.rgba = rgba;
        syncColorVisibility();
    };

    return {auraModeRow, colorRow, syncColorVisibility, syncToWidgets};
}

// ── Schedule row widget ─────────────────────────────────────────────────────

/**
 * A single expandable row representing one scheduled time period.
 *
 * Expands to show:
 *   Start  [HH] : [MM]   End  [HH] : [MM]   Brightness  [0–max]
 *   [Delete this period]
 */
const ScheduleRow = GObject.registerClass({
    GTypeName: 'KbdScheduleRow',
    Signals: {
        'changed': {},
        'confirmed': {},
        'deleted': {},
        'discard': {},
    },
}, class ScheduleRow extends Adw.ExpanderRow {
    _init(entry, maxBrightness, auraAvailable = false) {
        super._init();
        this._entry         = {...entry};
        this._savedEntry    = null;
        this._maxB          = maxBrightness;
        this._auraAvailable = auraAvailable;
        this._syncAura      = null;

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

            const {auraModeRow, colorRow, syncToWidgets} = createAuraWidgets({
                getMode:  () => this._entry.aura_mode,
                setMode:  m => { this._entry.aura_mode = m; this._updateTitle(); },
                getColor: () => this._entry.color,
                setColor: c => { this._entry.color = c; this._updateTitle(); },
                onChanged: () => this.emit('changed'),
            });
            this._syncAura = syncToWidgets;
            this.add_row(auraModeRow);
            this.add_row(colorRow);
        }

        // ── Cancel / OK confirm bar ────────────────────────────
        // Edits are staged locally in this._entry and only written to
        // GSettings when OK is clicked — there is no auto-save on every
        // keystroke, so this bar is the one and only way to confirm or
        // discard a change to this specific period.
        const confirmRow = new Adw.ActionRow();
        const confirmBox = new Gtk.Box({
            spacing: 8,
            halign: Gtk.Align.CENTER,
            margin_top: 4,
            margin_bottom: 4,
        });
        this._cancelBtn = new Gtk.Button({label: 'Cancel', css_classes: ['warning']});
        this._cancelBtn.connect('clicked', () => this.revert());
        this._okBtn = new Gtk.Button({label: 'OK', css_classes: ['suggested-action']});
        this._okBtn.connect('clicked', () => this.confirm());
        confirmBox.append(this._cancelBtn);
        confirmBox.append(this._okBtn);
        confirmRow.add_suffix(confirmBox);
        this._confirmRow = confirmRow;
        this._confirmRow.visible = false;
        this.add_row(confirmRow);

        // ── Delete button ─────────────────────────────────────
        const delRow = new Adw.ActionRow();
        const delBtn = new Gtk.Button({
            label: 'Remove this time period',
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

    setEntry(entry) {
        this._entry = {...entry};
        this._startH.value = entry.start_h;
        this._startM.value = entry.start_m;
        this._endH.value   = entry.end_h;
        this._endM.value   = entry.end_m;
        this._brightSpin.value = entry.brightness;
        if (this._auraAvailable) {
            this._entry.aura_mode = entry.aura_mode ?? 'Static';
            this._entry.color     = entry.color     ?? '#ffffff';
            this._syncAura?.();
        }
        this._updateTitle();
    }

    /** True until this period has ever had OK clicked — i.e. a fresh,
     * unconfirmed draft from "+ New Period" that isn't in GSettings yet. */
    isNewDraft() {
        return this._savedEntry === null;
    }

    getSavedEntry() {
        return this._savedEntry ? {...this._savedEntry} : null;
    }

    markSaved() {
        this._savedEntry = this.getEntry();
        this.setConflict(false);
        this.updateEditControlsVisibility();
    }

    isDirty() {
        return this._savedEntry === null || !entriesEqual(this.getEntry(), this._savedEntry);
    }

    setConflict(on) {
        if (on)
            this.add_css_class('error');
        else
            this.remove_css_class('error');
        this._okBtn.sensitive = !on;
    }

    /** Shows/hides and labels the Cancel/OK bar based on draft vs. edit state. */
    updateEditControlsVisibility() {
        if (this.isNewDraft()) {
            this._confirmRow.visible = true;
            this._cancelBtn.label = 'Cancel';
            this._okBtn.label = 'Add';
        } else {
            this._confirmRow.visible = this.isDirty();
            this._cancelBtn.label = 'Revert';
            this._okBtn.label = 'Save';
        }
        this._updateTitle();
    }

    /** Cancel: discard a never-confirmed draft, or revert edits to last-saved. */
    revert() {
        if (this.isNewDraft())
            this.emit('discard');
        else {
            this.setEntry(this._savedEntry);
            this.emit('changed');
        }
    }

    /** OK: ask the parent to validate + persist this period's staged edits. */
    confirm() {
        this.emit('confirmed');
    }

    _onTimeChanged() {
        this._entry.start_h = this._startH.value;
        this._entry.start_m = this._startM.value;
        this._entry.end_h   = this._endH.value;
        this._entry.end_m   = this._endM.value;
        this.updateEditControlsVisibility();
        this.emit('changed');
    }

    _onBrightChanged() {
        this._entry.brightness = this._brightSpin.value;
        this.updateEditControlsVisibility();
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
        if (this.isDirty())
            sub += this.isNewDraft() ? '   •  Not added yet' : '   •  Unsaved edit';
        this.subtitle = sub;
    }

    getEntry() {
        return {...this._entry};
    }
});

// ── Preferences window ──────────────────────────────────────────────────────

export default class KbdBacklightPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Re-detect hardware when Settings opens (may differ from last extension enable).
        const asusKbd       = detectAsusKbdLed() || detectAsusNbWmi();
        const auraAvailable = detectAuraAvailable();
        settings.set_boolean('asus-kbd-detected', asusKbd);
        settings.set_boolean('aura-available', auraAvailable);

        const maxB = settings.get_int('max-brightness');
        const hw   = await describeHardware({
            gsdOk:         maxB >= 0,
            gsdSteps:      maxB + 1,
            maxBrightness: maxB,
        });

        window.set_default_size(640, 620);
        window.connect('close-request', () => {
            this._scheduleRows = null;
            this._overlapBanner = null;
            this._addBtn = null;
            this._scheduleJsonError = null;
            return false;
        });

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
            title: 'Time Periods',
            description: 'No periods is a valid schedule — the backlight simply stays off. ' +
                         'End before Start means the period crosses midnight. ' +
                         'Editing a period stages the change — click OK to confirm it or ' +
                         'Cancel/Revert to discard it.',
        });
        schedulePage.add(scheduleContent);

        const {schedules: initialSchedules, error: scheduleError} = loadSchedules(settings);
        this._scheduleJsonError = !!scheduleError;

        const overlapBanner = new Adw.Banner({title: '', revealed: false});
        if (scheduleError) {
            overlapBanner.title = 'Schedule data is invalid and could not be loaded. ' +
                                  'Re-add your time periods below.';
            overlapBanner.revealed = true;
        }
        schedulePage.set_banner(overlapBanner);
        this._overlapBanner = overlapBanner;

        // "New Period" button row at the bottom of the group. Named
        // distinctly from the per-row "OK" button — this one always starts
        // a brand-new period; it never confirms an edit to an existing one.
        const addRow = new Adw.ActionRow({title: 'Create a new time period'});
        const addBtn = new Gtk.Button({
            label: '+ New Period',
            css_classes: ['suggested-action'],
            valign: Gtk.Align.CENTER,
        });
        this._addBtn = addBtn;
        addBtn.connect('clicked', () => {
            this._scheduleJsonError = false;
            const entry = nextDefaultEntry(this._liveSchedules(), maxB);
            this._addScheduleRow(
                entry, scheduleContent, addRow, settings, maxB, auraAvailable,
                {expand: true}
            );
            this._updatePreview();
        });
        addRow.add_suffix(addBtn);
        scheduleContent.add(addRow);

        // Populate existing schedules
        this._scheduleRows = [];
        for (const entry of initialSchedules)
            this._addScheduleRow(
                entry, scheduleContent, addRow, settings, maxB, auraAvailable, {saved: true}
            );

        this._updatePreview();

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

        const version = this.metadata['version-name'] ?? '—';
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

    _addScheduleRow(entry, group, addRow, settings, maxB, auraAvailable = false,
                    {expand = false, saved = false} = {}) {
        const row = new ScheduleRow(entry, maxB, auraAvailable);

        // 'changed' fires on every keystroke — live preview only (conflict
        // banner + this row's own OK/Cancel bar). Nothing is written to
        // GSettings until 'confirmed' (OK) fires.
        row.connect('changed', () => {
            row.updateEditControlsVisibility();
            this._updatePreview();
        });
        row.connect('confirmed', () => this._onRowConfirmed(row, settings));
        row.connect('deleted', () => {
            group.remove(row);
            this._scheduleRows = this._scheduleRows.filter(r => r !== row);
            this._scheduleJsonError = false;
            this._persistConfirmed(settings, {alwaysSave: true});
            this._updatePreview();
        });
        row.connect('discard', () => {
            // Never-confirmed draft cancelled — nothing was ever persisted
            // for it, so just drop it and refresh the live preview (it may
            // have been the other half of a conflict shown to the user).
            group.remove(row);
            this._scheduleRows = this._scheduleRows.filter(r => r !== row);
            this._updatePreview();
        });

        // Insert before the "Add" row by rebuilding order:
        // remove addRow, add this row, re-add addRow
        group.remove(addRow);
        group.add(row);
        group.add(addRow);

        this._scheduleRows.push(row);
        if (expand)
            row.expanded = true;
        if (saved)
            row.markSaved();
        else
            row.updateEditControlsVisibility(); // show Cancel/Add immediately, don't wait for a first edit
        return row;
    }

    /** OK clicked on one row: guard against confirming a still-conflicting
     * edit (the button is disabled in that case, but double-check), then
     * mark it saved and persist all confirmed periods. */
    _onRowConfirmed(row, settings) {
        const others = this._scheduleRows.filter(r => r !== row).map(r => r.getEntry());
        if (findOverlapWith(row.getEntry(), others)) {
            this._updatePreview();
            return;
        }
        row.markSaved();
        this._persistConfirmed(settings);
        this._updatePreview();
    }

    _liveSchedules() {
        return this._scheduleRows.map(r => r.getEntry());
    }

    _confirmedSchedules() {
        return this._scheduleRows
            .filter(r => !r.isNewDraft())
            .map(r => r.getSavedEntry());
    }

    /** Live, read-only feedback as the user types: conflict banner + per-row
     * error highlighting + Add-button availability. Never writes to GSettings. */
    _updatePreview() {
        // Don't clobber the "invalid JSON" banner before the user has done
        // anything to recover from it (no rows exist yet to conflict-check).
        if (this._scheduleJsonError && this._scheduleRows.length === 0)
            return;

        for (const row of this._scheduleRows)
            row.setConflict(false);

        const conflict = findFirstOverlap(this._liveSchedules());
        if (conflict) {
            this._overlapBanner.title = overlapEditBannerMessage(conflict.a, conflict.b);
            this._overlapBanner.revealed = true;
            this._scheduleRows[conflict.i]?.setConflict(true);
            this._scheduleRows[conflict.j]?.setConflict(true);
        } else {
            this._overlapBanner.revealed = false;
        }

        // Only one unconfirmed draft at a time — resolve it (OK or Cancel)
        // before starting another, so it can never be mistaken for the
        // thing that was just being edited.
        this._addBtn.sensitive = !this._scheduleRows.some(r => r.isNewDraft());
    }

    /** Writes the confirmed (OK'd) periods to GSettings. */
    _persistConfirmed(settings, {alwaysSave = false} = {}) {
        const schedules = this._confirmedSchedules();
        const {save} = planScheduleSave(schedules, {
            alwaysSave,
            jsonError: this._scheduleJsonError,
        });
        if (!save)
            return false;

        this._scheduleJsonError = false;
        saveSchedules(settings, schedules);
        return true;
    }

    _updateVisibility(modeIndex, alwaysOnGroup) {
        alwaysOnGroup.visible = modeIndex === 0;
    }

}
