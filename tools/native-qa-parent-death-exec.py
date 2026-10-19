#!/usr/bin/env python3
"""Linux QA-only parent-death guarded exec for native GUI subprocesses.

No shell, no user credentials, no privilege escalation, no desktop selection.
The caller supplies a trusted absolute executable and exact expected parent
PID. The Linux kernel sends SIGTERM when the launching Node worker dies.
Never use this to claim power-loss recovery, descendant-tree supervision,
cross-user isolation, or verified native effect outcomes.
"""
import ctypes
import os
from pathlib import Path
import signal
import sys

PR_SET_PDEATHSIG = 1


def main() -> int:
    if not sys.platform.startswith("linux") or len(sys.argv) < 4:
        return 64
    binary = sys.argv[1]
    if not Path(binary).is_absolute() or not os.access(binary, os.X_OK):
        return 65
    try:
        owner = int(sys.argv[2])
    except ValueError:
        return 66
    if owner < 2 or os.getppid() != owner:
        return 67
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_PDEATHSIG, signal.SIGTERM, 0, 0, 0) != 0:
        return 68
    # Parent might have exited between getppid and prctl. Fail before exec.
    if os.getppid() != owner:
        return 69
    os.execv(binary, [binary, *sys.argv[3:]])
    return 70


if __name__ == "__main__":
    raise SystemExit(main())
