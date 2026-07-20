#!/usr/bin/env bash
# uninstall.sh — Remove the Keyboard Backlight Scheduler GNOME extension
# Does not touch asusctl / asusd or other system packages.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
METADATA="$ROOT/extension/metadata.json"
UUID="$(grep -Po '(?<="uuid": ")[^"]+' "$METADATA")"
VERSION="$(grep -Po '(?<="version-name": ")[^"]+' "$METADATA")"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
LEGACY_DIRS=(
    "$HOME/.local/share/gnome-shell/extensions/kbd-backlight-scheduler@lcortes.gnome"
    "$HOME/.local/share/gnome-shell/extensions/kbd-backlight-scheduler@cscortes.gnome"
)

echo "=== Keyboard Backlight Scheduler – uninstall (v${VERSION}) ==="

if command -v gnome-extensions >/dev/null 2>&1; then
    if gnome-extensions info "$UUID" >/dev/null 2>&1; then
        echo "[1/2] Disabling $UUID…"
        gnome-extensions disable "$UUID" 2>/dev/null || true
        echo "      OK"
    else
        echo "[1/2] Extension not loaded in GNOME Shell — skip disable"
    fi
else
    echo "[1/2] gnome-extensions not found — skip disable"
fi

echo "[2/2] Removing install directories…"
REMOVED=0
if [[ -d "$EXT_DIR" ]]; then
    rm -rf "$EXT_DIR"
    echo "      Removed $EXT_DIR"
    REMOVED=1
fi
for LEGACY_DIR in "${LEGACY_DIRS[@]}"; do
    if [[ -d "$LEGACY_DIR" ]]; then
        rm -rf "$LEGACY_DIR"
        echo "      Removed legacy $LEGACY_DIR"
        REMOVED=1
    fi
done

if [[ "$REMOVED" -eq 0 ]]; then
    echo "      Nothing to remove (not installed under ~/.local/share/gnome-shell/extensions/)"
fi

echo ""
echo "=== Done ==="
echo "GSettings for this extension (if any) are left in place."
echo "Reload GNOME Shell to clear a still-visible panel icon:"
if [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
    echo "  log out and back in"
else
    echo "  Alt+F2 → r  (X11)"
fi
