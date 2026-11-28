// Actual Zenity owner consent UI is exercised on a disposable Xvfb display.
// This fixture cannot invoke the installer and never targets the user desktop.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {nativeApproval} from '../tools/universal-install/native-cli.mjs';

const self=fileURLToPath(import.meta.url);
const plan={platform:'linux',installedVersion:'0.12.0-dev.9',
  candidate:{version:'0.12.0-dev.10'},
  transactionId:'disposable-xvfb-fixture-only'};
if(process.env.RC012_PRIVATE_XVFB_CHILD==='1'){
  if(process.env.DISPLAY===':0'||!process.env.XAUTHORITY){
    console.error('PRIVATE_XVFB_REQUIRED');process.exitCode=15;
  }else{
    try{
      const receipt=await nativeApproval(plan,{
        guiApproval:true,
        // Xvfb is an isolated fake seat: the real same-owner systemd/Xauth
        // resolver is tested separately and must not be weakened for CI.
        ownerSeatResolver:()=>({DISPLAY:process.env.DISPLAY,
          XAUTHORITY:process.env.XAUTHORITY,
          XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR})
      });
      if(receipt.approved!==true||receipt.transactionId!==plan.transactionId)
        throw new Error('INCOMPLETE_RECEIPT');
      console.log('PRIVATE_GUI_APPROVED');
    }catch(e){
      if(e.code==='UNIVERSAL_NATIVE_OWNER_DECLINED'){
        console.log('PRIVATE_GUI_DECLINED');process.exitCode=12;
      }else{console.error(e?.code??e?.message);process.exitCode=15;}
    }
  }
}else{
  test('real Zenity approve and cancel render only on isolated Xvfb (no package effect)',t=>{
    if(process.platform!=='linux')return t.skip('Linux-only');
    for(const bin of ['/usr/bin/xvfb-run','/usr/bin/xauth','/usr/bin/xdotool','/usr/bin/zenity']){
      if(!fs.existsSync(bin))return t.skip('No isolated GUI fixture tools: '+bin);
    }
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-gui-xvfb-'));
    try{
      for(const [key,expected] of [['Return','PRIVATE_GUI_APPROVED'],['Escape','PRIVATE_GUI_DECLINED']]){
        const log=path.join(dir,key+'.log');
        const script=`
set -euo pipefail
export RC012_PRIVATE_XVFB_CHILD=1
export XDG_RUNTIME_DIR=/tmp
node "$1" > "$2" 2>&1 & child=$!
id=''
for i in $(seq 1 100); do
  id="$(xdotool search --onlyvisible --name 'ChatGPT Commander - Owner approval' 2>/dev/null | head -1 || :)"
  if [ -n "$id" ]; then break; fi
  sleep 0.05
done
if [ -z "$id" ]; then cat "$2"; kill "$child" 2>/dev/null || :; exit 24; fi
xdotool windowfocus --sync "$id"
xdotool key --clearmodifiers "$3"
wait "$child" && status=0 || status=$?
echo "GUI_CHILD_EXIT=$status"
if [ "$3" = Return ]; then test "$status" = 0; else test "$status" = 12; fi
`;
        const run=spawnSync('/usr/bin/xvfb-run',
          ['-a','-s','-screen 0 1024x768x24 -nolisten tcp','/bin/bash','-c',script,'bash',self,log,key],
          {encoding:'utf8',timeout:20000,maxBuffer:4096,
            env:{...process.env,RC012_PRIVATE_XVFB_CHILD:'0'}});
        assert.equal(run.error,undefined,String(run.error??''));
        assert.equal(run.status,0,[run.stdout,run.stderr,
          fs.existsSync(log)?fs.readFileSync(log,'utf8'):''].join('\n'));
        const recorded=fs.readFileSync(log,'utf8');
        assert.match(recorded,new RegExp(expected));
      }
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
}
