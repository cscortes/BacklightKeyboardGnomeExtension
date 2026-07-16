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

---

## Medium

### Remove time window does not always persist
- **Author:** Cursor Agent
- **Date found:** 2026-07-11
- **Status:** Fixed
- **Date fixed:** 2026-07-11
- **Fix:** Delete and “Cancel new window” now call `_validateAndSave()` with `alwaysSave: true` so removals are written even when remaining windows overlap or stored JSON was invalid; save decision extracted to `planScheduleSave()` in `scheduleLogic.js` with regression tests in `tools/schedule-logic-test.js`.
- **Files:** `prefs.js`, `scheduleLogic.js`, `tools/schedule-logic-test.js`
- **Description:** Removing a schedule row updated the UI but `_validateAndSave()` refused to write GSettings when other windows still overlapped or when `_scheduleJsonError` was set after a bad load. The row disappeared until Settings was reopened, then reappeared from stale stored data.
- **Repro:** Create three windows where two overlap; delete the non-overlapping one — row vanishes but returns after closing and reopening Settings. Or corrupt the `schedules` key, open Settings, delete rows — changes never persist.

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

## Midhigh

### "Add Window" crashed and left an unpersisted ghost draft when its default time overlapped an existing period
- **Author:** Cursor Agent
- **Date found:** 2026-07-11
- **Status:** Fixed
- **Date fixed:** 2026-07-11
- **Fix:** Redesigned period creation so it can never hit the overlap-dialog crash path: `nextDefaultEntry()` (new, in `scheduleLogic.js`) auto-places a new period in the largest free gap of the day via `findFreeSlot()`, so the default can only conflict with existing periods if the entire 24h is already covered — in which case Add now shows a plain "No free time available" info dialog and creates no row at all, instead of a partially-wired draft. Also fixed `_addScheduleRow()` not returning the created row (the underlying cause of the crash: `const row = this._addScheduleRow(...); row.updateRevertVisibility();` threw `TypeError` on `undefined` because of the missing `return row;`, aborting before `_validateAndSave()` ran). Zero configured periods is explicitly documented as a valid, fully-supported state (backlight stays off).
- **Files:** `scheduleLogic.js` (`findFreeSlot`, `nextDefaultEntry`), `prefs.js` (`_showNoRoomDialog` replaces `_showAddOverlapDialog`, `_addScheduleRow` now returns the row), `tools/schedule-logic-test.js` (regression tests for free-slot placement and the fully-packed case)
- **Description:** The old default new-period time was hard-coded to 6 PM–11 PM. If that overlapped an existing period, an overlap dialog appeared; choosing "Edit times" ran a callback that called `.updateRevertVisibility()` on the return value of `_addScheduleRow()`, which was always `undefined` (missing `return` statement). The `TypeError` aborted the callback *after* the row had already been added to the widget tree and pushed into `_scheduleRows`, but *before* `_validateAndSave()` ran — producing a visible row that was never persisted to GSettings and behaved inconsistently (appeared like an un-deletable "ghost" entry on subsequent edits).
- **Repro (old behavior):** Create one period covering 6 PM–11 PM (or anything overlapping it). Click "+ Add Window". Click "Edit times" in the overlap dialog. A second draft row appears; check `journalctl` for `TypeError: undefined has no properties` — the row was added without going through the normal save flow.
- **Update (2026-07-11):** The free-slot auto-placement (`findFreeSlot()`/`_showNoRoomDialog`) was removed again — it fixed the crash, but silently placing the new period in whatever gap was largest (sometimes far from where the user clicked, e.g. an overnight wrap) was confusing. `nextDefaultEntry()` now always returns the same fixed 6 PM–11 PM default regardless of existing periods; if that happens to overlap something, the existing overlap banner flags it for the user to resolve by editing times, same as any manual edit. The crash fix itself (`_addScheduleRow()` returning the row) stays in place. `findFreeSlot()` and `_showNoRoomDialog()` were deleted as dead code.
- **Update 2 (2026-07-11):** Fixed default always being 6 PM–11 PM (see above) still collided constantly: adding a *second* period always overlapped a first period placed anywhere near evening. `nextDefaultEntry()` now takes the existing periods back and continues for one hour from wherever the *last* period in the list ends (first period ever still gets the fixed 6 PM–11 PM default, since there's nothing to continue from). Simple/predictable (no whole-day search), and avoids the near-guaranteed collision from a fully static default.

### "+ Add Period" mistaken for an OK/confirm button while editing an existing period
- **Author:** Cursor Agent
- **Date found:** 2026-07-11
- **Status:** Fixed
- **Date fixed:** 2026-07-11
- **Description:** Editing a period's Start/End/Brightness/Aura fields auto-saved to GSettings on every single keystroke, with no explicit confirmation step. The only affordance resembling "confirm/cancel" was a "Revert changes"/"Cancel new period" button that only appeared once a row was dirty — there was no visible "OK" counterpart. The global "+ Add Period" button sat directly below the row list, which made it easy to mistake for "the button that finishes what I was just editing," when it actually always creates a brand-new, separate period. Combined with the fixed 6 PM–11 PM default above, this reliably produced an unwanted second period that immediately overlapped the one the user had just finished typing.
- **Fix:** Replaced live-apply-on-every-keystroke with an explicit per-row staged edit model. Each `ScheduleRow` now has a Cancel/OK confirm bar (labelled Cancel/Add for a brand-new unconfirmed period, Revert/Save for an edit to an already-saved one) that is the *only* way to persist or discard that row's changes — typing in the time/brightness/aura fields only updates a live in-memory preview (conflict banner + this row's own button state), never GSettings, until OK/Save is clicked. The global button was renamed **"+ New Period"** to read distinctly from the per-row OK/Save button, and is disabled while any period is still an unconfirmed new draft, so at most one unresolved "new period" can exist at a time. Also fixed a related pre-existing bug where the invalid-JSON banner was immediately cleared by the first (empty-schedule) validation pass, and where a freshly-added draft row's Cancel bar never appeared until the user made a first edit.
- **Files:** `prefs.js` (`ScheduleRow` Cancel/OK bar + `isNewDraft()`/`getSavedEntry()`/`confirm()`; `KbdBacklightPreferences._updatePreview()`/`_persistConfirmed()`/`_onRowConfirmed()`/`_liveSchedules()`/`_confirmedSchedules()` replace the old single `_validateAndSave()`/`_collectSchedules()`)
- **Repro (old behavior):** Delete all periods. Click "+ Add Period" (old label), edit the new row down to 6–7 PM without clicking anything else. Click "+ Add Period" again out of habit — a second row appears defaulting to 6 PM–11 PM (or, before the earlier fix, some auto-placed range), which immediately overlaps the 6–7 PM period and shows the overlap banner with no clear way to tell which button was supposed to "confirm" the first edit.

## Low

### "Window" terminology confusing next to the actual GTK Preferences window
- **Author:** Cursor Agent
- **Date found:** 2026-07-11
- **Status:** Fixed
- **Date fixed:** 2026-07-11
- **Fix:** Renamed the schedule-entry concept from "window" to "period" everywhere it referred to a scheduled time span: UI strings ("+ Add Period", "Time Periods", "Remove this time period", "Cancel new period", "Overlapping time period", panel menu "Schedule Periods"), and identifiers (`fmtWindowRange`→`fmtPeriodRange`, `windowsOverlap`→`periodsOverlap`, `isWindowActive`→`isPeriodActive`, `findActiveWindow`→`findActivePeriod`). Left genuine GTK/GNOME desktop-window references untouched (`Adw.PreferencesWindow`, `fillPreferencesWindow`, `window.add()`, "Settings window won't open").
- **Files:** `prefs.js`, `extension.js`, `scheduleLogic.js`, `tools/schedule-logic-test.js`, `README.md`, `docs/asus-color-control-fedora.md`
- **Description:** The Schedule tab's "+ Add Window" button and related strings/identifiers used "window" to mean a scheduled time span, while the same file also has a real GTK `Adw.PreferencesWindow` (`fillPreferencesWindow`, `window.add()`). The overloaded term made it easy to misread "Add Window" as opening a new dialog rather than adding a time period.
- **Repro:** N/A — naming/clarity issue, not a functional bug.

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

### Overlap validation had no Fix/Cancel flow (banner-only UX)
- **Author:** Cursor Agent
- **Date found:** 2026-07-11
- **Status:** Fixed
- **Date fixed:** 2026-07-11
- **Fix:** Add flow gated with `Adw.AlertDialog` (Edit times / Cancel); edit flow uses banner plus per-row Revert and conflict highlighting; rows track last-saved state.
- **File:** `prefs.js` — Schedule page, `ScheduleRow`, `_validateAndSave()`
- **Description:** Overlap detection only showed a passive banner and still added draft rows on “Add Window”, with no way to cancel an invalid new window or revert edited times. UI state could diverge from saved GSettings until the user manually fixed or reopened Settings.
- **Repro:** Add a window whose default times overlap an existing one, or edit a row to overlap another — banner appears but no explicit Cancel/Revert; unsaved draft row remains in the list.

### Duplicate `createAuraWidgets` call causes SyntaxError on Settings open
- **Author:** Cursor Agent
- **Date found:** 2026-07-11
- **Status:** Fixed
- **Date fixed:** 2026-07-11
- **Fix:** Removed duplicate `const {auraModeRow, colorRow}` destructuring in `ScheduleRow`; kept single call with `syncToWidgets`.
- **File:** `prefs.js` — `ScheduleRow._init()`
- **Description:** Two consecutive `createAuraWidgets()` calls declared `auraModeRow` and `colorRow` twice in the same block, causing `SyntaxError: redeclaration of const auraModeRow` and preventing Settings from opening.
- **Repro:** Open extension Settings after v0.3.2 overlap UX changes.

---

## GJS guide / EGO follow-ups (2026-07-15)

Cross-check against https://gjs.guide/extensions/ and the review guidelines. Severity here maps guide priority (Must / Should / Nice) onto the project tiers.

### Aura spawned on every 60s timer tick (no coalesce)
- **Author:** Cursor Agent
- **Date found:** 2026-07-15
- **Status:** Fixed
- **Date fixed:** 2026-07-15
- **Priority:** Must (quality) / Midhigh
- **Fix:** `_auraApply()` tracks `_lastAuraKey` (mode + colour + CLI style) and skips spawning when unchanged; clears the key on failure so retry is possible.
- **File:** `extension.js` — `_auraApply()`
- **Description:** With Aura available, `_applyNow()` always called `_auraApply()`, so the 60s timer re-ran `asusctl` even when effect/colour were unchanged. Guide: external processes must be spawned carefully.
- **Repro:** Enable Always On + Aura; watch processes / journal for repeated identical `asusctl` invocations each minute.

### Sync `communicate_utf8` on Shell main loop (Aura error path)
- **Author:** Cursor Agent
- **Date found:** 2026-07-15
- **Status:** Fixed
- **Date fixed:** 2026-07-15
- **Priority:** Should (EGO-ish) / Midhigh
- **Fix:** `_auraApply()` uses `communicate_utf8_async` / `communicate_utf8_finish` and reads stderr without blocking `wait` + sync communicate.
- **File:** `extension.js` — `_auraApply()`
- **Description:** After `wait_async`, the error path called `communicate_utf8(null, null)`, blocking the compositor. Same class of issue as prior EGO file-read feedback.
- **Repro:** Force an `asusctl` failure; observe sync communicate on the Shell process.

### Sync D-Bus `ListNames` on every `_applyNow` for Aura daemon
- **Author:** Cursor Agent
- **Date found:** 2026-07-15
- **Status:** Fixed
- **Date fixed:** 2026-07-15
- **Priority:** Should / Midhigh
- **Fix:** `detectAuraDaemon()` uses `NameHasOwner` for `org.asuslinux.Daemon` instead of listing every bus name.
- **File:** `hwDetect.js` — `detectAuraDaemon()`
- **Description:** `_syncAura()` ran on each timer tick and called system `ListNames`, which is heavyweight for a periodic check.
- **Repro:** dbus-monitor / profiling during Scheduled mode with Aura optional path enabled.

### README claimed test override auto-restores at next tick
- **Author:** Cursor Agent
- **Date found:** 2026-07-15
- **Status:** Fixed
- **Date fixed:** 2026-07-15
- **Priority:** Should / Medium
- **Fix:** README panel mockup and bullet now match code: override lasts until **Resume Schedule Now** or a mode switch (menu string was already correct).
- **File:** `README.md`
- **Description:** Docs said the scheduler restores brightness on the next tick, but `_testOverride` makes the timer skip `_applyNow()` until Resume/mode change.
- **Repro:** Compare README “auto-restores” wording with panel test-override behaviour.

### Panel menu async `_refresh` can resume after destroy
- **Author:** Cursor Agent
- **Date found:** 2026-07-15
- **Status:** Fixed
- **Date fixed:** 2026-07-15
- **Priority:** Should / Medium
- **Fix:** `KbdIndicator` sets `_destroyed` in `destroy()`; `_refresh()` returns early before and after `await describeHardware()` if destroyed or extension disabled.
- **File:** `extension.js` — `KbdIndicator`
- **Description:** Opening the menu awaited hardware description; if the extension was disabled mid-await, the continuation could touch destroyed widgets.
- **Repro:** Open panel menu then quickly disable the extension before HW describe completes.

### Custom panel buttons lacked accessible state / used hard-coded colours
- **Author:** Cursor Agent
- **Date found:** 2026-07-15
- **Status:** Fixed
- **Date fixed:** 2026-07-15
- **Priority:** Should (a11y) / Medium
- **Fix:** Test/mode `St.Button`s use `toggle_mode`, `checked`, `can_focus`, and `accessible_name`; active/warn labels use stylesheet classes instead of inline RGBA; added `stylesheet.css` to install/pack.
- **Files:** `extension.js`, `stylesheet.css`, `scripts/install.sh`, `tools/ci-verify.sh`
- **Description:** Guide accessibility guidance prefers proper widget state (e.g. checked) over painting selection with inline colours only.
- **Repro:** Inspect panel test/mode buttons with an accessibility tree / high-contrast theme.

### Sync GSD `call_sync` on enable and brightness writes
- **Author:** Cursor Agent
- **Date found:** 2026-07-15
- **Status:** Open
- **Priority:** Should (polish) / Midlow
- **File:** `extension.js` — `gsdGet()`, `gsdSetBrightness()`
- **Description:** Keyboard Steps/Brightness still use synchronous session D-Bus calls. Acceptable when rare (enable + level changes); `_writeBrightness()` already skips unchanged levels. Full async GSD would further reduce freeze risk if GSD hangs.
- **Repro:** N/A — known pattern; only problematic if GSD stops responding.

### No gettext / translations
- **Author:** Cursor Agent
- **Date found:** 2026-07-15
- **Status:** Open
- **Priority:** Should (audience) / Low for EGO · Medium for i18n
- **Files:** `metadata.json`, `extension.js`, `prefs.js`
- **Description:** Guide Translations page: add `gettext-domain`, wrap UI strings with `_()` / `ngettext`, ship `po/` and pack with `--podir`. Not required for EGO approval; all UI is English-only today.
- **Repro:** N/A — feature gap.

### metadata.json ships integer `"version"` (EGO-owned field)
- **Author:** Cursor Agent
- **Date found:** 2026-07-15
- **Status:** Deferred
- **Priority:** Nice / Low
- **File:** `metadata.json`
- **Description:** Anatomy docs say developers should not set `version` (EGO overrides it). We keep it for local install/CI/`gnome-extensions info` sync with `version-name`.
- **Repro:** N/A — intentional project convention.

### Prefer versioned GTK imports in prefs (done) / optional stylesheet (done)
- **Author:** Cursor Agent
- **Date found:** 2026-07-15
- **Status:** Fixed
- **Date fixed:** 2026-07-15
- **Priority:** Nice
- **Fix:** `prefs.js` imports `Gtk`/`Gdk`/`Adw`/`GObject` with explicit versions; `stylesheet.css` added for panel emphasis.
- **Files:** `prefs.js`, `stylesheet.css`

### Schedule logic duplicated between shell and prefs modules
- **Author:** Cursor Agent
- **Date found:** 2026-07-15
- **Status:** Open
- **Priority:** Nice / Low
- **Files:** `extension.js`, `scheduleLogic.js`
- **Description:** Period active/next-change helpers live in `extension.js` while prefs tests use `scheduleLogic.js`. Could import shared helpers in the Shell module (already packed).
- **Repro:** N/A — maintainability.

### Schedules stored as JSON string instead of structured GVariant
- **Author:** Cursor Agent
- **Date found:** 2026-07-15
- **Status:** Open
- **Priority:** Nice / Low
- **File:** `schemas/…gschema.xml` key `schedules`
- **Description:** Guide tip for complex settings prefers richer GVariant types; JSON-in-string works but is harder to validate/migrate.
- **Repro:** N/A — design choice.
