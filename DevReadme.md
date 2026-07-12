# Developer Notes — Keyboard Backlight Scheduler

Everything here is for people modifying, testing, or releasing this extension.
For install/usage instructions, see **[README.md](README.md)**.

---

## Setup

```bash
cd ~/Code/GnomeExtension
make dev-setup
```

Installs `glib2-devel`, `nodejs`, `npm`, `gjs`, and `mutter-devkit` via `dnf`, then runs
`npm install` (ESLint). Requires `sudo` for system packages.

## Validate before installing

```bash
npm install          # first time only — installs eslint
./validate-js.sh     # ESLint + syntax check + schedule logic tests + prefs smoke test
```

`validate-js.sh` runs before every install (`install.sh` calls it as step 1):

| Step | Tool | Catches |
|---|---|---|
| ESLint | Node.js | Duplicate `const`, unreachable code, common logic errors |
| gjs syntax | `gjs -c` | SyntaxErrors without loading GTK |
| schedule logic tests | `gjs` | Regressions in overlap detection / save planning (`scheduleLogic.js`) |
| prefs smoke | `gjs` + real Gtk/Adw | Wrong widget properties, invalid parenting, `fillPreferencesWindow` crashes |

The prefs smoke test builds Settings in a headless window — the same code path that failed
with `reveal` vs `revealed` and `set_banner()` — **without reloading GNOME Shell**.

It does **not** replace a quick open of the panel menu after install for `extension.js`
behaviour (the smoke test only exercises `prefs.js`).

## Development loop

There are two deploy paths:

- **`make install`** (or `./install.sh`) — the regular path. Validates, compiles the
  schema, and copies files into
  `~/.local/share/gnome-shell/extensions/kbd-backlight-scheduler@cscortes.gnome/`. GNOME
  Shell only picks up the change on its next restart (log out/in on Wayland, `Alt+F2 → r`
  on X11) — use this before a real restart, e.g. final checks before a release.
- **`make dev`** (or `npm run dev`) — the fast dev loop. GNOME Shell only discovers
  new/changed extension code when its own process starts (directory scan + GJS module
  cache are both process-lifetime), so `make dev` launches a disposable **nested devkit
  Shell** in its own window via `dbus-run-session -- gnome-shell --devkit --wayland`. It
  shares your `$HOME`, so it picks up the extension and your real GSettings/schedule, but
  runs in a private D-Bus session that can't affect your real desktop. On every save, it
  kills and relaunches the nested Shell (~1–2s) so the new code is always fresh — no
  logout required. Requires the `mutter-devkit` package
  (`sudo dnf install -y mutter-devkit`, included in `make dev-setup`).

Note: the nested Shell doesn't run a full `gnome-settings-daemon`, so actual hardware
brightness D-Bus calls won't succeed inside it — it's for testing the Settings UI,
scheduling logic, and panel indicator, not final hardware verification. Use `make install`
+ a real restart for that.

### Manual reload of an already-installed build

```bash
gnome-extensions disable kbd-backlight-scheduler@cscortes.gnome
gnome-extensions enable kbd-backlight-scheduler@cscortes.gnome
```

This picks up `prefs.js` changes (Settings windows are spawned fresh each time), but **not**
`extension.js` changes — the running Shell process keeps its old cached module for that.
Use `make dev` or a real restart for `extension.js` changes.

`install.sh` validates the on-disk files and warns if GNOME Shell is still running an
older integer build (common on Wayland until you log out/in).

**Where to check the running version**

| Location | Shows |
|---|---|
| Settings → About | `semantic-version` (e.g. `v0.3.2`) |
| Panel menu footer | `semantic-version` |
| `gnome-extensions info …` | integer `version` (e.g. `8`) |
| `install.sh` output | both, after validation |

## Packaging for `gnome-extensions install` / extensions.gnome.org

`install.sh` (used by `make install` / `make dev`) copies files straight into
`~/.local/share/gnome-shell/extensions/…` for local dev/personal use — it's not a
distributable package.

To build an actual `.shell-extension.zip` bundle — the format `gnome-extensions install`
expects, and what you'd upload to extensions.gnome.org — use:

```bash
make pack
```

This runs `make validate` first, then wraps the official `gnome-extensions pack` tool:

```bash
gnome-extensions pack . \
    --extra-source=hwDetect.js \
    --extra-source=scheduleLogic.js \
    -o dist -f
```

`extension.js`, `metadata.json`, and `prefs.js` are bundled automatically by `gnome-extensions
pack`; the `schemas/` folder is auto-detected too. `hwDetect.js` and `scheduleLogic.js` are
extra local imports that must be listed explicitly with `--extra-source`, or the bundle will
be missing files GNOME Shell tries to `import` at runtime — if a new top-level `.js` file is
ever added to the extension, add it here too. The output lands in `dist/` (gitignored).

Install the built bundle for a quick local test of the real packaging path:

```bash
gnome-extensions install --force dist/kbd-backlight-scheduler@cscortes.gnome.shell-extension.zip
```

Note that `gnome-extensions pack` does **not** embed a compiled `gschemas.compiled` in the
zip — it only bundles the raw `.gschema.xml`. `gnome-extensions install` (and, on
extensions.gnome.org, GNOME Shell's own extension downloader) compiles the schema locally
at install time, the same way `install.sh` does. There's no supported way to pre-compile the
schema at pack/dev time and skip that step on the target machine — `Gio.SettingsSchemaSource`
can only read the compiled binary format, so it has to exist wherever the extension actually
runs.

## Versioning

`metadata.json` defines **two** version fields. They are related but not interchangeable.

| Field | Example | Purpose |
|---|---|---|
| `"version"` | `9` | **GNOME integer version** — required by GNOME Shell, Extension Manager, and `extensions.gnome.org`. Must increase on every installable build (1, 2, 3 …). |
| `"semantic-version"` | `"0.3.3"` | **Human-readable semver** — shown in the panel menu, Settings → About, `install.sh` output, and README.md. |

GNOME only understands the integer. The semver string is a project convention for readable release labels.

**Bump rules**

| Change type | `semantic-version` | `"version"` |
|---|---|---|
| Bug fix | patch — e.g. `0.3.1` → `0.3.2` | increment by 1 |
| New feature | minor — e.g. `0.3.1` → `0.4.0` | increment by 1 |
| Every installable build | (as above) | **always** increment by 1 |

**What to update when releasing**

1. **`metadata.json`** — both `"version"` and `"semantic-version"` (source of truth)
2. **`README.md`** — `Version:` line near the top (keep in sync for readers who don't open metadata)
3. **`buglist.md`** — optional; note fix/feature version in entries when helpful

Everything else reads from `metadata.json` at runtime or install time (`extension.js`, `prefs.js`, `install.sh`).

## Hardware test scripts

Run the hardware detection script to see what your machine exposes (sysfs, GSD, Aura):

```bash
python3 test-detect-hardware.py
```

Run the interactive brightness test to cycle through every brightness level and confirm each one physically changes the hardware:

```bash
python3 test-backlight.py
```

At each level it waits 1 second then asks `Did the backlight change? [y/n/s=skip]`.
Your original brightness is restored automatically when the test finishes.

You can also test a single level directly:

```bash
# Full brightness
gdbus call --session \
  --dest org.gnome.SettingsDaemon.Power \
  --object-path /org/gnome/SettingsDaemon/Power \
  --method org.freedesktop.DBus.Properties.Set \
  "org.gnome.SettingsDaemon.Power.Keyboard" "Brightness" "<int32 100>"

# Off
gdbus call --session \
  --dest org.gnome.SettingsDaemon.Power \
  --object-path /org/gnome/SettingsDaemon/Power \
  --method org.freedesktop.DBus.Properties.Set \
  "org.gnome.SettingsDaemon.Power.Keyboard" "Brightness" "<int32 0>"
```

## How it works

### Scheduling engine

Every 60 seconds (and on any settings change), the extension:

1. Reads the current time in minutes since midnight
2. Checks every schedule entry: `start ≤ now < end` (or wraps midnight when `end < start`)
3. Finds the single active entry for the current time (0 if none)
4. Sends that value to GSD via D-Bus

### Brightness backend

Brightness is controlled via `org.gnome.SettingsDaemon.Power.Keyboard` — the same D-Bus interface GNOME's own panel slider uses. GSD handles hardware access and SELinux context internally. No sysfs writes, no udev rules, no elevated privileges.

GSD exposes brightness as a percentage (0–100). The extension reads the number of discrete `Steps` from GSD at startup and converts:

```
percentage = round(level / (steps - 1) × 100)
```

### Period editing model (`prefs.js`)

Editing a period's fields is a **staged edit**, not live-apply: typing updates an
in-memory preview only (conflict banner, this row's own Cancel/OK button state).
Nothing is written to `GSettings` until the row's OK/Save is clicked. `ScheduleRow`
tracks two copies of an entry:

- `_entry` — current, possibly-unconfirmed UI state
- `_savedEntry` — last confirmed state (`null` if the row has never been confirmed, i.e.
  a fresh "+ New Period" draft not yet added)

`KbdBacklightPreferences._liveSchedules()` (all rows' `_entry`) drives the live conflict
preview; `_confirmedSchedules()` (only rows with a non-null `_savedEntry`) is what
actually gets written to `GSettings`. See `buglist.md` for the history of why this
model replaced a simpler auto-save-on-every-keystroke design.

## File structure

```
GnomeExtension/
├── Makefile             Dev targets: dev-setup, validate, install, reload, dev
├── metadata.json        UUID, integer version (GNOME), semantic-version (display)
├── extension.js         Panel indicator + scheduling engine
├── prefs.js             Settings UI (General, Schedule, and About tabs)
├── hwDetect.js          ASUS WMI / Aura hardware detection
├── scheduleLogic.js     Pure schedule logic: overlap checks, next-default-entry
├── package.json         npm scripts + ESLint dev dependency manifest (Node.js)
├── eslint.config.js     Lint rules for extension JS
├── validate-js.sh       Pre-install validation (ESLint + gjs smoke test)
├── install.sh           Schema compile + file install (no sudo needed)
├── tools/
│   ├── check-syntax.js       gjs parse-check helper
│   ├── prefs-smoke.js        Headless Settings UI smoke test
│   ├── schedule-logic-test.js  Unit tests for scheduleLogic.js
│   ├── dev-devkit.js         Nested devkit Shell dev loop (`make dev`)
│   └── stubs/                Test doubles for prefs smoke test
├── test-backlight.py    Interactive brightness hardware test
├── test-detect-hardware.py  Sysfs / GSD / Aura detection report
├── docs/
│   └── asus-color-control-fedora.md  Install asusctl for RGB on Fedora
└── schemas/
    └── org.gnome.shell.extensions.kbd-backlight-scheduler.gschema.xml
```

### GSettings keys

| Key | Type | Default | Description |
|---|---|---|---|
| `mode` | string | `scheduled` | `always-on`, `always-off`, or `scheduled` |
| `brightness` | int | `3` | Level for Always On mode |
| `always-on-aura-mode` | string | `Static` | Aura effect for Always On mode |
| `always-on-aura-color` | string | `#ffffff` | Aura colour for Always On mode |
| `schedules` | string | `[]` | JSON array of `{start_h, start_m, end_h, end_m, brightness}` |
| `max-brightness` | int | `3` | Fallback if GSD Steps cannot be read at startup |

## Known issues / history

See **[buglist.md](buglist.md)** for the full history of found/fixed bugs and design
iterations (e.g. why period defaults and the Cancel/OK edit model look the way they do).
