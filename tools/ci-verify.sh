#!/usr/bin/env bash
# ci-verify.sh — Extra CI checks beyond validate-js.sh:
#   metadata shape + README version sync
#   GSettings schema compile (--strict)
#   static EGO-ish import / API hygiene
#   pack .shell-extension.zip and verify top-level contents
#
# Usage (from repo root):
#   ./tools/ci-verify.sh
#   ./tools/ci-verify.sh --skip-pack   # metadata/schema/hygiene only

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SKIP_PACK=0
for arg in "$@"; do
    case "$arg" in
        --skip-pack) SKIP_PACK=1 ;;
        -h|--help)
            sed -n '2,12p' "$0"
            exit 0
            ;;
        *)
            echo "ci-verify: unknown option: $arg" >&2
            exit 2
            ;;
    esac
done

fail() { echo "ci-verify: FAIL: $*" >&2; exit 1; }
ok()   { echo "      OK — $*"; }

echo "=== CI verify (packaging + hygiene) ==="

# ── 1. metadata.json ────────────────────────────────────────────────────────
echo "[1/5] metadata.json…"
command -v python3 >/dev/null || fail "python3 required"
python3 - <<'PY'
import json, re, sys
from pathlib import Path

meta = json.loads(Path("metadata.json").read_text())
errors = []

def req(key):
    if key not in meta or meta[key] in ("", None, []):
        errors.append(f"missing or empty required key: {key}")

for key in ("uuid", "name", "description", "shell-version", "url"):
    req(key)

uuid = meta.get("uuid", "")
if not re.fullmatch(r"[A-Za-z0-9._-]+@[A-Za-z0-9._-]+", uuid):
    errors.append(f"uuid must look like name@namespace, got: {uuid!r}")
if uuid.endswith("@gnome.org") or uuid.endswith(".gnome.org"):
    errors.append(f"uuid must not use gnome.org namespace: {uuid!r}")

ver = meta.get("version")
if not isinstance(ver, int) or isinstance(ver, bool) or ver < 1:
    errors.append(f'version must be a positive integer (not semver), got: {ver!r}')

sem = meta.get("semantic-version")
if not isinstance(sem, str) or not re.fullmatch(r"\d+\.\d+\.\d+", sem):
    errors.append(f'semantic-version must be MAJOR.MINOR.PATCH, got: {sem!r}')

shell = meta.get("shell-version")
if not isinstance(shell, list) or not shell or not all(isinstance(s, str) for s in shell):
    errors.append(f"shell-version must be a non-empty string array, got: {shell!r}")

url = meta.get("url", "")
if not isinstance(url, str) or not url.startswith("https://"):
    errors.append(f"url must be an https:// link, got: {url!r}")

readme = Path("README.md").read_text()
m = re.search(r"Version:\s*\*\*([0-9.]+)\*\*", readme)
if not m:
    errors.append("README.md missing 'Version: **x.y.z**' line")
elif sem and m.group(1) != sem:
    errors.append(f"README version {m.group(1)!r} != metadata semantic-version {sem!r}")

if errors:
    for e in errors:
        print(f"  - {e}", file=sys.stderr)
    sys.exit(1)

print(f"      uuid={uuid}  version={ver}  semantic-version={sem}")
print(f"      shell-version={', '.join(shell)}")
PY
ok "metadata + README version sync"

# ── 2. GSettings schema ─────────────────────────────────────────────────────
echo "[2/5] glib-compile-schemas --strict…"
command -v glib-compile-schemas >/dev/null || fail "glib-compile-schemas not found (libglib2.0-bin)"
SCHEMA_XML="schemas/org.gnome.shell.extensions.kbd-backlight-scheduler.gschema.xml"
[[ -f "$SCHEMA_XML" ]] || fail "missing $SCHEMA_XML"
grep -q 'id="org.gnome.shell.extensions.kbd-backlight-scheduler"' "$SCHEMA_XML" \
    || fail "schema id must be org.gnome.shell.extensions.kbd-backlight-scheduler"
grep -q 'path="/org/gnome/shell/extensions/kbd-backlight-scheduler/"' "$SCHEMA_XML" \
    || fail "schema path must be /org/gnome/shell/extensions/kbd-backlight-scheduler/"
glib-compile-schemas --strict schemas/
ok "schema compiles"

# ── 3. Static hygiene (EGO-ish) ──────────────────────────────────────────────
echo "[3/5] static import / API hygiene…"
python3 - <<'PY'
import re, sys
from pathlib import Path

errors = []

ext = Path("extension.js").read_text()
prefs = Path("prefs.js").read_text()

# GTK stack must stay out of the Shell process
for bad in ("gi://Gtk", "gi://Gdk", "gi://Adw"):
    if re.search(rf"from ['\"]{re.escape(bad)}", ext):
        errors.append(f"extension.js must not import {bad}")

# Shell / Clutter stack must stay out of prefs
for bad in ("gi://Clutter", "gi://Meta", "gi://St", "gi://Shell"):
    if re.search(rf"from ['\"]{re.escape(bad)}", prefs):
        errors.append(f"prefs.js must not import {bad}")

for path in ("extension.js", "prefs.js", "hwDetect.js", "scheduleLogic.js"):
    text = Path(path).read_text()
    if "spawn_command_line_sync" in text:
        errors.append(f"{path}: spawn_command_line_sync is discouraged (use async Gio.Subprocess)")
    if re.search(r"\bByteArray\b", text):
        errors.append(f"{path}: ByteArray is deprecated")
    if re.search(r"\bimports\.lang\b|\bLang\.", text):
        errors.append(f"{path}: Lang is deprecated")
    if re.search(r"\bimports\.mainloop\b|\bMainloop\.", text):
        errors.append(f"{path}: Mainloop is deprecated")

# Required top-level sources for pack
for req in (
    "extension.js",
    "prefs.js",
    "metadata.json",
    "hwDetect.js",
    "scheduleLogic.js",
    "LICENSE",
    "schemas/org.gnome.shell.extensions.kbd-backlight-scheduler.gschema.xml",
):
    if not Path(req).is_file():
        errors.append(f"missing required file: {req}")

if errors:
    for e in errors:
        print(f"  - {e}", file=sys.stderr)
    sys.exit(1)
PY
ok "hygiene checks"

if [[ "$SKIP_PACK" -eq 1 ]]; then
    echo "[4/5] pack… skipped"
    echo "[5/5] zip inspect… skipped"
    echo "=== CI verify passed (pack skipped) ==="
    exit 0
fi

# ── 4. Pack zip ──────────────────────────────────────────────────────────────
echo "[4/5] pack extension zip…"
UUID="$(python3 -c 'import json; print(json.load(open("metadata.json"))["uuid"])')"
mkdir -p dist
ZIP="dist/${UUID}.shell-extension.zip"
rm -f "$ZIP"

if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions pack . \
        --extra-source=hwDetect.js \
        --extra-source=scheduleLogic.js \
        --extra-source=LICENSE \
        -o dist -f
    [[ -f "$ZIP" ]] || fail "gnome-extensions pack did not produce $ZIP"
    ok "gnome-extensions pack → $ZIP"
else
    # Fallback matching Makefile pack contents (no gnome-shell package needed)
    zip -q -r "$ZIP" \
        metadata.json extension.js prefs.js \
        hwDetect.js scheduleLogic.js LICENSE \
        schemas/org.gnome.shell.extensions.kbd-backlight-scheduler.gschema.xml
    ok "zip fallback → $ZIP (install gnome-shell for official pack tool)"
fi

# ── 5. Inspect zip layout ───────────────────────────────────────────────────
echo "[5/5] verify zip contents…"
command -v unzip >/dev/null || fail "unzip required"
LIST="$(unzip -Z1 "$ZIP")"

need_top=(
    metadata.json
    extension.js
    prefs.js
    hwDetect.js
    scheduleLogic.js
    LICENSE
    schemas/org.gnome.shell.extensions.kbd-backlight-scheduler.gschema.xml
)
for f in "${need_top[@]}"; do
    grep -Fxq "$f" <<<"$LIST" || fail "zip missing top-level entry: $f"
done

# metadata.json must not be nested under a directory
grep -E '^[^/]+/metadata\.json$' <<<"$LIST" >/dev/null \
    && fail "metadata.json must be at zip root, not inside a folder"

# No compiled schema in the upload (EGO/install compiles on target)
if grep -E 'gschemas\.compiled$' <<<"$LIST" >/dev/null; then
    fail "zip must not include gschemas.compiled (compile on install)"
fi

# Keep junk out of the distributable
for bad in node_modules/ build/ .git/ package.json package-lock.json \
           validate-js.sh install.sh Makefile tools/ test-backlight.py \
           test-detect-hardware.py; do
    if grep -E "^${bad}" <<<"$LIST" >/dev/null; then
        fail "zip must not include development path: $bad"
    fi
done

echo "      entries:"
unzip -Z1 "$ZIP" | sed 's/^/        /'
ok "zip layout"
echo "=== CI verify passed ==="
