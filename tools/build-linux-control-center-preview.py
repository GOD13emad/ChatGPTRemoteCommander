#!/usr/bin/env python3
"""Deterministic, non-installing Linux GTK Control Center QA preview bundle.

This builder NEVER writes to an installed Commander, XDG directory or host
configuration. A successful archive build is NOT native GUI or release approval.
"""
import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = (
    "desktop/linux-control-center/control_center.py",
    "desktop/linux-control-center/dashboard_ui.py",
    "desktop/linux-control-center/notion_panel.py",
)
LAUNCHER = """#!/bin/sh
set -eu
HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
exec /usr/bin/python3 -B "$HERE/control_center.py" "$@"
"""


def checked_git(*args):
    result = subprocess.run(
        ["git", "-C", str(ROOT), *args],
        capture_output=True, text=True, timeout=12, check=True,
    )
    return result.stdout.strip()


def pack(output: Path):
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("INVALID_SOURCE_VERSION")
    commit = checked_git("rev-parse", "HEAD^{commit}")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("INVALID_SOURCE_COMMIT")
    # Only historical commit time: no wall-clock timestamp in artifact bytes.
    epoch = max(315532800, int(checked_git("show", "-s", "--format=%ct", "HEAD")))
    timestamp = time.gmtime(epoch)[:6]
    prefix = f"Remote-Commander-Control-Center-Linux-v{version}-preview/"
    entries = {}
    for src in SOURCES:
        path = ROOT / src
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > 1024 * 1024:
            raise ValueError("UNSAFE_SOURCE_FILE " + src)
        entries[Path(src).name] = path.read_bytes()
    entries["run-control-center.sh"] = LAUNCHER.encode("utf-8")
    entries["README.txt"] = (
        f"Remote Commander Linux Control Center v{version} (QA SOURCE PREVIEW)\n"
        f"Exact repository source commit: {commit}\n"
        "This is a portable read-only preview, NOT a public Linux installer.\n"
        "No service, desktop entry, credential, profile, system file or auto-update is installed.\n"
        "Run: sh ./run-control-center.sh --audit (no native GUI required).\n"
        "For manual GTK4/Adwaita testing: sh ./run-control-center.sh\n"
        "Requirements: Linux, /usr/bin/python3, PyGObject, GTK4 and libadwaita.\n"
        "The Notion panel requires independent owner opt-in and the separately qualified Core.\n"
        "Never claim authenticated GUI control or native release acceptance from archive checks.\n"
    ).encode("utf-8")
    manifest = {
        "schema": 1,
        "product": "remote-commander-linux-control-center-qa-preview",
        "version": version,
        "sourceCommit": commit,
        "installationPerformed": False,
        "nativeGuiAccepted": False,
        "files": {name: hashlib.sha256(raw).hexdigest()
                  for name, raw in sorted(entries.items())},
    }
    entries["MANIFEST.json"] = (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode("utf-8")
    entries["SHA256SUMS.txt"] = "".join(
        f"{hashlib.sha256(raw).hexdigest()}  {name}\n"
        for name, raw in sorted(entries.items())
    ).encode("utf-8")
    if output.is_symlink() or output.exists():
        raise ValueError("OUTPUT_EXISTS_OR_IS_SYMLINK")
    if not output.parent.is_dir() or output.parent.is_symlink():
        raise ValueError("OUTPUT_DIRECTORY_MISSING_OR_SYMLINK")
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as dest:
        for name, raw in sorted(entries.items()):
            info = zipfile.ZipInfo(prefix + name, date_time=timestamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o755 if name.endswith(".sh") else 0o644) << 16
            info.create_system = 3
            dest.writestr(info, raw, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    print(
        f"LINUX_CONTROL_CENTER_QA_BUNDLE_PASS version={version} commit={commit}"
        f" members={len(entries)} sha256={hashlib.sha256(output.read_bytes()).hexdigest()}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        pack(Path(os.path.abspath(args.output)))
    except (OSError, ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        print("LINUX_CONTROL_CENTER_QA_BUNDLE_FAIL " + str(e), file=sys.stderr)
        sys.exit(2)
