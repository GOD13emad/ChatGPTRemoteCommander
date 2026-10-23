#!/usr/bin/env python3
"""Disposable Linux GUI native coordinator tests. No real desktop input."""
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent.parent
HELPER=ROOT/'tools'/'gui-control-linux.py'
spec=importlib.util.spec_from_file_location('rc_linux_native_gui',str(HELPER))
helper=importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

def child_attempt(root):
    fd,error=helper._native_input_lock(root)
    if fd is not None:
        os.close(fd)
    print(json.dumps({'acquired':fd is not None,'error':error}),flush=True)

def child_hold(root):
    fd,error=helper._native_input_lock(root)
    if error:
        print('CANNOT_ACQUIRE',flush=True)
        return 72
    print('HELD',flush=True)
    try:
        while True:
            import time
            time.sleep(0.05)
    finally:
        os.close(fd)

class NativeCoordinatorQA(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory(prefix='rc-linux-gui-native-qa-')
        self.addCleanup(self.directory.cleanup)
        self.root=self.directory.name
        os.chmod(self.root,0o700)
    def child(self,kind):
        return subprocess.run([sys.executable,__file__,kind,self.root],capture_output=True,
                              text=True,timeout=8,check=True)
    def test_nonblocking_cross_process_lock_prevents_second_dispatch(self):
        fd,error=helper._native_input_lock(self.root)
        self.assertIsNone(error)
        self.assertIsNotNone(fd)
        try:
            second=json.loads(self.child('--child-attempt').stdout)
            self.assertEqual(second,{'acquired':False,'error':'GUI_NATIVE_BUSY'})
            called=[]
            result=helper.coordinated_native_result(lambda:called.append('NATIVE') or {'ok':True},
                                                     root=self.root)
            self.assertEqual(result,{'ok':False,'error':'GUI_NATIVE_BUSY','submission':'NOT_SUBMITTED'})
            self.assertEqual(called,[])
        finally:
            os.close(fd)
        after=json.loads(self.child('--child-attempt').stdout)
        self.assertEqual(after,{'acquired':True,'error':None})
    def test_killed_owner_releases_mutex_without_ever_replaying_input(self):
        worker=subprocess.Popen([sys.executable,__file__,'--child-hold',self.root],
                                stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE,text=True)
        try:
            self.assertEqual(worker.stdout.readline().strip(),'HELD')
            fd,error=helper._native_input_lock(self.root)
            self.assertIsNone(fd)
            self.assertEqual(error,'GUI_NATIVE_BUSY')
        finally:
            worker.kill()
            worker.communicate(timeout=5)
        fd,error=helper._native_input_lock(self.root)
        self.assertIsNone(error)
        os.close(fd)
    def test_permissive_directory_is_refused_before_native_dispatch(self):
        os.chmod(self.root,0o755)
        called=[]
        result=helper.coordinated_native_result(lambda:called.append('NATIVE'),root=self.root)
        self.assertEqual(result['error'],'GUI_COORDINATOR_UNAVAILABLE')
        self.assertEqual(result['submission'],'NOT_SUBMITTED')
        self.assertEqual(called,[])
    def test_hardlink_and_symlink_mutexes_fail_closed(self):
        lock=os.path.join(self.root,helper.COORD_NAME)
        with open(lock,'wb') as f:
            f.write(b'')
        alias=lock+'.alias'
        os.link(lock,alias)
        fd,error=helper._native_input_lock(self.root)
        self.assertIsNone(fd)
        self.assertEqual(error,'GUI_COORDINATOR_UNAVAILABLE')
        os.unlink(alias)
        os.unlink(lock)
        os.symlink(alias,lock)
        fd,error=helper._native_input_lock(self.root)
        self.assertIsNone(fd)
        self.assertEqual(error,'GUI_COORDINATOR_UNAVAILABLE')
    def test_status_screenshot_are_not_coordinated_mutations(self):
        self.assertTrue({'move','moveRelative','scroll','click','drag','typeText','keyPress','focusWindow'}.issubset(helper.MUTATING_ACTIONS))
        self.assertNotIn('status',helper.MUTATING_ACTIONS)
        self.assertNotIn('screenshot',helper.MUTATING_ACTIONS)
        self.assertEqual(stat.S_IMODE(os.stat(self.root).st_mode),0o700)

if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--child-attempt':
        child_attempt(sys.argv[2])
    elif len(sys.argv)==3 and sys.argv[1]=='--child-hold':
        raise SystemExit(child_hold(sys.argv[2]))
    else:
        unittest.main()
