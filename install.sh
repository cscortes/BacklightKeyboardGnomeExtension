#!/usr/bin/env bash
# install.sh — Install the Keyboard Backlight Scheduler GNOME extension
# Brightness is controlled via the GSD D-Bus interface — no sudo required.

set -euo pipefail

UUID="kbd-backlight-scheduler@lcortes.gnome"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SCHEMA_SRC="$(dirname "$0")/schemas"
SCRIPT_DIR="$(dirname "$0")"
VERSION="$(grep -Po '(?<="semantic-version": ")[^"]+' "$SCRIPT_DIR/metadata.json")"

echo "=== Keyboard Backlight Scheduler – installer (v${VERSION}) ==="

# ── 1. Compile GSettings schema ────────────────────────────────────────────
echo "[1/2] Compiling GSettings schema…"
glib-compile-schemas "$(dirname "$0")/schemas"
echo "      OK"

# ── 2. Install extension files ─────────────────────────────────────────────
echo "[2/2] Installing extension to $EXT_DIR…"
mkdir -p "$EXT_DIR/schemas"
cp "$(dirname "$0")/metadata.json" "$EXT_DIR/"
cp "$(dirname "$0")/extension.js"  "$EXT_DIR/"
cp "$(dirname "$0")/prefs.js"      "$EXT_DIR/"
cp "$(dirname "$0")/hwDetect.js"   "$EXT_DIR/"
cp "$SCHEMA_SRC/"*.xml             "$EXT_DIR/schemas/"
cp "$SCHEMA_SRC/gschemas.compiled" "$EXT_DIR/schemas/"
echo "      OK"

echo ""
echo "=== Done! (v${VERSION} installed) ==="
echo ""
echo "Verify version:"
echo "  gnome-extensions info $UUID | grep -i version"
echo "  # or open the panel menu — version shown at the bottom"
echo ""
echo "Next steps:"
echo "  1. Reload GNOME Shell:"
echo "       X11:    Alt+F2 → type 'r' → Enter"
echo "       Wayland: log out and back in"
echo "  2. Enable the extension:"
echo "       gnome-extensions enable $UUID"
echo "  3. Open Settings in the panel menu to add schedule windows."
