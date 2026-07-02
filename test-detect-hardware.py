#!/usr/bin/env python3
"""
test-detect-hardware.py
Detect ASUS keyboard backlight hardware and related control paths.

Run from a normal GNOME session (outside any sandbox):

    python3 test-detect-hardware.py

Checks:
  - sysfs LED devices (asus::kbd_backlight, etc.)
  - GSD D-Bus keyboard brightness (org.gnome.SettingsDaemon.Power.Keyboard)
  - ASUS Aura / asusctl (optional RGB — separate from white backlight)
  - Cross-check: sysfs max_brightness vs GSD Steps
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# ── GSD D-Bus ───────────────────────────────────────────────────────────────

GSD_DEST  = "org.gnome.SettingsDaemon.Power"
GSD_OPATH = "/org/gnome/SettingsDaemon/Power"
GSD_IFACE = "org.gnome.SettingsDaemon.Power.Keyboard"
GSD_PROPS = "org.freedesktop.DBus.Properties"

ASUS_KBD_LED = Path("/sys/class/leds/asus::kbd_backlight")
AURA_DAEMON  = "org.asuslinux.Daemon"


def run(cmd: list[str], check: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def ok(label: bool) -> str:
    return "YES" if label else "no"


def read_sysfs_int(path: Path) -> int | None:
    try:
        return int(path.read_text().strip())
    except (OSError, ValueError):
        return None


def read_sysfs_text(path: Path) -> str | None:
    try:
        return path.read_text().strip()
    except OSError:
        return None


def gdbus_session(*args: str) -> str:
    cmd = [
        "gdbus", "call", "--session",
        "--dest", GSD_DEST,
        "--object-path", GSD_OPATH,
        "--method", *args,
    ]
    r = run(cmd)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or r.stdout.strip())
    return r.stdout.strip()


def gsd_get(prop: str) -> int:
    raw = gdbus_session(f"{GSD_PROPS}.Get", GSD_IFACE, prop)
    m = re.search(r"(\d+)", raw)
    if not m:
        raise RuntimeError(f"Could not parse GSD {prop} from: {raw!r}")
    return int(m.group(1))


def busctl_system_list() -> list[str]:
    r = run(["busctl", "--system", "list"])
    if r.returncode != 0:
        return []
    return r.stdout.splitlines()


def section(title: str) -> None:
    print()
    print(f"=== {title} ===")


def subsection(title: str) -> None:
    print()
    print(f"--- {title} ---")


# ── 1. Environment ──────────────────────────────────────────────────────────

section("Environment")
print(f"  XDG_SESSION_TYPE : {os.environ.get('XDG_SESSION_TYPE', '(unset)')}")
print(f"  USER             : {os.environ.get('USER', '(unset)')}")
print(f"  Python           : {sys.version.split()[0]}")


# ── 2. sysfs LEDs ───────────────────────────────────────────────────────────

section("sysfs LED devices (/sys/class/leds)")

leds_dir = Path("/sys/class/leds")
if not leds_dir.is_dir():
    print("  ERROR: /sys/class/leds not found")
    asus_kbd_present = False
    sysfs_max = None
    sysfs_brightness = None
else:
    all_leds = sorted(p.name for p in leds_dir.iterdir() if p.is_symlink() or p.is_dir())
    asus_leds = [n for n in all_leds if "asus" in n.lower() or "kbd" in n.lower()]

    print(f"  Total LED entries : {len(all_leds)}")
    if asus_leds:
        print("  ASUS / keyboard related:")
        for name in asus_leds:
            print(f"    - {name}")
    else:
        print("  No ASUS/keyboard LED names found in /sys/class/leds")

    asus_kbd_present = ASUS_KBD_LED.is_dir() or (ASUS_KBD_LED / "max_brightness").is_file()
    print()
    print(f"  asus::kbd_backlight present : {ok(asus_kbd_present)}")

    if asus_kbd_present:
        sysfs_max = read_sysfs_int(ASUS_KBD_LED / "max_brightness")
        sysfs_brightness = read_sysfs_int(ASUS_KBD_LED / "brightness")
        print(f"  max_brightness (sysfs)    : {sysfs_max}")
        print(f"  brightness (sysfs, current) : {sysfs_brightness}")

        # Useful sysfs metadata when present
        for attr in ("type", "device", "trigger"):
            val = read_sysfs_text(ASUS_KBD_LED / attr)
            if val is not None:
                display = val if len(val) < 80 else val[:77] + "..."
                print(f"  {attr:26}: {display}")
    else:
        sysfs_max = None
        sysfs_brightness = None
        print("  Path checked:", ASUS_KBD_LED)


# ── 3. asus-nb-wmi platform ─────────────────────────────────────────────────

section("ASUS platform (asus-nb-wmi)")

wmi_path = Path("/sys/devices/platform/asus-nb-wmi")
if wmi_path.is_dir():
    print(f"  asus-nb-wmi driver present : {ok(True)}")
    modalias = read_sysfs_text(wmi_path / "modalias")
    if modalias:
        print(f"  modalias                   : {modalias}")
else:
    print(f"  asus-nb-wmi driver present : {ok(False)}")
    print("  (White keyboard backlight may still work via another driver.)")


# ── 4. GSD D-Bus keyboard interface ─────────────────────────────────────────

section("GSD keyboard backlight (session D-Bus)")

gsd_ok = False
gsd_steps = None
gsd_brightness = None
gsd_error = None

try:
    gsd_steps = gsd_get("Steps")
    gsd_brightness = gsd_get("Brightness")
    gsd_ok = True
    gsd_max_level = max(0, gsd_steps - 1)
    print(f"  GSD reachable              : {ok(True)}")
    print(f"  Steps                      : {gsd_steps}  (levels 0–{gsd_max_level})")
    print(f"  Brightness (%, current)    : {gsd_brightness}")
    print(f"  Interface                  : {GSD_IFACE}")
except RuntimeError as e:
    gsd_error = str(e)
    print(f"  GSD reachable              : {ok(False)}")
    print(f"  Error                      : {gsd_error}")
    print()
    print("  Hint: run this script in a GNOME session with gnome-settings-daemon active.")


# ── 5. sysfs vs GSD cross-check ───────────────────────────────────────────────

section("Cross-check: sysfs vs GSD")

if asus_kbd_present and gsd_ok and sysfs_max is not None:
    # sysfs max_brightness is the highest level index (e.g. 3 for 4 levels)
    sysfs_levels = sysfs_max + 1
    match = sysfs_levels == gsd_steps
    print(f"  sysfs levels (max+1)       : {sysfs_levels}")
    print(f"  GSD Steps                  : {gsd_steps}")
    print(f"  Match                      : {ok(match)}")
    if not match:
        print("  WARNING: sysfs and GSD disagree on step count.")
elif asus_kbd_present and not gsd_ok:
    print("  sysfs ASUS LED found but GSD is not reachable.")
elif gsd_ok and not asus_kbd_present:
    print("  GSD works but asus::kbd_backlight sysfs node not found.")
    print("  (Backlight may use a different LED name on this machine.)")
else:
    print("  Insufficient data for cross-check.")


# ── 6. Aura RGB / asusctl (optional) ──────────────────────────────────────────

section("Aura RGB (optional — separate from white backlight levels)")

asusctl_path = shutil.which("asusctl")
print(f"  asusctl in PATH            : {ok(asusctl_path is not None)}")
if asusctl_path:
    print(f"  Path                       : {asusctl_path}")
    ver = run([asusctl_path, "--version"])
    if ver.returncode == 0:
        print(f"  Version                    : {ver.stdout.strip()}")
    help_r = run([asusctl_path, "aura", "--help"])
    if help_r.returncode == 0:
        colour_flag = "--colour" if "--colour" in help_r.stdout else (
            "--color" if "--color" in help_r.stdout else "(unknown)"
        )
        print(f"  aura colour flag           : {colour_flag}")
else:
    print("  Install from https://asus-linux.org/ if you want per-zone RGB effects.")

bus_lines = busctl_system_list()
aura_daemon = any(AURA_DAEMON in line for line in bus_lines)
print(f"  {AURA_DAEMON} on system bus : {ok(aura_daemon)}")

if not aura_daemon and not asusctl_path:
    print()
    print("  Note: White backlight scheduling does NOT require asusctl.")
    print("        GSD controls brightness levels on most ASUS laptops.")


# ── 7. Extension-relevant summary ─────────────────────────────────────────────

section("Summary (what the GNOME extension cares about)")

kbd_via_gsd = gsd_ok
asus_wmi = asus_kbd_present
aura_rgb = aura_daemon or (asusctl_path is not None)

print()
print("  Control path for brightness levels:")
if kbd_via_gsd and asus_wmi:
    print("    ✓ ASUS WMI keyboard LED + GSD D-Bus (recommended path)")
elif kbd_via_gsd:
    print("    ✓ GSD D-Bus (keyboard backlight available)")
elif asus_wmi:
    print("    ~ ASUS WMI sysfs only — GSD not reachable from this session")
else:
    print("    ✗ No keyboard backlight control path detected")

print()
print("  Aura RGB (optional schedule colours/effects):")
if aura_rgb:
    print("    ✓ asusctl and/or org.asuslinux.Daemon detected")
else:
    print("    — Not available (normal on Fedora without asus-linux packages)")

print()
print("  Suggested extension settings after enable:")
if gsd_ok:
    print(f"    max-brightness ≈ {max(0, gsd_steps - 1)}")
print(f"    asus-kbd-detected ≈ {str(asus_wmi).lower()}")
print(f"    aura-available    ≈ {str(aura_rgb).lower()}")

print()
if kbd_via_gsd:
    print("  Next: run test-backlight.py to confirm each level changes the hardware.")
else:
    print("  Fix GSD/session issues before testing brightness levels.")
    sys.exit(1)
