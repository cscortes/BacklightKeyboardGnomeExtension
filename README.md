# Keyboard Backlight Scheduler

A GNOME Shell extension that automatically controls keyboard backlight brightness on a time-of-day schedule.

Tested on Fedora 44 with an ASUS laptop, GNOME Shell 50.2. Compatible with GNOME 45–50.
Version: **0.6.0** · License: **GPL-2.0-or-later**

> Contributing or modifying the code? See **[DevReadme.md](DevReadme.md)** instead.

Installable extension sources live under **`extension/`** (what GNOME Shell loads). Repo
tooling is in `scripts/`, `tools/`, and `tests/` — see DevReadme for the full layout.

---

## Features

- **Three modes** — Always On, Always Off, or Scheduled
- **Panel indicator** — keyboard icon in the top bar that dims when backlight is off
- **Multiple time periods** — add as many slots as you need, each with its own brightness level
- **Midnight-crossing periods** — e.g. `10:00 PM → 6:00 AM` (end < start wraps automatically)
- **Non-overlapping periods** — Settings warns and blocks overlapping time periods
- **Auto-applies** — checks every 60 seconds and immediately on any settings change
- **No root, no udev, no SELinux workarounds** — uses the same GSD D-Bus interface as GNOME's own brightness slider
- **ASUS ROG / Aura** — on modern ASUS RGB keyboards the keys stay dark until [asusctl + asusd](docs/asus-color-control-fedora.md) are installed (required for visible lighting and optional color/effects)
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
Test Override  (click ↺ Resume to restore schedule)
  [Off]  [●○○○]  [●●○○]  [●●●○]  [●●●●]
  ↺  Resume Schedule Now
──────────────────────────────────────────
[Always On]  [Scheduled]  [Always Off]
──────────────────────────────────────────
Open Settings…
```

- **Schedule Periods** — shows all configured periods; the active one is highlighted in yellow with `▶`
- **Next change** — counts down to the next brightness transition (Scheduled mode only)
- **Test Override** — sets hardware brightness immediately to a fixed preset (Off ≈ 0%, then ~25% / 50% / 75% / 100%) without touching the mode or schedule; GSD may snap to fewer hardware steps. Stays in effect until you click **↺ Resume Schedule Now** (or switch mode)
- **Mode row** — switch modes without opening Settings

---

## Settings

### General tab

| Section | What it does |
|---|---|
| **Control Mode** | Always On / Scheduled / Always Off |
| **Always On** | Brightness slider; Aura effect + colour when asusctl / asusd are installed |

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
- **ASUS ROG / TUF / Aura RGB keyboards (required):** install `asusctl` and start `asusd`
  before expecting the keyboard to light up. GNOME and this extension can write brightness
  successfully while the keys stay dark until Aura is running — see
  [ASUS setup below](#asus-rog--aura-required-for-visible-lighting).

### Install

```bash
cd ~/Code/GnomeExtension
make dev-setup    # installs dnf + npm deps and runs validation
make install      # or: make validate && ./scripts/install.sh
```

`make dev-setup` installs `glib2-devel`, `nodejs`, `npm`, and `gjs` via `dnf`, then runs `npm install`. Requires `sudo` for system packages.

The installer compiles the GSettings schema and copies files from `extension/` to
`~/.local/share/gnome-shell/extensions/kbd-backlight-scheduler@cscortes.github.io/`
(extension UUID is defined in `extension/metadata.json`; install scripts read it from there).
No sudo required.

### Uninstall

```bash
make uninstall    # or: ./scripts/uninstall.sh
```

Disables the extension (if loaded) and deletes its folder under
`~/.local/share/gnome-shell/extensions/`. Does not remove `asusctl` / `asusd` or wipe
saved GSettings. Reload the Shell afterward so a stale panel icon disappears.

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

### ASUS ROG / Aura (required for visible lighting)

On modern ASUS RGB keyboards (ROG, many TUF / Zenbook Aura boards), **this is the only
way the keyboard will actually light up.** GSD and `/sys/class/leds/asus::kbd_backlight`
can report full brightness while the keys stay dark until `asusd` is running.

`asusctl` is **not** in Fedora’s default repos — add the **Terra** repository first:

```bash
# 1. Add Terra (ASUS Linux packages)
sudo dnf install --nogpgcheck \
  --repofrompath 'terra,https://repos.fyralabs.com/terra$releasever' \
  terra-release

# 2. Install asusctl
sudo dnf install asusctl

# 3. Enable and start the daemon
sudo systemctl enable --now asusd.service

# 4. Smoke-test lighting
asusctl -k high
# or set a solid white Aura effect:
asusctl aura effect static -c ffffff
```

Verify the daemon:

```bash
systemctl status asusd.service
```

After that, this extension’s schedule / Test Override and GNOME’s keyboard brightness
controls can change visible levels. With asusctl present, Settings also unlocks per-period
**Aura Effect** and colour (Static, Breathe, Strobe, Rainbow).

Longer guide (COPR migration, troubleshooting, CLI versions):
**[docs/asus-color-control-fedora.md](docs/asus-color-control-fedora.md)**

Official reference: [ASUS Linux Fedora guide](https://asus-linux.org/guides/fedora-guide/)

---

## Example schedule

| Period | Start | End | Brightness |
|---|---|---|---|
| Evening | 6:00 PM | 11:45 PM | 3 (full) |
| Early morning | 12:05 AM | 9:00 AM | 1 (dim) |

The gap 11:45 PM – 12:05 AM has no active period — backlight turns off automatically.

---

## Troubleshooting

**ASUS keyboard stays dark (even though brightness looks “on”)**

Classic on ROG RGB machines: GSD/`asus::kbd_backlight` accept writes, but nothing lights
until `asusctl` + `asusd` are installed. Follow
[ASUS ROG / Aura](#asus-rog--aura-required-for-visible-lighting) above, then:

```bash
systemctl is-active asusd.service   # should print: active
asusctl -k high
```

**Backlight doesn't change**
```bash
# Confirm GSD responds directly
gdbus call --session \
  --dest org.gnome.SettingsDaemon.Power \
  --object-path /org/gnome/SettingsDaemon/Power \
  --method org.freedesktop.DBus.Properties.Set \
  "org.gnome.SettingsDaemon.Power.Keyboard" "Brightness" "<int32 100>"

# On ASUS: if this returns () but keys stay dark, install asusctl (section above)

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

Install Terra + `asusctl`, enable `asusd`, then reload the Shell / reopen Settings.
See **[docs/asus-color-control-fedora.md](docs/asus-color-control-fedora.md)**.

---

AI tools helped develop this extension. Initial construction was done with Claude; finishing
work used Cursor. On this project Claude was technically stronger, but harder to
install and use in VS Code vs Cursor (although it feels a little clumsy too).
