# Bug List — Keyboard Backlight Scheduler

Severity tiers: **High** → **Midhigh** → **Medium** → **Midlow** → **Low**

**Status values:** `Open` · `Fixed` · `Won't fix` · `Deferred`

---

## High

### Division by zero when GSD reports Steps = 1
- **Author:** Cursor Agent
- **Date found:** 2026-07-01
- **Status:** Fixed
- **Date fixed:** 2026-07-01
- **Fix:** Added `levelToPct()` / `pctToLevel()` helpers that handle `maxBrightness <= 0` without dividing; clamp levels in `_writeBrightness()`.
- **File:** `extension.js` — `_writeBrightness()`
- **Description:** At startup, `_maxBrightness` is set to `steps - 1`. If GSD reports `Steps = 1`, `_maxBrightness` becomes `0` and `_writeBrightness()` divides by zero when computing the percentage (`level / this._maxBrightness`). This can throw on every apply cycle and break the extension entirely.
- **Repro:** Hardware or GSD config where `Steps` returns `1`; enable extension and trigger `_applyNow()`.

---

## Midhigh

### Preferences UI uses stale max-brightness instead of live GSD Steps
- **Author:** Cursor Agent
- **Date found:** 2026-07-01
- **Status:** Fixed
- **Date fixed:** 2026-07-01
- **Fix:** Extension now writes GSD-derived `max-brightness` to GSettings on every enable.
- **Files:** `extension.js`, `prefs.js`
- **Description:** `extension.js` reads discrete `Steps` from GSD at enable time and sets `_maxBrightness`, but never writes that value back to the `max-brightness` GSettings key. `prefs.js` reads `max-brightness` (default `3`) for sliders, spin buttons, and labels. If hardware has a different step count, the Settings UI shows the wrong range and labels while the panel indicator uses the correct GSD value.
- **Repro:** Machine where GSD `Steps` ≠ 4; open Settings and compare brightness controls to the panel test buttons.

### Schedule brightness cannot be set to level 0 (Off)
- **Author:** Cursor Agent
- **Date found:** 2026-07-01
- **Status:** Fixed
- **Date fixed:** 2026-07-01
- **Fix:** Schedule brightness spin range changed from `1‥max` to `0‥max`; title shows "Off" for level 0.
- **File:** `prefs.js` — `ScheduleRow`
- **Description:** The per-window brightness spin button is created with `Gtk.SpinButton.new_with_range(1, maxBrightness, 1)`, so users cannot assign brightness level `0` to a schedule window. The only way to get "off" during a scheduled period is to have no active window covering that time, not an explicit off level inside a window.
- **Repro:** Open Schedule tab, expand a window, try to set brightness to Off / 0.

### Extension UUID mismatch between metadata and install path (`@lcortes` vs `@cscortes`)
- **Author:** Cursor Agent
- **Date found:** 2026-07-11
- **Status:** Fixed
- **Date fixed:** 2026-07-11
- **Fix:** `install.sh` and `dev-reload.sh` now read UUID from `metadata.json`; README/docs updated to `@cscortes.gnome`; legacy `@lcortes.gnome` install folder removed on install.
- **Files:** `metadata.json`, `install.sh`, `dev-reload.sh`, `README.md`, `docs/asus-color-control-fedora.md`
- **Description:** `metadata.json` declared `kbd-backlight-scheduler@cscortes.gnome`, but install scripts copied files to `kbd-backlight-scheduler@lcortes.gnome` and `gnome-extensions enable` used the `@lcortes` name. GNOME requires the install directory name to match the `uuid` in `metadata.json`; the mismatch caused “Extension does not exist” and a shell journal error refusing to load the extension.
- **Repro:** Run `./install.sh`; run `gnome-extensions enable kbd-backlight-scheduler@lcortes.gnome` — extension not found. Check journal: `UUID from metadata.json does not match directory name`.

---

## Medium

### Aura detection only runs once at extension enable
- **Author:** Cursor Agent
- **Date found:** 2026-07-01
- **Status:** Fixed
- **Date fixed:** 2026-07-01
- **Fix:** `_syncAura()` re-checks dbus on every `_applyNow()` (60 s timer + settings changes); updates `aura-available` when state changes.
- **File:** `extension.js` — `enable()`
- **Description:** `detectAura()` and `aura-available` are set only when the extension is enabled. If `asusctl` / `org.asuslinux.Daemon` starts after the extension (e.g., delayed service start), Aura options stay hidden in Settings and `_auraApply()` is never called until the user disables and re-enables the extension.
- **Repro:** Enable extension before asusctl daemon is running; start asusctl later; open Settings — no Aura controls.

### Unconditional D-Bus writes every 60 seconds
- **Author:** Cursor Agent
- **Date found:** 2026-07-01
- **Status:** Fixed
- **Date fixed:** 2026-07-01
- **Fix:** `_writeBrightness()` returns early when clamped level equals `_currentBrightness`.
- **File:** `extension.js` — `_applyNow()`, `_writeBrightness()`
- **Description:** The 60-second timer always calls `_applyNow()`, which always calls `_writeBrightness(target)` even when `target` matches the current level. This sends a GSD `Properties.Set` on every tick regardless of whether brightness changed, adding unnecessary D-Bus traffic and potential flicker on some hardware.
- **Repro:** Enable extension in Scheduled mode with stable schedule; watch logs or dbus-monitor for repeated `Set` calls with the same value.

### Test override has no explicit override flag
- **Author:** Cursor Agent
- **Date found:** 2026-07-01
- **Status:** Fixed
- **Date fixed:** 2026-07-01
- **Fix:** Added `_testOverride` flag; timer skips schedule while active; Resume / mode switch clears it and forces `_applyNow(true)`.
- **File:** `extension.js` — `KbdIndicator` test buttons
- **Description:** Panel test buttons call `_writeBrightness()` directly without marking an override state. Brightness is restored only on the next 60-second timer tick or when the user clicks "Resume Schedule Now". If the timer is delayed or the user expects immediate reversion, behavior may feel inconsistent. A dedicated override flag would make intent explicit and allow instant cancel.
- **Repro:** Use test override buttons; observe that schedule is not restored until up to 60 seconds later unless "Resume Schedule Now" is clicked.

---

## Midlow

### asusctl CLI flags may not match installed version
- **Author:** Cursor Agent
- **Date found:** 2026-07-01
- **Status:** Fixed
- **Date fixed:** 2026-07-01
- **Fix:** `detectAsusctlColourFlag()` probes `asusctl aura --help` at enable and picks `--colour` vs `--color`.
- **File:** `extension.js` — `_auraApply()`
- **Description:** Aura control uses hard-coded `asusctl aura` arguments (`-m breathe-single`, `--colour`, etc.) with an inline comment noting they may need adjustment for asusctl 5.x. Wrong flags fail silently from the user's perspective (only a console error) and RGB effects won't apply.
- **Repro:** Enable Aura on a machine with a different asusctl version; set a schedule window with Breathe/Strobe/Rainbow; check journal for `[KbdBacklight] asusctl failed`.

### asusctl subprocess errors are not surfaced to the user
- **Author:** Cursor Agent
- **Date found:** 2026-07-01
- **Status:** Fixed
- **Date fixed:** 2026-07-01
- **Fix:** `_auraApply()` waits on subprocess, captures stderr, sets `_auraError`; panel status shows `⚠ Aura` when set.
- **File:** `extension.js` — `_auraApply()`
- **Description:** `Gio.Subprocess.new()` is called without waiting for completion or reading stderr. Failures are only logged via `console.error`. Users get no panel or Settings feedback when Aura commands fail.
- **Repro:** Run without `asusctl` installed or with invalid mode; no user-visible error appears.

### GSD percentage rounding may not align with discrete steps
- **Author:** Cursor Agent
- **Date found:** 2026-07-01
- **Status:** Fixed
- **Date fixed:** 2026-07-01
- **Fix:** `pctToLevel()` picks the nearest discrete step by comparing against `levelToPct()` for each level.
- **File:** `extension.js` — `_readBrightness()`, `_writeBrightness()`
- **Description:** Levels are converted to/from GSD percentage with `Math.round((level / max) * 100)`. For non-uniform step mappings (e.g., 4 steps), intermediate percentages may round to the wrong discrete level when read back, causing the panel indicator to disagree with hardware after a set/read cycle.
- **Repro:** Set level 1 of 3 via extension; read back via GSD `Get Brightness`; compare panel dot display to actual hardware level.

---

## Low

### Version metadata inconsistent across project files
- **Author:** Cursor Agent
- **Date found:** 2026-07-01
- **Status:** Fixed
- **Date fixed:** 2026-07-01
- **Fix:** README version updated to `0.2.0` to match `metadata.json` `semantic-version`.
- **Files:** `README.md`, `metadata.json`
- **Description:** README states version **0.1.1**; `metadata.json` has `"version": 1` and `"semantic-version": "0.2.0"`. The About row in Settings reads `semantic-version`, so documentation and packaging disagree.
- **Repro:** Compare README, `metadata.json`, and Settings → About version string.

### Malformed schedules JSON fails silently
- **Author:** Cursor Agent
- **Date found:** 2026-07-01
- **Status:** Fixed
- **Date fixed:** 2026-07-01
- **Fix:** `parseSchedules()` / `loadSchedules()` return an error string; panel menu and Settings banner warn the user.
- **Files:** `extension.js`, `prefs.js`
- **Description:** `JSON.parse()` on the `schedules` key is wrapped in empty `catch` blocks in multiple places. Corrupted settings data results in an empty schedule with no warning to the user.
- **Repro:** Manually set `schedules` GSettings key to invalid JSON via `dconf` or `gsettings`; extension shows no windows and no error.

### Aura color row visibility not updated when toggling modes in panel
- **Author:** Cursor Agent
- **Date found:** 2026-07-01
- **Status:** Fixed
- **Date fixed:** 2026-07-01
- **Fix:** `_syncColorRowVisibility()` centralises color-row show/hide; called on init and mode change.
- **File:** `prefs.js` — `ScheduleRow`
- **Description:** Color picker row visibility is tied to Aura mode changes inside the Settings expander only. If `aura_mode` is changed elsewhere or loaded with `Rainbow`, edge-case UI state depends on widget init order. Minor UX inconsistency compared to panel indicator refresh logic.
- **Repro:** Set a schedule entry with `aura_mode: Rainbow` via gsettings; open Settings and expand row — color row should be hidden; verify behavior after mode changes.

### No `url` in metadata.json
- **Author:** Cursor Agent
- **Date found:** 2026-07-01
- **Status:** Fixed
- **Date fixed:** 2026-07-01
- **Fix:** Set `url` to GitHub repository.
- **File:** `metadata.json`
- **Description:** The `url` field is an empty string. Extension Manager and GNOME Extensions website integration expect a project homepage or repository URL for support and updates.
- **Repro:** Inspect `metadata.json` or view extension info in Extension Manager.

### ASUS WMI backlight conflated with Aura RGB detection
- **Author:** Cursor Agent
- **Date found:** 2026-07-01
- **Status:** Fixed
- **Date fixed:** 2026-07-01
- **Fix:** Split detection: `asus::kbd_backlight` sysfs (ASUS WMI) vs asusctl/Aura RGB. Settings and panel menu now show both statuses clearly.
- **Files:** `hwDetect.js`, `extension.js`, `prefs.js`
- **Description:** Extension only checked `org.asuslinux.Daemon` / asusctl for "ASUS" detection. Machines with ASUS WMI white backlight (via GSD) but without asusctl installed appeared undetected even though GSD + `asus::kbd_backlight` worked.
- **Repro:** ASUS laptop without asusctl; open Settings — no indication ASUS hardware is present.

### AdwBanner uses wrong property name (`reveal` vs `revealed`)
- **Author:** Cursor Agent
- **Date found:** 2026-07-11
- **Status:** Fixed
- **Date fixed:** 2026-07-11
- **Fix:** Renamed `reveal` to `revealed` on all `Adw.Banner` instances (libadwaita API).
- **File:** `prefs.js` — schedule error banner, overlap banner, `_validateAndSave()`
- **Description:** Overlap-validation and invalid-schedule banners were created with `reveal: true/false`. libadwaita’s `AdwBanner` exposes `revealed`, not `reveal`. Opening Settings crashed with `Error: No property reveal on AdwBanner`.
- **Repro:** Install v0.2.3+ with overlap banners; open extension Settings on GNOME Shell 50 / libadwaita 1.3+.

### AdwBanner added with PreferencesPage.add() instead of set_banner()
- **Author:** Cursor Agent
- **Date found:** 2026-07-11
- **Status:** Fixed
- **Date fixed:** 2026-07-11
- **Fix:** Use `schedulePage.set_banner()` for the single page banner; merge invalid-schedule and overlap messages into one `Adw.Banner`.
- **File:** `prefs.js` — Schedule page
- **Description:** Banners were passed to `Adw.PreferencesPage.add()`, which only accepts `AdwPreferencesGroup`. Opening Settings crashed with `TypeError: Object is of type Adw.Banner - cannot convert to AdwPreferencesGroup`.
- **Repro:** Open extension Settings on GNOME Shell 50 / libadwaita 1.7+ with overlap-validation banners enabled.
