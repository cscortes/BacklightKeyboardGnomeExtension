#!/usr/bin/env python3
"""
Static checks that mirror extensions.gnome.org review rules we have hit before.

Fail the process with a non-zero exit if any check fails. Safe to run from
scripts/validate-js.sh and tools/ci-verify.sh (no GNOME Shell / display needed).

Rules covered:
  EGO-A-004  ungated console.log/warn/error count per file (threshold: 5)
  EGO-L-003  signal IDs assigned from .connect() must be .disconnect()'d
  EGO-L-006  prefs instance fields for window widgets need close-request cleanup
  Prior EGO  version-name (not semantic-version), settings-schema, async sysfs reads
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / "extension"
CONSOLE_THRESHOLD = 5


def fail(errors: list[str]) -> None:
    for e in errors:
        print(f"  FAIL: {e}", file=sys.stderr)
    sys.exit(1)


def test_console_logging() -> list[str]:
    """EGO-A-004: no excessive ungated console logging."""
    errors = []
    pattern = re.compile(r"\bconsole\.(log|warn|error)\s*\(")
    for path in sorted(EXT.glob("*.js")):
        text = path.read_text()
        hits = pattern.findall(text)
        if len(hits) > CONSOLE_THRESHOLD:
            errors.append(
                f"{path.relative_to(ROOT)}: {len(hits)} ungated console.* "
                f"calls (threshold {CONSOLE_THRESHOLD}) — EGO-A-004"
            )
    return errors


def test_signal_disconnect() -> list[str]:
    """EGO-L-003: stored .connect() IDs must be disconnected."""
    errors = []
    text = (EXT / "extension.js").read_text()
    # this._fooId = <anything>.connect(
    assigned = re.findall(
        r"this\.(_[A-Za-z0-9]*)\s*=\s*[^\n;]*\.connect\s*\(",
        text,
    )
    for name in assigned:
        if not re.search(rf"\.disconnect\(\s*this\.{re.escape(name)}\s*\)", text):
            errors.append(
                f"extension/extension.js: this.{name} from .connect() has no "
                f"matching .disconnect(this.{name}) — EGO-L-003"
            )
    return errors


def test_prefs_close_request_cleanup() -> list[str]:
    """EGO-L-006: window-scoped prefs fields cleared on close-request."""
    errors = []
    prefs = (EXT / "prefs.js").read_text()

    # Fields the preferences class stores for the open window.
    window_fields = [
        name
        for name in ("_scheduleRows", "_overlapBanner", "_addBtn", "_scheduleJsonError")
        if re.search(rf"this\.{name}\s*=", prefs)
    ]
    if not window_fields:
        return errors

    m = re.search(
        r"window\.connect\(\s*['\"]close-request['\"]\s*,\s*\([^)]*\)\s*=>\s*\{(.*?)\}\s*\)",
        prefs,
        re.S,
    )
    if not m:
        errors.append(
            "extension/prefs.js: stores window-scoped fields on the prefs "
            "instance but has no window.connect('close-request', …) cleanup — EGO-L-006"
        )
        return errors

    body = m.group(1)
    for name in window_fields:
        if not re.search(rf"this\.{re.escape(name)}\s*=\s*null\b", body):
            errors.append(
                f"extension/prefs.js: close-request handler must set "
                f"this.{name} = null — EGO-L-006"
            )
    return errors


def test_metadata_ego_fields() -> list[str]:
    """Prior EGO feedback: version-name + settings-schema, no semantic-version."""
    errors = []
    meta = json.loads((EXT / "metadata.json").read_text())
    if "semantic-version" in meta:
        errors.append(
            'extension/metadata.json: rename "semantic-version" to "version-name"'
        )
    if "version-name" not in meta:
        errors.append('extension/metadata.json: missing "version-name"')
    if "settings-schema" not in meta:
        errors.append(
            'extension/metadata.json: missing "settings-schema" '
            "(required for parameterless getSettings())"
        )
    return errors


def test_no_blocking_sysfs_reads() -> list[str]:
    """Prior EGO feedback: no sync load_contents / subprocess cat for file reads."""
    errors = []
    hw = (EXT / "hwDetect.js").read_text()
    if re.search(r"\.load_contents\s*\(\s*null\s*\)", hw):
        errors.append(
            "extension/hwDetect.js: use Gio.File.load_contents_async, "
            "not blocking load_contents(null)"
        )
    if re.search(r"Subprocess\.new\s*\(\s*\[[^\]]*['\"]cat['\"]", hw, re.S):
        errors.append(
            "extension/hwDetect.js: must not spawn subprocess to read file content"
        )
    if "load_contents_async" not in hw:
        errors.append(
            "extension/hwDetect.js: expected Gio.File.load_contents_async for sysfs reads"
        )
    return errors


def test_get_settings_no_schema_arg() -> list[str]:
    """Prior EGO feedback: getSettings() should use metadata settings-schema."""
    errors = []
    for rel in ("extension.js", "prefs.js"):
        text = (EXT / rel).read_text()
        if re.search(r"getSettings\s*\(\s*['\"]", text):
            errors.append(
                f"extension/{rel}: call getSettings() with no schema argument "
                "(schema is in metadata.json settings-schema)"
            )
    return errors


def main() -> None:
    print("=== EGO hygiene tests ===")
    suites = [
        ("EGO-A-004 console logging", test_console_logging),
        ("EGO-L-003 signal disconnect", test_signal_disconnect),
        ("EGO-L-006 prefs close-request", test_prefs_close_request_cleanup),
        ("metadata version-name / settings-schema", test_metadata_ego_fields),
        ("async sysfs reads (no cat/subprocess)", test_no_blocking_sysfs_reads),
        ("getSettings() without schema arg", test_get_settings_no_schema_arg),
    ]

    errors: list[str] = []
    for name, fn in suites:
        suite_errors = fn()
        if suite_errors:
            print(f"  · {name}: FAIL ({len(suite_errors)})")
            errors.extend(suite_errors)
        else:
            print(f"  · {name}: OK")

    if errors:
        fail(errors)

    print("ego hygiene tests OK")


if __name__ == "__main__":
    main()
