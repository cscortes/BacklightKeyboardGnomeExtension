#!/usr/bin/env bash
# validate-js.sh — Pre-install checks (no GNOME Shell reload required).
# 1. ESLint (Node.js) — static analysis, duplicate declarations, etc.
# 2. gjs syntax compile — parse-check without GTK
# 3. schedule logic unit tests — overlap + delete-save behavior
# 4. gjs prefs smoke test — fillPreferencesWindow with real Gtk/Adw

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXT="$ROOT/extension"
cd "$ROOT"

fail() { echo "validate: FAIL: $1" >&2; exit 1; }

echo "=== Pre-install validation ==="

# ── 1. ESLint ───────────────────────────────────────────────────────────────
echo "[1/4] ESLint…"
if ! command -v npm >/dev/null 2>&1; then
    fail "npm not found — install Node.js (e.g. sudo dnf install nodejs npm)"
fi
if [[ ! -d node_modules/eslint ]]; then
    echo "      Installing dev dependencies (first run)…"
    npm install --no-fund --no-audit
fi
npm run lint
echo "      OK"

# ── 2. Syntax compile ───────────────────────────────────────────────────────
echo "[2/4] gjs syntax check…"
gjs -m "$EXT/hwDetect.js" >/dev/null 2>&1 \
    || fail "hwDetect.js — run: gjs -m extension/hwDetect.js"
gjs -m "$ROOT/tools/check-syntax.js" \
    "$EXT/extension.js" \
    "$EXT/prefs.js" \
    "$EXT/scheduleLogic.js" \
    || fail "syntax check — see errors above"
echo "      OK"

# ── 3. Schedule logic tests ─────────────────────────────────────────────────
echo "[3/4] schedule logic tests…"
gjs -m "$ROOT/tools/schedule-logic-test.js" \
    || fail "schedule logic tests — see errors above"
echo "      OK"

# ── 4. Prefs smoke test ─────────────────────────────────────────────────────
echo "[4/4] prefs smoke test (Gtk/Adw)…"
gjs -m "$ROOT/tools/prefs-smoke.js" \
    || fail "prefs smoke test — see errors above"
echo "      OK"

echo "=== Validation passed ==="
