#!/usr/bin/env python3
"""V1-08 real one-file upgrade and rollback with a non-ASCII, $, %, and space in the managed path.

Must run only as the ordinary logged-in owner. Never targets existing installations,
cleans an unknown tree, changes shared project sources or restarts an OS service.
"""
import argparse,hashlib,json,os,pathlib,shutil,subprocess,sys,tempfile,time
def sha(b): return hashlib.sha256(b).hexdigest()
def sha_file(p):
    h=hashlib.sha256()
    with p.open("rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""): h.update(b)
    return h.hexdigest()
def call(args,*,failure=False,timeout=50):
    p=subprocess.run([str(x) for x in args],capture_output=True,text=True,timeout=timeout)
    lines=(p.stdout or p.stderr).strip().splitlines()
    try: data=json.loads(lines[-1]) if lines else {}
    except (ValueError,IndexError):raise RuntimeError("QA_OUTPUT_NOT_JSON:"+str(lines[-2:]))
    if (p.returncode==0)==failure:
        raise RuntimeError("QA_UNEXPECTED_EXIT:"+str(p.returncode)+":"+str(data)[:750])
    return data
def entry(target):
    if os.name=="nt":return [str(target/"Commander.exe")]
    return [str(target/"bin/node"),str(target/"Commander.cjs")]

_CLEANUP_ADMISSIONS={}

def _cleanup_path(p):
    value=str(p)
    if os.name!="nt":return value
    if not p.is_absolute() or ".." in p.parts:raise RuntimeError("QA_CLEANUP_ABSOLUTE_PATH_REQUIRED")
    return "\\\\?\\UNC\\"+value[2:] if value.startswith("\\\\") else "\\\\?\\"+value

def _no_reparse_ancestors(p):
    for item in reversed((p,*p.parents)):
        state=os.lstat(_cleanup_path(item))
        if pathlib.Path(item).is_symlink() or getattr(state,"st_file_attributes",0)&0x400:
            raise RuntimeError("QA_CLEANUP_REPARSE_REFUSED")

def _admit_cleanup(scratch,sandbox,packages):
    sandbox=sandbox.absolute();scratch=scratch.absolute()
    _no_reparse_ancestors(scratch)
    if (scratch.parent!=sandbox or scratch.resolve(strict=True)!=scratch
            or sandbox.resolve(strict=True)!=sandbox or not scratch.name.startswith("v108-unicode-upgrade-")):
        raise RuntimeError("QA_CLEANUP_OWN_ROOT_NOT_ADMITTED")
    state=os.stat(_cleanup_path(scratch))
    admission=dict(root=str(scratch),sandbox=str(sandbox),identity=[state.st_dev,state.st_ino],
        source=str(pathlib.Path(__file__).resolve()),sourceSha256=sha_file(pathlib.Path(__file__).resolve()),
        packages={str(p):sha_file(p) for p in packages})
    import uuid
    admission['token']=uuid.uuid4().hex
    _CLEANUP_ADMISSIONS[admission['token']]=json.dumps(admission,sort_keys=True)
    return admission

def _cleanup_inventory(root):
    rows=[]
    def visit(directory):
        with os.scandir(_cleanup_path(directory)) as items:
            for item in items:
                state=item.stat(follow_symlinks=False)
                if item.is_symlink() or getattr(state,"st_file_attributes",0)&0x400:
                    raise RuntimeError("QA_CLEANUP_DESCENDANT_REPARSE_REFUSED")
                p=directory/item.name
                if directory.name=="controls":raise RuntimeError("QA_CLEANUP_CONTROL_REMAINS")
                row=[str(p.relative_to(root)),state.st_dev,state.st_ino,state.st_size,state.st_mtime_ns]
                if item.is_dir(follow_symlinks=False):rows.append(row+["directory"]);visit(p)
                elif item.is_file(follow_symlinks=False):rows.append(row+[sha_file(pathlib.Path(_cleanup_path(p)))])
                else:raise RuntimeError("QA_CLEANUP_SPECIAL_FILE_REFUSED")
    visit(root)
    return sorted(rows)

def _owned_processes(root):
    if os.name!="nt":raise RuntimeError("QA_CLEANUP_PROCESS_GUARD_WINDOWS_ONLY")
    script=r"""$ErrorActionPreference='Stop'
$r=[IO.Path]::GetFullPath($env:RC_QA_CLEANUP_ROOT).TrimEnd('\')+'\'
$matches=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
($_.ExecutablePath -and $_.ExecutablePath.StartsWith($r,[StringComparison]::OrdinalIgnoreCase)) -or
($_.CommandLine -and $_.CommandLine.IndexOf($r,[StringComparison]::OrdinalIgnoreCase) -ge 0)
} | Select-Object -ExpandProperty ProcessId)
[ordered]@{ok=$true;pids=@($matches)} | ConvertTo-Json -Compress
"""
    import base64
    env=os.environ.copy();env['RC_QA_CLEANUP_ROOT']=str(root)
    powershell=pathlib.Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'
    try:
        result=subprocess.run([str(powershell),'-NoProfile','-NonInteractive','-EncodedCommand',
            base64.b64encode(script.encode('utf-16-le')).decode('ascii')],env=env,capture_output=True,text=True,timeout=15,
            creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        proof=json.loads(result.stdout)
        if result.returncode or proof.get('ok') is not True or not isinstance(proof.get('pids'),list):raise ValueError()
        return proof['pids']
    except Exception:raise RuntimeError("QA_CLEANUP_PROCESS_GUARD_UNAVAILABLE") from None

def cleanup_owned_scratch(admission,observe_processes=None,remove_tree=None):
    if _CLEANUP_ADMISSIONS.get(admission.get('token'))!=json.dumps(admission,sort_keys=True):
        raise RuntimeError('QA_CLEANUP_ADMISSION_NOT_CURRENT_OWN_LAUNCH')
    root=pathlib.Path(admission['root']);sandbox=pathlib.Path(admission['sandbox'])
    _no_reparse_ancestors(root)
    state=os.stat(_cleanup_path(root))
    if (root.parent!=sandbox or root.resolve(strict=True)!=root or sandbox.resolve(strict=True)!=sandbox
            or [state.st_dev,state.st_ino]!=admission['identity'] or not root.name.startswith('v108-unicode-upgrade-')):
        raise RuntimeError('QA_CLEANUP_ROOT_IDENTITY_CHANGED')
    if sha_file(pathlib.Path(admission['source']))!=admission['sourceSha256']:
        raise RuntimeError('QA_CLEANUP_SOURCE_CHANGED')
    for path,expected in admission['packages'].items():
        if sha_file(pathlib.Path(path))!=expected:raise RuntimeError('QA_CLEANUP_PACKAGE_CHANGED')
    inventory=_cleanup_inventory(root)
    processes=(observe_processes or _owned_processes)(root)
    if processes:raise RuntimeError('QA_CLEANUP_OWNED_PROCESS_STILL_ACTIVE')
    # Fresh exact root and complete inventory recheck immediately before the one removal.
    _no_reparse_ancestors(root);current=os.stat(_cleanup_path(root))
    if [current.st_dev,current.st_ino]!=admission['identity'] or _cleanup_inventory(root)!=inventory:
        raise RuntimeError('QA_CLEANUP_CONTENT_CHANGED')
    receipt=sandbox/(root.name+'.cleanup.json')
    record=dict(schema=1,status='ADMITTED_BEFORE_EXTENDED_PATH_DELETE',admission=admission,
        files=inventory,ownedProcesses=processes,extendedPath=os.name=='nt')
    with receipt.open('x',encoding='utf8') as stream:
        json.dump(record,stream);stream.flush();os.fsync(stream.fileno())
    if (observe_processes or _owned_processes)(root):
        raise RuntimeError('QA_CLEANUP_OWNED_PROCESS_BECAME_ACTIVE')
    _CLEANUP_ADMISSIONS.pop(admission['token']) # consumed before the one destructive call
    (remove_tree or shutil.rmtree)(_cleanup_path(root))
    try:os.stat(_cleanup_path(root))
    except FileNotFoundError:pass
    else:raise RuntimeError('QA_CLEANUP_ROOT_STILL_EXISTS')
    record['status']='PASS_OWNED_SCRATCH_CLEANED'
    receipt.write_text(json.dumps(record),encoding='utf8')
    return record

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--previous",required=True,type=pathlib.Path)
    ap.add_argument("--current",required=True,type=pathlib.Path)
    ap.add_argument("--previous-sha256",required=True)
    ap.add_argument("--current-sha256",required=True)
    ap.add_argument("--previous-ui-sha256",required=True)
    ap.add_argument("--current-ui-sha256",required=True)
    ap.add_argument("--mode",required=True,choices=("standard","full"))
    ap.add_argument("--test-user-systemd",action="store_true")
    a=ap.parse_args()
    if a.test_user_systemd and (sys.platform!="linux" or a.mode!="standard"):
        raise SystemExit("QA_SYSTEMD_ONLY_LINUX_STANDARD")
    old=a.previous.resolve(strict=True);new=a.current.resolve(strict=True)
    if old.is_symlink() or new.is_symlink() or sha_file(old)!=a.previous_sha256 or sha_file(new)!=a.current_sha256:
        raise SystemExit("QA_PACKAGE_SHA_NOT_ACCEPTED")
    if sys.platform=="linux" and os.geteuid()==0:raise SystemExit("QA_NO_ROOT")
    sandbox=pathlib.Path(os.environ["TEMP"] if os.name=="nt" else pathlib.Path.home()/".cache")
    sandbox.mkdir(parents=True,exist_ok=True)
    scratch=pathlib.Path(tempfile.mkdtemp(prefix="v108-unicode-upgrade-",dir=str(sandbox)))
    admission=_admit_cleanup(scratch,sandbox,[old,new]) if os.name=="nt" else None
    result=None
    target=scratch/("Managed space % $ \u00c4 \u062A\u0633\u062A")
    assert "\u00c4" in str(target) and "\u062A\u0633\u062A" in str(target)
    note=None
    current_ui=target/"app/desktop/RemoteCommander.exe" if os.name=="nt" else target/"app/desktop/linux-control-center/managed_controls.py"
    service_enabled=False
    clean=False
    try:
        installed=call([old,"--install","--target",target,"--mode",a.mode],timeout=80)
        assert installed.get("installed") and installed.get("oneManagedInstall")
        assert sha_file(current_ui)==a.previous_ui_sha256,"QA_PREVIOUS_UI_WRONG"
        cli=entry(target)
        extra=call([*cli,"--add-profile","--target",target,"--profile","MMZ"])
        assert extra.get("added")=="MMZ",extra
        paths=[target/"state/profiles/default.json",target/"state/profiles/MMZ.json"]
        pre=[p.read_bytes() for p in paths]
        note=target/"state"/"owner-notes.txt"
        note.write_text("Owner V1-08 Unicode upgrade \u00c4 \u062A\u0633\u062A\n",encoding="utf8")
        note_hash=sha_file(note)
        original=json.loads((target/"product.json").read_text(encoding="utf8"))
        if os.name=="nt":
            # Refuse unsafe WScript expansion paths for Autostart-enable,
            # while permitting fail-closed status and managed upgrade.
            for profile in ("default","MMZ"):
                # Previous packages may themselves reject status for a '%'
                # path; distinguish fail-closed legacy behavior from a live
                # or orphaned autostart. Never reinterpret an unknown error.
                result=subprocess.run([*cli,"--autostart-status","--target",str(target),
                                       "--profile",profile],capture_output=True,text=True,timeout=25)
                lines=(result.stdout or result.stderr).strip().splitlines()
                receipt=json.loads(lines[-1]) if lines else {}
                if result.returncode:
                    assert receipt.get("errorCode")=="INSTALLER_AUTOSTART_WINDOWS_PATH_UNSUPPORTED",receipt
                else:
                    assert receipt.get("autostartEnabled") is False and receipt.get("reconcileRequired") is False,receipt
                deny=call([*cli,"--autostart-enable","--target",target,"--profile",profile],failure=True)
                assert deny.get("errorCode")=="INSTALLER_AUTOSTART_WINDOWS_PATH_UNSUPPORTED",deny
        conflict=call([new,"--install","--target",target,"--mode",a.mode],failure=True)
        assert conflict.get("errorCode")=="INSTALLER_SAME_BUILD_DIFFERENT_PAYLOAD_REQUIRES_UPGRADE",conflict
        upgrade=call([new,"--upgrade","--target",target,"--mode",a.mode],timeout=80)
        assert upgrade.get("upgraded") and upgrade.get("rollbackAvailable"),upgrade
        fresh=json.loads((target/"product.json").read_text(encoding="utf8"))
        assert (fresh["sourceSha256"]!=original["sourceSha256"] or
                fresh.get("installerCoreSha256")!=original.get("installerCoreSha256") or
                fresh.get("nativeUi")!=original.get("nativeUi")), "QA_IDENTICAL_UPGRADE_NOT_ACCEPTED"
        assert sha_file(current_ui)==a.current_ui_sha256,"QA_NEW_UI_WRONG"
        assert fresh["upgradedFromSource"]==original["sourceSha256"]
        assert [p.read_bytes() for p in paths]==pre and sha_file(note)==note_hash
        if os.name=="nt":
            for profile in ("default","MMZ"):
                off=call([*entry(target),"--autostart-status","--target",target,"--profile",profile])
                assert off.get("autostartEnabled") is False and off.get("reconcileRequired") is False,off
                deny=call([*entry(target),"--autostart-enable","--target",target,"--profile",profile],failure=True)
                assert deny.get("errorCode")=="INSTALLER_AUTOSTART_WINDOWS_PATH_UNSUPPORTED",deny
                off=call([*entry(target),"--autostart-status","--target",target,"--profile",profile])
                assert off.get("autostartEnabled") is False and off.get("reconcileRequired") is False,off
        if a.test_user_systemd:
            enabling=call([*cli,"--headless-enable","--target",target],timeout=35)
            assert enabling.get("serviceActive") and enabling.get("verifiedHealth"),enabling
            service_enabled=True
            state=call([*cli,"--headless-status","--target",target])
            assert state.get("serviceEnabled") and state.get("serviceActive"),state
            disabling=call([*cli,"--headless-disable","--target",target],timeout=35)
            service_enabled=False
            assert disabling.get("changed") and not disabling.get("serviceActive"),disabling
        rolled=call([*cli,"--rollback","--target",target],timeout=40)
        assert rolled.get("rolledBack") and rolled.get("previousCandidateRetained")
        final=json.loads((target/"product.json").read_text(encoding="utf8"))
        assert final["sourceSha256"]==original["sourceSha256"]
        assert final.get("nativeUi")==original.get("nativeUi")
        assert final.get("installerCoreSha256")==original.get("installerCoreSha256")
        assert sha_file(current_ui)==a.previous_ui_sha256,"QA_RESTORED_UI_WRONG"
        assert [p.read_bytes() for p in paths]==pre and sha_file(note)==note_hash
        for profile in ("default","MMZ"):
            status=call([*entry(target),"--runtime-status","--target",target,"--profile",profile])
            assert not status.get("running") and not status.get("verified"),status
        clean=True
        result={"status":"UNICODE_SPECIAL_PATH_UPGRADE_ROLLBACK_PASS","platform":sys.platform,
          "mode":a.mode,"previousUiSha":a.previous_ui_sha256,"newUiSha":a.current_ui_sha256,
          "nonAsciiDollarPercentSpace":True,"autostartUnsafeEnableDenied":os.name=="nt",
          "sameBuildInstallRejected":True,
          "twoProfilesAndOwnerStateBytePreserved":True,"exactUiAndCoreRollback":True,
          "actualUserSystemdLifecycleTested":a.test_user_systemd,
          "productionChanged":False}
        print(json.dumps({**result,"status":"UNICODE_SPECIAL_PATH_FUNCTIONAL_PASS_CLEANUP_PENDING"}))
    finally:
        if service_enabled:
            try:
                disabled=call([*entry(target),"--headless-disable","--target",target],timeout=25)
                if disabled.get("serviceActive"):clean=False
            except Exception:
                clean=False
        if clean and scratch.name.startswith("v108-unicode-upgrade-") and scratch.parent==sandbox and not scratch.is_symlink():
            primary=sys.exc_info()[1]
            try:
                if os.name=="nt":cleanup_owned_scratch(admission)
                else:shutil.rmtree(scratch)
            except Exception as cleanup_error:
                print("UNICODE_SPECIAL_PATH_CLEANUP_FAILED_RETAIN:"+type(cleanup_error).__name__+":"+str(scratch),file=sys.stderr)
                if primary is None:raise
            else:
                print("UNICODE_SPECIAL_PATH_TEMP_CLEANED")
                print(json.dumps(result))
        else:
            print("UNICODE_SPECIAL_PATH_RECONCILIATION_REQUIRED:"+str(scratch),file=sys.stderr)
            # On a nonzero exit, preserve exact-scoped QA evidence, not unrelated state.
if __name__=="__main__":
    main()
