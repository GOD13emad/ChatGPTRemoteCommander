#!/usr/bin/env python3
"""Owner-only native Control Center installer. No Core, Browser, systemd or profile mutation."""
import argparse, hashlib, json, os, stat, subprocess, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parent
SRC=ROOT/"control_center.py"
ICON_SRC=ROOT/"assets/logo.png"
SRC_SHA="40f11c75f6be87e81f789f0dab3738d4eca35bd750c37595e8e114a69356a64c"
ICON_SHA="d724415693a4a4da8c20a065db978467ae979714d9b0559ace7dc33035461195"
APP_ID="io.github.god13emad.RemoteCommander.ControlCenter"
HOME=Path.home()
APPDIR=HOME/".local/share/remote-commander-control-center"
APP=APPDIR/"control_center.py"
ICON=HOME/".local/share/icons/hicolor/512x512/apps/remote-commander-control-center.png"
DESKTOP=HOME/".local/share/applications"/(APP_ID+".desktop")
SHORTCUT=HOME/"Desktop/Remote Commander Control Center.desktop"
RECEIPT=APPDIR/"install-receipt.json"
BASE=[APPDIR,ICON,DESKTOP,SHORTCUT]

def sha(b):return hashlib.sha256(b).hexdigest()
def file_bytes(p):return p.read_bytes()
def validate_identity():
    assert os.name=="posix" and os.geteuid()!=0,"NON_ROOT_LINUX_ONLY"
    assert HOME.is_dir() and not HOME.is_symlink() and HOME.stat().st_uid==os.getuid(),"OWNER_HOME_REQUIRED"
    for parent in (HOME/".local",APPDIR.parent,ICON.parent,DESKTOP.parent,SHORTCUT.parent):
        if parent.exists():
            assert parent.is_dir() and not parent.is_symlink() and parent.stat().st_uid==os.getuid(),"TARGET_PARENT_NOT_OWNED"
    assert SRC.is_file() and not SRC.is_symlink(),"SOURCE_NOT_REGULAR"
    assert ICON_SRC.is_file() and not ICON_SRC.is_symlink(),"ICON_NOT_REGULAR"
    assert sha(file_bytes(SRC))==SRC_SHA and sha(file_bytes(ICON_SRC))==ICON_SHA,"SOURCE_SHA_CHANGED"
    assert file_bytes(ICON_SRC)[:8]==b"\x89PNG\r\n\x1a\n","ICON_NOT_PNG"

def entry():
    return (f"[Desktop Entry]\nVersion=1.0\nType=Application\n"
            f"Name=Remote Commander Control Center\n"
            f"GenericName=Commander monitoring\n"
            f"Comment=Owner-private local monitoring for profiles and durable workflows\n"
            f"Exec=/usr/bin/python3 {APP}\nTryExec=/usr/bin/python3\n"
            f"Icon=remote-commander-control-center\nTerminal=false\n"
            f"Categories=Utility;\nStartupNotify=true\n").encode("utf8")

def desktop_validate(data):
    check=ROOT/".desktop-validate-preview.tmp"
    # Never write a validation artifact in the source tree.
    import tempfile
    with tempfile.TemporaryDirectory(prefix="rc-center-validation-") as tmp:
        f=Path(tmp)/"control-center.desktop"
        f.write_bytes(data)
        result=subprocess.run(["/usr/bin/desktop-file-validate",str(f)],
                              capture_output=True,text=True,timeout=7)
        if result.returncode!=0:
            raise RuntimeError("DESKTOP_FILE_INVALID:"+result.stderr[:180])

def secure_new(path,data,mode):
    flags=os.O_CREAT|os.O_EXCL|os.O_WRONLY
    if hasattr(os,"O_NOFOLLOW"):flags|=os.O_NOFOLLOW
    fd=os.open(str(path),flags,mode)
    try:
        with os.fdopen(fd,"wb") as f:
            f.write(data);f.flush();os.fsync(f.fileno())
        os.chmod(path,mode)
        if path.stat().st_uid!=os.getuid():raise RuntimeError("OWNER_CHANGED")
    except BaseException:
        if path.is_file() and sha(path.read_bytes())==sha(data):path.unlink()
        raise

def status(installer_entry):
    mapping={APP:SRC_SHA,ICON:ICON_SHA,DESKTOP:sha(installer_entry),SHORTCUT:sha(installer_entry)}
    outcomes={}
    for p,d in mapping.items():
        try:
            if p.is_symlink():outcomes[str(p)]="UNTRUSTED_SYMLINK"
            elif not p.is_file():outcomes[str(p)]="MISSING"
            elif p.stat().st_uid!=os.getuid():outcomes[str(p)]="FOREIGN_OWNER"
            elif sha(file_bytes(p))!=d:outcomes[str(p)]="CHANGED"
            else:outcomes[str(p)]="MATCH"
        except OSError:outcomes[str(p)]="UNVERIFIED"
    return outcomes

def run():
    parser=argparse.ArgumentParser()
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run",action="store_true")
    group.add_argument("--install",action="store_true")
    group.add_argument("--verify",action="store_true")
    args=parser.parse_args()
    validate_identity()
    data=entry()
    desktop_validate(data)
    before=status(data)
    if args.dry_run:
        print(json.dumps({"status":"PREFLIGHT_PASS","installationState":before,
              "mode":"READ_ONLY_CANDIDATE","sourceSha256":SRC_SHA,"iconSha256":ICON_SHA}))
        return 0
    if args.verify:
        approved=all(v=="MATCH" for v in before.values())
        result={"status":"VERIFIED" if approved else "NOT_VERIFIED",
                "files":before,"mode":"READ_ONLY_CANDIDATE"}
        print(json.dumps(result))
        return 0 if approved else 2
    if any(v!="MISSING" for v in before.values()) or APPDIR.exists():
        raise RuntimeError("UNSAFE_RERUN_OR_EXISTING_UNKNOWN_TARGET")
    # Installed target has no network or mutating workflow channel, even
    # when started by another signed-in desktop session.
    check=subprocess.run(["/usr/bin/python3",str(SRC),"--audit"],
                         capture_output=True,text=True,timeout=8,check=True)
    schema=json.loads(check.stdout)
    assert schema["mode"]=="READ_ONLY_CANDIDATE" and schema["credentialAccess"] is False
    created=[]
    try:
        APPDIR.parent.mkdir(parents=True,exist_ok=True)
        assert not APPDIR.parent.is_symlink() and APPDIR.parent.stat().st_uid==os.getuid(), "PARENT_OWNER_CHANGED"
        APPDIR.mkdir(mode=0o700)
        created.append(APPDIR)
        secure_new(APP,file_bytes(SRC),0o700);created.append(APP)
        ICON.parent.mkdir(parents=True,exist_ok=True)
        secure_new(ICON,file_bytes(ICON_SRC),0o644);created.append(ICON)
        DESKTOP.parent.mkdir(parents=True,exist_ok=True)
        secure_new(DESKTOP,data,0o644);created.append(DESKTOP)
        SHORTCUT.parent.mkdir(parents=True,exist_ok=True)
        secure_new(SHORTCUT,data,0o755);created.append(SHORTCUT)
        desktop_validate(file_bytes(DESKTOP))
        desktop_validate(file_bytes(SHORTCUT))
        after=status(data)
        assert all(v=="MATCH" for v in after.values()),"POST_SHA_CHECK"
        record={"status":"PASS_OWNER_PRIVATE_CONTROL_CENTER_INSTALL",
                "product":"Remote Commander Control Center","mode":"READ_ONLY_CANDIDATE",
                "sha256":{"app":SRC_SHA,"logo":ICON_SHA,"desktop":sha(data)},
                "files":after,"coreUnmodified":True,"browserUnmodified":True,
                "profileUnmodified":True,"workflowMutationEnabled":False}
        secure_new(RECEIPT,(json.dumps(record,indent=2)+"\n").encode("utf8"),0o600)
        print(json.dumps(record))
    except BaseException:
        # Roll back only content exact-matching files created in this transaction.
        mapping={APP:SRC_SHA,ICON:ICON_SHA,DESKTOP:sha(data),SHORTCUT:sha(data)}
        for p in reversed(created):
            if p.is_file() and mapping.get(p)==sha(file_bytes(p)):p.unlink()
            elif p==APPDIR and p.is_dir() and not any(p.iterdir()):p.rmdir()
        raise
    return 0

if __name__=="__main__":
    try:raise SystemExit(run())
    except (OSError,ValueError,RuntimeError,AssertionError) as e:
        print(type(e).__name__+": "+str(e),file=sys.stderr)
        raise SystemExit(3)
