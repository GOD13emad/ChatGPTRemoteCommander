import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {createNativeWorkspaceJournal} from '../src/native-workspace-journal.mjs';

const exec=promisify(execFile);
const ref=()=>randomBytes(32).toString('hex');
const newRoot=()=>fs.mkdtemp(path.join(os.tmpdir(),'rc-native-journal-qa-'));
async function scoped(fn){
  const root=await newRoot();
  try{return await fn(root);}
  finally{await fs.rm(root,{recursive:true,force:true});}
}
const intent=(workspaceRef,operationId,kind='type',revision=0)=>
  ({workspaceRef,operationId,kind,revision});

test('journal requires a trusted root and refuses invalid workspace names',async()=>{
  assert.throws(()=>createNativeWorkspaceJournal({root:'relative'}),/ROOT_INVALID/);
  await scoped(async root=>{
    const j=createNativeWorkspaceJournal({root});
    await assert.rejects(j.prepare(intent('../escape','synthetic-action')),
      /WORKSPACE_REF_INVALID/);
    await assert.rejects(j.prepare(intent(ref(),'../escape')),
      /INTENT_INVALID/);
  });
});

test('exclusive pre-dispatch intent, sync ACK, next action and no input text persisted',
  async()=>scoped(async root=>{
    const A=ref(),j=createNativeWorkspaceJournal({root});
    const a=await j.prepare(intent(A,'stable-action-a'));
    const ws=path.join(root,'workspace-'+A);
    const entries=await fs.readdir(ws);
    assert.equal(entries.length,1);
    const raw=await fs.readFile(path.join(ws,entries[0]),'utf8');
    assert.match(raw,/PENDING_NATIVE_EFFECT/);
    assert.doesNotMatch(raw,/SECRET_ACTION_TEXT/);
    assert.doesNotMatch(raw,/stable-action-a/);
    assert.equal((await j.acknowledge(a)).submitted,true);
    await assert.rejects(j.prepare(intent(A,'stable-action-a')),
      /DUPLICATE_OPERATION/);
    const b=await j.prepare(intent(A,'stable-action-b','click',1));
    assert.equal((await j.acknowledge(b)).nativeEffectConfirmed,false);
    assert.equal((await fs.readdir(ws)).length,4);
    assert.equal((await j.inspect(A)).releaseAuthorized,false);
  }));

test('pending intent quarantines only its workspace, unrelated workspace can run',
  async()=>scoped(async root=>{
    const A=ref(),B=ref(),j=createNativeWorkspaceJournal({root});
    await j.prepare(intent(A,'unresolved'));
    const newProcess=createNativeWorkspaceJournal({root});
    const seen=await newProcess.inspect(A);
    assert.equal(seen.disposition,'RECOVERY_REQUIRED_NO_REPLAY');
    assert.equal(seen.nativeOutcome,'UNKNOWN');
    assert.equal(seen.releaseAuthorized,false);
    await assert.rejects(newProcess.prepare(intent(A,'blind-retry')),
      /RECOVERY_REQUIRED/);
    const b=await newProcess.prepare(intent(B,'other-worker'));
    await newProcess.acknowledge(b);
    assert.equal((await fs.readdir(path.join(root,'workspace-'+A))).length,1);
  }));

test('previous process acknowledgement cannot authorize a new process',async()=>scoped(async root=>{
  const A=ref(),first=createNativeWorkspaceJournal({root});
  const a=await first.prepare(intent(A,'first'));
  await first.acknowledge(a);
  const before=await fs.readdir(path.join(root,'workspace-'+A));
  const fresh=createNativeWorkspaceJournal({root});
  await assert.rejects(fresh.prepare(intent(A,'next')),/RECOVERY_REQUIRED/);
  assert.deepEqual(await fs.readdir(path.join(root,'workspace-'+A)),before);
  assert.equal((await fresh.inspect(A)).releaseAuthorized,false);
}));

test('forged or cloned handle cannot acknowledge a pending native effect',
  async()=>scoped(async root=>{
    const A=ref(),j=createNativeWorkspaceJournal({root});
    const a=await j.prepare(intent(A,'first'));
    await assert.rejects(j.acknowledge({...a}),/HANDLE_INVALID/);
    assert.equal((await fs.readdir(path.join(root,'workspace-'+A))).length,1);
    assert.equal((await j.acknowledge(a)).submitted,true);
    await assert.rejects(j.acknowledge(a),/HANDLE_INVALID/);
  }));

test('simultaneous intents on a new workspace admit at most one action',
  async()=>scoped(async root=>{
    const A=ref(),j=createNativeWorkspaceJournal({root});
    const outcomes=await Promise.allSettled([
      j.prepare(intent(A,'alpha')),j.prepare(intent(A,'beta'))
    ]);
    assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1);
    assert.equal(outcomes.filter(v=>v.status==='rejected').length,1);
    assert.equal((await fs.readdir(path.join(root,'workspace-'+A))).length,1);
  }));

test('tampering with receipt bytes and symlink paths blocks acknowledgement',
  async()=>scoped(async root=>{
    const A=ref(),j=createNativeWorkspaceJournal({root});
    const a=await j.prepare(intent(A,'one'));
    const ws=path.join(root,'workspace-'+A);
    const [name]=await fs.readdir(ws);
    await fs.writeFile(path.join(ws,'rogue.json'),'{"fake":true}');
    await assert.rejects(j.acknowledge(a),/EVIDENCE_CORRUPT/);
    await fs.rm(path.join(ws,'rogue.json'));
    await fs.rm(path.join(ws,name));
    await fs.symlink('/nonexistent',path.join(ws,name));
    await assert.rejects(j.acknowledge(a),/EVIDENCE_CORRUPT/);
  }));

test('unsafe root permissions and symlink root fail closed',
  {skip:process.platform==='win32'},async()=>scoped(async root=>{
    const A=ref(),j=createNativeWorkspaceJournal({root});
    await fs.chmod(root,0o777);
    await assert.rejects(j.prepare(intent(A,'first')),/DIRECTORY_UNTRUSTED/);
    await fs.chmod(root,0o700);
    const alias=path.join(root,'alias');
    await fs.symlink(root,alias);
    const via=createNativeWorkspaceJournal({root:alias});
    await assert.rejects(via.prepare(intent(ref(),'bad-symlink')),
      /DIRECTORY_UNTRUSTED/);
  }));

test('real child process crash after durable intent never resumes input on restart',
  {skip:process.platform==='win32'},async()=>scoped(async root=>{
    const A=ref(),B=ref();
    const snippet=[
      "const m=await import(process.argv[1]);",
      "const j=m.createNativeWorkspaceJournal({root:process.argv[2]});",
      "await j.prepare({workspaceRef:process.argv[3],operationId:'native-crash',kind:'key',revision:0});",
      "process.exit(73);"
    ].join('\n');
    let exit=null;
    try{
      await exec(process.execPath,['--input-type=module','-e',snippet,
        new URL('../src/native-workspace-journal.mjs',import.meta.url).href,
        root,A],{timeout:6500});
    }catch(e){exit=e.code;}
    assert.equal(exit,73);
    const recovered=createNativeWorkspaceJournal({root});
    assert.equal((await recovered.inspect(A)).releaseAuthorized,false);
    await assert.rejects(recovered.prepare(intent(A,'same-action')),
      /RECOVERY_REQUIRED/);
    const b=await recovered.prepare(intent(B,'other-worker'));
    await recovered.acknowledge(b);
  }));


test('crash between simulated native effect and ACK never replays that effect',
  {skip:process.platform==='win32'},async()=>scoped(async root=>{
    const A=ref(),B=ref(),marker=path.join(root,'synthetic-effect-count.txt');
    const snippet=[
      "const fs=await import('node:fs/promises');",
      "const m=await import(process.argv[1]);",
      "const j=m.createNativeWorkspaceJournal({root:process.argv[2]});",
      "await j.prepare({workspaceRef:process.argv[3],operationId:'action-A1',kind:'key',revision:0});",
      "await fs.writeFile(process.argv[4],'1',{flag:'wx',mode:0o600,flush:true});",
      "process.exit(79);"
    ].join('\n');
    let exit=null;
    try{
      await exec(process.execPath,['--input-type=module','-e',snippet,
        new URL('../src/native-workspace-journal.mjs',import.meta.url).href,
        root,A,marker],{timeout:6500});
    }catch(e){exit=e.code;}
    assert.equal(exit,79);
    assert.equal(await fs.readFile(marker,'utf8'),'1');
    const recovered=createNativeWorkspaceJournal({root});
    await assert.rejects(recovered.prepare(intent(A,'action-A1','key')),
      /RECOVERY_REQUIRED/);
    await assert.rejects(recovered.prepare(intent(A,'new-action','key')),
      /RECOVERY_REQUIRED/);
    assert.equal(await fs.readFile(marker,'utf8'),'1',
      'synthetic native effect was applied once before crash, never replayed');
    const b=await recovered.prepare(intent(B,'independent-workspace','key'));
    await recovered.acknowledge(b);
  }));
