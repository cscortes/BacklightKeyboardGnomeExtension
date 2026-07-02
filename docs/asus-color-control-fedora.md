# ASUS Color Control on Fedora

This guide explains how to install **Aura RGB keyboard color control** on Fedora using
[asusctl](https://github.com/opengamingcollective/asusctl) from the ASUS Linux project.

---

## Do you need this?

| Feature | Requires asusctl? | How this extension handles it |
|---------|-------------------|-------------------------------|
| White backlight brightness (off / dim / full) | **No** | GSD D-Bus — works out of the box on most ASUS laptops |
| Per-window **RGB color** (Static, Breathe, Strobe, Rainbow) | **Yes** | Schedule tab → Aura Effect + Color picker |

If you only want scheduled **brightness levels**, you do **not** need asusctl. Run
`python3 test-detect-hardware.py` to confirm GSD and `asus::kbd_backlight` are working.

Install asusctl when you want **colored** keyboard lighting tied to schedule windows.

---

## Prerequisites

- Fedora Workstation (tested on Fedora 44; should work on recent releases)
- ASUS ROG / TUF / Zenbook laptop with Aura-compatible keyboard
- Administrator (`sudo`) access
- Internet connection

---

## Step 1 — Add the Terra repository

ASUS Linux packages for Fedora are published on the **Terra** repository
(maintained by Fyra Labs / OGC). This is the current recommended source.

```bash
sudo dnf install --nogpgcheck \
  --repofrompath 'terra,https://repos.fyralabs.com/terra$releasever' \
  terra-release
```

### Migrating from the old COPR repo

If you previously used `lukenukem/asus-linux` from COPR, remove it first — that repo
is **no longer maintained**:

```bash
sudo dnf copr remove lukenukem/asus-linux
```

Then add Terra (command above) and reinstall the ASUS tools below.

Official reference: [ASUS Linux Fedora guide](https://asus-linux.org/guides/fedora-guide/)

---

## Step 2 — Install asusctl

```bash
sudo dnf install asusctl
```

Optional GUI for fan profiles, GPU switching, and RGB testing:

```bash
sudo dnf install asusctl-rog-gui
```

---

## Step 3 — Enable the daemon

```bash
sudo systemctl enable --now asusd.service
```

Verify it is running:

```bash
systemctl status asusd.service
```

You should also see the D-Bus service:

```bash
busctl --system list | grep asus
# expect: org.asuslinux.Daemon
```

---

## Step 4 — (Recommended) Use power-profiles-daemon

ASUS Linux recommends `power-profiles-daemon` over `tuned` to avoid conflicts:

```bash
sudo dnf swap tuned-ppd power-profiles-daemon --allowerasing
sudo systemctl enable --now power-profiles-daemon.service
```

---

## Step 5 — Verify Aura / keyboard RGB

### Check your asusctl version

```bash
asusctl info
```

Command syntax changed significantly in **asusctl 6.x**. If `asusctl aura --help` lists
subcommands like `effect`, `power`, and `power-tuf`, use the **v6** commands below.
Older versions use `-m` mode flags instead.

### asusctl 6.x (current Terra packages)

```bash
# Show available effects
asusctl aura effect --help

# Static white
asusctl aura effect static -c ffffff

# Breathe (two colours + speed)
asusctl aura effect breathe --colour ffffff --colour2 000000 --speed med

# Rainbow
asusctl aura effect rainbow-cycle --speed med

# Flash / strobe-like effect
asusctl aura effect flash -c ff0000
```

### Older asusctl (legacy `-m` syntax)

```bash
asusctl aura -m static --colour ffffff
asusctl aura -m breathe-single --colour ff0000
asusctl aura -m rainbow-cycle
```

### Use the project detection script

From this repository:

```bash
cd ~/Code/GnomeExtension
python3 test-detect-hardware.py
```

Look for:

```
=== Aura RGB (optional — separate from white backlight levels) ===
  asusctl in PATH            : YES
  org.asuslinux.Daemon on system bus : YES
```

### GUI

Launch **ROG Control Center** from the app grid (installed with `asusctl-rog-gui`)
and test keyboard lighting under the lighting / Aura section.

---

## Step 6 — Reload the GNOME extension

After asusctl is installed and `asusd` is running:

```bash
cd ~/Code/GnomeExtension
./install.sh
gnome-extensions disable kbd-backlight-scheduler@lcortes.gnome
gnome-extensions enable kbd-backlight-scheduler@lcortes.gnome
```

Open **Settings → Schedule** in the extension panel menu. Each time window should now
show **Aura Effect** and **Color** rows when Aura is detected.

If Aura options do not appear, log out and back in (Wayland), then reopen Settings.

---

## How the extension uses asusctl

When Aura is available and mode is **Scheduled**, the extension runs asusctl commands.
It auto-detects **v6** vs legacy syntax from `asusctl aura --help`.

**asusctl 6.x examples** (what the extension uses on Fedora Terra today):

```bash
asusctl aura effect static -c ffffff
asusctl aura effect breathe --colour ffffff --colour2 000000 --speed med
asusctl aura effect rainbow-cycle --speed med
asusctl aura effect flash -c ff0000
```

**Legacy asusctl** (older `-m` flag style):

```bash
asusctl aura -m static --colour ffffff
asusctl aura -m breathe-single --colour ff0000
asusctl aura -m rainbow-cycle
```

Per-window settings are stored in the `schedules` GSettings JSON
(`aura_mode`, `color` fields). White brightness levels are still controlled via GSD
independently of Aura.

---

## Troubleshooting

### `asusctl: command not found`

Terra repo is not enabled, or install failed. Repeat Steps 1–2.

### `asusd.service` fails to start

Run the daemon in the foreground to see errors:

```bash
sudo asusd
```

Check kernel modules:

```bash
lsmod | grep -i asus
# expect modules such as: asus_nb_wmi, asus_wmi
```

### D-Bus daemon not on system bus

```bash
busctl --system list | grep asuslinux
```

If empty, restart the service:

```bash
sudo systemctl restart asusd.service
```

### RGB commands fail but brightness works

- Run `asusctl info` and `asusctl aura --help` to see your CLI version.
- **v6.x** uses `asusctl aura effect static -c ffffff` — **not** `-m static`.
- **Legacy** versions use `asusctl aura -m static --colour ffffff`.
- Check extension logs:
  ```bash
  journalctl /usr/bin/gnome-shell -b --output=cat | grep KbdBacklight
  ```
- Panel menu shows `⚠ Aura` when the last asusctl command failed.

### Newer hardware / missing features

Some very new ASUS models need a newer kernel (ASUS Linux recommends 6.19+ for full
driver support). See the
[ASUS Linux Fedora guide](https://asus-linux.org/guides/fedora-guide/) section on
kernel options if Aura does not respond after a correct install.

### Extension still shows `aura-available: false`

1. Confirm `org.asuslinux.Daemon` is on the system bus.
2. Confirm `which asusctl` returns a path.
3. Disable and re-enable the extension (or log out on Wayland).
4. Reopen extension Settings — hardware is re-detected when the window opens.

---

## Useful links

| Resource | URL |
|----------|-----|
| ASUS Linux project | https://asus-linux.org/ |
| Official Fedora guide | https://asus-linux.org/guides/fedora-guide/ |
| asusctl source (OGC) | https://github.com/opengamingcollective/asusctl |
| Terra repository | https://terrapkg.com/ |

---

## Uninstall

```bash
sudo systemctl disable --now asusd.service
sudo dnf remove asusctl asusctl-rog-gui
# Optional: remove Terra if you added it only for asusctl
```

The keyboard backlight scheduler extension continues to work for **brightness levels**
via GSD after uninstalling asusctl.
