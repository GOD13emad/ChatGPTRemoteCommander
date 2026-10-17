import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const supported = process.platform === 'win32';
const fixture = fileURLToPath(new URL('./fixtures/local-management-windows-peer-proof.ps1', import.meta.url));

test('Windows: real cross-process current-user-only named pipe verifies both kernel peer PIDs (QA-only)', {
  skip: !supported, timeout: 20000
}, async t => {
  const p=spawn('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',fixture],
    {windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  for(const [stream,key] of [[p.stdout,'out'],[p.stderr,'err']]){
    stream.on('data',buf=>{if(key==='out')stdout+=buf;else stderr+=buf;
      assert.ok(stdout.length<12000 && stderr.length<12000,'QA_OUTPUT_LIMIT');
    });
  }
  const finished=new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',resolve);});
  t.after(async()=>{if(p.exitCode===null && p.signalCode===null)p.kill();await finished.catch(()=>{});});
  const exit=await finished;
  assert.equal(exit,0,'WIN_PIPE_FIXTURE_FAILED: '+stderr.slice(-1200));
  const result=JSON.parse(stdout.trim());
  assert.equal(result.status,'PASS_TWO_PROCESS_WINDOWS_NAMED_PIPE_CURRENT_USER_ONLY');
  for(const flag of ['peerPidMatchedSpawnedProcess','peerServerPidVerifiedByClient','noTcp','noAdministrator','noPersistentService'])
    assert.equal(result[flag],true,flag);
  assert.equal(result.childExit,0);
});
