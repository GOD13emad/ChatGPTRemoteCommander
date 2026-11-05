#!/usr/bin/env python3
"""QA-only Linux OS-peer identity gate, using kernel SO_PEERCRED.

One connection and one read-only acknowledgement. Never forwards V1 tools,
reads credentials, launches a privileged broker or writes installed services.
This is a native gate probe, NOT a ChatGPT user / OAuth authentication server.
"""
import json
import os
import socket
import stat
import struct
import sys


def fail(code):
    raise RuntimeError("CMDV2_OWNER_PEER_" + code)


def validate(path):
    if sys.platform != "linux" or os.geteuid() == 0:
        fail("UNPRIVILEGED_LINUX_REQUIRED")
    if not os.path.isabs(path) or len(os.fsencode(path)) > 104:
        fail("ABSOLUTE_SHORT_SOCKET_PATH_REQUIRED")
    parent = os.path.dirname(path)
    st = os.lstat(parent)
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.geteuid() or (st.st_mode & 0o077):
        fail("PRIVATE_OWNER_DIRECTORY_REQUIRED")
    if os.path.lexists(path):
        fail("EXISTING_SOCKET_REFUSED")


def serve(path):
    validate(path)
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        server.bind(path)
        os.chmod(path, 0o600)
        st = os.lstat(path)
        if not stat.S_ISSOCK(st.st_mode) or st.st_uid != os.geteuid() or (st.st_mode & 0o077):
            fail("SOCKET_OWNER_MODE_INVALID")
        server.listen(1)
        server.settimeout(5)
        print(json.dumps({"gate": "CMDV2_OWNER_PEER_QA_LISTENING", "ready": True}), flush=True)
        connection, _ = server.accept()
        with connection:
            connection.settimeout(3)
            credential_bytes = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED,
                                                     struct.calcsize("3i"))
            pid, uid, gid = struct.unpack("3i", credential_bytes)
            verified = pid > 0 and uid == os.geteuid() and gid >= 0
            # A matched Unix UID does not identify a ChatGPT account or grant any tool use.
            output = {"kernelPeerVerified": verified, "ownerUidMatch": verified,
                      "mcpToolAuthorized": False, "osAdminGranted": False,
                      "accountAuthenticated": False, "readOnly": True}
            connection.sendall((json.dumps(output) + "\n").encode("utf-8"))
            print(json.dumps({"gate": "CMDV2_OWNER_PEER_QA_PASS" if verified else
                              "CMDV2_OWNER_PEER_QA_DENIED", **output}), flush=True)
            if not verified:
                return 3
        return 0
    finally:
        server.close()
        # Only unlink the socket this one-shot probe created inside private QA root.
        if os.path.lexists(path):
            st = os.lstat(path)
            if stat.S_ISSOCK(st.st_mode) and st.st_uid == os.geteuid():
                os.unlink(path)


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3 or sys.argv[1] != "--socket":
            fail("USAGE")
        sys.exit(serve(sys.argv[2]))
    except Exception as exc:
        code = str(exc) if str(exc).startswith("CMDV2_OWNER_PEER_") else "CMDV2_OWNER_PEER_QA_ERROR"
        print(json.dumps({"gate": code, "ready": False}), file=sys.stderr, flush=True)
        sys.exit(2)
