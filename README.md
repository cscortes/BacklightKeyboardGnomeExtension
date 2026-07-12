# Keyboard Backlight Scheduler

A GNOME Shell extension that automatically controls keyboard backlight brightness on a time-of-day schedule.

Tested on Fedora 44 with an ASUS laptop, GNOME Shell 50.2. Compatible with GNOME 45–50.
Version: **0.5.0** · License: **GPL-2.0-or-later**

> Contributing or modifying the code? See **[DevReadme.md](DevReadme.md)** instead.

---

## Features

- **Three modes** — Always On, Always Off, or Scheduled
- **Panel indicator** — keyboard icon in the top bar that dims when backlight is off
- **Multiple time periods** — add as many slots as you need, each with its own brightness level
- **Midnight-crossing periods** — e.g. `10:00 PM → 6:00 AM` (end < start wraps automatically)
- **Non-overlapping periods** — Settings warns and blocks overlapping time periods
- **Auto-applies** — checks every 60 seconds and immediately on any settings change
- **No root, no udev, no SELinux workarounds** — uses the same GSD D-Bus interface as GNOME's own brightness slider
- **Optional Aura RGB** — per-period color and effects when [asusctl is installed](docs/asus-color-control-fedora.md) (Fedora guide)
- **About tab** — version, keyboard backlight backend, and hardware detection in Settings

---

## Panel menu

```
Keyboard Backlight  |  Scheduled  |  ●●●○
Next change in 47 min: Off
──────────────────────────────────────────
Schedule Periods
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

- **Schedule Periods** — shows all configured periods; the active one is highlighted in yellow with `▶`
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

Each time period appears as a collapsible row:

```
6:00 PM  →  11:45 PM    Brightness 3 / 3
```

Expand a row to edit **Start time**, **End time**, **Brightness level**, or **Remove** the
period. Editing stages the change locally — nothing is written until you click **OK** (or
**Save** on an existing period); click **Cancel** (or **Revert**) to discard it instead.
This is the only way to confirm or discard changes to that specific period.

Use **+ New Period** at the bottom to create a new entry. It defaults to 6 PM–11 PM for
your first period, or to one hour right after your last period ends for every one after
that — deliberately simple and predictable rather than searching the whole day for free
time. The button is disabled while an unconfirmed new period is still pending, so you
always resolve (OK or Cancel) one before starting another. An empty schedule (no periods
at all) is a fully valid setup — the backlight just stays off.

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
make dev-setup    # installs dnf + npm deps and runs validation
make install      # or: make validate && ./install.sh
```

`make dev-setup` installs `glib2-devel`, `nodejs`, `npm`, and `gjs` via `dnf`, then runs `npm install`. Requires `sudo` for system packages.

The installer compiles the GSettings schema and copies all files to
`~/.local/share/gnome-shell/extensions/kbd-backlight-scheduler@cscortes.github.io/`
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
gnome-extensions enable kbd-backlight-scheduler@cscortes.github.io
```

Or use **Extensions** / **Extension Manager** from the app grid.

### Optional: ASUS RGB color control (asusctl)

White backlight **brightness scheduling works without asusctl**. To enable per-period
**RGB colors and effects** (Static, Breathe, Strobe, Rainbow) in the Schedule settings,
install asusctl on Fedora:

**[→ ASUS Color Control on Fedora](docs/asus-color-control-fedora.md)**

---

## Example schedule

| Period | Start | End | Brightness |
|---|---|---|---|
| Evening | 6:00 PM | 11:45 PM | 3 (full) |
| Early morning | 12:05 AM | 9:00 AM | 1 (dim) |

The gap 11:45 PM – 12:05 AM has no active period — backlight turns off automatically.

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
  ~/.local/share/gnome-shell/extensions/kbd-backlight-scheduler@cscortes.github.io/schemas/
```

**Extension doesn't load**
```bash
gnome-shell --version
gnome-extensions info kbd-backlight-scheduler@cscortes.github.io
```

**Aura RGB not detected / no color options in Settings**

See **[docs/asus-color-control-fedora.md](docs/asus-color-control-fedora.md)** for Fedora
asusctl installation. Brightness scheduling does not require Aura.
