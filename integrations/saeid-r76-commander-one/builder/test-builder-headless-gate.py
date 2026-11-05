#!/usr/bin/env python3
"""Pure unit checks for build.py's real Linux systemd package QA admission gate."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

MODULE=Path(__file__).resolve().parent/"build.py"
spec=importlib.util.spec_from_file_location("v108_one_install_builder",MODULE)
builder=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=builder
spec.loader.exec_module(builder)

class H3cHeadlessBuilderGate(unittest.TestCase):
    def setUp(self):
        self.work=tempfile.TemporaryDirectory(prefix="v108-headless-builder-unit-")
        self.root=Path(self.work.name)
        self.core=self.root/"core.cjs"
        self.core.write_text("const headlessLifecycleRevision = 1;\n")
        self.setup=self.root/"setup.run"
        self.setup.write_bytes(b"scoped-qa-exact-setup")
        self.hash=builder.sha(self.setup.read_bytes())

    def tearDown(self):
        self.work.cleanup()

    def invoke(self, mode="auto", platform="linux-x64", previous=None):
        return builder.headless_systemd_gate(
            mode,platform,self.core,self.setup,self.setup.read_bytes(),previous)

    def good_receipt(self, previous=None):
        return {
            "status":"HEADLESS_SYSTEMD_USER_PASS",
            "installerSha256":self.hash,
            "profiles":2,"distinctPorts":True,"actualSystemdUserServices":True,
            "unsafeUpgradeUninstallRejected":True,
            "legacyMutationRejected":previous is not None,
            "configShaMismatchRejected":True,
            "systemdCrashRecoveryTested":True,
            "systemdCrashRecoveryPassed":True,
            "reversibleUninstallRestore":True,"fullPowerServiceDenied":True,
            "bootOrLoginTested":False,"productionTouched":False
        }

    def mock_test(self, proof, *, extra="\nHEADLESS_QA_TEMP_CLEANED\n", code=0):
        proc=subprocess.CompletedProcess(
            args=["mock-test"],returncode=code,stdout=json.dumps(proof)+extra,stderr="")
        return mock.patch.object(builder.subprocess,"run",return_value=proc)

    def test_windows_auto_is_not_applicable(self):
        self.assertEqual(self.invoke(platform="win-x64")["status"],"NOT_APPLICABLE")

    def test_windows_required_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError,"LINUX_ONLY"):
            self.invoke(mode="required",platform="win-x64")

    def test_opt_out_is_distinct_from_pass(self):
        self.assertEqual(self.invoke(mode="off")["status"],"NOT_RUN")

    def test_missing_headless_core_is_not_pass(self):
        self.core.write_text("unrelated core")
        self.assertEqual(self.invoke()["status"],"NOT_RUN")
        with self.assertRaisesRegex(RuntimeError,"CORE_UNSUPPORTED"):
            self.invoke(mode="required")

    def test_auto_unready_environment_is_not_pass(self):
        with mock.patch.object(builder,"headless_systemd_preflight",
                               return_value=(False,"linger-not-ready")):
            self.assertEqual(self.invoke()["status"],"NOT_RUN")

    def test_required_unready_environment_blocks_build(self):
        with mock.patch.object(builder,"headless_systemd_preflight",
                               return_value=(False,"linger-not-ready")):
            with self.assertRaisesRegex(RuntimeError,"QA_NOT_READY"):
                self.invoke(mode="required")

    def test_complete_real_receipt_is_admitted(self):
        with mock.patch.object(builder,"headless_systemd_preflight",
                               return_value=(True,"ready")), \
             self.mock_test(self.good_receipt()):
            result=self.invoke(mode="required")
            self.assertEqual(result["status"],"PASS")
            self.assertTrue(result["crashRecovery"])
            self.assertFalse(result["bootOrLoginTested"])

    def test_legacy_mutation_receipt_required_for_previous(self):
        previous=self.root/"old.run"
        previous.write_bytes(b"old")
        with mock.patch.object(builder,"headless_systemd_preflight",
                               return_value=(True,"ready")), \
             self.mock_test(self.good_receipt(previous=previous)) as sp:
            self.assertEqual(self.invoke(mode="required",previous=previous)["status"],"PASS")
            command=sp.call_args.args[0]
            self.assertIn("--previous-installer",command)
            self.assertIn("--verify-crash-recovery",command)

    def test_missing_cleanup_receipt_blocks_publish(self):
        with mock.patch.object(builder,"headless_systemd_preflight",
                               return_value=(True,"ready")), \
             self.mock_test(self.good_receipt(),extra="\n"):
            with self.assertRaisesRegex(RuntimeError,"RECEIPT_INVALID"):
                self.invoke(mode="required")

    def test_wrong_setup_sha_blocks_publish(self):
        proof=self.good_receipt()
        proof["installerSha256"]="0"*64
        with mock.patch.object(builder,"headless_systemd_preflight",
                               return_value=(True,"ready")), \
             self.mock_test(proof):
            with self.assertRaisesRegex(RuntimeError,"RECEIPT_INVALID"):
                self.invoke(mode="required")

    def test_missing_crash_recovery_blocks_publish(self):
        proof=self.good_receipt()
        proof["systemdCrashRecoveryPassed"]=False
        with mock.patch.object(builder,"headless_systemd_preflight",
                               return_value=(True,"ready")), \
             self.mock_test(proof):
            with self.assertRaisesRegex(RuntimeError,"RECEIPT_INVALID"):
                self.invoke(mode="required")

    def test_nonzero_test_return_blocks_publish(self):
        with mock.patch.object(builder,"headless_systemd_preflight",
                               return_value=(True,"ready")), \
             self.mock_test(self.good_receipt(),code=1):
            with self.assertRaisesRegex(RuntimeError,"QA_FAILED"):
                self.invoke(mode="required")

if __name__=="__main__":
    unittest.main(verbosity=2)
