#!/usr/bin/env python3
"""Reproducible, stdlib-only V2 Workspace preview ZIP (no installation or promotion)."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent
FILES = (
    "index.html", "app.css", "app.js",
    "server.mjs", "v1-runtime-bridge.mjs", "continuation-handoff.mjs", "local-model-evidence.mjs",
    "workflow-view.mjs", "local-evidence.mjs", "transport-evidence.mjs",
    "owner-diagnostic-reader.mjs", "owner-seat-evidence.mjs", "desktop-app.mjs",
    "start-windows.cmd", "start-linux.sh", "start-desktop-windows.cmd",
    "start-desktop-linux.sh", "install-user-windows.ps1",
    "install-user-linux.sh", "upgrade-r18.mjs", "README.md",
)
DATE = (2026, 10, 31, 0, 0, 0)
MODE = "LOCAL_GUI_PREVIEW_NO_PROMOTION"


def stage(output: Path, source: Path = HERE) -> dict:
    if source.is_symlink():
        raise ValueError("SOURCE_ALIAS_INVALID")
    source = source.resolve(strict=True)
    if not source.is_dir():
        raise ValueError("SOURCE_INVALID")
    if output.exists() or output.is_symlink():
        raise FileExistsError("OUTPUT_EXISTS")
    if not output.is_absolute() or output.parent.is_symlink() or not output.parent.is_dir():
        raise ValueError("OUTPUT_PARENT_INVALID")
    if output.parent.stat().st_uid != os.getuid():
        raise ValueError("OUTPUT_OWNER_INVALID")
    entries = []
    payload = []
    for name in FILES:
        item = source / name
        info = item.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid():
            raise ValueError("UNSAFE_SOURCE_FILE:" + name)
        data = item.read_bytes()
        entries.append({"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        payload.append((name, data))
    manifest = {
        "product": "Commander V2 Workspace GUI",
        "mode": MODE,
        "design": "Owner approved dark layout",
        "mmzSource": "RC_CONTROL_CENTER_PRODUCT_R1 / RC_UI_MONITOR_R1 read-only contracts",
        "schema": 1,
        "date": "2026-11-03",
        "files": entries,
    }
    manifest_bytes = json.dumps(manifest, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    fd, temp_name = tempfile.mkstemp(prefix=".v2-workspace-", suffix=".zip.tmp", dir=output.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as output_file:
            with zipfile.ZipFile(output_file, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                for name, data in [*payload, ("MANIFEST.json", manifest_bytes)]:
                    meta = zipfile.ZipInfo(name, DATE)
                    meta.create_system = 3
                    meta.external_attr = 0o100600 << 16
                    meta.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(meta, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
            output_file.flush()
            os.fsync(output_file.fileno())
        with zipfile.ZipFile(temp_name) as check:
            if check.namelist() != [*FILES, "MANIFEST.json"]:
                raise ValueError("ZIP_PATH_INVALID")
            observed = json.loads(check.read("MANIFEST.json"))
            if observed != manifest:
                raise ValueError("ZIP_MANIFEST_INVALID")
            for item in entries:
                if hashlib.sha256(check.read(item["path"])).hexdigest() != item["sha256"]:
                    raise ValueError("ZIP_FILE_HASH_INVALID:" + item["path"])
        # Link is create-new and atomic within the output parent: never overwrite.
        os.link(temp_name, output)
        return {"status": "QA_ZIP_BUILT_NOT_INSTALLED", "path": str(output),
                "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                "bytes": output.stat().st_size, "files": len(FILES), "mode": MODE}
    finally:
        Path(temp_name).unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New, absolute .zip path in an owned folder")
    args = parser.parse_args()
    try:
        print(json.dumps(stage(args.output), sort_keys=True))
        return 0
    except (OSError, ValueError) as error:
        print("V2_WORKSPACE_ZIP_BUILD_FAILED:" + type(error).__name__ + ":" + str(error)[:90],
              file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
