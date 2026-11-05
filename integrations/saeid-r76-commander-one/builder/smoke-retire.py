#!/usr/bin/env python3
"""One managed preview root: reversible uninstall and restore with real process QA.

Never targets production. Verifies exact profile byte identity, ownership and
fail-closed behavior with occupied backend, target collisions, and repeat calls.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time


def run(args,fail=False,timeout=45):
    proc=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
    raw=(proc.stdout or proc.stderr).strip()
    try:
        receipt=json.loads(raw.splitlines()[-1]) if raw else {}
    except ValueError as e:
        raise RuntimeError('RETIRE_QA_NOT_JSON:'+raw[-300:]) from e
    if fail and proc.returncode==0:
        raise RuntimeError('EXPECTED_RETIRE_REFUSAL_MISSING')
    if not fail and proc.returncode:
        raise RuntimeError('RETIRE_QA_FAILED:'+str(receipt))
    return receipt


def installed(root):
    return ([str(root/'Commander.exe')] if os.name=='nt'
            else [str(root/'bin/node'),str(root/'Commander.cjs')])


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--installer',type=Path,required=True)
    ap.add_argument('--mode',choices=('standard','full'),default='standard')
    a=ap.parse_args()
    installer=a.installer.resolve()
    temp=Path(os.environ.get('TEMP',str(Path.home()/'.cache')))
    with tempfile.TemporaryDirectory(prefix='commander-one-retire-r42-',dir=temp) as td:
        root=Path(td)/'owner-product'
        run([str(installer),'--install','--target',str(root),'--mode',a.mode],timeout=65)
        cli=installed(root)
        run(cli+['--add-profile','--profile','MMZ','--target',str(root)])
        configs={name:(root/'state/profiles'/(name+'.json')).read_bytes()
                 for name in ('default','MMZ')}
        marker=(root/'product.json').read_bytes()
        state=root/'state/owner-notes.txt'
        state.write_text('retain exact profile and user-owned notes')
        original_note=sha(state.read_bytes())

        run(cli+['--start','--target',str(root),'--profile','default'],timeout=35)
        try:
            blocked=run(cli+['--uninstall','--target',str(root)],fail=True)
            assert blocked.get('errorCode')=='INSTALLER_ACTIVE_OR_STALE_CONTROL_RECONCILE_FIRST',blocked
            assert root.is_dir()
        finally:
            run(cli+['--stop','--target',str(root),'--profile','default'])
        for _ in range(40):
            if not list((root/'state/controls').glob('*.json')):break
            time.sleep(.1)
        assert not list((root/'state/controls').glob('*.json'))

        retired_result=run(cli+['--uninstall','--target',str(root)])
        assert retired_result['uninstalledFromActiveRoot'] is True
        assert retired_result['destructiveRemoval'] is False
        retired=Path(retired_result['retiredPath'])
        assert not root.exists() and retired.is_dir()
        assert (retired/'product.json').read_bytes()==marker
        for name,b in configs.items():
            assert (retired/'state/profiles'/(name+'.json')).read_bytes()==b
        assert sha((retired/'state/owner-notes.txt').read_bytes())==original_note
        restored_cli=installed(retired)

        # The owner target can be occupied by another install. Never overwrite it.
        root.mkdir()
        sentinel=root/'unrelated.txt'
        sentinel.write_text('do-not-overwrite')
        denied=run(restored_cli+['--restore','--target',str(root)],fail=True)
        assert denied.get('errorCode')=='INSTALLER_RESTORE_TARGET_ALREADY_OCCUPIED',denied
        assert sentinel.read_text()=='do-not-overwrite'
        sentinel.unlink()
        root.rmdir()

        restored=run(restored_cli+['--restore','--target',str(root)])
        assert restored['restored'] and restored['exactPreviousBytesPreserved']
        assert root.is_dir() and not retired.exists()
        assert (root/'product.json').read_bytes()==marker
        for name,b in configs.items():
            assert (root/'state/profiles'/(name+'.json')).read_bytes()==b
        assert sha((root/'state/owner-notes.txt').read_bytes())==original_note
        again=run(installed(root)+['--restore','--target',str(root)],fail=True)
        assert again.get('errorCode')=='INSTALLER_RESTORE_TARGET_ALREADY_OCCUPIED'
        print(json.dumps({'status':'OWNER_REVERSIBLE_UNINSTALL_PASS','os':os.name,
           'mode':a.mode,'profiles':len(configs),'userDataByteIdentical':True,
           'liveUninstallRejected':True,'targetCollisionRejected':True,
           'restorePreservesExactMarker':True,'repeatRestoreRejected':True,
           'destructiveDelete':False,'productionChanged':False,
           'installerSha256':sha(installer.read_bytes())}))
    print('REVERSIBLE_UNINSTALL_QA_CLEANED')

if __name__=='__main__':main()
