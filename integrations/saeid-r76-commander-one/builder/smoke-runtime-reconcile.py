#!/usr/bin/env python3
"""Scoped owner-local dead-control reconciliation acceptance; no production mutations."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time

def call(args, failure=False, timeout=55):
    p=subprocess.run([str(v) for v in args],text=True,capture_output=True,timeout=timeout,
                     creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    diagnostic_log=os.environ.get("R76_DIAGNOSTIC_LOG")
    if diagnostic_log:
        with open(diagnostic_log,"a",encoding="utf8") as log:
            log.write(json.dumps({"action":next((str(v) for v in args if str(v).startswith("--")),"unknown"),"exitCode":p.returncode,"stdout":p.stdout[-2000:],"stderr":p.stderr[-2000:]})+"\n")
    raw=(p.stdout or p.stderr).strip().splitlines()
    try: out=json.loads(raw[-1])
    except (IndexError,ValueError):out={"raw":(p.stdout or p.stderr)[-700:]}
    if (failure and p.returncode==0) or (not failure and (p.returncode!=0 or out.get("ok") is not True)):
        raise RuntimeError("R46_COMMAND_FAILED:"+str(p.returncode)+":"+str(out)[:600])
    return out

def eventually(condition,seconds=16):
    until=time.monotonic()+seconds
    while time.monotonic()<until:
        if condition():return True
        time.sleep(.15)
    return False

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--installer",type=Path,required=True)
    p.add_argument("--core",type=Path)
    p.add_argument("--mode",choices=("standard","full"),required=True)
    a=p.parse_args()
    assert a.installer.is_file() and (a.core is None or a.core.is_file())
    home=Path.home()
    base=Path(tempfile.mkdtemp(prefix=".rc-v1-reconcile-r46-",dir=home))
    root=base/"CommanderOne"
    active=False
    stop_attempted=False
    complete=False
    try:
        x=call([a.installer,"--install","--mode",a.mode,"--target",root],timeout=80)
        assert x.get("installed") is True
        cli=([root/"Commander.exe"] if os.name=="nt" else [root/"bin/node",root/"Commander.cjs"])
        stage=((["node",a.core.resolve()] if os.name=="nt" else
                [root/"bin/node",a.core.resolve()]) if a.core is not None else cli)
        suffix=["--target",root,"--profile","default"]
        def run_staged(act,failure=False):
            return call(stage+[act]+suffix,failure=failure)
        def run_cli(act,failure=False):
            return call(cli+[act]+suffix,failure=failure)
        none=run_staged("--runtime-reconcile")
        assert none["reconciled"] is False and none["notRunning"] is True
        started=run_cli("--start")
        active=True
        stop_attempted=False
        assert started.get("verifiedHealth") is True
        record=root/"state"/"controls"/"default.json"
        assert record.is_file() and not record.is_symlink()
        previous=record.read_bytes()
        old=json.loads(previous)
        cfg=json.loads((root/"state"/"profiles"/"default.json").read_text())
        denied=run_staged("--runtime-reconcile",failure=True)
        assert denied["errorCode"]=="INSTALLER_RUNTIME_RECONCILE_PID_PRESENT",denied
        assert record.read_bytes()==previous
        stop_attempted=True
        stop=run_staged("--stop")
        assert stop.get("verifiedIdentity") is True
        active=False
        assert eventually(lambda:not record.exists()),"R46_CONTROL_DID_NOT_EXIT"
        # The actual old owner runtime is now absent. Replay its exact private
        # serialized control receipt as a dead record in this disposable root.
        record.write_bytes(previous)
        changed=json.loads(previous)
        changed["configSha256"]="0"*64
        record.write_text(json.dumps(changed))
        mismatch=run_staged("--runtime-reconcile",failure=True)
        assert mismatch["errorCode"]=="INSTALLER_CONTROL_CONFIG_CHANGED",mismatch
        record.write_bytes(previous)
        lock=record.with_suffix(".reconcile.lock")
        lock.write_text("held")
        busy=run_staged("--runtime-reconcile",failure=True)
        assert busy["errorCode"]=="INSTALLER_RUNTIME_RECONCILE_BUSY",busy
        blocked=run_staged("--start",failure=True)
        assert blocked["errorCode"]=="INSTALLER_RUNTIME_RECONCILE_BUSY",blocked
        lock.unlink()
        for target,reason in ((old["controlPort"],"CONTROL_PORT_BUSY"),
                              (cfg["port"],"BACKEND_PORT_BUSY")):
            with socket.socket() as s:
                # Node TCP servers use SO_REUSEADDR; mirror that behavior on Linux
                # so a just-stopped backend TIME_WAIT socket is not a false failure.
                s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
                s.bind(("127.0.0.1",target))
                s.listen(1)
                denied=run_staged("--runtime-reconcile",failure=True)
                assert denied["errorCode"]=="INSTALLER_RUNTIME_RECONCILE_"+reason,denied
                assert record.read_bytes()==previous
        accepted=run_staged("--runtime-reconcile")
        assert accepted["reconciled"] is True and accepted["quarantined"] is True
        assert not record.exists()
        recovery=root/"state"/"recovery"/(
            "control-default-stale-"+hashlib.sha256(previous).hexdigest()[:16]+".json")
        assert recovery.read_bytes()==previous
        again=run_staged("--runtime-reconcile")
        assert again["reconciled"] is False and again["notRunning"] is True
        start2=run_cli("--start")
        active=True
        stop_attempted=False
        assert start2["started"] and start2["verifiedHealth"]
        check=run_cli("--runtime-status")
        assert check["running"] and check["verified"]
        stop_attempted=True
        stop2=run_staged("--stop")
        assert stop2["verifiedIdentity"]
        active=False
        assert eventually(lambda:not record.exists()),"R46_RECOVERED_CONTROL_NOT_CLEANED"
        print(json.dumps({"ok":True,"status":"R46_DEAD_OWNER_CONTROL_RECONCILE_PASS",
              "platform":os.name,"mode":a.mode,"liveControlRejected":True,
              "configMismatchRejected":True,"reconcileLockRejected":True,
              "controlPortOccupiedRejected":True,"backendPortOccupiedRejected":True,
              "staleControlQuarantined":True,"idempotentSecondReconcile":True,
              "restartAndHealthVerified":True,"noProcessKilled":True,
              "productionTouched":False}))
        complete=True
    finally:
        if active:
            if stop_attempted:
                print("R46_STOP_OUTCOME_RECONCILE_NO_REPLAY")
            else:
                # Read fresh identity before a single owned cleanup request.
                try:
                    observed=run_cli("--runtime-status")
                    if observed.get("running") is True and observed.get("verified") is True:
                        stop_attempted=True
                        run_staged("--stop")
                except Exception as cleanup_error:
                    print("R46_SECONDARY_CLEANUP_UNPROVEN="+str(cleanup_error)[:700])
        if complete:
            until=time.monotonic()+16
            while True:
                try:shutil.rmtree(base);break
                except PermissionError:
                    if time.monotonic()>=until:raise
                    time.sleep(.2)
        else:print("R46_RECOVERY_QA_ROOT="+str(base))

if __name__=="__main__":main()
