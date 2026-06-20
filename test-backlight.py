#!/usr/bin/env python3
"""
test-backlight.py
Cycle through every keyboard backlight level via GSD D-Bus and confirm
each one physically changes the hardware.
"""

import subprocess
import sys
import time
import re

DEST   = "org.gnome.SettingsDaemon.Power"
OPATH  = "/org/gnome/SettingsDaemon/Power"
IFACE  = "org.gnome.SettingsDaemon.Power.Keyboard"
PROPS  = "org.freedesktop.DBus.Properties"


def gdbus(*args):
    """Run a gdbus call and return stdout, raising on failure."""
    cmd = ["gdbus", "call", "--session",
           "--dest", DEST, "--object-path", OPATH,
           "--method"] + list(args)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip())
    return r.stdout.strip()


def gsd_get(prop):
    """Read an integer property from the GSD keyboard interface."""
    raw = gdbus(f"{PROPS}.Get", IFACE, prop)
    # gdbus output looks like:  (<@i 4>,)  or  (<int32 100>,)
    m = re.search(r"(\d+)", raw)
    if not m:
        raise RuntimeError(f"Could not parse value from: {raw!r}")
    return int(m.group(1))


def gsd_set(pct):
    """Set the Brightness property (percentage 0-100)."""
    gdbus(f"{PROPS}.Set", IFACE, "Brightness", f"<int32 {pct}>")


# ── Verify GSD is reachable ────────────────────────────────────────────────
print()
print("=== Keyboard Backlight Test ===")
print()

try:
    steps    = gsd_get("Steps")
    original = gsd_get("Brightness")
except RuntimeError as e:
    print(f"ERROR: Cannot talk to GSD: {e}")
    print()
    print("Make sure GNOME Settings Daemon is running and you are in a GNOME session.")
    sys.exit(1)

max_level = steps - 1
print(f"  Steps    : {steps}  (levels 0–{max_level})")
print(f"  Current  : {original}%")
print()
print("Will set each brightness level, wait 1 second, then ask")
print("whether you saw the keyboard backlight physically change.")
print()
input("Press Enter to begin (Ctrl+C to cancel)… ")
print()

# ── Cycle through every level ──────────────────────────────────────────────
results = []   # list of (level, pct, answer)

for level in range(steps):
    pct = round(level / max_level * 100) if max_level > 0 else 0

    print(f"  Level {level}/{max_level}  ({pct}%)  — setting now…", end="", flush=True)
    try:
        gsd_set(pct)
    except RuntimeError as e:
        print(f"\n  ERROR setting brightness: {e}")
        results.append((level, pct, "error"))
        continue

    print("Sleeping for 1 second…", end="", flush=True)
    time.sleep(1)

    while True:
        ans = input("  Did the backlight change? [y/n/s=skip]: ").strip().lower()
        if ans in ("y", "yes", "n", "no", "s", "skip", ""):
            break
        print("  Please enter y, n, or s.")

    if ans in ("y", "yes"):
        label = "✓  confirmed"
        result = "pass"
    elif ans in ("s", "skip"):
        label = "—  skipped"
        result = "skip"
    else:
        label = "✗  no change seen"
        result = "fail"

    print(f"      {label}")
    results.append((level, pct, result))
    print()

# ── Restore original brightness ────────────────────────────────────────────
print(f"Restoring original brightness ({original}%)…", end=" ", flush=True)
try:
    gsd_set(original)
    print("done")
except RuntimeError as e:
    print(f"ERROR: {e}")

# ── Summary ────────────────────────────────────────────────────────────────
passed  = sum(1 for _, _, r in results if r == "pass")
failed  = sum(1 for _, _, r in results if r == "fail")
errored = sum(1 for _, _, r in results if r == "error")
skipped = sum(1 for _, _, r in results if r == "skip")

print()
print("=== Results ===")
print(f"  Passed  : {passed}")
print(f"  Failed  : {failed}")
print(f"  Errored : {errored}")
print(f"  Skipped : {skipped}")
print()

if failed or errored:
    print("Some levels did not respond. Check GNOME Shell logs:")
    print("  journalctl /usr/bin/gnome-shell -b --output=cat | grep KbdBacklight")
    sys.exit(1)
else:
    print("All tested levels responded correctly.")
