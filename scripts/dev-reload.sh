#!/usr/bin/env bash
# bump extension/metadata.json first, then:
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
UUID="$(grep -Po '(?<="uuid": ")[^"]+' "$ROOT/extension/metadata.json")"

"$SCRIPT_DIR/install.sh"
gnome-extensions disable "$UUID"
gnome-extensions enable "$UUID"
