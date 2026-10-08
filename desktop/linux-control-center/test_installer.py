#!/usr/bin/env python3
"""Portable, temporary-HOME installer contract. Never writes actual user app paths."""
import hashlib,json,os,pathlib,subprocess,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parent
EXE=ROOT/"install.py"
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="rc-linux-center-owner-fixture-")
        self.home=pathlib.Path(self.temp.name)
        self.env=dict(os.environ,HOME=str(self.home))
    def tearDown(self):self.temp.cleanup()
    def go(self,action):
        return subprocess.run(["/usr/bin/python3",str(EXE),action],env=self.env,
            cwd=ROOT,capture_output=True,text=True,timeout=12)
    def test_dry_run_is_read_only(self):
        r=self.go("--dry-run")
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(json.loads(r.stdout)["status"],"PREFLIGHT_PASS")
        self.assertEqual(list(self.home.iterdir()),[])
    def test_install_verify_and_reinstall_guard(self):
        r=self.go("--install")
        self.assertEqual(r.returncode,0,r.stderr)
        msg=json.loads(r.stdout)
        self.assertEqual(msg["status"],"PASS_OWNER_PRIVATE_CONTROL_CENTER_INSTALL")
        app=self.home/".local/share/remote-commander-control-center/control_center.py"
        self.assertEqual(sha(app),"ee23db980da38a5cea2c08da117e406e1dc6e7bfa3672e13493870bf77975751")
        p=self.go("--verify")
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertEqual(json.loads(p.stdout)["status"],"VERIFIED")
        again=self.go("--install")
        self.assertEqual(again.returncode,3)
        self.assertIn("UNSAFE_RERUN",again.stderr)
        self.assertEqual(sha(app),"ee23db980da38a5cea2c08da117e406e1dc6e7bfa3672e13493870bf77975751")
    def test_unknown_preexisting_icon_is_preserved(self):
        target=self.home/".local/share/icons/hicolor/512x512/apps/remote-commander-control-center.png"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"FOREIGN_ICON_DO_NOT_TOUCH")
        r=self.go("--install")
        self.assertEqual(r.returncode,3,r.stderr)
        self.assertEqual(target.read_bytes(),b"FOREIGN_ICON_DO_NOT_TOUCH")
    def test_symlink_icon_is_rejected(self):
        original=self.home/"foreign.png"
        original.write_bytes(b"PRIVATE")
        dest=self.home/".local/share/icons/hicolor/512x512/apps/remote-commander-control-center.png"
        dest.parent.mkdir(parents=True)
        dest.symlink_to(original)
        r=self.go("--install")
        self.assertEqual(r.returncode,3,r.stderr)
        self.assertTrue(dest.is_symlink())
        self.assertEqual(original.read_bytes(),b"PRIVATE")
if __name__=="__main__":unittest.main(verbosity=2)
