#!/usr/bin/env python3
"""Real two-version atomic upgrade and rollback QA in disposable owner-local paths.
Do not run against an existing production root. No network/elevation/credentials.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

def sha(raw):return hashlib.sha256(raw).hexdigest()

def run(argv,expect_fail=False,timeout=45):
    proc=subprocess.run(argv,capture_output=True,text=True,timeout=timeout)
    raw=(proc.stdout or proc.stderr).strip()
    try:data=json.loads(raw.splitlines()[-1]) if raw else {}
    except ValueError as exc:raise RuntimeError('UPGRADE_QA_JSON_UNREADABLE:'+raw[-280:]) from exc
    if expect_fail and proc.returncode==0:raise RuntimeError('EXPECTED_UPGRADE_REJECTION_MISSING')
    if not expect_fail and proc.returncode:raise RuntimeError('UPGRADE_QA_COMMAND_FAILED:'+str(data))
    return data

def installed_cmd(root):
    if os.name=='nt':return [str(root/'Commander.exe')]
    return [str(root/'bin/node'),str(root/'Commander.cjs')]

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--previous-installer',required=True,type=Path)
    ap.add_argument('--installer',required=True,type=Path)
    ap.add_argument('--mode',choices=('standard','full'),default='standard')
    args=ap.parse_args()
    old=args.previous_installer.resolve()
    new=args.installer.resolve()
    base=Path(os.environ.get('TEMP',str(Path.home()/'.cache')))
    with tempfile.TemporaryDirectory(prefix='commander-one-r40-upgrade-',dir=base) as tmp:
        root=Path(tmp)/'owner-product'
        previous=run([str(old),'--install','--target',str(root),'--mode',args.mode],timeout=65)
        assert previous['installed']
        old_entry=installed_cmd(root)
        run(old_entry+['--add-profile','--profile','MMZ','--target',str(root)])
        marker=root/'product.json'
        before=json.loads(marker.read_text())
        assert before['mode']==args.mode
        configs={name:(root/'state/profiles'/(name+'.json')).read_bytes()
                 for name in ('default','MMZ')}
        note=root/'state/owner-notes.txt'
        note.write_text('this owner state must survive atomic upgrade and rollback')
        noteSha=sha(note.read_bytes())

        run(old_entry+['--start','--target',str(root),'--profile','default'],timeout=35)
        try:
            denied=run([str(new),'--upgrade','--target',str(root),'--mode',args.mode],
                       expect_fail=True)
            assert denied.get('errorCode')=='INSTALLER_ACTIVE_OR_STALE_CONTROL_RECONCILE_FIRST',denied
            assert json.loads(marker.read_text())['sourceSha256']==before['sourceSha256']
        finally:
            run(old_entry+['--stop','--target',str(root),'--profile','default'])
        controls=root/'state/controls'
        for _ in range(40):
            if not any(controls.glob('*.json')):break
            time.sleep(.1)
        assert not any(controls.glob('*.json')),'PRE_UPGRADE_CONTROL_NOT_STOPPED'

        upgraded=run([str(new),'--upgrade','--target',str(root),'--mode',args.mode],timeout=75)
        assert upgraded['upgraded'] and upgraded['rollbackAvailable']
        now=json.loads(marker.read_text())
        assert (now['sourceSha256']!=before['sourceSha256'] or
                now.get('nativeUi')!=before.get('nativeUi') or
                now.get('installerCoreSha256')!=before.get('installerCoreSha256')), 'UPGRADE_IDENTITY_UNCHANGED'
        assert now['upgradedFromSource']==before['sourceSha256']
        assert (now.get('nativeUi')!=before.get('nativeUi') or
                now['sourceSha256']!=before['sourceSha256'] or
                now.get('installerCoreSha256')!=before.get('installerCoreSha256'))
        assert len(upgraded['profiles'])==len(configs)
        for name,data in configs.items():
            assert (root/'state/profiles'/(name+'.json')).read_bytes()==data
        assert sha(note.read_bytes())==noteSha
        backup=Path(now['rollbackPath'])
        assert backup.is_dir() and json.loads((backup/'product.json').read_text())['sourceSha256']==before['sourceSha256']
        noop=run([str(new),'--upgrade','--target',str(root),'--mode',args.mode])
        assert noop['idempotent'] and noop['upgrade'] is False
        restored=run(installed_cmd(root)+['--rollback','--target',str(root)],timeout=35)
        assert restored['rolledBack'] and restored['previousCandidateRetained']
        rolled=json.loads(marker.read_text())
        assert rolled['sourceSha256']==before['sourceSha256']
        assert rolled.get('nativeUi')==before.get('nativeUi'),'ROLLBACK_UI_IDENTITY_NOT_RESTORED'
        assert rolled.get('installerCoreSha256')==before.get('installerCoreSha256'),'ROLLBACK_CORE_IDENTITY_NOT_RESTORED'
        for name,data in configs.items():
            assert (root/'state/profiles'/(name+'.json')).read_bytes()==data
        assert sha(note.read_bytes())==noteSha
        # Match the installed Core's content-addressed recovery identity:
        # source bytes, installer Core bytes, and native UI identity.
        slot=hashlib.sha256(json.dumps([
          now["sourceSha256"],now.get("installerCoreSha256"),now.get("nativeUi")
        ],separators=(",",":"),ensure_ascii=False).encode("utf8")).hexdigest()[:16]
        failed=Path(str(root)+'.failed-'+slot)
        assert failed.is_dir()
        failed_marker=json.loads((failed/"product.json").read_text())
        assert failed_marker["sourceSha256"]==now["sourceSha256"]
        assert failed_marker.get("installerCoreSha256")==now.get("installerCoreSha256")
        assert failed_marker.get("nativeUi")==now.get("nativeUi")
        again=run(installed_cmd(root)+['--runtime-status','--target',str(root),'--profile','MMZ'])
        assert again['running'] is False
        print(json.dumps({'status':'ATOMIC_UPGRADE_ROLLBACK_PASS','os':os.name,
          'mode':args.mode,'profilesPreserved':len(configs),
          'stateShaPreserved':True,'activeUpgradeDenied':True,'upgradeIdempotent':True,
          'recoverableBackupKept':True,'rollbackRestoredExactPrevious':True,
          'failedCandidateRetained':True,'productionChanged':False,
          'newInstallerSha':sha(new.read_bytes())}))
        for item in (root,failed):
            assert not any((item/'state/controls').glob('*.json'))
    print('UPGRADE_QA_TREES_CLEANED')

if __name__=='__main__':main()
