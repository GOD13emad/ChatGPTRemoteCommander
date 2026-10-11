#!/usr/bin/env python3
"""CI-only cleanup of owned Node routers/backends in a disposable R170 sandbox.

Fails closed on uncertain process identity. No interactive/real host deployment.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import sys
import time

PATTERNS = (b"src/server-v0.3.mjs", b"src/stable-router.mjs")


def matches(root: Path, cwd: str, argv: bytes) -> bool:
    try:
        directory = Path(cwd).resolve(strict=True)
        return directory.is_relative_to(root) and (
            b"node" in argv.split(b"\0")[0].split(b"/")[-1:]
            or Path(argv.split(b"\0")[0].decode(errors="ignore")).name in ("node", "node.exe")
        ) and any(fragment in argv for fragment in PATTERNS)
    except (OSError, ValueError):
        return False


def list_owned(root: Path):
    found = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            if entry.stat().st_uid != os.getuid():
                continue
            cmd = (entry / "cmdline").read_bytes()
            if not cmd:
                continue
            current = os.readlink(entry / "cwd")
            state = (entry / "stat").read_text().split(")", 1)[1].split()[0]
            if state == "Z":
                continue
            if matches(root, current, cmd):
                found.append(int(entry.name))
        except (FileNotFoundError, ProcessLookupError, PermissionError, OSError):
            continue
    return sorted(set(found))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        import tempfile
        with tempfile.TemporaryDirectory(prefix="rc-r172-") as tmp:
            r = Path(tmp).resolve()
            (r / "release").mkdir()
            assert matches(r, str(r / "release"), b"/opt/node/bin/node\0src/server-v0.3.mjs\0")
            assert matches(r, str(r / "release"), b"node\0src/stable-router.mjs\0")
            assert not matches(r, "/home/user/private", b"node\0src/stable-router.mjs\0")
            assert not matches(r, str(r / "release"), b"python3\0src/server-v0.3.mjs\0")
        print("R172_IDENTITY_PURE_TEST_PASS")
        return
    if os.getenv("CI") != "true" or not os.getenv("RUNNER_TEMP") or not os.getenv("GITHUB_WORKSPACE"):
        raise SystemExit("R172_CI_ONLY")
    if not args.root:
        raise SystemExit("R172_ROOT_REQUIRED")
    sandbox = Path(args.root).resolve(strict=True)
    temp = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    if sandbox != temp / "remote-commander-rollback-r170":
        raise SystemExit("R172_SANDBOX_IDENTITY_FAILURE")
    receipt = sandbox / "CLEANUP_R172.json"
    if receipt.exists():
        raise SystemExit("R172_NO_BLIND_REWRITE")
    before = list_owned(sandbox)
    for pid in before:
        if pid in list_owned(sandbox):
            os.kill(pid, signal.SIGTERM)
    for _ in range(30):
        if not list_owned(sandbox):
            break
        time.sleep(0.1)
    remaining = list_owned(sandbox)
    for pid in remaining:
        if pid in list_owned(sandbox):
            os.kill(pid, signal.SIGKILL)
    for _ in range(30):
        if not list_owned(sandbox):
            break
        time.sleep(0.1)
    after = list_owned(sandbox)
    record = {
        "schema": 1, "revision": "R172", "host": "isolated-linux-github-runner",
        "status": "PASS_ZERO_OWNED_NODE_AFTER_ROLLBACK" if not after else "FAIL_OWNED_NODE_REMAIN",
        "ownedBefore": before, "ownedAfter": after, "cleanupUsed": bool(before),
        "externalNodeProcessesTouched": False, "root": str(sandbox)
    }
    with receipt.open("x", encoding="utf-8") as output:
        json.dump(record, output, indent=2)
        output.write("\n")
    print("R172_CLEANUP_STATUS=" + record["status"] + " receiptSha=" + sha(receipt))
    if after:
        raise SystemExit(78)


if __name__ == "__main__":
    main()
