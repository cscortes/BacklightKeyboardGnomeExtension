#!/usr/bin/env bash
# install.sh — Install the Keyboard Backlight Scheduler GNOME extension
# Brightness is controlled via the GSD D-Bus interface — no sudo required.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXT_SRC="$ROOT/extension"
SCHEMA_SRC="$EXT_SRC/schemas"
METADATA="$EXT_SRC/metadata.json"
UUID="$(grep -Po '(?<="uuid": ")[^"]+' "$METADATA")"
VERSION="$(grep -Po '(?<="semantic-version": ")[^"]+' "$METADATA")"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
# Older installs used other UUID namespaces; folder name must match metadata.json uuid.
LEGACY_DIRS=(
    "$HOME/.local/share/gnome-shell/extensions/kbd-backlight-scheduler@lcortes.gnome"
    "$HOME/.local/share/gnome-shell/extensions/kbd-backlight-scheduler@cscortes.gnome"
)

echo "=== Keyboard Backlight Scheduler – installer (v${VERSION}) ==="

for LEGACY_DIR in "${LEGACY_DIRS[@]}"; do
    if [[ -d "$LEGACY_DIR" && "$LEGACY_DIR" != "$EXT_DIR" ]]; then
        echo "Removing legacy install at $LEGACY_DIR (UUID is now $UUID)…"
        rm -rf "$LEGACY_DIR"
    fi
done

# ── 1. Validate JS syntax ──────────────────────────────────────────────────
echo "[1/4] Validating JS syntax…"
"$SCRIPT_DIR/validate-js.sh"
echo "      OK"

# ── 2. Compile GSettings schema ────────────────────────────────────────────
echo "[2/4] Compiling GSettings schema…"
glib-compile-schemas "$SCHEMA_SRC"
echo "      OK"

# ── 3. Install extension files ─────────────────────────────────────────────
echo "[3/4] Installing extension to $EXT_DIR…"
mkdir -p "$EXT_DIR/schemas"
cp "$EXT_SRC/metadata.json" "$EXT_DIR/"
cp "$EXT_SRC/extension.js"  "$EXT_DIR/"
cp "$EXT_SRC/prefs.js"      "$EXT_DIR/"
cp "$EXT_SRC/hwDetect.js"   "$EXT_DIR/"
cp "$EXT_SRC/scheduleLogic.js" "$EXT_DIR/"
cp "$SCHEMA_SRC/"*.xml             "$EXT_DIR/schemas/"
cp "$SCHEMA_SRC/gschemas.compiled" "$EXT_DIR/schemas/"
echo "      OK"

# ── 4. Validate install ────────────────────────────────────────────────────
echo "[4/4] Validating install…"
fail() { echo "      FAIL: $1" >&2; exit 1; }
warn() { echo "      WARN: $1"; }

[[ -d "$EXT_DIR" ]] || fail "Extension directory missing: $EXT_DIR"

REQUIRED_FILES=(
    metadata.json
    extension.js
    prefs.js
    hwDetect.js
    scheduleLogic.js
    schemas/gschemas.compiled
    schemas/org.gnome.shell.extensions.kbd-backlight-scheduler.gschema.xml
)
for f in "${REQUIRED_FILES[@]}"; do
    [[ -s "$EXT_DIR/$f" ]] || fail "Missing or empty: $EXT_DIR/$f"
done

INSTALLED_UUID="$(grep -Po '(?<="uuid": ")[^"]+' "$EXT_DIR/metadata.json")"
INSTALLED_VERSION="$(grep -Po '(?<="semantic-version": ")[^"]+' "$EXT_DIR/metadata.json")"
INSTALLED_BUILD="$(grep -Po '(?<="version": )[0-9]+' "$EXT_DIR/metadata.json")"
DIR_UUID="$(basename "$EXT_DIR")"

[[ "$INSTALLED_UUID" == "$UUID" ]] \
    || fail "metadata.json uuid ($INSTALLED_UUID) != source uuid ($UUID)"
[[ "$DIR_UUID" == "$UUID" ]] \
    || fail "Install folder ($DIR_UUID) != metadata.json uuid ($INSTALLED_UUID)"
[[ "$INSTALLED_VERSION" == "$VERSION" ]] \
    || fail "Installed version ($INSTALLED_VERSION) != expected ($VERSION)"

if command -v gnome-extensions >/dev/null 2>&1; then
    if gnome-extensions info "$UUID" >/dev/null 2>&1; then
        INFO="$(gnome-extensions info "$UUID" 2>/dev/null)"
        RUNNING_PATH="$(grep -Po '(?<=^  Path: ).*' <<< "$INFO")"
        RUNNING_BUILD="$(grep -Po '(?<=^  Version: ).*' <<< "$INFO")"
        [[ "$RUNNING_PATH" == "$EXT_DIR" ]] \
            || fail "GNOME Shell path ($RUNNING_PATH) != install path ($EXT_DIR)"
        if [[ "$RUNNING_BUILD" != "$INSTALLED_BUILD" ]]; then
            warn "GNOME Shell reports build ${RUNNING_BUILD}; reload Shell to pick up v${VERSION} (build ${INSTALLED_BUILD})"
        else
            echo "      GNOME Shell sees v${VERSION} (build ${INSTALLED_BUILD})"
        fi
    else
        warn "GNOME Shell has not loaded this extension yet — log out/in (Wayland) or Alt+F2 → r (X11), then:"
        warn "  gnome-extensions enable $UUID"
    fi
else
    warn "gnome-extensions not found; skipped runtime check"
fi

echo "      OK — v${VERSION} installed to $EXT_DIR"

echo ""
echo "=== Done! (v${VERSION} validated) ==="
echo ""
if [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
    echo "Next: log out and back in, then run:"
else
    echo "Next: reload GNOME Shell (Alt+F2 → r), then run:"
fi
echo "  gnome-extensions enable $UUID"
