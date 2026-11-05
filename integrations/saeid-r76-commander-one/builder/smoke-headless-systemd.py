#!/usr/bin/env python3
"""Real, owner-local systemd --user acceptance for an exact Linux one-file installer.

This is a destructive test ONLY within fresh temporary managed installations. Never
starts, stops, reloads, or adopts an existing Commander installation or unrelated
unit. Exact-hash admission, unique target-derived service names, and readback guard
the test. Production boot/login acceptance is NOT claimed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

def digest(blob):
    return hashlib.sha256(blob).hexdigest()

def file_digest(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""):
            h.update(b)
    return h.hexdigest()

def call(argv, *, allowed=(0,), timeout=35):
    p=subprocess.run([str(x) for x in argv],capture_output=True,text=True,timeout=timeout)
    out=(p.stdout or p.stderr).strip().splitlines()
    try:
        value=json.loads(out[-1]) if out else {}
    except ValueError:
        value={"unparsed":(p.stdout+p.stderr)[-900:]}
    if p.returncode not in allowed:
        raise RuntimeError("HEADLESS_QA_COMMAND_REJECTED:"+str([str(x) for x in argv[1:4]])+
                           ":"+str(p.returncode)+":"+str(value)[:900])
    return p.returncode,value

def service_name(target,profile):
    return "commander-v1-"+digest((str(target)+"\n"+profile).encode())[:20]+".service"

def state(name):
    p=subprocess.run(["systemctl","--user","show",name,"-p","LoadState","-p",
                      "ActiveState","-p","UnitFileState","-p","MainPID"],
                     capture_output=True,text=True,timeout=8)
    if p.returncode or not p.stdout:
        raise RuntimeError("HEADLESS_QA_USER_MANAGER_UNAVAILABLE:"+p.stderr[-350:])
    d=dict(x.split("=",1) for x in p.stdout.splitlines() if "=" in x)
    if "LoadState" not in d or "ActiveState" not in d:
        raise RuntimeError("HEADLESS_QA_SYSTEMD_READBACK_INCOMPLETE")
    return d

def command(cli,action,target,profile=None,*,denied=False):
    argv=[*cli,"--"+action,"--target",target]
    if profile is not None:
        argv += ["--profile",profile]
    return call(argv,allowed=(2,) if denied else (0,))[1]

def assert_health(target,profile):
    cfg_file=target/"state"/"profiles"/(profile+".json")
    cfg=json.loads(cfg_file.read_text())
    with urllib.request.urlopen("http://127.0.0.1:"+str(cfg["port"])+"/health",timeout=3) as r:
        d=json.load(r)
    if d.get("ok") is not True or d.get("instance",{}).get("profile")!=profile:
        raise AssertionError("HEADLESS_QA_HEALTH_IDENTITY_MISMATCH")
    if d.get("configSha256")!=file_digest(cfg_file):
        raise AssertionError("HEADLESS_QA_ACTIVE_CONFIG_SHA_MISMATCH")
    return cfg["port"]

def main():
    a=argparse.ArgumentParser()
    a.add_argument("--installer",type=Path,required=True)
    a.add_argument("--expected-sha256",required=True)
    a.add_argument("--previous-installer",type=Path)
    a.add_argument("--verify-crash-recovery",action="store_true")
    opt=a.parse_args()
    if sys.platform!="linux" or os.geteuid()==0:
        raise SystemExit("HEADLESS_QA_REQUIRES_NONROOT_LINUX")
    setup=opt.installer.resolve(strict=True)
    if opt.installer.is_symlink() or not setup.is_file() or file_digest(setup)!=opt.expected_sha256:
        raise SystemExit("HEADLESS_QA_INSTALLER_SHA_MISMATCH")
    if opt.previous_installer and not opt.previous_installer.is_file():
        raise SystemExit("HEADLESS_QA_PREVIOUS_INSTALLER_MISSING")
    # loginctl returns a literal "yes", not JSON.
    linger_reply=subprocess.run(["loginctl","show-user",str(os.getuid()),"-p",
                                 "Linger","--value"],capture_output=True,text=True,timeout=8)
    if linger_reply.returncode or linger_reply.stdout.strip()!="yes":
        raise SystemExit("HEADLESS_QA_LINGER_NOT_ENABLED")
    cache=Path.home()/".cache"
    cache.mkdir(mode=0o700,exist_ok=True)
    qa=Path(tempfile.mkdtemp(prefix="v108-systemd-owner-qa-",dir=cache))
    target=qa/"managed"
    full=qa/"full-managed"
    profiles=("default","V108QA")
    service_units=[service_name(target,x) for x in profiles]
    unit_dir=Path.home()/".config"/"systemd"/"user"
    for unit in service_units:
        if (unit_dir/unit).exists() or (unit_dir/unit).is_symlink():
            raise RuntimeError("HEADLESS_QA_TEST_UNIT_COLLISION")
        if state(unit).get("LoadState")!="not-found":
            raise RuntimeError("HEADLESS_QA_TEST_UNIT_ALREADY_REGISTERED")
    cli=[target/"bin"/"node",target/"Commander.cjs"]
    enabled=[]
    clean=False
    try:
        _,verify=call(["bash",setup,"--verify-package"])
        if verify.get("ok") is not True or not 100<=verify.get("files",0)<=500:
            raise RuntimeError("HEADLESS_QA_PACKAGE_VERIFICATION_FAILED")
        _,installed=call(["bash",setup,"--install","--target",target,"--mode","standard"],timeout=80)
        assert installed.get("installed") is True
        assert json.loads((target/"product.json").read_text())["installerCoreSha256"]
        _,added=call([*cli,"--add-profile","--target",target,"--profile","V108QA"])
        assert added.get("added")=="V108QA"
        for profile in profiles:
            out=command(cli,"headless-enable",target,profile)
            enabled.append(profile)
            assert out.get("serviceActive") and out.get("serviceEnabled") and out.get("verifiedHealth")
            assert out.get("unit")==service_name(target,profile)
            second=command(cli,"headless-enable",target,profile)
            assert second.get("idempotent") and not second.get("changed")
        ports=[assert_health(target,p) for p in profiles]
        assert len(set(ports))==2, "HEADLESS_QA_PROFILE_PORT_COLLISION"
        for profile in profiles:
            s=state(service_name(target,profile))
            assert s.get("ActiveState")=="active" and s.get("UnitFileState")=="enabled"
        # New Core must refuse active mutating operations.
        for action in ("upgrade","uninstall"):
            result=command(cli,action,target,denied=True)
            assert result.get("errorCode")=="INSTALLER_HEADLESS_UNIT_RECONCILE_FIRST",result
        # Previous R47 must not mutate an active H3c managed instance.
        if opt.previous_installer:
            _,prev=call(["bash",opt.previous_installer,"--upgrade","--target",target,
                         "--mode","standard"],allowed=(2,))
            assert prev.get("errorCode") in (
                "INSTALLER_ACTIVE_OR_STALE_CONTROL_RECONCILE_FIRST",
                "INSTALLER_EXISTING_CONTROL_RECORD_RECONCILE_FIRST",
                "INSTALLER_HEADLESS_UNIT_RECONCILE_FIRST"),prev
        # A changed config MUST NOT be mistaken for a safe idempotent enable.
        cfg=target/"state"/"profiles"/"default.json"
        original=cfg.read_bytes()
        mutated=json.loads(original)
        mutated["qaTransientConfigMarker"]="config-sha-invalid"
        cfg.write_text(json.dumps(mutated,sort_keys=True)+"\n")
        try:
            wrong=command(cli,"headless-enable",target,"default",denied=True)
            assert wrong.get("errorCode")=="INSTALLER_HEADLESS_ACTIVE_HEALTH_UNVERIFIED",wrong
        finally:
            cfg.write_bytes(original)
        assert_health(target,"default")
        restarted=False
        if opt.verify_crash_recovery:
            old_pid=int(state(service_units[0])["MainPID"])
            assert old_pid>1
            # Only kill the exact unique QA unit; no PID or unrelated process targeting.
            call(["systemctl","--user","kill","--kill-whom=main","--signal=SIGKILL",service_units[0]])
            for _ in range(75):
                time.sleep(.2)
                status=state(service_units[0])
                new_pid=int(status.get("MainPID","0"))
                if status.get("ActiveState")=="active" and new_pid>1 and new_pid!=old_pid:
                    # systemd marks the process active before the HTTP server binds.
                    # Retain the PID condition and wait for the actual health receipt.
                    try:
                        assert_health(target,"default")
                    except (OSError, AssertionError):
                        continue
                    restarted=True
                    break
            assert restarted,"HEADLESS_QA_SYSTEMD_AUTO_RESTART_FAILED"
        command(cli,"headless-disable",target,"V108QA")
        enabled.remove("V108QA")
        assert state(service_units[0])["ActiveState"]=="active"
        command(cli,"headless-disable",target,"default")
        enabled.remove("default")
        _,retire=call([*cli,"--uninstall","--target",target])
        assert retire.get("preservedForOwnerRestore") is True
        _,restore=call(["bash",setup,"--restore","--target",target])
        assert restore.get("restored") is True
        _,full_install=call(["bash",setup,"--install","--target",full,"--mode","full"],timeout=80)
        assert full_install.get("installed") is True
        denied=command([full/"bin"/"node",full/"Commander.cjs"],
                       "headless-enable",full,denied=True)
        assert denied.get("errorCode")=="INSTALLER_HEADLESS_FULL_POWER_TRUST_BOUNDARY_NOT_ACCEPTED"
        assert all(state(x).get("LoadState")=="not-found" for x in service_units)
        assert all(not (unit_dir/x).exists() and not (unit_dir/x).is_symlink()
                   for x in service_units)
        clean=True
        print(json.dumps({"status":"HEADLESS_SYSTEMD_USER_PASS",
                          "installerSha256":opt.expected_sha256,"profiles":2,
                          "distinctPorts":True,"actualSystemdUserServices":True,
                          "unsafeUpgradeUninstallRejected":True,
                          "legacyMutationRejected":bool(opt.previous_installer),
                          "configShaMismatchRejected":True,
                          "systemdCrashRecoveryTested":bool(opt.verify_crash_recovery),
                          "systemdCrashRecoveryPassed":restarted,
                          "reversibleUninstallRestore":True,
                          "fullPowerServiceDenied":True,
                          "bootOrLoginTested":False,"productionTouched":False}))
    finally:
        # Only attempt shutdown for the verified, unique QA-target units.
        for profile in reversed(enabled):
            try:
                command(cli,"headless-disable",target,profile)
            except Exception as exc:
                print("HEADLESS_QA_DISABLE_RECONCILE_REQUIRED:"+str(exc),file=sys.stderr)
        for name in service_units:
            try:
                s=state(name)
                if s.get("ActiveState")=="active" or s.get("LoadState")!="not-found" or (
                    unit_dir/name).exists() or (unit_dir/name).is_symlink():
                    clean=False
            except Exception:
                clean=False
        if clean:
            shutil.rmtree(qa)
            print("HEADLESS_QA_TEMP_CLEANED")
        else:
            print("HEADLESS_QA_RECOVERY_REQUIRED:"+str(qa),file=sys.stderr)

if __name__=="__main__":
    main()
