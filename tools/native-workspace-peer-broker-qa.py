#!/usr/bin/env python3
"""Linux AF_UNIX / SO_PEERCRED transport prototype for PRIVATE QA ONLY.

No application GUI, keyboard, cursor, native-input command, signing key,
ChatGPT user/chat identity, or owner consent is exposed by this module.

SO_PEERCRED supplies kernel-level pid/uid/gid, not authenticated conversation
identity. User-local owner permissions and same-UID processes are NOT a
protected principal boundary. A protected system broker would require a
separately provisioned OS identity and authenticated approval pipeline.

This module has no command-line entrypoint, no service registration and no
automatic startup. An explicit test harness must instantiate the broker.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import stat
import struct
import sys
import threading
from typing import Callable, NamedTuple

SCHEMA = 1
MAX_REQUEST_BYTES = 4096
MAX_RESPONSE_BYTES = 512
SOCKET_BASENAME = "rc-native-workspace-qa.sock"
MAX_SOCKET_PATH = 100


class BrokerUnavailable(RuntimeError):
    """Fail closed; never grant native input based on a transport failure."""


class PeerCredentials(NamedTuple):
    pid: int
    uid: int
    gid: int


def _json_unique_pairs(items: list[tuple[str, object]]) -> dict:
    value: dict[str, object] = {}
    for key, member in items:
        if key in value:
            raise ValueError("duplicate JSON member")
        value[key] = member
    return value


def _trusted_directory(root: Path) -> None:
    if not root.is_absolute():
        raise BrokerUnavailable("BROKER_ROOT_MUST_BE_ABSOLUTE")
    try:
        entry = root.lstat()
        canonical = root.resolve(strict=True)
    except OSError as exc:
        raise BrokerUnavailable("BROKER_ROOT_UNAVAILABLE") from exc
    if (
        not stat.S_ISDIR(entry.st_mode)
        or stat.S_ISLNK(entry.st_mode)
        or entry.st_uid != os.getuid()
        or (entry.st_mode & 0o077) != 0
        or canonical != root
    ):
        raise BrokerUnavailable("BROKER_ROOT_UNTRUSTED")


def _packet(raw: bytes) -> dict:
    if not raw or len(raw) > MAX_REQUEST_BYTES or not raw.endswith(b"\n"):
        raise ValueError("invalid bounded framing")
    if b"\n" in raw[:-1] or b"\x00" in raw:
        raise ValueError("extra framing or null bytes")
    data = json.loads(raw[:-1].decode("utf-8"), object_pairs_hook=_json_unique_pairs)
    if not isinstance(data, dict):
        raise ValueError("not an object")
    if set(data) != {"schema", "operation"}:
        raise ValueError("unexpected fields")
    if type(data["schema"]) is not int or data["schema"] != SCHEMA:
        raise ValueError("invalid schema")
    if data["operation"] != "peer_status":
        raise ValueError("unsupported operation")
    return data


def _read_bounded(sock: socket.socket) -> bytes:
    data = bytearray()
    while len(data) <= MAX_REQUEST_BYTES:
        packet = sock.recv(min(1024, MAX_REQUEST_BYTES + 1 - len(data)))
        if not packet:
            break
        data.extend(packet)
        if b"\n" in packet:
            break
    if len(data) > MAX_REQUEST_BYTES:
        raise ValueError("request too large")
    return bytes(data)


def _peercred(conn: socket.socket) -> PeerCredentials:
    if not sys.platform.startswith("linux") or not hasattr(socket, "SO_PEERCRED"):
        raise BrokerUnavailable("BROKER_PEER_CREDENTIALS_UNAVAILABLE")
    size = struct.calcsize("3i")
    packed = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, size)
    pid, uid, gid = struct.unpack("3i", packed)
    if pid < 1 or uid < 0 or gid < 0:
        raise BrokerUnavailable("BROKER_INVALID_KERNEL_PEER_CREDENTIALS")
    return PeerCredentials(pid, uid, gid)


def _reply(status: str) -> bytes:
    # No OS credentials, identities, tokens, consent, screenshots or secrets.
    message = {
        "schema": SCHEMA,
        "status": status,
        "nativeInputAuthorized": False,
        "trustedConversationIdentity": False,
        "ownerConsentVerified": False,
    }
    encoded = (json.dumps(message, separators=(",", ":")) + "\n").encode()
    assert len(encoded) <= MAX_RESPONSE_BYTES
    return encoded


class NativeWorkspacePeerBrokerQA:
    """Explicit opt-in, bounded transport probe; control is never implemented."""

    def __init__(
        self,
        root: Path,
        *,
        authorize_peer: Callable[[PeerCredentials], bool] | None = None,
        peer_observer: Callable[[PeerCredentials], None] | None = None,
    ):
        self.root = Path(root)
        self.path = self.root / SOCKET_BASENAME
        self.authorize_peer = authorize_peer or (lambda _peer: False)
        self.peer_observer = peer_observer
        self._socket: socket.socket | None = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._socket_identity: tuple[int, int] | None = None

    def start(self) -> "NativeWorkspacePeerBrokerQA":
        if self._socket is not None:
            raise BrokerUnavailable("BROKER_ALREADY_STARTED")
        _trusted_directory(self.root)
        if len(os.fsencode(self.path)) > MAX_SOCKET_PATH:
            raise BrokerUnavailable("BROKER_SOCKET_PATH_TOO_LONG")
        # No rename/unlink of a potentially live or unknown socket.
        if os.path.lexists(self.path):
            raise BrokerUnavailable("BROKER_SOCKET_PATH_ALREADY_EXISTS")
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            srv.bind(os.fspath(self.path))
            os.chmod(self.path, 0o600)
            entry = self.path.lstat()
            if (
                not stat.S_ISSOCK(entry.st_mode)
                or entry.st_uid != os.getuid()
                or entry.st_mode & 0o077
            ):
                raise BrokerUnavailable("BROKER_SOCKET_UNTRUSTED")
            self._socket_identity = (entry.st_dev, entry.st_ino)
            srv.listen(8)
            srv.settimeout(0.15)
            self._socket = srv
            self._thread = threading.Thread(
                target=self._accept_loop, name="rc-peercred-qa", daemon=True
            )
            self._thread.start()
            return self
        except Exception:
            srv.close()
            self._safe_unlink_own_socket()
            raise

    def _safe_unlink_own_socket(self) -> None:
        # Do not unlink any path that was replaced by a foreign writer.
        if self._socket_identity is None:
            return
        try:
            current = self.path.lstat()
            if (
                stat.S_ISSOCK(current.st_mode)
                and (current.st_dev, current.st_ino) == self._socket_identity
            ):
                self.path.unlink()
        except FileNotFoundError:
            pass

    def _handle(self, conn: socket.socket) -> None:
        with conn:
            conn.settimeout(1.5)
            try:
                peer = _peercred(conn)
                if self.peer_observer:
                    self.peer_observer(peer)
                request = _packet(_read_bounded(conn))
                # A matching UID/PID is not itself owner consent.
                allowed = self.authorize_peer(peer) is True
                result = "TRANSPORT_ONLY" if allowed else "PEER_NOT_AUTHORIZED"
                assert request["operation"] == "peer_status"
            except (OSError, ValueError, UnicodeError, BrokerUnavailable):
                result = "MALFORMED_OR_UNAVAILABLE"
            except Exception:
                # A policy fault is a denial, never an authorization fallback.
                result = "PEER_NOT_AUTHORIZED"
            try:
                conn.sendall(_reply(result))
            except OSError:
                pass

    def _accept_loop(self) -> None:
        server = self._socket
        if server is None:
            return
        while not self._stop.is_set():
            try:
                conn, _addr = server.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            self._handle(conn)

    def close(self) -> None:
        self._stop.set()
        if self._socket:
            self._socket.close()
        if self._thread:
            self._thread.join(timeout=2.5)
            if self._thread.is_alive():
                raise BrokerUnavailable("BROKER_OWNED_WORKER_NOT_STOPPED")
        self._safe_unlink_own_socket()
        self._socket = None
        self._thread = None

    def __enter__(self) -> "NativeWorkspacePeerBrokerQA":
        return self.start()

    def __exit__(self, *_exc_info: object) -> None:
        self.close()
