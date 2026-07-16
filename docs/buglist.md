# Bug List — Keyboard Backlight Scheduler

Severity: **High** → **Midhigh** → **Medium** → **Midlow** → **Low**

Status: `Open` · `Fixed` · `Won't fix` · `Deferred`

| # | Severity | Status | Issue | Found | Fixed | Files | Notes |
|---|---|---|---|---|---|---|---|
| 1 | High | Fixed | Division by zero when GSD reports Steps = 1 | 2026-07-01 | 2026-07-01 | `extension.js` | `levelToPct()` / `pctToLevel()` handle `maxBrightness <= 0` |
| 2 | Midhigh | Fixed | Preferences UI uses stale max-brightness instead of live GSD Steps | 2026-07-01 | 2026-07-01 | `extension.js`, `prefs.js` | Write GSD-derived `max-brightness` on every enable |
| 3 | Midhigh | Fixed | Schedule brightness cannot be set to level 0 (Off) | 2026-07-01 | 2026-07-01 | `prefs.js` | Spin range `0‥max`; title shows Off |
| 4 | Midhigh | Fixed | "Add Window" crashed / unpersisted ghost draft on overlap | 2026-07-11 | 2026-07-11 | `scheduleLogic.js`, `prefs.js`, tests | `_addScheduleRow()` returns row; `nextDefaultEntry()` continues from last end |
| 5 | Midhigh | Fixed | "+ Add Period" mistaken for OK while editing | 2026-07-11 | 2026-07-11 | `prefs.js` | Staged Cancel/OK per row; "+ New Period" disabled during draft |
| 6 | Midhigh | Fixed | Aura spawned on every 60s timer tick (no coalesce) | 2026-07-15 | 2026-07-15 | `extension.js` | `_lastAuraKey` skips identical `asusctl` runs |
| 7 | Midhigh | Fixed | Sync `communicate_utf8` on Shell main loop (Aura errors) | 2026-07-15 | 2026-07-15 | `extension.js` | `communicate_utf8_async` |
| 8 | Midhigh | Fixed | Sync D-Bus `ListNames` on every `_applyNow` for Aura | 2026-07-15 | 2026-07-15 | `hwDetect.js` | `NameHasOwner` for `org.asuslinux.Daemon` |
| 9 | Medium | Fixed | Remove time window does not always persist | 2026-07-11 | 2026-07-11 | `prefs.js`, `scheduleLogic.js`, tests | `planScheduleSave({alwaysSave})` on delete |
| 10 | Medium | Fixed | Aura detection only runs once at extension enable | 2026-07-01 | 2026-07-01 | `extension.js` | `_syncAura()` on each `_applyNow()` |
| 11 | Medium | Fixed | Unconditional D-Bus writes every 60 seconds | 2026-07-01 | 2026-07-01 | `extension.js` | Skip `_writeBrightness` when level unchanged |
| 12 | Medium | Fixed | Test override has no explicit override flag | 2026-07-01 | 2026-07-01 | `extension.js` | `_testOverride`; Resume / mode clears it |
| 13 | Medium | Fixed | README claimed test override auto-restores at next tick | 2026-07-15 | 2026-07-15 | `README.md` | Docs match: lasts until Resume or mode switch |
| 14 | Medium | Fixed | Panel menu async `_refresh` can resume after destroy | 2026-07-15 | 2026-07-15 | `extension.js` | `_destroyed` guard around `await` |
| 15 | Medium | Fixed | Custom panel buttons lacked accessible state / hard-coded colours | 2026-07-15 | 2026-07-15 | `extension.js`, `stylesheet.css`, install/CI | `toggle_mode` / `checked` / `accessible_name` + CSS |
| 16 | Midlow | Fixed | asusctl CLI flags may not match installed version | 2026-07-01 | 2026-07-01 | `hwDetect.js`, `extension.js` | Probe `--colour` vs `--color` (async idle) |
| 17 | Midlow | Fixed | asusctl subprocess errors not surfaced to user | 2026-07-01 | 2026-07-01 | `extension.js` | `_auraError` + panel `⚠ Aura` |
| 18 | Midlow | Fixed | GSD percentage rounding may not align with discrete steps | 2026-07-01 | 2026-07-01 | `extension.js` | Nearest-step `pctToLevel()` |
| 19 | Midlow | Open | Sync GSD `call_sync` on enable and brightness writes | 2026-07-15 | — | `extension.js` | Rare path; skip-unchanged already; async GSD optional polish |
| 20 | Low | Fixed | "Window" terminology confusing vs GTK Preferences window | 2026-07-11 | 2026-07-11 | prefs/extension/scheduleLogic/docs | Renamed schedule concept to "period" |
| 21 | Low | Fixed | Malformed schedules JSON fails silently | 2026-07-01 | 2026-07-01 | `extension.js`, `prefs.js` | Error banner / panel warning |
| 22 | Low | Fixed | Aura color row visibility not updated when toggling modes | 2026-07-01 | 2026-07-01 | `prefs.js` | `_syncColorRowVisibility()` |
| 23 | Low | Fixed | ASUS WMI backlight conflated with Aura RGB detection | 2026-07-01 | 2026-07-01 | `hwDetect.js`, extension, prefs | Split sysfs WMI vs asusctl/Aura |
| 24 | Low | Fixed | AdwBanner wrong property (`reveal` vs `revealed`) | 2026-07-11 | 2026-07-11 | `prefs.js` | Use `revealed` |
| 25 | Low | Fixed | AdwBanner via `PreferencesPage.add()` instead of `set_banner()` | 2026-07-11 | 2026-07-11 | `prefs.js` | Single page banner |
| 26 | Low | Fixed | Overlap validation had no Fix/Cancel flow | 2026-07-11 | 2026-07-11 | `prefs.js` | Staged edit + conflict banner / row highlight |
| 27 | Low | Fixed | Duplicate `createAuraWidgets` → SyntaxError on Settings open | 2026-07-11 | 2026-07-11 | `prefs.js` | Single destructuring call |
| 28 | Low | Fixed | Prefer versioned GTK imports / optional stylesheet | 2026-07-15 | 2026-07-15 | `prefs.js`, `stylesheet.css` | Explicit `gi://…?version=` + panel CSS |
| 29 | Low | Open | No gettext / translations | 2026-07-15 | — | metadata, extension, prefs | Optional for EGO; English-only UI today |
| 30 | Low | Deferred | metadata.json ships integer `"version"` (EGO-owned) | 2026-07-15 | — | `metadata.json` | Kept for local/CI; EGO overwrites on upload |
| 31 | Low | Open | Schedule logic duplicated between shell and prefs | 2026-07-15 | — | `extension.js`, `scheduleLogic.js` | Could share helpers in Shell module |
| 32 | Low | Open | Schedules stored as JSON string vs structured GVariant | 2026-07-15 | — | gschema `schedules` | Works; richer type is future polish |

### Open / deferred only

| # | Severity | Status | Issue | Notes |
|---|---|---|---|---|
| 19 | Midlow | Open | Sync GSD `call_sync` | Async GSD if reviewers push or GSD hangs |
| 29 | Low | Open | No gettext / translations | Add `gettext-domain`, `_()`, `po/`, `--podir` |
| 30 | Low | Deferred | Integer `"version"` in metadata | Intentional for CI; EGO assigns on upload |
| 31 | Low | Open | Duplicated schedule helpers | Import `scheduleLogic.js` from Shell |
| 32 | Low | Open | JSON schedules key | Optional migrate to structured GVariant |

Items **6–8**, **13–15**, and **19–32** (open ones) come from the 2026-07-15 cross-check against [gjs.guide/extensions](https://gjs.guide/extensions/) and the review guidelines.
