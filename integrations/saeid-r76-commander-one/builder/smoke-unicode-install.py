#!/usr/bin/env python3
"""V1-08 Windows real one-file installation in paths that tar.exe cannot decode as argv.

Owner-local disposable QA only. The script never touches installed production
Routers, OS autostart, services, credentials, or foreground desktop sessions.
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

def digest_file(file):
    h=hashlib.sha256()
    with file.open("rb") as f:
        for block in iter(lambda:f.read(1024*1024),b""):
            h.update(block)
    return h.hexdigest()

def execute(argv,timeout=90):
    proc=subprocess.run([str(x) for x in argv],capture_output=True,
                        text=True,encoding="utf-8",timeout=timeout)
    lines=(proc.stdout or proc.stderr).strip().splitlines()
    try:
        result=json.loads(lines[-1]) if lines else {}
    except (ValueError,IndexError):
        raise RuntimeError("UNICODE_INSTALL_QA_RECEIPT_MISSING")
    if proc.returncode:
        raise RuntimeError("UNICODE_INSTALL_QA_COMMAND_FAILED:"+
                           str(result.get("errorCode","unrecognized")))
    return result

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--installer",required=True,type=Path)
    ap.add_argument("--expected-sha256",required=True)
    ap.add_argument("--native-ui-sha256")
    args=ap.parse_args()
    if os.name!="nt":
        raise SystemExit("UNICODE_INSTALL_QA_WINDOWS_ONLY")
    file=args.installer.resolve(strict=True)
    if args.installer.is_symlink() or not file.is_file():
        raise SystemExit("UNICODE_INSTALL_QA_INVALID_INSTALLER")
    if digest_file(file)!=args.expected_sha256:
        raise SystemExit("UNICODE_INSTALL_QA_INSTALLER_SHA_MISMATCH")
    base=Path(os.environ["TEMP"]).resolve(strict=True)
    scratch=Path(tempfile.mkdtemp(prefix="v108-win-unicode-install-",dir=base))
    clean=False
    profiles=[]
    try:
        for mode in ("standard","full"):
            name="Managed space % $ \u00c4 \u062A\u0633\u062A "+mode
            assert "\u00c4" in name and "\u062A\u0633\u062A" in name
            root=scratch/name
            if root.exists():raise AssertionError("QA_UNEXPECTED_PREEXISTING_ROOT")
            proof=execute([file,"--install","--target",root,"--mode",mode])
            assert proof.get("installed") and proof.get("oneManagedInstall"),proof
            status=execute([root/"Commander.exe","--status","--target",root])
            assert status.get("ok") and status.get("mode")==mode,status
            marker=json.loads((root/"product.json").read_text(encoding="utf8"))
            assert marker.get("mode")==mode
            assert status.get("profiles")==["default"],status
            assert len(list((root/"state/profiles").glob("*.json")))==1
            if args.native_ui_sha256:
                path=root/"app/desktop/RemoteCommander.exe"
                assert digest_file(path)==args.native_ui_sha256
                assert marker.get("nativeUi",{}).get("sha256")==args.native_ui_sha256
            runtime=execute([root/"Commander.exe","--runtime-status","--target",root])
            assert runtime.get("running") is False
            profiles.append(mode)
        clean=True
        print(json.dumps({
          "status":"WINDOWS_UNICODE_SPECIAL_PATH_INSTALL_PASS",
          "installerSha256":args.expected_sha256,
          "modes":profiles,"nativeUiHashVerified":bool(args.native_ui_sha256),
          "unicodeAbsolutePathPreviouslyUnsafe":True,
          "percentDollarSpaceTested":True,"productionTouched":False,
          "osElevationRequired":False,"osRestartTested":False
        },ensure_ascii=True))
    finally:
        if clean and scratch.parent==base and scratch.name.startswith(
                "v108-win-unicode-install-") and not scratch.is_symlink():
            shutil.rmtree(scratch)
            print("UNICODE_INSTALL_QA_TEMP_CLEANED")
        else:
            print("UNICODE_INSTALL_QA_RECONCILE_REQUIRED:"+str(scratch),
                  file=sys.stderr)

if __name__=="__main__":
    main()
