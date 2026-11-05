"""Deterministic fail-closed behavior and real subprocess boundary tests."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from managed_controls import collect, CATEGORIES, UNAVAILABLE, _cli, validate_managed_root


class SnapshotTests(unittest.TestCase):
    def test_untrusted_status_text_and_diagnostic_report_allowlist(self):
        from managed_controls import safe_status_label, safe_diagnostics_report
        for bad in ("bad\\u202eevil", "bad\\u2066evil", "line\\nnew", "x<secret>", ""):
            self.assertIsNone(safe_status_label(bad.replace("\\u202e", "\u202e")
                                                   .replace("\\u2066", "\u2066")
                                                   .replace("\\n", "\n")))
        self.assertEqual(safe_status_label("1.0-beta"), "1.0-beta")
        fake = dict(ok=True, product="ChatGPTRemoteCommander", profiles=["default"],
                    build="test\\u202eINJECTED", mode="full<QA11_SECRET>",
                    secret="QA11_SECRET_SENTINEL")
        fake["build"] = fake["build"].replace("\\u202e", "\u202e")
        collected=collect(Path("/tmp/staged-mock"),"default",lambda _,__,action: fake if action=="status" else
                  {"ok":True,"profile":"default","running":False,"verified":False}
                  if action=="runtime-status" else
                  {"ok":True,"profile":"default","autostartEnabled":False})
        self.assertEqual(collected.values["Managed host"],UNAVAILABLE)
        self.assertEqual(collected.values["Permissions"],UNAVAILABLE)
        report=safe_diagnostics_report("default",collected.values,"Local CLI checks complete")
        self.assertNotIn("QA11_SECRET", report)
        self.assertEqual(sum(1 for k in CATEGORIES if "\n"+k+"\n" in report),len(CATEGORIES))
        self.assertIn("NOT evidence of authenticated remote identity",report)
        self.assertIn("Unavailable / not verified",report)
        with self.assertRaises(ValueError):
            safe_diagnostics_report("../bad",collected.values,"status")

    def test_three_independent_trusted_feeds(self):
        calls = []
        def execute(root, profile, action):
            calls.append(action)
            return {
                'status': dict(ok=True, product='ChatGPTRemoteCommander', build='qa', mode='full', profiles=['default']),
                'runtime-status': dict(ok=True, profile='default', running=True, verified=True),
                'autostart-status': dict(ok=True, profile='default', autostartEnabled=False, reconcileRequired=False),
            }[action]
        result = collect(Path('/tmp/staged-mock'), 'default', execute)
        self.assertEqual(calls, ['status', 'runtime-status', 'autostart-status'])
        self.assertIn('running', result.values['Runtime / connection'])
        self.assertIn('native OS grant unknown', result.values['Permissions'])
        self.assertEqual(result.values['Resource monitoring'], UNAVAILABLE)
        self.assertEqual(result.values['GUI control'], UNAVAILABLE)
        self.assertEqual(result.values['Errors'], UNAVAILABLE)
        self.assertEqual(len(result.values), len(CATEGORIES))

    def test_forged_or_failed_status_never_produces_green(self):
        for forged in ({'ok': True, 'product':'another'}, {'ok': False}, {}):
            result = collect(Path('/tmp/staged-mock'), 'default', lambda *_: forged)
            self.assertTrue(all(x == UNAVAILABLE for k, x in result.values.items() if k != 'Errors'))
            self.assertIn('rejected', result.values['Errors'])

    def test_runtime_false_requires_exact_verified_false(self):
        def fake_status(_, profile, action, receipt):
            if action == "status":
                return dict(ok=True, product="ChatGPTRemoteCommander",
                            profiles=["default"], build="qa12", mode="standard")
            if action == "runtime-status":
                return receipt
            return dict(ok=True, profile=profile, autostartEnabled=False, reconcileRequired=False)
        for incorrect in (
            dict(ok=True, profile="default", running=False, verified=True),
            dict(ok=True, profile="default", running=False),
            dict(ok=True, profile="default", running=False, verified=None),
            dict(ok=True, profile="default", running=False, verified=0),
            dict(ok=True, profile="default", running=False, verified="false"),
            dict(ok=True, profile="default", running=True, verified=False),
            dict(ok=True, profile="other", running=False, verified=False),
        ):
            result = collect(Path("/tmp/staged-mock"), "default",
                             lambda root, profile, action:
                             fake_status(root, profile, action, incorrect))
            self.assertEqual(result.values["Runtime / connection"], UNAVAILABLE, incorrect)
        valid_stopped = dict(ok=True,profile="default",running=False,verified=False)
        result=collect(Path("/tmp/staged-mock"),"default",
                       lambda root,profile,action:
                       fake_status(root, profile, action, valid_stopped))
        self.assertIn("stopped",result.values["Runtime / connection"])

    def test_profile_mismatch_and_missing_feed(self):
        def execute(_, profile, action):
            if action == 'status': return dict(ok=True, product='ChatGPTRemoteCommander', build='qa', mode='full', profiles=['default'])
            if action == 'runtime-status': return dict(ok=True, profile='other', running=True, verified=True)
            raise TimeoutError('isolated mock timeout')
        result = collect(Path('/tmp/staged-mock'), 'default', execute)
        self.assertEqual(result.values['Runtime / connection'], UNAVAILABLE)
        self.assertEqual(result.values['Update / rollback'], UNAVAILABLE)
        self.assertIn('Autostart CLI unavailable', result.values['Errors'])

    def test_missing_selected_profile_fail_closed(self):
        status = dict(ok=True, product='ChatGPTRemoteCommander', build='qa', mode='full', profiles=['other'])
        result = collect(Path('/tmp/staged-mock'), 'default', lambda *_: status)
        self.assertTrue(all(x == UNAVAILABLE for k, x in result.values.items() if k != 'Errors'))
        self.assertIn('rejected', result.values['Errors'])

    def test_bad_profile_is_rejected(self):
        for profile in ('../evil','a/b','a\x00z',''):
            with self.assertRaises(ValueError): collect(Path('/tmp/staged-mock'), profile)


class LifecycleReceiptTests(unittest.TestCase):
    def test_action_specific_receipts_do_not_trust_ok_alone(self):
        from managed_controls import verified_lifecycle_receipt, reported_stopped_receipt
        valid = (
            ("start", dict(ok=True,profile="default",started=True,verifiedHealth=True)),
            ("stop", dict(ok=True,profile="default",stopped=True,verifiedIdentity=True)),
            ("runtime-status", dict(ok=True,profile="default",running=True,verified=True)),
        )
        for action, receipt in valid:
            self.assertTrue(verified_lifecycle_receipt(receipt, action, "default"),action)
            self.assertFalse(verified_lifecycle_receipt(receipt, action, "other"),action)
        forged = (
            ("start", {"ok": True}),
            ("start", dict(ok=True,profile="default",started=True,verifiedHealth=False)),
            ("start", dict(ok=True,profile="other",started=True,verifiedHealth=True)),
            ("stop", dict(ok=True,profile="default",stopped=False,notRunning=True)),
            ("stop", dict(ok=True,profile="default",stopped=True,verifiedIdentity=False)),
            ("runtime-status", dict(ok=True,profile="default",running=False,verified=False)),
        )
        for action, receipt in forged:
            self.assertFalse(verified_lifecycle_receipt(receipt, action, "default"),action)
        stopped=dict(ok=True,profile="default",running=False,verified=False)
        self.assertTrue(reported_stopped_receipt(stopped,"runtime-status","default"))
        self.assertFalse(reported_stopped_receipt(stopped,"stop","default"))
        self.assertFalse(reported_stopped_receipt(stopped,"runtime-status","other"))

    def test_secret_bearing_receipt_is_displayed_as_allowlisted_evidence(self):
        from managed_controls import safe_lifecycle_display
        secret = {
            "ok": True, "profile": "default", "started": True,
            "verifiedHealth": True, "controlToken": "QA8_SECRET_SENTINEL",
            "nested": {"password": "QA8_SECRET_NESTED"},
        }
        shown = json.dumps(safe_lifecycle_display(secret,"start","default"))
        self.assertNotIn("QA8_SECRET",shown)
        self.assertNotIn("password",shown)
        self.assertNotIn("controlToken",shown)
        self.assertIn('"verifiedHealth": true',shown)
        unknown = json.dumps(safe_lifecycle_display(secret,"stop","other"))
        self.assertIn('"unverified"',unknown)
        self.assertNotIn("QA8_SECRET",unknown)
        stopped = {"ok":True,"profile":"default","running":False,"verified":False,
                   "password":"QA8_SECRET_SENTINEL"}
        safe = safe_lifecycle_display(stopped,"runtime-status","default")
        self.assertEqual(safe["verification"],"reported-stopped")
        self.assertNotIn("password",safe)

class BoundedProcessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='commander-v1-10-qa-', dir=Path.home())
        self.root = Path(self.tmp.name)
        (self.root/'state/profiles').mkdir(parents=True)
        (self.root/'bin').mkdir()
        (self.root/'product.json').write_text(json.dumps({'product':'ChatGPTRemoteCommander','schema':1}))
        (self.root/'state/profiles/default.json').write_text('{}')
        (self.root/'Commander.cjs').write_text('// no runtime in bounded subprocess QA\n')
        self.node = self.root/'bin/node'

    def tearDown(self):
        self.tmp.cleanup()

    def script(self, body):
        self.node.write_text('#!/usr/bin/env python3\nimport sys, time\n'+body+'\n')
        self.node.chmod(0o700)

    def test_duplicate_json_keys_fail_closed(self):
        for payload in (
            '{"ok":false,"ok":true}',
            '{"ok":true,"nested":{"profile":"bad","profile":"default"}}',
            '{"profiles":[{"name":"first","name":"second"}]}',
        ):
            self.script("print(" + repr(payload) + ")")
            with self.assertRaisesRegex(ValueError, "DUPLICATE_JSON"):
                _cli(self.root, 'default', 'runtime-status', timeout=3)

    def test_duplicate_manifest_json_rejected(self):
        self.script('print("{\\"ok\\":true}")')
        (self.root / 'product.json').write_text(
            '{"product":"ChatGPTRemoteCommander","schema":1,"schema":1}')
        with self.assertRaisesRegex(ValueError, "DUPLICATE_JSON"):
            validate_managed_root(self.root)

    def test_lifecycle_cli_requires_action_specific_ack(self):
        from managed_controls import run_profile_command
        self.script('print(\'{"ok":true}\')')
        with self.assertRaisesRegex(ValueError,"CLI_ACTION_RECEIPT_UNVERIFIED"):
            run_profile_command(self.root,"default","start",timeout=3)
        self.script('print(\'{"ok":true,"profile":"default","started":true,"verifiedHealth":true}\')')
        self.assertTrue(run_profile_command(self.root,"default","start",timeout=3)["verified"])
        self.script('print(\'{"ok":true,"profile":"default","stopped":false,"notRunning":true}\')')
        with self.assertRaisesRegex(ValueError,"CLI_ACTION_RECEIPT_UNVERIFIED"):
            run_profile_command(self.root,"default","stop",timeout=3)
        self.script('print(\'{"ok":true,"profile":"default","running":false,"verified":false}\')')
        state=run_profile_command(self.root,"default","runtime-status",timeout=3)
        self.assertFalse(state["verified"])
        self.assertTrue(state["reportedStopped"])

    def test_real_limited_cli(self):
        self.script('print("{\\"ok\\": true, \\"profile\\": \\"default\\"}")')
        self.assertEqual(_cli(self.root,'default','runtime-status')['profile'], 'default')

    def test_excess_output_rejected_before_unbounded_buffer(self):
        self.script('sys.stdout.write("X" * 100_000); sys.stdout.flush()')
        with self.assertRaisesRegex(RuntimeError, 'OUTPUT_OVERSIZED'):
            _cli(self.root,'default','runtime-status', timeout=3)

    def test_timeout_kills_own_process_group(self):
        self.script('time.sleep(2)')
        with self.assertRaises(Exception) as raised:
            _cli(self.root,'default','runtime-status', timeout=0.2)
        self.assertIn('TimeoutExpired', type(raised.exception).__name__)

    def test_child_pipes_timeout_cleans_private_process_group(self):
        # A malicious read-only CLI can exit its parent while a child holds
        # inherited stdout/stderr open; this must not strand a live child.
        self.script('import subprocess, pathlib, os\nchild = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(15)"])\npathlib.Path(os.path.dirname(sys.argv[0])).joinpath("child.pid").write_text(str(child.pid))\n')
        with self.assertRaises(Exception):
            _cli(self.root, 'default', 'runtime-status', timeout=1.2)
        pid = int((self.root/'bin/child.pid').read_text())
        import time as _time
        for _ in range(20):
            state = Path(f'/proc/{pid}/stat')
            if not state.exists() or state.read_text().split()[2] == 'Z':
                break
            _time.sleep(0.05)
        else:
            os.kill(pid, 9)
            self.fail('DESCENDANT_LEFT_RUNNING_AFTER_TIMEOUT')

    def test_alias_intermediate_and_manifest_bool_schema_rejected(self):
        self.script('print("{\\"ok\\": true}")')
        (self.root/'product.json').write_text('{"product":"ChatGPTRemoteCommander","schema":true}')
        with self.assertRaisesRegex(ValueError, 'IDENTITY_INVALID'):
            validate_managed_root(self.root)
        (self.root/'product.json').write_text('{"product":"ChatGPTRemoteCommander","schema":1}')
        (self.root/'bin/node').unlink()
        (self.root/'bin').rmdir()
        with tempfile.TemporaryDirectory(prefix='commander-v1-10-other-', dir=Path.home()) as other:
            (Path(other)/'node').write_text('file')
            os.symlink(other, self.root/'bin')
            with self.assertRaisesRegex(ValueError, 'INTERMEDIATE_ALIAS'):
                validate_managed_root(self.root)

    def test_symlink_profile_not_executed(self):
        self.script('print("{\\"ok\\": true}")')
        (self.root/'state/profiles/default.json').unlink()
        os.symlink(self.root/'product.json', self.root/'state/profiles/default.json')
        with self.assertRaisesRegex(ValueError, 'NOT_FOUND_OR_ALIAS'):
            _cli(self.root,'default','runtime-status')


if __name__ == '__main__':
    unittest.main()
