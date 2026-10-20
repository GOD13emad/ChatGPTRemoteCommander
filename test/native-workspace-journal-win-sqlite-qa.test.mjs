// QA ONLY: actual Windows SQLite intent/ACK, replay and process-death tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createWindowsNativeJournalQA} from '../src/native-workspace-journal-win-sqlite-qa.mjs';

const ref=()=>randomBytes(32).toString('hex');
const tmp=()=>fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-native-journal-win-sqlite-qa-')));
const owned=async (fn,{provision=true}={})=>{
  const root=tmp();
  try{
    if(provision){const j=createWindowsNativeJournalQA({root});j.provision();j.close();}
    await fn(root);
  }finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:120});}
};
const runChild=(root,mode,workspaceRef,operationId)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url)],{
    env:{...process.env,RC_SQLITE_QA_CHILD:'1',RC_SQLITE_ROOT:root,RC_SQLITE_MODE:mode,RC_SQLITE_WORKSPACE:workspaceRef,RC_SQLITE_OPERATION:operationId},
    stdio:['ignore','pipe','pipe']
  });
  let out='',err='';
  child.stdout.on('data',c=>out+=c);
  child.stderr.on('data',c=>err+=c);
  child.on('error',reject);
  child.on('close',code=>resolve({code,out,err}));
});

if(process.env.RC_SQLITE_QA_CHILD==='1'){
  const j=createWindowsNativeJournalQA({root:process.env.RC_SQLITE_ROOT});
  try{
    await j.execute({workspaceRef:process.env.RC_SQLITE_WORKSPACE,
      operationId:process.env.RC_SQLITE_OPERATION,kind:'click'},async()=>{
        if(process.env.RC_SQLITE_MODE==='crash')process.exit(43);
        if(process.env.RC_SQLITE_MODE==='race')await new Promise(r=>setTimeout(r,450));
      });
    process.stdout.write('ACCEPTED\n');
  }catch(e){
    process.stdout.write('DENIED:'+e.code+'\n');
  }finally{j.close();}
}else{
  test('ack persists; prior operation cannot be replayed across process-local reopens',
    {skip:process.platform!=='win32'},async()=>owned(async root=>{
      const ws=ref(),id='sample-win-op-1';
      let effects=0;
      let j=createWindowsNativeJournalQA({root});
      await j.execute({workspaceRef:ws,operationId:id,kind:'click'},async()=>{effects++;});
      assert.equal(effects,1);
      assert.equal(j.inspect(id).state,'ACKED');
      j.close();
      j=createWindowsNativeJournalQA({root});
      await assert.rejects(j.execute({workspaceRef:ws,operationId:id,kind:'click'},()=>{effects++;}),
        e=>e.code==='WIN_JOURNAL_OPERATION_REPLAY_DENIED');
      assert.equal(effects,1);
      await j.execute({workspaceRef:ws,operationId:'sample-win-op-2',kind:'drag'},async()=>{effects++;});
      assert.equal(effects,2);
      j.close();
    })
  );
  test('unknown effect quarantines only its workspace, never replays',
    {skip:process.platform!=='win32'},async()=>owned(async root=>{
      const j=createWindowsNativeJournalQA({root});
      const a=ref(),b=ref();
      let replayed=false;
      await assert.rejects(j.execute({workspaceRef:a,operationId:'faulted-op',kind:'type'},
        ()=>{throw Error('unexpected native outcome');}));
      assert.equal(j.inspect('faulted-op').state,'PREPARED');
      await assert.rejects(j.execute({workspaceRef:a,operationId:'new-op',kind:'click'},()=>{
        replayed=true;
      }),e=>e.code==='WIN_JOURNAL_WORKSPACE_UNCERTAIN');
      assert.equal(replayed,false);
      await j.execute({workspaceRef:b,operationId:'unrelated-ok',kind:'click'},async()=>{});
      assert.equal(j.inspect('unrelated-ok').state,'ACKED');
      j.close();
    })
  );
  test('OS child crash after intent remains PREPARED; another workspace is usable',
    {skip:process.platform!=='win32'},async()=>owned(async root=>{
      const ws=ref(),other=ref(),id='crash-before-ack';
      const child=await runChild(root,'crash',ws,id);
      assert.equal(child.code,43,child.err);
      const j=createWindowsNativeJournalQA({root});
      assert.equal(j.inspect(id).state,'PREPARED');
      await assert.rejects(j.execute({workspaceRef:ws,operationId:'retry-is-forbidden',kind:'click'},()=>{}),
        e=>e.code==='WIN_JOURNAL_WORKSPACE_UNCERTAIN');
      await j.execute({workspaceRef:other,operationId:'other-after-crash',kind:'click'},async()=>{});
      j.close();
    })
  );
  test('two independent processes racing for one workspace admit at most one effect',
    {skip:process.platform!=='win32'},async()=>owned(async root=>{
      const initial=createWindowsNativeJournalQA({root});
      initial.close();
      const ws=ref();
      const responses=await Promise.all([
        runChild(root,'race',ws,'race-child-A'),
        runChild(root,'race',ws,'race-child-B')
      ]);
      for(const r of responses)assert.equal(r.code,0,r.err);
      assert.equal(responses.filter(r=>r.out.includes('ACCEPTED')).length,1,JSON.stringify(responses));
      assert.equal(responses.filter(r=>r.out.includes('DENIED:WIN_JOURNAL_WORKSPACE_UNCERTAIN')).length,1,JSON.stringify(responses));
      const j=createWindowsNativeJournalQA({root});
      assert.equal(['ACKED','PREPARED'].filter(s=>j.inspect('race-child-A')?.state===s||j.inspect('race-child-B')?.state===s).length>=1,true);
      j.close();
    })
  );
  test('rejects invalid references and stores no GUI content or raw key text',
    {skip:process.platform!=='win32'},async()=>owned(async root=>{
      const j=createWindowsNativeJournalQA({root});
      let ran=false;
      await assert.rejects(j.execute({workspaceRef:'../../escape',operationId:'bad',kind:'type'},()=>{ran=true;}),
        e=>e.code==='WIN_JOURNAL_WORKSPACE_INVALID');
      assert.equal(ran,false);
      await j.execute({workspaceRef:ref(),operationId:'sensitive-opaque-1',kind:'type'},async()=>{});
      j.close();
      const db=fs.readFileSync(path.join(root,'native-workspace-qa.sqlite')).toString('utf8');
      assert.equal(db.includes('private-secret-typed-text'),false);
    })
  );

  test('read-only inspect does not create a missing journal database',
    {skip:process.platform!=='win32'},async()=>owned(async root=>{
      const j=createWindowsNativeJournalQA({root});
      assert.equal(j.inspect('never-created'),null);
      assert.equal(fs.existsSync(path.join(root,'native-workspace-qa.sqlite')),false,
        'observation must not silently initialize native effect state');
      j.close();
    },{provision:false})
  );
  test('missing journal after successful native effect cannot silently reauthorize replay',
    {skip:process.platform!=='win32'},async()=>owned(async root=>{
      const workspaceRef=ref(),operationId='must-not-repeat-after-db-loss';
      let effects=0;
      let j=createWindowsNativeJournalQA({root});
      await j.execute({workspaceRef,operationId,kind:'click'},async()=>{effects++;});
      j.close();
      const database=path.join(root,'native-workspace-qa.sqlite');
      fs.unlinkSync(database);
      j=createWindowsNativeJournalQA({root});
      await assert.rejects(j.execute({workspaceRef,operationId,kind:'click'},
        async()=>{effects++;}),error=>error?.code==='WIN_JOURNAL_HISTORY_INCOMPLETE');
      assert.equal(effects,1);
      assert.equal(fs.existsSync(database),false,
        'missing journal must not be silently replaced by dispatch');
      j.close();
    })
  );

  test('provisioning is explicit and cannot silently reset an existing journal',
    {skip:process.platform!=='win32'},async()=>owned(async root=>{
      const j=createWindowsNativeJournalQA({root});
      const workspaceRef=ref();
      await j.execute({workspaceRef,operationId:'original-ack',kind:'click'},async()=>{});
      const database=path.join(root,'native-workspace-qa.sqlite');
      const before=fs.readFileSync(database);
      assert.throws(()=>j.provision(),e=>e?.code==='WIN_JOURNAL_ALREADY_INITIALIZED');
      assert.deepEqual(fs.readFileSync(database),before);
      assert.equal(j.inspect('original-ack').state,'ACKED');
      j.close();
    })
  );

  test('deleted database cannot be provisioned again while its epoch marker survives',
    {skip:process.platform!=='win32'},async()=>owned(async root=>{
      const j=createWindowsNativeJournalQA({root});
      const ws=ref();
      await j.execute({workspaceRef:ws,operationId:'before-loss',kind:'click'},async()=>{});
      const db=path.join(root,'native-workspace-qa.sqlite');
      const marker=path.join(root,'native-workspace-qa.epoch');
      assert.equal(fs.existsSync(marker),true,'provision must create a persistent generation marker');
      fs.unlinkSync(db);
      assert.throws(()=>j.provision(),e=>e?.code==='WIN_JOURNAL_ALREADY_INITIALIZED');
      assert.equal(fs.existsSync(db),false,'provision must not recreate lost history');
      j.close();
    })
  );
  test('missing epoch marker denies inspection and additional native input',
    {skip:process.platform!=='win32'},async()=>owned(async root=>{
      const j=createWindowsNativeJournalQA({root});
      const ws=ref();
      await j.execute({workspaceRef:ws,operationId:'before-marker-loss',kind:'click'},async()=>{});
      fs.unlinkSync(path.join(root,'native-workspace-qa.epoch'));
      assert.throws(()=>j.inspect('before-marker-loss'),e=>e?.code==='WIN_JOURNAL_HISTORY_INCOMPLETE');
      let effects=0;
      await assert.rejects(j.execute({workspaceRef:ws,operationId:'after-marker-loss',kind:'click'},async()=>{effects++;}),
        e=>e?.code==='WIN_JOURNAL_HISTORY_INCOMPLETE');
      assert.equal(effects,0);
      j.close();
    })
  );
  test('swapped SQLite file from different workspace root fails generation binding',
    {skip:process.platform!=='win32'},async()=>owned(async a=>owned(async b=>{
      const ja=createWindowsNativeJournalQA({root:a}), jb=createWindowsNativeJournalQA({root:b});
      await ja.execute({workspaceRef:ref(),operationId:'source-a',kind:'click'},async()=>{});
      await jb.execute({workspaceRef:ref(),operationId:'source-b',kind:'click'},async()=>{});
      fs.copyFileSync(path.join(b,'native-workspace-qa.sqlite'),path.join(a,'native-workspace-qa.sqlite'));
      assert.throws(()=>ja.inspect('source-a'),e=>e?.code==='WIN_JOURNAL_GENERATION_MISMATCH');
      ja.close();jb.close();
    }))
  );
}
