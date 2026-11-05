#!/usr/bin/env python3
"""R44 real owner-local startup command handoff, no reboot or login simulation.
Runs only the launcher created by the disposable managed install, never live routes.
"""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import time
import sys
from qa_stop_guard import QaStopGuard,retain_recovery

def cmd(args, expect=True, timeout=45):
    p=subprocess.run([str(x) for x in args], capture_output=True, text=True,
                     timeout=timeout, creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    raw=(p.stdout or p.stderr).strip()
    try: out=json.loads(raw.splitlines()[-1])
    except (ValueError,IndexError):out={"raw":raw[-500:]}
    if expect and (p.returncode or out.get("ok") is not True):
        raise RuntimeError("R44_CMD_FAILED:"+str(p.returncode)+":"+repr(out)[:500])
    return out

def cmd_status(args):
    p=subprocess.run([str(x) for x in args],capture_output=True,text=True,timeout=12,
                     creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    raw=(p.stdout or p.stderr).strip()
    try: out=json.loads(raw.splitlines()[-1])
    except (ValueError,IndexError):out={"raw":raw[-450:]}
    return p.returncode,out

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--installer",type=Path,required=True)
    ap.add_argument("--mode",choices=["standard","full"],required=True)
    o=ap.parse_args()
    assert o.installer.is_file()
    root=Path(tempfile.mkdtemp(prefix=".rc-v1-r44-launch-",dir=Path.home()))
    managed=root/"CommanderOne"
    installed=False
    enabled=False
    stopped=True
    guard=QaStopGuard(managed,"default")
    disable_attempted=False
    done=False
    cli=None
    try:
        info=cmd([o.installer,"--install","--mode",o.mode,"--target",managed],timeout=70)
        assert info["installed"] is True
        installed=True
        cli=([managed/"Commander.exe"] if os.name=="nt" else
             [managed/"bin/node",managed/"Commander.cjs"])
        suffix=["--target",managed,"--profile","default"]
        enabled_result=cmd(cli+["--autostart-enable"]+suffix)
        assert enabled_result["autostartEnabled"] is True
        enabled=True
        if os.name=="nt":
            launcher=managed/"state/autostart/default.vbs"
            assert launcher.is_file()
            native=[Path(os.environ.get("SystemRoot","C:/Windows"))/"System32/wscript.exe",
                    "//B","//Nologo",launcher]
            # Windows WScript is the actual HKCU Run launcher produced by Commander.
        else:
            import hashlib
            name="commander-one-"+hashlib.sha256(
                (str(managed)+"\n"+"default").encode()).hexdigest()[:20]+".desktop"
            launcher=Path.home()/".config/autostart"/name
            data=launcher.read_text(encoding="utf8")
            exec_line=next(x[5:] for x in data.splitlines() if x.startswith("Exec="))
            native=shlex.split(exec_line)
            assert native[0]==str(managed/"bin/node")
            assert native[1]==str(managed/"Commander.cjs")
            assert native[2:5]==["--start","--target",str(managed)]
        p=subprocess.run([str(x) for x in native],capture_output=True,text=True,timeout=45,
                         creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
        if p.returncode:raise RuntimeError("R44_NATIVE_STARTUP_LAUNCH_FAILED:"+p.stderr[-450:])
        stopped=False
        deadline=time.monotonic()+18
        status=None
        while time.monotonic()<deadline:
            _,status=cmd_status(cli+["--runtime-status"]+suffix)
            if status.get("running") and status.get("verified"):break
            if status.get("errorCode") not in (None,"INSTALLER_BACKEND_IDENTITY_MISMATCH"):
                raise RuntimeError("R44_START_UNEXPECTED_STATUS:"+repr(status))
            time.sleep(0.25)
        else:raise RuntimeError("R44_NATIVE_LAUNCH_BACKEND_MISSING:"+str(status))
        assert status["backendPort"]>1024
        guard.after_verified_start({"started":True,"verifiedHealth":status.get("verified"),"profile":status.get("profile")})
        stopped_resp=guard.stop_once(lambda:cmd(cli+["--stop"]+suffix),"native-autostart-stop")
        assert stopped_resp.get("stopped") is True
        stopped=True
        deadline=time.monotonic()+18
        while time.monotonic()<deadline:
            _,inactive=cmd_status(cli+["--runtime-status"]+suffix)
            if inactive.get("ok") and inactive.get("running") is False:break
            # A just-stopped control process can be briefly unresponsive while
            # Windows releases its IPC handle; never accept it as stopped.
            if inactive.get("errorCode") not in (None,"INSTALLER_BACKEND_IDENTITY_MISMATCH",
                                                 "INSTALLER_CONTROL_UNRESPONSIVE_RECONCILE_FIRST"):
                raise RuntimeError("R44_STOP_UNEXPECTED_STATUS:"+repr(inactive))
            time.sleep(0.25)
        else:raise RuntimeError("R44_STOP_DID_NOT_SETTLE:"+repr(inactive))
        disable_attempted=True
        disabled=cmd(cli+["--autostart-disable"]+suffix)
        assert disabled["autostartEnabled"] is False
        enabled=False
        # Windows may retain an executable handle briefly after verified stop.
        # Retry only if the active root is still present and the owned retired
        # slot has not appeared; an uncertain rename must never be replayed.
        product=json.loads((managed/"product.json").read_text(encoding="utf8"))
        retired_path=Path(str(managed)+".retired-"+product["sourceSha256"][:12])
        deadline=time.monotonic()+18
        while True:
            rc,retired=cmd_status([o.installer,"--uninstall","--target",managed])
            if rc==0 and retired.get("uninstalledFromActiveRoot") is True:break
            if (retired.get("errorCode")!="EPERM" or
                not managed.is_dir() or retired_path.exists() or
                time.monotonic()>=deadline):
                raise RuntimeError("R44_RETIRE_UNVERIFIED:"+repr(retired))
            time.sleep(0.5)
        restored=cmd([o.installer,"--restore","--target",managed])
        assert restored["restored"] is True
        done=True
        print(json.dumps({"ok":True,"status":"R44_NATIVE_STARTUP_LAUNCH_HANDOFF_PASS",
                          "mode":o.mode,"platform":os.name,"verifiedBackend":True,
                          "realLoginTested":False,"productionTouched":False}))
    finally:
        primary=sys.exc_info()[1]
        secondary=[]
        if installed and cli and guard.launch_verified and not guard.consumed:
            try:
                code,fresh=cmd_status(cli+["--runtime-status","--target",managed,"--profile","default"])
                exact=(code==0 and fresh.get("ok") is True and fresh.get("profile")=="default")
                if exact and fresh.get("running") is True and fresh.get("verified") is True:
                    guard.stop_once(lambda:cmd(cli+["--stop","--target",managed,"--profile","default"]),"finally-fresh-autostart-stop")
                elif not (exact and fresh.get("running") is False and fresh.get("verified") is False
                          and not (managed/"state/controls/default.json").exists()):
                    raise RuntimeError("QA_STOP_FRESH_STATUS_UNCERTAIN_RETAIN")
            except BaseException as error:secondary.append(error)
        # Once Stop was consumed, missing or ambiguous completion never permits replay.
        if installed and cli and enabled and not disable_attempted:
            disable_attempted=True
            try:cmd(cli+["--autostart-disable","--target",managed,"--profile","default"])
            except BaseException as error:secondary.append(error)
        if done:shutil.rmtree(root)
        else:
            retain_recovery(root,primary,[guard],secondary)
            print("R44_LAUNCH_RECOVERY_ROOT="+str(root))
        for error in secondary:print("QA_SECONDARY_CLEANUP_FAILURE="+type(error).__name__)
        if secondary and primary is None:raise secondary[0]

if __name__=="__main__":main()
