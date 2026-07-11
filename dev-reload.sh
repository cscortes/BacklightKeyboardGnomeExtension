#!/usr/bin/env bash
# bump metadata.json first, then:
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
UUID="$(grep -Po '(?<="uuid": ")[^"]+' "$SCRIPT_DIR/metadata.json")"

"$SCRIPT_DIR/install.sh"
gnome-extensions disable "$UUID"
gnome-extensions enable "$UUID"
