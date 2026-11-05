#!/usr/bin/env python3
"""Owner-local autostart opt-in smoke on a throwaway real R42 install.

No physical login, live service, desktop takeover, or system-wide startup.
This test alters only a unique hashed user startup entry and removes it.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

def run(args, *, check=True, timeout=45):
    p=subprocess.run(list(map(str,args)),capture_output=True,text=True,timeout=timeout,
                     creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    output=p.stdout.strip() or p.stderr.strip()
    try: value=json.loads(output.splitlines()[-1])
    except Exception: value={"raw":output[-500:]}
    if check and (p.returncode!=0 or value.get("ok") is not True):
        raise RuntimeError("AUTOSTART_QA_COMMAND_FAILED:"+str(p.returncode)+":"+str(value)[:900])
    return p.returncode,value

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--setup",type=Path,required=True)
    parser.add_argument("--source",type=Path)
    parser.add_argument("--mode",choices=("standard","full"),default="standard")
    args=parser.parse_args()
    assert args.setup.is_file() and (args.source is None or args.source.is_file())
    host=Path.home()
    work=Path(tempfile.mkdtemp(prefix=".rc-v1-autostart-qa-",dir=host))
    target=work/"CommanderOne"
    configured=[]
    clean=False
    try:
        _,installed=run([args.setup,"--install","--mode",args.mode,"--target",target],timeout=75)
        assert installed["installed"] is True
        cli=([target/"Commander.exe"] if os.name=="nt" else
             [target/"bin"/"node",target/"Commander.cjs"])
        source=(["node",str(args.source.resolve())] if args.source is not None else cli)
        run(cli+["--add-profile","--profile","MMZ","--target",target])
        for profile in ("default","MMZ"):
            suffix=["--target",target,"--profile",profile]
            _,before=run(source+["--autostart-status"]+suffix)
            assert before["autostartEnabled"] is False, before
            _,enabled=run(source+["--autostart-enable"]+suffix)
            configured.append(profile)
            assert enabled["autostartEnabled"] and enabled["changed"],enabled
            _,twice=run(source+["--autostart-enable"]+suffix)
            assert twice["idempotent"] and twice["autostartEnabled"],twice
        rc,blocked=run(source+["--uninstall","--target",target],check=False)
        assert rc!=0 and blocked["errorCode"]=="INSTALLER_AUTOSTART_DISABLE_BEFORE_MIGRATION",blocked
        assert (target/"product.json").is_file()
        _,default_disabled=run(source+["--autostart-disable","--target",target,
                                     "--profile","default"])
        configured.remove("default")
        assert not default_disabled["autostartEnabled"]
        _,mmz_on=run(source+["--autostart-status","--target",target,"--profile","MMZ"])
        assert mmz_on["autostartEnabled"],mmz_on
        _,mmz_disabled=run(source+["--autostart-disable","--target",target,
                                 "--profile","MMZ"])
        configured.remove("MMZ")
        assert mmz_disabled["autostartEnabled"] is False
        _,again=run(source+["--autostart-disable","--target",target,
                            "--profile","MMZ"])
        assert not again["changed"] and not again["autostartEnabled"]
        _,retired=run(cli+["--uninstall","--target",target])
        assert retired["uninstalledFromActiveRoot"] is True
        _,restored=run([args.setup,"--restore","--target",target])
        assert restored["restored"] is True
        clean=True
        print(json.dumps({"ok":True,"code":"R43_AUTOSTART_OWNER_LOCAL_ENABLE_DISABLE_PASS",
                          "platform":os.name,"profiles":2,"mode":args.mode,
                          "packagedCliTested":args.source is None,
                          "loginEventTested":False,"productionTouched":False}))
    finally:
        for profile in configured:
            run(source+["--autostart-disable","--target",target,
                        "--profile",profile],check=False)
        if clean:
            shutil.rmtree(work)
        else:
            print("AUTOSTART_QA_RECOVERY_ROOT:"+str(work))

if __name__=="__main__":
    main()
