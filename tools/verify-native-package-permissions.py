#!/usr/bin/env python3
"""Read-only inspection of ALL installed DEB tar entry modes.

No extraction, privileged install, archive modification, or trusted-root
grant. A package that would install writable root-owned payloads is denied.
"""
import json
import pathlib
import subprocess
import sys
import tarfile


def main():
    if len(sys.argv) != 2:
        raise SystemExit("RC012_PACKAGE_PERMISSIONS_ARGS_INVALID")
    file = pathlib.Path(sys.argv[1])
    if not file.is_file() or file.is_symlink() or file.stat().st_size < 4096:
        raise SystemExit("RC012_PACKAGE_PERMISSIONS_ARCHIVE_INVALID")
    proc = subprocess.Popen(
        ["dpkg-deb", "--fsys-tarfile", str(file)],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    unsafe = []
    total = 0
    seen = set()
    try:
        with tarfile.open(fileobj=proc.stdout, mode="r|") as archive:
            for entry in archive:
                if entry.name in seen:
                    unsafe.append((entry.name, "DUPLICATE"))
                seen.add(entry.name)
                if entry.name in (".", "./"):
                    continue
                if not entry.name.startswith("./") or ".." in pathlib.PurePosixPath(entry.name).parts:
                    unsafe.append((entry.name, "TRAVERSAL"))
                if entry.isfile() or entry.isdir():
                    total += 1
                    if entry.mode & 0o022:
                        unsafe.append((entry.name, "GROUP_OR_WORLD_WRITABLE"))
                if len(unsafe) > 10:
                    break
    finally:
        if unsafe:
            proc.kill()
        status = proc.wait()
    if unsafe or status != 0 or total < 100:
        print(
            json.dumps({
                "code": "RC012_PACKAGE_WRITABLE_OR_UNTRUSTED_CONTENT",
                "filesOrDirsChecked": total,
                "samples": unsafe[:5],
                "archiveProcessed": status == 0,
            }),
            file=sys.stderr,
        )
        raise SystemExit(4)
    print(
        json.dumps({
            "result": "RC012_PACKAGE_CONTENT_PERMISSIONS_PASS",
            "filesAndDirectoriesChecked": total,
            "groupOrWorldWritableEntries": 0,
            "installed": False,
        })
    )


if __name__ == "__main__":
    main()
