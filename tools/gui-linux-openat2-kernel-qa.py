#!/usr/bin/env python3
"""Linux E44 actual kernel pathname containment, disposable synthetic J01 QA only."""
import ctypes, errno, json, os, platform, stat, tempfile, threading, unittest

if platform.system() != "Linux":
    raise SystemExit("LINUX_ONLY_QA")
if platform.machine().lower() not in ("x86_64", "amd64", "aarch64", "arm64"):
    raise SystemExit("OPENAT2_SYSCALL_ARCH_NOT_VERIFIED")
# The generic syscall number is 437 on the verified architectures.
NR=437
PROTECT=0x01|0x02|0x04|0x08  # NO_XDEV, NO_MAGICLINKS, NO_SYMLINKS, BENEATH
libc=ctypes.CDLL(None,use_errno=True)
libc.syscall.restype=ctypes.c_long
class How(ctypes.Structure):
    _fields_=[("flags",ctypes.c_uint64),("mode",ctypes.c_uint64),("resolve",ctypes.c_uint64)]
def openat2(dfd,name,flags,mode=0,resolve=PROTECT):
    name=os.fsencode(name)
    if b"\x00" in name:
        raise ValueError("NUL_PATH")
    how=How(flags,mode,resolve)
    ctypes.set_errno(0)
    fd=libc.syscall(ctypes.c_long(NR),ctypes.c_int(dfd),ctypes.c_char_p(name),
                    ctypes.byref(how),ctypes.sizeof(how))
    if fd<0:
        n=ctypes.get_errno()
        raise OSError(n,os.strerror(n),name)
    return int(fd)

class KernelQA(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory(prefix="rc-e44-openat2-qa-")
        self.root=self.t.name
        assert self.root.startswith(os.path.realpath(tempfile.gettempdir())+os.sep+"rc-e44-openat2-qa-")
        self.arc=os.path.join(self.root,"archive")
        os.mkdir(self.arc,0o700)
        self.dfd=os.open(self.root,os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC)
        self.addCleanup(os.close,self.dfd)
        self.addCleanup(self.t.cleanup)
    def deny(self,name,code):
        with self.assertRaises(OSError) as e:
            fd=openat2(self.dfd,name,os.O_RDONLY|os.O_CLOEXEC)
            os.close(fd)
        self.assertEqual(e.exception.errno,code)
    def test_01_file_and_directory_fsync(self):
        data=b"E44-SYNTHETIC-UNKNOWN-NATIVE-J01\n"
        fd=openat2(self.dfd,"archive/j01.bin",os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_CLOEXEC,0o600)
        try:
            self.assertEqual(os.fstat(fd).st_nlink,1)
            self.assertEqual(os.write(fd,data),len(data))
            os.fsync(fd)
        finally: os.close(fd)
        d=openat2(self.dfd,"archive",os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(d)
        finally:os.close(d)
        fd=openat2(self.dfd,"archive/j01.bin",os.O_RDONLY)
        try:self.assertEqual(os.read(fd,4096),data)
        finally:os.close(fd)
    def test_02_exclusive_replay_denied(self):
        fd=openat2(self.dfd,"archive/single",os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        os.close(fd)
        with self.assertRaises(OSError) as e: openat2(self.dfd,"archive/single",os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        self.assertEqual(e.exception.errno,errno.EEXIST)
    def test_03_two_writers_one_winner(self):
        barrier=threading.Barrier(2)
        result=[]
        def writer():
            barrier.wait()
            try:
                fd=openat2(self.dfd,"archive/claim",os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
                os.close(fd)
                result.append("CREATED")
            except OSError as e:result.append(e.errno)
        th=[threading.Thread(target=writer) for _ in range(2)]
        for x in th:x.start()
        for x in th:x.join(timeout=6);self.assertFalse(x.is_alive())
        self.assertCountEqual(result,["CREATED",errno.EEXIST])
    def test_04_ancestor_symlink_denied(self):
        os.symlink("archive",os.path.join(self.root,"alias"))
        self.deny("alias/other",errno.ELOOP)
    def test_05_final_symlink_denied(self):
        os.symlink("absent",os.path.join(self.arc,"alias"))
        self.deny("archive/alias",errno.ELOOP)
    def test_06_proc_magic_link_denied(self):
        os.symlink("/proc/self/fd/0",os.path.join(self.arc,"magic"))
        self.deny("archive/magic",errno.ELOOP)
    def test_07_parent_escape_denied(self):self.deny("../escape",errno.EXDEV)
    def test_08_absolute_path_denied(self):self.deny("/tmp/escape",errno.EXDEV)
    def test_09_hardlink_requires_nlink_one(self):
        fd=openat2(self.dfd,"archive/one",os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        os.close(fd)
        os.link(os.path.join(self.arc,"one"),os.path.join(self.arc,"two"))
        fd=openat2(self.dfd,"archive/one",os.O_RDONLY)
        try:self.assertEqual(os.fstat(fd).st_nlink,2)
        finally:os.close(fd)
    def test_10_unknown_resolve_flag_denied(self):
        with self.assertRaises(OSError) as e:openat2(self.dfd,"archive",os.O_RDONLY,resolve=PROTECT|(1<<62))
        self.assertEqual(e.exception.errno,errno.EINVAL)
    def test_11_invalid_mode_denied(self):
        with self.assertRaises(OSError) as e:openat2(self.dfd,"archive",os.O_RDONLY,mode=0o600)
        self.assertEqual(e.exception.errno,errno.EINVAL)

if __name__=="__main__":
    result=unittest.TextTestRunner(verbosity=1).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(KernelQA))
    if not result.wasSuccessful():raise SystemExit(1)
    print(json.dumps({"schema":"rc-e44-openat2-real-kernel-qa-v1","tests":result.testsRun,
        "actualKernelConfinement":True,"requestedFlags":PROTECT,
        "noCrossMountBehaviorTested":True,"noPowerLossProven":True,
        "ownerAuthenticated":False,"storageTrusted":False,
        "releaseAuthorized":False,"nativeOutcome":"UNKNOWN"}))
