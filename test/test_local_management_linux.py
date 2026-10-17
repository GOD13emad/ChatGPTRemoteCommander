import importlib.util
import json
import os
from pathlib import Path
import socket
import stat
import tempfile
import time
import unittest

spec=importlib.util.spec_from_file_location('rc_transport',Path(__file__).resolve().parents[1]/'tools/local-management-linux.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class NativeTransportTests(unittest.TestCase):
    def test_real_socketpair_reports_kernel_current_pid_uid(self):
        a,b=socket.socketpair()
        try:
            peer=m.peer_credentials(a)
            self.assertEqual(peer[:2],(os.getpid(),os.getuid()))
            self.assertEqual(m.authorize_peer(peer,os.getuid(),os.getpid()),peer)
        finally:a.close();b.close()
    def test_foreign_uid_fixture_rejected_not_a_second_os_user_experiment(self):
        with self.assertRaises(m.ManagementError):m.authorize_peer((123,os.getuid()+1,os.getgid()),os.getuid())
    def test_wrong_pid_fixture_rejected(self):
        with self.assertRaises(m.ManagementError):m.authorize_peer((123,os.getuid(),os.getgid()),os.getuid(),124)
    def test_private_root_accepted_without_mode_change(self):
        with tempfile.TemporaryDirectory(prefix='rcm-unit-') as d:
            fd=m.open_private_directory(d,os.getuid());os.close(fd)
            self.assertEqual(stat.S_IMODE(os.stat(d).st_mode),0o700)
    def test_root_symlink_refusal_does_not_chmod_target(self):
        with tempfile.TemporaryDirectory(prefix='rcm-unit-') as d:
            target=Path(d)/'target';target.mkdir(mode=0o755);target.chmod(0o755)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode),0o755)
            alias=Path(d)/'alias';alias.symlink_to(target)
            with self.assertRaises((m.ManagementError,OSError)):m.open_private_directory(str(alias),os.getuid())
            self.assertEqual(stat.S_IMODE(target.stat().st_mode),0o755)
    def test_ancestor_symlink_refused(self):
        with tempfile.TemporaryDirectory(prefix='rcm-unit-') as d:
            target=Path(d)/'target';target.mkdir();(target/'private').mkdir(mode=0o700)
            alias=Path(d)/'alias';alias.symlink_to(target)
            with self.assertRaises((m.ManagementError,OSError)):m.open_private_directory(str(alias/'private'),os.getuid())
    def test_permissive_root_refused_without_repair(self):
        with tempfile.TemporaryDirectory(prefix='rcm-unit-') as d:
            os.chmod(d,0o755)
            with self.assertRaises(m.ManagementError):m.open_private_directory(d,os.getuid())
            self.assertEqual(stat.S_IMODE(os.stat(d).st_mode),0o755)
    def test_duplicate_json_and_nonfinite_refused(self):
        for value in ['{"x":1,"x":2}', '{"x":NaN}', '{"x":Infinity}']:
            with self.subTest(value=value),self.assertRaises(m.ManagementError):m.strict_json(value)
    def test_strict_integer_rejects_bool(self):
        self.assertFalse(m.integer(True));self.assertFalse(m.integer('2'));self.assertTrue(m.integer(0))
    def test_line_limit_and_partial_eof(self):
        for raw in [b'x'*33+b'\n',b'partial']:
            a,b=os.pipe()
            try:
                os.write(b,raw);os.close(b);b=None
                with self.assertRaises(m.ManagementError):m.LineReader(a,32).line(time.monotonic()+1)
            finally:
                os.close(a)
                if b is not None:os.close(b)
    def test_line_framing_retains_next_frame(self):
        a,b=os.pipe()
        try:
            os.write(b,b'one\ntwo\n');reader=m.LineReader(a,32)
            self.assertEqual(reader.line(time.monotonic()+1),'one');self.assertEqual(reader.line(time.monotonic()+1),'two')
        finally:os.close(a);os.close(b)
    def test_untrusted_target_types_refused(self):
        t=dict(deviceId='fixture',profileId='default',configSha256='1'*64,routeGeneration=1)
        self.assertEqual(m.target_record(t),t)
        t['routeGeneration']=True
        with self.assertRaises(m.ManagementError):m.target_record(t)

    def test_buffered_parent_revocation_precedes_buffered_client_request(self):
        a,b=os.pipe();c,d=os.pipe()
        try:
            parent=m.LineReader(a,1024)
            parent.buffer.extend(b'{"type":"close"}\n')
            client=m.LineReader(c,1024,control=parent)
            client.buffer.extend(b'queued-client-request\n')
            with self.assertRaisesRegex(m.ManagementError,'MANAGEMENT_SESSION_REVOKED'):
                client.line(time.monotonic()+0.1)
        finally:
            for fd in (a,b,c,d):os.close(fd)

if __name__=='__main__':unittest.main(verbosity=2)
