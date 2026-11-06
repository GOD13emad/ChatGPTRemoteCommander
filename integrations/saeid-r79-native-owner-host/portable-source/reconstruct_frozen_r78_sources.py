#!/usr/bin/env python3
"""Reconstruct six frozen C# sources only; never build, execute or install them."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import zipfile

ARCHIVE_SHA256 = "3e3442499c71a3adcdf5dfc23061a6e7f8be13605747d4b41bf8d834f07c5784"
MAP_SHA256 = "f0a6d7d1dbb27ffcc1a543d79c8d85593ea7a53ff9cf780b525d3f3a0524a138"
COMMIT = "5bdbd9c59a761b30d3a1aeda7df2bcdfa85cbccf"
HISTORIC_ROOT = "G:/CodexWork/RemoteCommander_ConnectionRecovery_20261027/commander-one-integration-r78/"
RELATIVE_PREFIX = "reviews/durable/local-owner-auth/"
DEPENDENCIES = (
    ("protected-oauth-exchange/ProtectedOAuthExchange.cs", "277beb1f077289203ee57ab3df55ac64d8e7bfca2d0aa0b31a25aaaf5d208ae0"),
    ("protected-oauth-exchange/ExchangeJournal.cs", "e79149d2cb090771a9705890ae113f32251d69300fcb79f739024aa8e40a91c8"),
    ("protected-issuer-state/ProtectedIssuerState.cs", "f9daf6bdc0a641f1527b07efadfd8f9f36cb3047e8e22b574a00fac60435cc82"),
    ("native-consent-aot-j/OwnerConsentCore.cs", "684dd5d8efdc9a90c6d00e1ee6adb7a04bdf3563d716fa9e2dc76c8fab28d663"),
    ("native-consent-aot-j/WindowsGuard.cs", "30d773de2fde0a50f5519961f0d19ebbeb59bf6f6346f7d3bc9301f4f79ec0b5"),
    ("native-consent-aot-j/SystemDllPolicy.cs", "916e611fd3dfbd23614e774b134f0a5f90fcbecbdc385e53b15d03e32a6d2347"),
)
MAX_SOURCE_BYTES = 1024 * 1024
MAX_METADATA_BYTES = 2 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def parse_json(data):
    return json.loads(data.decode("utf-8-sig"), object_pairs_hook=unique_object)


def relative_path(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("UNSAFE_RELATIVE_PATH")
    parts = value.split("/")
    if any(p in ("", ".", "..") or ":" in p or p.endswith((" ", ".")) for p in parts):
        raise ValueError("UNSAFE_RELATIVE_PATH")
    if PurePosixPath(value).is_absolute() or any(re.match(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", p, re.I) for p in parts):
        raise ValueError("UNSAFE_RELATIVE_PATH")
    return parts


def no_links(path):
    """Reject symbolic links and all Windows reparse points in existing ancestors."""
    for part in reversed((path, *path.parents)):
        try:
            info = part.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError("LINK_OR_REPARSE_POINT")


def absolute_path(value):
    path = Path(value)
    if not path.is_absolute() or ".." in path.parts:
        raise ValueError("EXPLICIT_ABSOLUTE_PATH_REQUIRED")
    no_links(path)
    return path


def regular_read(path, max_bytes):
    no_links(path)
    if not path.is_file() or path.stat().st_size > max_bytes:
        raise ValueError("INPUT_TYPE_OR_SIZE")
    with path.open("rb") as handle:
        data = handle.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError("INPUT_SIZE")
    return data


def exclusive_write(path, data):
    no_links(path)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags, 0o600)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        # Preserve partial evidence; never delete or overwrite an uncertain output.
        raise


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def durable_receipt_write(handle, value):
    data = json_bytes(value)
    handle.seek(0)
    remaining = memoryview(data)
    while remaining:
        count = handle.write(remaining)
        if count is None or count <= 0:
            raise OSError("RECEIPT_SHORT_WRITE")
        remaining = remaining[count:]
    handle.truncate()
    os.fsync(handle.fileno())


def validate_manifest(manifest):
    expected = {RELATIVE_PREFIX + suffix: sha for suffix, sha in DEPENDENCIES}
    if (manifest.get("schema") != "r79-frozen-source-input-manifest-v1"
            or manifest.get("r78SourceCommit") not in (COMMIT, COMMIT[:7])
            or manifest.get("r78ReturnSha256") != ARCHIVE_SHA256
            or manifest.get("buildTimeRootProperty") != "FrozenR78SourceRoot"):
        raise ValueError("MANIFEST_AUTHORITY_MISMATCH")
    rows = manifest.get("dependencies")
    if not isinstance(rows, list) or len(rows) != 6:
        raise ValueError("EXACT_SIX_DEPENDENCIES_REQUIRED")
    found = {}
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"path", "sha256"}:
            raise ValueError("DEPENDENCY_SCHEMA_MISMATCH")
        relative_path(row["path"])
        if row["path"] in found:
            raise ValueError("DUPLICATE_DEPENDENCY")
        found[row["path"]] = row["sha256"]
    if found != expected:
        raise ValueError("DEPENDENCY_BINDING_MISMATCH")


def collect_sources(archive):
    """Hash the same open archive handle used for reads; no ZIP bulk extraction."""
    no_links(archive)
    with archive.open("rb") as handle:
        before = os.fstat(handle.fileno())
        if before.st_size > 32 * 1024 * 1024:
            raise ValueError("ARCHIVE_SIZE_BOUND")
        sha = hashlib.sha256()
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            sha.update(chunk)
        if sha.hexdigest() != ARCHIVE_SHA256:
            raise ValueError("ARCHIVE_SHA256_MISMATCH")
        handle.seek(0)
        with zipfile.ZipFile(handle) as zf:
            infos = {}
            for info in zf.infolist():
                # Directories are checked without their terminal slash.
                relative_path(info.filename.rstrip("/"))
                key = info.filename.casefold()
                if key in infos:
                    raise ValueError("DUPLICATE_ZIP_MEMBER")
                infos[key] = info
            def read_member(name, limit):
                info = infos.get(name.casefold())
                if info is None or info.filename != name or info.is_dir():
                    raise ValueError("EXACT_ARCHIVE_MEMBER_MISSING")
                mode = info.external_attr >> 16
                if stat.S_ISLNK(mode) or info.external_attr & 0x400 or info.flag_bits & 1:
                    raise ValueError("UNSAFE_ARCHIVE_MEMBER")
                if info.file_size > limit or info.compress_size > limit:
                    raise ValueError("ARCHIVE_MEMBER_SIZE_BOUND")
                with zf.open(info) as source:
                    data = source.read(limit + 1)
                if len(data) != info.file_size or len(data) > limit:
                    raise ValueError("ARCHIVE_MEMBER_SIZE_MISMATCH")
                return data
            map_bytes = read_member("PATH_RECOVERY_MAP.json", MAX_METADATA_BYTES)
            if digest(map_bytes) != MAP_SHA256:
                raise ValueError("RECOVERY_MAP_SHA256_MISMATCH")
            recovery = parse_json(map_bytes)
            if recovery.get("schema") != 1 or recovery.get("revision") != "R78":
                raise ValueError("RECOVERY_MAP_SCHEMA_MISMATCH")
            rows = recovery.get("files")
            if not isinstance(rows, list):
                raise ValueError("RECOVERY_MAP_FILES_REQUIRED")
            sources = []
            for suffix, pinned_sha in DEPENDENCIES:
                relative = RELATIVE_PREFIX + suffix
                archived = "source/supplement/local-owner/" + suffix
                matches = [row for row in rows if isinstance(row, dict)
                           and str(row.get("originalPath", "")).replace("\\", "/") == HISTORIC_ROOT + relative]
                if len(matches) != 1 or matches[0].get("archivePath") != archived or matches[0].get("sha256") != pinned_sha:
                    raise ValueError("RECOVERY_MAPPING_MISMATCH")
                data = read_member(archived, MAX_SOURCE_BYTES)
                if digest(data) != pinned_sha:
                    raise ValueError("SOURCE_SHA256_MISMATCH")
                sources.append((relative, archived, pinned_sha, data))
        after = os.fstat(handle.fileno())
        if (before.st_ino, before.st_dev, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_dev, after.st_size, after.st_mtime_ns):
            raise ValueError("ARCHIVE_CHANGED_DURING_READ")
    return sources


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--source-manifest", required=True)
    parser.add_argument("--target", required=True, help="Fresh absent absolute source root; never an installed or existing folder")
    parser.add_argument("--receipt", required=True, help="Fresh absolute receipt outside target, with existing parent")
    args = parser.parse_args()
    receipt_path = None
    receipt_handle = None
    state = {"schema": "r79-six-source-reconstruction-v1", "revision": "R79", "status": "STARTED",
             "startedUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
             "execution": False, "build": False, "installation": False, "deletion": False,
             "acceptanceScope": "Frozen source reconstruction only; runtime and installed product unchanged", "files": []}
    try:
        archive = absolute_path(args.archive)
        manifest_path = absolute_path(args.source_manifest)
        target = absolute_path(args.target)
        receipt_path = absolute_path(args.receipt)
        if receipt_path == target or target in receipt_path.parents:
            raise ValueError("RECEIPT_MUST_BE_OUTSIDE_TARGET")
        if not receipt_path.parent.is_dir() or not target.parent.is_dir():
            raise ValueError("EXISTING_SAFE_PARENT_REQUIRED")
        if os.path.lexists(target):
            raise ValueError("TARGET_ALREADY_EXISTS_NO_REPLAY")
        if receipt_path in (archive, manifest_path):
            raise ValueError("RECEIPT_INPUT_COLLISION")
        # Exclusive receipt is a consumed-operation witness before any extraction.
        receipt_handle = open(receipt_path, "xb", buffering=0)
        state.update({"archive": str(archive), "sourceManifest": str(manifest_path), "target": str(target),
                      "owner": "Commander R79 portable-source", "helperSha256": digest(Path(__file__).read_bytes())})
        def persist():
            durable_receipt_write(receipt_handle, state)
        persist()
        manifest_bytes = regular_read(manifest_path, MAX_METADATA_BYTES)
        validate_manifest(parse_json(manifest_bytes))
        sources = collect_sources(archive)
        state.update({"phase": "ADMITTED_PRE_MUTATION", "archiveSha256": ARCHIVE_SHA256,
                      "sourceManifestSha256": digest(manifest_bytes), "recoveryMapSha256": MAP_SHA256,
                      "sourceCommit": COMMIT, "admittedCount": len(sources)})
        persist()
        no_links(target)
        target.mkdir(mode=0o700)  # no exist_ok: competing/consumed runs fail closed
        marker = {"schema": "r79-owned-source-target-v1", "owner": state["owner"], "revision": "R79",
                  "target": str(target), "helper": str(Path(__file__).absolute()), "helperSha256": state["helperSha256"],
                  "receipt": str(receipt_path), "archiveSha256": ARCHIVE_SHA256, "noExecution": True}
        exclusive_write(target / "RECONSTRUCTION_OWNER.json", json_bytes(marker))
        state["phase"] = "WRITING_EXACT_SIX_SOURCES"
        persist()
        for relative, archived, pinned_sha, data in sources:
            destination = target.joinpath(*relative_path(relative))
            parent = target
            for part in relative_path(relative)[:-1]:
                parent = parent / part
                no_links(parent)
                if not parent.exists():
                    parent.mkdir(mode=0o700)
                if not parent.is_dir():
                    raise ValueError("DESTINATION_PARENT_NOT_DIRECTORY")
            exclusive_write(destination, data)
            if digest(regular_read(destination, MAX_SOURCE_BYTES)) != pinned_sha:
                raise ValueError("POST_WRITE_SOURCE_HASH_MISMATCH")
            state["files"].append({"path": relative, "archivePath": archived, "sha256": pinned_sha,
                                   "bytes": len(data), "targetPath": str(destination), "verified": True})
            persist()
        actual_sources = sorted(str(p.relative_to(target)).replace("\\", "/") for p in target.rglob("*.cs"))
        if actual_sources != sorted(row["path"] for row in state["files"]):
            raise ValueError("OUTPUT_SOURCE_SET_MISMATCH")
        no_links(target)
        state.update({"status": "PASS_SOURCE_RECONSTRUCTION_ONLY", "phase": "COMPLETE", "verifiedCount": 6,
                      "finishedUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      "baselineChanged": False, "installedVersionChanged": False,
                      "buildTimeRootProperty": "FrozenR78SourceRoot", "buildTimeRootValue": str(target)})
        persist()
        print(json.dumps({"status": state["status"], "verifiedCount": 6, "receipt": str(receipt_path)}))
        return 0
    except BaseException as error:
        if receipt_handle is not None:
            state.update({"status": "FAIL_STOP_NO_RETRY", "failureType": type(error).__name__,
                          "error": str(error), "failedUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                          "rollback": "No deletion; preserve receipt and any owned partial target for review"})
            try:
                durable_receipt_write(receipt_handle, state)
            except BaseException:
                print("RECEIPT_PERSISTENCE_UNCERTAIN", file=sys.stderr)
        print(json.dumps({"status": "FAIL_STOP_NO_RETRY", "type": type(error).__name__, "error": str(error)}), file=sys.stderr)
        return 1
    finally:
        if receipt_handle is not None:
            receipt_handle.close()


if __name__ == "__main__":
    sys.exit(main())
