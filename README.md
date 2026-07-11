# Keyboard Backlight Scheduler

A GNOME Shell extension that automatically controls keyboard backlight brightness on a time-of-day schedule.

Tested on Fedora 44 with an ASUS laptop, GNOME Shell 50.2. Compatible with GNOME 45–50.
Version: **0.3.1**

---

## Features

- **Three modes** — Always On, Always Off, or Scheduled
- **Panel indicator** — keyboard icon in the top bar that dims when backlight is off
- **Multiple time windows** — add as many slots as you need, each with its own brightness level
- **Midnight-crossing windows** — e.g. `10:00 PM → 6:00 AM` (end < start wraps automatically)
- **Non-overlapping windows** — Settings warns and blocks overlapping time periods
- **Auto-applies** — checks every 60 seconds and immediately on any settings change
- **No root, no udev, no SELinux workarounds** — uses the same GSD D-Bus interface as GNOME's own brightness slider
- **Optional Aura RGB** — per-window color and effects when [asusctl is installed](docs/asus-color-control-fedora.md) (Fedora guide)
- **About tab** — version, keyboard backlight backend, and hardware detection in Settings

---

## Panel menu

```
Keyboard Backlight  |  Scheduled  |  ●●●○
Next change in 47 min: Off
──────────────────────────────────────────
Schedule Windows
▶  6:00 PM – 11:45 PM    ●●●       ← active (highlighted)
   12:05 AM – 9:00 AM    ●
──────────────────────────────────────────
Test Override  (auto-restores at next schedule tick)
  [Off]  [●]  [●●]  [●●●]
  ↺  Resume Schedule Now
──────────────────────────────────────────
[Always On]  [Scheduled]  [Always Off]
──────────────────────────────────────────
Open Settings…
```

- **Schedule Windows** — shows all configured windows; the active one is highlighted in yellow with `▶`
- **Next change** — counts down to the next brightness transition (Scheduled mode only)
- **Test Override** — sets hardware brightness immediately without touching the mode or schedule; the scheduler restores the correct level at the next tick, or click **↺ Resume Schedule Now**
- **Mode row** — switch modes without opening Settings

---

## Settings

### General tab

| Section | What it does |
|---|---|
| **Control Mode** | Always On / Scheduled / Always Off |
| **Always On** | Brightness slider; Aura effect + colour when asusctl is installed |

### Schedule tab

Each time window appears as a collapsible row:

```
6:00 PM  →  11:45 PM    Brightness 3 / 3
```

Expand to edit **Start time**, **End time**, **Brightness level**, or **Remove** the window.
Use **+ Add Window** at the bottom to create a new entry.

### About tab

| Section | What it does |
|---|---|
| **Extension** | Version, keyboard backlight backend, ASUS WMI detection, Aura RGB status |

---

## Installation

### Prerequisites

- GNOME Shell 45–50
- `glib-compile-schemas` — install if missing:
  ```bash
  sudo dnf install glib2-devel
  ```

### Install

```bash
cd ~/Code/GnomeExtension
./install.sh
```

The installer compiles the GSettings schema and copies all files to
`~/.local/share/gnome-shell/extensions/kbd-backlight-scheduler@cscortes.gnome/`
(extension UUID is defined in `metadata.json`; install scripts read it from there).
No sudo required.

### Reload GNOME Shell

```bash
echo $XDG_SESSION_TYPE   # check x11 or wayland
```

- **X11** — `Alt + F2`, type `r`, press `Enter`
- **Wayland** — log out and back in

### Enable

```bash
gnome-extensions enable kbd-backlight-scheduler@cscortes.gnome
```

Or use **Extensions** / **Extension Manager** from the app grid.

### Versioning

`metadata.json` defines **two** version fields. They are related but not interchangeable.

| Field | Example | Purpose |
|---|---|---|
| `"version"` | `7` | **GNOME integer version** — required by GNOME Shell, Extension Manager, and `extensions.gnome.org`. Must increase on every installable build (1, 2, 3 …). |
| `"semantic-version"` | `"0.3.1"` | **Human-readable semver** — shown in the panel menu, Settings → About, `install.sh` output, and this README. |

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

**Install and confirm**

Increment versions in `metadata.json`, then install and reload:

```bash
# e.g. "semantic-version": "0.3.1", "version": 7
./install.sh
gnome-extensions disable kbd-backlight-scheduler@cscortes.gnome
gnome-extensions enable kbd-backlight-scheduler@cscortes.gnome
```

`install.sh` validates the on-disk files and warns if GNOME Shell is still running an older integer build (common on Wayland until you log out/in).

**Where to check the running version**

| Location | Shows |
|---|---|
| Settings → About | `semantic-version` (e.g. `v0.3.1`) |
| Panel menu footer | `semantic-version` |
| `gnome-extensions info …` | integer `version` (e.g. `7`) |
| `install.sh` output | both, after validation |

### Optional: ASUS RGB color control (asusctl)

White backlight **brightness scheduling works without asusctl**. To enable per-window
**RGB colors and effects** (Static, Breathe, Strobe, Rainbow) in the Schedule settings,
install asusctl on Fedora:

**[→ ASUS Color Control on Fedora](docs/asus-color-control-fedora.md)**

---

## Testing the backlight

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

---

## Example schedule

| Window | Start | End | Brightness |
|---|---|---|---|
| Evening | 6:00 PM | 11:45 PM | 3 (full) |
| Early morning | 12:05 AM | 9:00 AM | 1 (dim) |

The gap 11:45 PM – 12:05 AM has no active window — backlight turns off automatically.

---

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

---

## File structure

```
GnomeExtension/
├── metadata.json        UUID, integer version (GNOME), semantic-version (display)
├── extension.js         Panel indicator + scheduling engine
├── prefs.js             Settings UI (General, Schedule, and About tabs)
├── hwDetect.js          ASUS WMI / Aura hardware detection
├── install.sh           Schema compile + file install (no sudo needed)
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

---

## Troubleshooting

**Backlight doesn't change**
```bash
# Confirm GSD responds directly
gdbus call --session \
  --dest org.gnome.SettingsDaemon.Power \
  --object-path /org/gnome/SettingsDaemon/Power \
  --method org.freedesktop.DBus.Properties.Set \
  "org.gnome.SettingsDaemon.Power.Keyboard" "Brightness" "<int32 100>"

# Check extension logs
journalctl /usr/bin/gnome-shell -b --output=cat | grep KbdBacklight
```

**Settings window won't open**
```bash
glib-compile-schemas \
  ~/.local/share/gnome-shell/extensions/kbd-backlight-scheduler@cscortes.gnome/schemas/
```

**Extension doesn't load**
```bash
gnome-shell --version
gnome-extensions info kbd-backlight-scheduler@cscortes.gnome
```

**Aura RGB not detected / no color options in Settings**

See **[docs/asus-color-control-fedora.md](docs/asus-color-control-fedora.md)** for Fedora
asusctl installation. Brightness scheduling does not require Aura.
