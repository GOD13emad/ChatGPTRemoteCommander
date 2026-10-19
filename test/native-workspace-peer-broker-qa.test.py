"""Actual Linux AF_UNIX peer credential negative tests; no desktop or Core input."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import unittest

SOURCE = Path(__file__).resolve().parent.parent / "tools/native-workspace-peer-broker-qa.py"
spec = importlib.util.spec_from_file_location("rc_native_peer_broker_qa", SOURCE)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

REQUEST = json.dumps({"schema": 1, "operation": "peer_status"}).encode() + b"\n"


def exchange(address: Path, payload: bytes = REQUEST) -> dict:
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        conn.settimeout(3)
        conn.connect(str(address))
        conn.sendall(payload)
        data = bytearray()
        while not data.endswith(b"\n") and len(data) < 1024:
            chunk = conn.recv(512)
            if not chunk:
                break
            data.extend(chunk)
    result = json.loads(data)
    assert result["nativeInputAuthorized"] is False
    assert result["trustedConversationIdentity"] is False
    assert result["ownerConsentVerified"] is False
    return result


@unittest.skipUnless(sys.platform.startswith("linux"), "Linux SO_PEERCRED only")
class LinuxPeerCredentialBrokerQATests(unittest.TestCase):
    def setUp(self) -> None:
        self.scratch = tempfile.TemporaryDirectory(prefix="rc-peerbroker-qa-")
        self.root = Path(self.scratch.name)

    def tearDown(self) -> None:
        self.scratch.cleanup()

    def test_default_deny_even_for_matching_local_uid(self) -> None:
        with mod.NativeWorkspacePeerBrokerQA(self.root) as broker:
            first = exchange(broker.path)
            self.assertEqual(first["status"], "PEER_NOT_AUTHORIZED")
            self.assertEqual(os.stat(broker.path).st_mode & 0o777, 0o600)
        self.assertFalse(broker.path.exists())
        self.assertFalse(broker.path.is_symlink())

    def test_kernel_peer_credentials_match_actual_subprocess_not_body(self) -> None:
        observed = []
        started = threading.Event()

        def observe(peer: mod.PeerCredentials) -> None:
            observed.append(peer)
            started.set()

        with mod.NativeWorkspacePeerBrokerQA(
            self.root,
            authorize_peer=lambda peer: peer.uid == os.getuid()
            and peer.gid == os.getgid(),
            peer_observer=observe,
        ) as broker:
            code = (
                "import json,socket,sys;"
                "s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);"
                "s.settimeout(2);s.connect(sys.argv[1]);"
                "s.sendall(b'{\\\"schema\\\":1,\\\"operation\\\":\\\"peer_status\\\"}\\n');"
                "sys.stdout.write(str(__import__('os').getpid())+'\\n');"
                "sys.stdout.write(s.recv(1024).decode());s.close()"
            )
            process = subprocess.run(
                [sys.executable, "-c", code, str(broker.path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                encoding="utf-8",
                timeout=5,
                check=True,
            )
            self.assertTrue(started.wait(1))
            self.assertEqual(len(observed), 1)
            # subprocess.run has no pid on CompletedProcess; a fresh
            # subprocess prints its process id in a second machine-readable
            # field so we can establish the real kernel PID independently.
            self.assertEqual(observed[0].uid, os.getuid())
            self.assertEqual(observed[0].gid, os.getgid())
            self.assertGreater(observed[0].pid, 1)
            child_pid, child_response = process.stdout.split("\n", 1)
            self.assertEqual(observed[0].pid, int(child_pid),
                             "Linux kernel peer PID must match the real child process")
            reply = json.loads(child_response)
            self.assertEqual(reply["status"], "TRANSPORT_ONLY")
            self.assertFalse(reply["nativeInputAuthorized"])

    def test_peer_body_uid_claims_and_native_commands_never_grant(self) -> None:
        with mod.NativeWorkspacePeerBrokerQA(
            self.root, authorize_peer=lambda _peer: True
        ) as broker:
            for value in (
                {"schema": 1, "operation": "control"},
                {"schema": 1, "operation": "observe_cached"},
                {"schema": 1, "operation": "peer_status", "claimedUid": 0},
                {"schema": 1, "operation": "click", "x": 100},
                {"schema": True, "operation": "peer_status"},
            ):
                result = exchange(broker.path, json.dumps(value).encode() + b"\n")
                self.assertEqual(result["status"], "MALFORMED_OR_UNAVAILABLE")
            self.assertEqual(exchange(broker.path)["status"], "TRANSPORT_ONLY")

    def test_duplicate_keys_bad_frames_and_oversized_requests_are_denied(self) -> None:
        with mod.NativeWorkspacePeerBrokerQA(
            self.root, authorize_peer=lambda _peer: True
        ) as broker:
            bad = (
                b'{"schema":1,"schema":1,"operation":"peer_status"}\n',
                b'{"schema":1,"operation":"peer_status"}\n{"schema":1}\n',
                b'{"schema":1,"operation":"peer_status"',
                b"A" * (mod.MAX_REQUEST_BYTES + 10) + b"\n",
                b'{"schema":1,"operation":"peer_status","foo":null}\n',
            )
            for value in bad:
                self.assertEqual(
                    exchange(broker.path, value)["status"],
                    "MALFORMED_OR_UNAVAILABLE",
                )
            self.assertEqual(exchange(broker.path)["status"], "TRANSPORT_ONLY")

    def test_authorizer_failure_never_allows_fallback(self) -> None:
        def faulty(_peer):
            raise RuntimeError("synthetic-unavailable")
        with mod.NativeWorkspacePeerBrokerQA(
            self.root, authorize_peer=faulty
        ) as broker:
            self.assertEqual(exchange(broker.path)["status"], "PEER_NOT_AUTHORIZED")

    def test_matching_uid_is_insufficient_for_authenticated_conversation(self) -> None:
        with mod.NativeWorkspacePeerBrokerQA(
            self.root, authorize_peer=lambda p: p.uid == os.getuid()
        ) as broker:
            accepted = exchange(broker.path)
            self.assertEqual(accepted["status"], "TRANSPORT_ONLY")
            self.assertFalse(accepted["trustedConversationIdentity"])
            self.assertFalse(accepted["ownerConsentVerified"])
            self.assertFalse(accepted["nativeInputAuthorized"])

    def test_second_instance_does_not_replace_first_socket(self) -> None:
        with mod.NativeWorkspacePeerBrokerQA(self.root) as first:
            inode = os.lstat(first.path).st_ino
            duplicate = mod.NativeWorkspacePeerBrokerQA(self.root)
            with self.assertRaisesRegex(mod.BrokerUnavailable, "PATH_ALREADY_EXISTS"):
                duplicate.start()
            self.assertEqual(os.lstat(first.path).st_ino, inode)
            self.assertEqual(exchange(first.path)["status"], "PEER_NOT_AUTHORIZED")

    def test_untrusted_permissions_and_symlink_root_fail_closed(self) -> None:
        os.chmod(self.root, 0o777)
        with self.assertRaisesRegex(mod.BrokerUnavailable, "ROOT_UNTRUSTED"):
            mod.NativeWorkspacePeerBrokerQA(self.root).start()
        os.chmod(self.root, 0o700)
        alias = self.root / "alias"
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(mod.BrokerUnavailable, "ROOT_UNTRUSTED"):
            mod.NativeWorkspacePeerBrokerQA(alias).start()

    def test_close_never_unlinks_replaced_socket_path(self) -> None:
        broker = mod.NativeWorkspacePeerBrokerQA(self.root).start()
        sock = broker.path
        sock.unlink()
        sock.write_text("qa-replacement", encoding="utf-8")
        broker.close()
        self.assertEqual(sock.read_text(), "qa-replacement")

    def test_healthy_peer_can_connect_after_malformed_client(self) -> None:
        with mod.NativeWorkspacePeerBrokerQA(
            self.root, authorize_peer=lambda _peer: True
        ) as broker:
            self.assertEqual(
                exchange(broker.path, b"not-json\n")["status"],
                "MALFORMED_OR_UNAVAILABLE",
            )
            self.assertEqual(exchange(broker.path)["status"], "TRANSPORT_ONLY")


    def test_abrupt_broker_exit_does_not_silently_reclaim_old_socket(self) -> None:
        # A kernel/socket crash is an UNKNOWN effect, never reason to
        # overwrite an existing endpoint or join another owner's session.
        code = (
            "import importlib.util,os,sys;"
            "from pathlib import Path;"
            "spec=importlib.util.spec_from_file_location('rc_peercrash_qa',sys.argv[1]);"
            "m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;"
            "spec.loader.exec_module(m);"
            "m.NativeWorkspacePeerBrokerQA(Path(sys.argv[2])).start();"
            "os._exit(79)"
        )
        completed = subprocess.run(
            [sys.executable, "-B", "-c", code, str(SOURCE), str(self.root)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, timeout=6,
        )
        self.assertEqual(completed.returncode, 79, completed.stderr[-200:])
        socket_file = self.root / mod.SOCKET_BASENAME
        self.assertTrue(stat.S_ISSOCK(socket_file.lstat().st_mode))
        with self.assertRaisesRegex(mod.BrokerUnavailable, "PATH_ALREADY_EXISTS"):
            mod.NativeWorkspacePeerBrokerQA(self.root).start()
        # Only the disposable TestCase.TemporaryDirectory cleanup deletes
        # this stale fixture path, never the broker's retry path.

    def test_partial_client_timeout_does_not_block_unrelated_clients(self) -> None:
        import time
        with mod.NativeWorkspacePeerBrokerQA(
            self.root, authorize_peer=lambda _peer: True
        ) as broker:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as slow:
                slow.settimeout(3)
                slow.connect(str(broker.path))
                slow.sendall(b'{"schema":1')
                time.sleep(1.85)
                result = exchange(broker.path)
                self.assertEqual(result["status"], "TRANSPORT_ONLY")
                self.assertFalse(result["nativeInputAuthorized"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
