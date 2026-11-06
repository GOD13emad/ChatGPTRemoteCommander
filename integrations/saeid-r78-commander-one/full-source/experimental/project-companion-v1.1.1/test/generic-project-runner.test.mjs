import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {admitGrant,canonical,hash,hashData,parseStrictJson,unsignedFileId,identityFromStat,validateIdentity,sameIdentity,sameStatIdentity,inspectDirectory,readPinned} from '../src/project-catalog.mjs';
import {createProjectRunner} from '../src/durable-project-runner.mjs';

// Fixtures have fresh task-specific short roots. They are preserved, not swept
// by a recursive cleanup; tests never invoke a model, command or live server.
function fixture({command=false,modelFailure=false,postWriteFailure=false,filePort=false}={}){
  const base=fs.realpathSync.native(fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'rc-general-v111-'))),root=path.join(base,'project'),stateRoot=path.join(base,'state');fs.mkdirSync(root);fs.mkdirSync(stateRoot);
  const input='first needle second needle\n',source='export const fixture = true;\n',program='synthetic-image-not-an-executable';
  fs.writeFileSync(path.join(root,'input.txt'),input);const sourcePath=path.join(base,'source.mjs'),programPath=path.join(base,'image.exe');fs.writeFileSync(sourcePath,source);fs.writeFileSync(programPath,program);
  const output='{"accepted_fixture":true}\n',sourcePin={path:sourcePath,sha256:hash(source),bytes:Buffer.byteLength(source)};
  const catalog=[{id:'read_input',kind:'read_text',path:'input.txt',sha256:hash(input),bytes:Buffer.byteLength(input)},
    {id:'find_marker',kind:'search_files',path:'input.txt',sha256:hash(input),bytes:Buffer.byteLength(input),query:'needle',maxMatches:2},
    {id:'write_output',kind:'write_text',path:'result.json',content:output,sha256:hash(output),bytes:Buffer.byteLength(output)}];
  if(command)catalog.push({id:'approved_command',kind:'run_project_command',program:programPath,executableSha256:hash(program),args:[sourcePath,'--fixture'],cwd:root,sourcePins:[sourcePin],timeoutMs:30000,maxOutputBytes:65536,memoryMb:512});
  const grant={schema:1,projectId:'test_project',owner:'saeed',authorizationSha256:'a'.repeat(64),root,
    inputs:[{path:'input.txt',sha256:hash(input),bytes:Buffer.byteLength(input)}],sourcePins:[sourcePin],catalog,
    budgets:{maxModelCalls:8,maxActions:8,wallTimeMs:600000,maxOutputBytes:65536},acceptance:[{type:'file_sha256',path:'result.json',sha256:hash(output),bytes:Buffer.byteLength(output)}]};
  const calls=[],nativeCalls=[],fileCalls=[];let clock=Date.now(),runner;
  const modelPort={async plan(context,meta){calls.push({context,meta});const last=history().at(-1);assert.equal(last.type,'MODEL_INTENT');assert.equal(last.payload.callId,meta.callId);if(modelFailure)throw Object.assign(Error('original model failure'),{code:'MODEL_PORT_FAILURE'});return reply(meta.callId);}};
  const nativePort=async(request,meta)=>{nativeCalls.push({request,meta});assert.equal(history().at(-1).type,'ACTION_INTENT');return nativeResult();};
  const files={async readPinned(request,meta){fileCalls.push({request,meta});const text=fs.readFileSync(request.target,'utf8');return {validated:true,sha256:hash(text),bytes:Buffer.byteLength(text),text,proofSha256:'c'.repeat(64)};},
    async createOnly(request,meta){fileCalls.push({request,meta});assert.equal(history().at(-1).type,'ACTION_INTENT');fs.writeFileSync(request.target,request.content,{flag:'wx'});if(postWriteFailure)throw Object.assign(Error('post publication failure'),{code:'POST_PUBLICATION_FAILURE'});return {validated:true,sha256:request.sha256,bytes:request.bytes,text:null,proofSha256:'d'.repeat(64)};}};
  const opts={stateRoot,grant,modelPort,nativePort,now:()=>clock,...(filePort||postWriteFailure?{filePort:files}:{})};
  function history(){const p=path.join(stateRoot,'HISTORY.jsonl');return fs.existsSync(p)?fs.readFileSync(p,'utf8').trimEnd().split('\n').map(line=>parseStrictJson(line)):[];}
  function open(changes={}){runner=createProjectRunner({...opts,...changes});return runner;}
  return {base,root,stateRoot,sourcePath,programPath,grant,opts,modelPort,nativePort,files,calls,nativeCalls,fileCalls,history,open,
    now:()=>clock,advance:ms=>{clock+=ms;},setClock:value=>{clock=value;},get runner(){return runner;}};
}
const reply=callId=>({proposal:{choice:'CONTINUE_STEP'},receipt:{model:'gpt-6.1-sol',callId,validated:true,streamSha256:'e'.repeat(64),artifactSha256:'f'.repeat(64)}});
function nativeResult(){return {proof:{schema:1,status:'COMPLETED',assignedBeforeResume:true,cleanupConfirmed:true,activeJobProcesses:0,ownedJobTerminated:false,win32Error:0,cleanupWin32Error:0},stdout:'synthetic command proof\n',stderr:'',exitCode:0,signal:null,closed:true,overflow:false,pipeError:null};}
async function finish(runner,count){for(let n=0;n<count;n++)await runner.tick();return runner.tick();}
function rewriteHistory(f,change){const events=f.history();change(events);let previous='0'.repeat(64);events.forEach((event,index)=>{event.seq=index+1;event.previousSha256=previous;const {sha256:ignored,...unsigned}=event;event.sha256=hashData(unsigned);previous=event.sha256;});fs.writeFileSync(path.join(f.stateRoot,'HISTORY.jsonl'),events.map(canonical).join('\n')+'\n');}
const largeFileId=188869709377531519n;
function changedStat(stat,change){return Object.assign(Object.create(Object.getPrototypeOf(stat)),stat,change);}
test('canonical uint64 identity strings preserve zero and maximum, rejecting nondecimal or numeric legacy encodings',()=>{
  for(const value of ['0','1','9007199254740993','188869709377531519','18446744073709551615'])assert.equal(unsignedFileId(value),value);
  for(const value of [0,1,Number(largeFileId),null,undefined,1n,'','00','01','+1','-1',' 1','1 ','1.0','1e3','1E3','18446744073709551616','999999999999999999999'])assert.throws(()=>unsignedFileId(value),{code:'CATALOG_FILE_ID_DECIMAL_UINT64'});
});
test('identity is encoded from original BigInt only; adjacent high NTFS IDs are distinguishable',()=>{
  const a=identityFromStat({dev:3228628090n,ino:largeFileId}),b=identityFromStat({dev:3228628090n,ino:largeFileId+1n});assert.equal(Number(largeFileId),Number(largeFileId+1n));assert.equal(a.ino,'188869709377531519');assert.equal(b.ino,'188869709377531520');assert.notDeepEqual(a,b);assert.equal(sameStatIdentity({dev:3228628090n,ino:largeFileId},{dev:3228628090n,ino:largeFileId+1n}),false);
  for(const stat of [{dev:1,ino:1},{dev:1n,ino:Number(largeFileId)},{dev:-1n,ino:1n},{dev:1n,ino:-1n},{dev:18446744073709551616n,ino:1n},{dev:1n,ino:18446744073709551616n}])assert.throws(()=>identityFromStat(stat),{code:'CATALOG_FILE_ID_BIGINT_REQUIRED'});
});
test('directory identity durable encode/decode and clean reopen retains high bits without any model/effect',t=>{
  const f=fixture(),original=fs.lstatSync;t.mock.method(fs,'lstatSync',(target,options)=>{assert.equal(options?.bigint,true);const s=original(target,options);return target===f.root?changedStat(s,{ino:largeFileId}):s;});
  const r=f.open(),enrolled=f.history()[0];assert.equal(enrolled.payload.rootIdentity.ino,largeFileId.toString());assert.equal(typeof enrolled.payload.rootIdentity.dev,'string');assert.equal(validateIdentity(parseStrictJson(canonical(enrolled.payload.rootIdentity))).ino,largeFileId.toString());r.close();const reopened=f.open();try{assert.equal(reopened.status().modelCalls,0);assert.equal(reopened.status().actions,0);assert.equal(reopened.status().deadline,enrolled.payload.deadline);assert.equal(f.calls.length,0);assert.equal(f.nativeCalls.length,0);}finally{reopened.close();}
});
test('closed directory identity schema rejects numeric migration, extra fields and noncanonical path',()=>{
  const f=fixture(),identity={path:f.root,dev:'1',ino:largeFileId.toString()};assert.equal(sameIdentity(identity,{...identity}),true);assert.equal(sameIdentity(identity,{...identity,ino:(largeFileId+1n).toString()}),false);
  assert.throws(()=>validateIdentity({...identity,dev:1}),{code:'CATALOG_LEGACY_NUMERIC_IDENTITY'});assert.throws(()=>validateIdentity({...identity,ino:Number(largeFileId)}),{code:'CATALOG_LEGACY_NUMERIC_IDENTITY'});assert.throws(()=>validateIdentity({...identity,ino:'0188869709377531519'}),{code:'CATALOG_FILE_ID_DECIMAL_UINT64'});assert.throws(()=>validateIdentity({...identity,extra:true}),{code:'CATALOG_FILE_IDENTITY_FIELDS'});assert.throws(()=>validateIdentity({...identity,path:f.root+path.sep+'.'}),{code:'CATALOG_CANONICAL_PATH'});
});
test('numeric stats mock is refused before owner lock, enrollment, model or effect',t=>{
  const f=fixture(),original=fs.lstatSync;t.mock.method(fs,'lstatSync',(target,options)=>{assert.equal(options?.bigint,true);const s=original(target,options);return target===f.root?changedStat(s,{ino:Number(largeFileId)}):s;});
  assert.throws(()=>f.open(),{code:'CATALOG_FILE_ID_BIGINT_REQUIRED'});assert.equal(fs.existsSync(path.join(f.stateRoot,'OWNER_LOCK.json')),false);assert.equal(fs.existsSync(path.join(f.stateRoot,'HISTORY.jsonl')),false);assert.equal(f.calls.length,0);assert.equal(f.nativeCalls.length,0);assert.equal(fs.existsSync(path.join(f.root,'result.json')),false);
});
test('adjacent high directory ID drift is detected before model/effect; no weakened root guard',async t=>{
  const f=fixture(),original=fs.lstatSync;let drift=false;t.mock.method(fs,'lstatSync',(target,options)=>{const s=original(target,options);return target===f.root?changedStat(s,{ino:largeFileId+(drift?1n:0n)}):s;});const r=f.open();drift=true;try{await assert.rejects(r.tick(),{code:'PROJECT_ROOT_DRIFT'});assert.equal(f.calls.length,0);assert.equal(f.nativeCalls.length,0);assert.equal(f.history().some(e=>e.type==='MODEL_INTENT'),false);}finally{drift=false;r.close();}
});
test('legacy numeric identities in a closed journal are not automatically migrated or replayed',()=>{
  const f=fixture(),r=f.open();r.close();rewriteHistory(f,events=>{events[0].payload.rootIdentity.ino=Number(largeFileId);});const journal=path.join(f.stateRoot,'HISTORY.jsonl'),before=fs.readFileSync(journal);assert.throws(()=>f.open(),{code:'CATALOG_LEGACY_NUMERIC_IDENTITY'});assert.deepEqual(fs.readFileSync(journal),before);assert.equal(fs.existsSync(path.join(f.stateRoot,'OWNER_LOCK.json')),false);assert.equal(f.calls.length,0);assert.equal(f.nativeCalls.length,0);
});
for(const stage of ['opened','after','named'])test('pinned read rejects adjacent high file ID drift at '+stage,t=>{
  const f=fixture(),file=path.join(f.root,'input.txt'),originalLstat=fs.lstatSync,originalFstat=fs.fstatSync;let observations=0,namedObservations=0;
  t.mock.method(fs,'lstatSync',(target,options)=>{assert.equal(options?.bigint,true);const s=originalLstat(target,options);if(target!==file)return s;namedObservations++;return changedStat(s,{ino:largeFileId+(stage==='named'&&namedObservations>1?1n:0n)});});
  t.mock.method(fs,'fstatSync',(fd,options)=>{assert.equal(options?.bigint,true);const s=originalFstat(fd,options);observations++;return changedStat(s,{ino:largeFileId+(stage==='opened'||stage==='after'&&observations>1?1n:0n)});});assert.throws(()=>readPinned(file,f.grant.inputs[0]),{code:'CATALOG_FILE_CHANGED'});assert.equal(f.calls.length,0);
});
test('pinned read still enforces nanosecond time and exact safe size bound',t=>{
  const f=fixture(),file=path.join(f.root,'input.txt'),original=fs.fstatSync;let observations=0;t.mock.method(fs,'fstatSync',(fd,options)=>{const s=original(fd,options);observations++;return observations>1?changedStat(s,{mtimeNs:s.mtimeNs+1n}):s;});assert.throws(()=>readPinned(file,f.grant.inputs[0]),{code:'CATALOG_FILE_CHANGED'});assert.throws(()=>readPinned(file,{maxBytes:Number.MAX_SAFE_INTEGER+1}),{code:'CATALOG_FILE_BOUND'});
});
test('held exclusive lock detects adjacent high identity drift and releases only the original owner',async t=>{
  const f=fixture(),lock=path.join(f.stateRoot,'OWNER_LOCK.json'),open=fs.openSync,lstat=fs.lstatSync,fstat=fs.fstatSync;let lockFd,drift=false;const lockReads=new Set();
  t.mock.method(fs,'openSync',(target,...args)=>{const fd=open(target,...args);lockReads.delete(fd);if(target===lock){if(args[0]==='wx')lockFd=fd;else lockReads.add(fd);}return fd;});t.mock.method(fs,'lstatSync',(target,options)=>{const s=lstat(target,options);return target===lock?changedStat(s,{ino:largeFileId}):s;});t.mock.method(fs,'fstatSync',(fd,options)=>{const s=fstat(fd,options);return fd===lockFd||lockReads.has(fd)?changedStat(s,{ino:largeFileId+(fd===lockFd&&drift?1n:0n)}):s;});
  const r=f.open();drift=true;try{await assert.rejects(r.tick(),{code:'PROJECT_LOCK_DRIFT'});assert.equal(f.calls.length,0);assert.equal(f.nativeCalls.length,0);}finally{drift=false;r.close();}assert.equal(fs.existsSync(lock),false);
});
test('journal append compares held original BigInt identity to adjacent high named identity without publishing intent',async t=>{
  const f=fixture(),journal=path.join(f.stateRoot,'HISTORY.jsonl'),open=fs.openSync,lstat=fs.lstatSync,fstat=fs.fstatSync;let journalFd,armed=false,appendSeen=false;const journalReads=new Set();
  t.mock.method(fs,'openSync',(target,...args)=>{const fd=open(target,...args);journalReads.delete(fd);if(target===journal){if(['ax','a'].includes(args[0]))journalFd=fd;else journalReads.add(fd);}return fd;});t.mock.method(fs,'lstatSync',(target,options)=>{const s=lstat(target,options);return target===journal?changedStat(s,{ino:largeFileId+(armed&&appendSeen?1n:0n)}):s;});t.mock.method(fs,'fstatSync',(fd,options)=>{const s=fstat(fd,options);if(fd===journalFd&&armed)appendSeen=true;return fd===journalFd||journalReads.has(fd)?changedStat(s,{ino:largeFileId}):s;});
  const r=f.open(),before=fs.readFileSync(journal);armed=true;try{await assert.rejects(r.tick(),{code:'PROJECT_JOURNAL_BOUND_OR_DRIFT'});assert.deepEqual(fs.readFileSync(journal),before);assert.equal(f.calls.length,0);assert.equal(f.nativeCalls.length,0);}finally{armed=false;appendSeen=false;r.close();}
});
test('all runtime stats for enrollment, pinned data, journal, write, restart and lock close are original BigInt',async t=>{
  const f=fixture(),lstat=fs.lstatSync,fstat=fs.fstatSync;let lstatCalls=0,fstatCalls=0;t.mock.method(fs,'lstatSync',(target,options)=>{assert.equal(options?.bigint,true);lstatCalls++;return lstat(target,options);});t.mock.method(fs,'fstatSync',(fd,options)=>{assert.equal(options?.bigint,true);fstatCalls++;return fstat(fd,options);});const r=f.open();await r.tick();r.close();const reopened=f.open();try{assert.equal((await finish(reopened,2)).status,'FINAL_ACCEPTED');}finally{reopened.close();}assert.ok(lstatCalls>0&&fstatCalls>0);
});

test('enrollment is one timestamp transaction with a clock advancing on every observation',async()=>{
  const f=fixture();let clock=Date.now(),observations=0;const r=f.open({now:()=>{observations++;return clock++;}});const enrolled=f.history()[0];assert.equal(observations,1);assert.equal(enrolled.at,enrolled.payload.createdAt);assert.equal(enrolled.payload.deadline,enrolled.at+f.grant.budgets.wallTimeMs);const deadline=r.status().deadline;
  try{assert.equal((await finish(r,3)).status,'FINAL_ACCEPTED');assert.ok(observations>1);assert.equal(r.status().deadline,deadline);}finally{r.close();}
});
test('actual Date.now enrollment accepts the same strict timestamp and resumes confirmed receipts',async()=>{
  for(let project=0;project<5;project++){const f=fixture(),r=f.open({now:Date.now});const enrolled=f.history()[0];assert.equal(enrolled.at,enrolled.payload.createdAt);await r.tick();const before=r.status();r.close();const reopened=f.open({now:Date.now});try{assert.equal(reopened.status().deadline,before.deadline);assert.equal(reopened.status().modelCalls,1);assert.equal(reopened.status().actions,1);await reopened.tick();await reopened.tick();assert.equal((await reopened.tick()).status,'FINAL_ACCEPTED');assert.equal(f.calls.length,3);for(const event of f.history().filter(e=>e.type==='ACTION_INTENT'))assert.ok(event.payload.effectiveTimeoutMs<=enrolled.payload.deadline-event.at);}finally{reopened.close();}}
});
test('action intention clamps only downward against its own persisted timestamp',async()=>{
  const f=fixture({command:true});let clock=Date.now();const r=f.open({now:()=>clock++});try{await finish(r,4);for(const event of f.history().filter(e=>e.type==='ACTION_INTENT')){assert.ok(event.payload.effectiveTimeoutMs<=r.status().deadline-event.at);assert.ok(event.payload.effectiveTimeoutMs>0);}const native=f.nativeCalls[0];assert.ok(native.request.timeoutMs<=f.grant.catalog[3].timeoutMs);assert.equal(native.meta.deadline,r.status().deadline);}finally{r.close();}
});
test('forward clock jump after intent preserves uncertainty and prevents owned write below 100ms',async()=>{
  const f=fixture({filePort:true});let r,creates=0;r=f.open({filePort:{async readPinned(request,meta){const last=f.history().at(-1);if(meta.purpose==='input_preflight'&&last.type==='ACTION_INTENT'&&last.payload.stepId==='write_output')f.setClock(r.status().deadline-99);return f.files.readPinned(request,meta);},async createOnly(request,meta){creates++;return f.files.createOnly(request,meta);}}});try{await r.tick();await r.tick();await assert.rejects(r.tick(),{code:'PROJECT_DEADLINE_EXPIRED'});assert.equal(creates,0);assert.equal(fs.existsSync(path.join(f.root,'result.json')),false);assert.equal(r.status().pending.length,1);assert.equal(r.status().deadline,f.history()[0].payload.deadline);}finally{r.close();}
});
test('forward clock jump through deadline before effect keeps confirmed decision but adds no action intent',async()=>{
  const f=fixture(),r=f.open({modelPort:{async plan(context,meta){f.setClock(context.deadline+10);return reply(meta.callId);}}});try{const v=await r.tick();assert.equal(v.status,'BUDGET_STOP');assert.equal(v.actions,0);assert.equal(v.modelCalls,1);assert.equal(f.history().some(e=>e.type==='ACTION_INTENT'),false);assert.equal(v.deadline,f.history()[0].payload.deadline);}finally{r.close();}
});
test('nonmonotonic clock during awaited model preserves original reversal with no action authority',async()=>{
  const f=fixture(),r=f.open({modelPort:{async plan(context,meta){f.setClock(f.now()-1);return reply(meta.callId);}}});try{const error=await r.tick().then(()=>null,e=>e);assert.equal(error.code,'PROJECT_CLOCK_REVERSED');assert.equal(r.status().actions,0);assert.equal(r.status().pending.length,1);assert.equal(r.status().modelCalls,1);}finally{f.advance(2);r.close();}
});
test('deadline crossing between tick admission and model intent stops without publishing intent or calling model',async()=>{
  const f=fixture();let r,clock=f.now();r=f.open({now:()=>{const file=path.join(f.stateRoot,'HISTORY.jsonl');if(fs.existsSync(path.join(f.stateRoot,'models','call_1'))&&fs.existsSync(file)&&!fs.readFileSync(file,'utf8').includes('MODEL_INTENT'))clock=r.status().deadline;return clock;}});try{const v=await r.tick();assert.equal(v.status,'BUDGET_STOP');assert.equal(v.modelCalls,0);assert.equal(v.actions,0);assert.equal(f.calls.length,0);assert.equal(f.history().some(e=>e.type==='MODEL_INTENT'),false);assert.equal(f.history().at(-1).type,'BUDGET_STOP');}finally{r.close();}
});
test('invalid control after FINAL is rejected without persisting another event',async()=>{
  const f=fixture(),r=f.open();try{await finish(r,3);const before=fs.readFileSync(path.join(f.stateRoot,'HISTORY.jsonl'));assert.throws(()=>r.control('pause'),{code:'PROJECT_CONTROL_TERMINAL'});assert.deepEqual(fs.readFileSync(path.join(f.stateRoot,'HISTORY.jsonl')),before);assert.equal(r.status().status,'FINAL_ACCEPTED');}finally{r.close();}
});
test('invalid command timeout grant is rejected before journal publication or model invocation',()=>{
  const f=fixture({command:true});f.grant.catalog[3].timeoutMs=180001;assert.throws(()=>f.open());assert.equal(fs.existsSync(path.join(f.stateRoot,'HISTORY.jsonl')),false);assert.equal(f.calls.length,0);
});
test('failed proposed transition leaves prior valid journal unchanged and preserves original error',async()=>{
  const f=fixture();let r,armed=false;r=f.open({now:()=>{if(armed&&fs.existsSync(path.join(f.stateRoot,'models','call_1')))return f.now()-1;return f.now();}});const before=fs.readFileSync(path.join(f.stateRoot,'HISTORY.jsonl'));armed=true;try{const error=await r.tick().then(()=>null,e=>e);assert.equal(error.code,'PROJECT_CLOCK_REVERSED');assert.equal(error.collectorError.code,'PROJECT_CLOCK_REVERSED');assert.deepEqual(fs.readFileSync(path.join(f.stateRoot,'HISTORY.jsonl')),before);assert.equal(r.status().modelCalls,0);assert.equal(f.calls.length,0);}finally{armed=false;r.close();}
});

test('generic 4-action catalog: independent final output and durable outbox; no real native/model execution',async()=>{
  const f=fixture({command:true,filePort:true}),r=f.open();try{
    assert.equal(r.status().modelCalls,0);assert.equal(f.calls.length,0);const result=await finish(r,4);
    assert.equal(result.status,'FINAL_ACCEPTED');assert.equal(result.modelCalls,4);assert.equal(result.actions,4);assert.equal(result.completedSteps.length,4);assert.equal(result.outbox.length,4);assert.equal(f.nativeCalls.length,1);
    assert.ok(f.fileCalls.some(x=>x.meta.purpose==='acceptance'));assert.ok(f.fileCalls.some(x=>x.meta.purpose==='completed_recheck'));assert.equal(f.nativeCalls[0].request.cwd,f.root);assert.deepEqual(f.nativeCalls[0].request.args,[f.sourcePath,'--fixture']);
    assert.equal(f.nativeCalls[0].request.executableSha256,f.grant.catalog[3].executableSha256);assert.equal(result.operationalAcceptance,'NOT_CLAIMED_BY_GENERIC_MODULE');
    await r.tick();assert.equal(f.calls.length,4);assert.equal(f.nativeCalls.length,1);const id=result.outbox[0].eventId;r.acknowledge(id);r.acknowledge(id);assert.equal(r.status().outbox.length,3);
  }finally{r.close();}
});
test('decision context has current executor time, exact admitted read scope, hashes and explicit reserved budgets',async()=>{
  const f=fixture(),r=f.open();try{await r.tick();const c=f.calls[0].context,a=f.grant.catalog[0];assert.equal(c.currentTime,f.now());assert.ok(c.currentTime<c.deadline);assert.equal(c.catalogActionSha256,hashData(a));assert.equal(c.grantHash,r.status().grantHash);assert.equal(c.authorizationSha256,f.grant.authorizationSha256);assert.equal(c.actionSummary.path,a.path);assert.equal(c.actionSummary.sha256,a.sha256);assert.equal(c.actionSummary.bytes,a.bytes);assert.equal(c.actionSummary.scope.root,f.root);assert.equal(c.actionSummary.scope.target,path.join(f.root,a.path));assert.equal(c.actionSummary.scope.mode,'READ_ONLY_PINNED_INPUT');assert.deepEqual(c.choices,['CONTINUE_STEP','STOP']);assert.equal(c.reservedCurrentModelCall,true);assert.equal(c.modelCallsBeforeReservation,0);assert.equal(c.modelCallBudget,8);assert.equal(c.remainingModelCalls,7);assert.equal(c.actionAttemptsBeforeDecision,0);assert.equal(c.remainingActions,8);assert.equal(c.executorPreflight.checkedAt,c.currentTime);assert.equal(c.executorPreflight.inputPinsVerified,1);assert.equal(c.executorPreflight.sourcePinsVerified,1);assert.equal(c.executorPreflight.rootAndExclusiveJournalOwnerVerified,true);assert.ok(Object.isFrozen(c)&&Object.isFrozen(c.actionSummary.scope));assert.equal(Object.hasOwn(c,'tools'),false);assert.equal(Object.hasOwn(c,'allowShell'),false);}finally{r.close();}
});
test('write decision context omits content but retains exact create-only owned content hash and bytes',async()=>{
  const f=fixture(),r=f.open();try{await r.tick();await r.tick();await r.tick();const c=f.calls[2].context,a=f.grant.catalog[2];assert.equal(c.catalogActionSha256,hashData(a));assert.equal(Object.hasOwn(c.actionSummary,'content'),false);assert.equal(c.actionSummary.contentSha256,hash(a.content));assert.equal(c.actionSummary.contentBytes,Buffer.byteLength(a.content));assert.equal(c.actionSummary.createOnly,true);assert.equal(c.actionSummary.scope.mode,'CREATE_ONLY_OWNED_FILE');assert.equal(c.actionSummary.scope.target,path.join(f.root,'result.json'));assert.equal(c.modelCallsBeforeReservation,2);assert.equal(c.actionAttemptsBeforeDecision,2);assert.equal(c.executorPreflight.completedSteps,2);}finally{r.close();}
});
test('command decision context uses exact image/argv/cwd/source limits with immutable summary, not new permission',async()=>{
  const f=fixture({command:true}),r=f.open();try{await finish(r,4);const c=f.calls[3].context,a=f.grant.catalog[3];assert.equal(c.actionSummary.program,a.program);assert.equal(c.actionSummary.executableSha256,a.executableSha256);assert.deepEqual(c.actionSummary.args,a.args);assert.equal(c.actionSummary.cwd,a.cwd);assert.deepEqual(c.actionSummary.sourcePins,a.sourcePins);assert.equal(c.actionSummary.timeoutMs,a.timeoutMs);assert.equal(c.actionSummary.memoryMb,a.memoryMb);assert.equal(c.actionSummary.scope.mode,'EXACT_PINNED_NATIVE_PROGRAM');assert.equal(c.executorPreflight.completedWriteOutputsRechecked,1);assert.ok(Object.isFrozen(c.actionSummary.args));assert.throws(()=>{c.actionSummary.args.push('--new-authority');});assert.deepEqual(f.nativeCalls[0].request.args,a.args);}finally{r.close();}
});
test('oversized decision context stops before model intent, reservation, model folder or invocation',async()=>{
  const f=fixture({command:true}),command={...f.grant.catalog[3],args:Array.from({length:5},()=>'-'.repeat(8192))};f.grant.catalog=[command,f.grant.catalog[2]];const r=f.open();try{await assert.rejects(r.tick(),{code:'CATALOG_DATA_BOUND'});assert.equal(r.status().modelCalls,0);assert.equal(r.status().actions,0);assert.equal(r.status().pending.length,0);assert.equal(f.calls.length,0);assert.equal(f.history().some(e=>e.type==='MODEL_INTENT'),false);assert.deepEqual(fs.readdirSync(path.join(f.stateRoot,'models')),[]);assert.equal(fs.existsSync(path.join(f.root,'result.json')),false);}finally{r.close();}
});
test('maximum allowed write content is represented only by bounded hash summary, not passed into the model',async()=>{
  const f=fixture(),a={...f.grant.catalog[2],content:'z'.repeat(65536),sha256:hash('z'.repeat(65536)),bytes:65536};f.grant.catalog=[a];f.grant.acceptance=[{type:'file_sha256',path:a.path,sha256:a.sha256,bytes:a.bytes}];const r=f.open();try{assert.equal((await finish(r,1)).status,'FINAL_ACCEPTED');assert.ok(Buffer.byteLength(canonical(f.calls[0].context))<=32768);assert.equal(Object.hasOwn(f.calls[0].context.actionSummary,'content'),false);assert.equal(f.calls[0].context.actionSummary.contentBytes,65536);}finally{r.close();}
});
test('confirmed receipt clean-close/reopen resumes same counts/deadline without replaying completed read',async()=>{
  const f=fixture(),first=f.open();await first.tick();const before=first.checkpoint();first.close();const reopened=f.open();try{
    assert.equal(reopened.status().modelCalls,1);assert.equal(reopened.status().actions,1);assert.equal(reopened.status().deadline,before.deadline);
    await reopened.tick();await reopened.tick();assert.equal((await reopened.tick()).status,'FINAL_ACCEPTED');assert.deepEqual(f.calls.map(c=>c.context.currentStep),['read_input','find_marker','write_output']);
  }finally{reopened.close();}
});
test('one exclusive lock; live second constructor does not mutate first ledger',()=>{
  const f=fixture(),r=f.open();try{const before=fs.readFileSync(path.join(f.stateRoot,'HISTORY.jsonl'));assert.throws(()=>f.open(),{code:'EEXIST'});assert.deepEqual(fs.readFileSync(path.join(f.stateRoot,'HISTORY.jsonl')),before);}finally{r.close();}
});
test('orphan lock is preserved; no PID-only recovery or implicit deletion',()=>{
  const f=fixture();const lock=path.join(f.stateRoot,'OWNER_LOCK.json');fs.writeFileSync(lock,'{"unknownOwner":true}\n');assert.throws(()=>f.open(),{code:'EEXIST'});assert.equal(fs.readFileSync(lock,'utf8'),'{"unknownOwner":true}\n');assert.equal(fs.existsSync(path.join(f.stateRoot,'HISTORY.jsonl')),false);
});
test('unresolved model call after restart latches without another invocation or budget reset',async()=>{
  const f=fixture({modelFailure:true}),r=f.open();await assert.rejects(r.tick(),{code:'MODEL_PORT_FAILURE'});const before=r.status();assert.equal(before.status,'RECONCILIATION_REQUIRED');assert.equal(before.modelCalls,1);assert.equal(before.actions,0);assert.equal(f.history().at(-1).payload.error.message,'original model failure');r.close();
  const reopened=f.open();try{await assert.rejects(reopened.tick(),{code:'PROJECT_RECONCILIATION_REQUIRED'});assert.equal(f.calls.length,1);assert.equal(reopened.status().modelCalls,1);assert.equal(reopened.status().deadline,before.deadline);assert.throws(()=>reopened.control('resume'),{code:'PROJECT_RECONCILIATION_REQUIRED'});}finally{reopened.close();}
});
test('post-write uncertain effect is independently reconciled, never written twice',async()=>{
  const f=fixture({postWriteFailure:true}),r=f.open();await r.tick();await r.tick();await assert.rejects(r.tick(),{code:'POST_PUBLICATION_FAILURE'});assert.equal(r.status().actions,3);assert.equal(r.status().completedSteps.length,2);const writtenBefore=fs.statSync(path.join(f.root,'result.json')).mtimeMs;r.close();
  const reopened=f.open({reconcilePort:async request=>({verified:true,outcome:request.outcome,evidenceSha256:'b'.repeat(64),receipt:{kind:'write_text',path:'result.json',sha256:f.grant.catalog[2].sha256,bytes:f.grant.catalog[2].bytes,createOnly:true}})});
  try{const beforeRefusal=reopened.status().headSha256;await assert.rejects(reopened.tick(),{code:'PROJECT_RECONCILIATION_REQUIRED'});assert.equal(reopened.status().headSha256,beforeRefusal);assert.equal(f.calls.length,3);await reopened.reconcile({kind:'action',id:'action_3',outcome:'applied',evidence:{receiptHash:'b'.repeat(64)}});
    assert.equal((await reopened.tick()).status,'FINAL_ACCEPTED');assert.equal(f.calls.length,3);assert.equal(reopened.status().actions,3);assert.equal(fs.statSync(path.join(f.root,'result.json')).mtimeMs,writtenBefore);assert.equal(reopened.status().outbox.length,3);
  }finally{reopened.close();}
});
test('reconciliation authority and actual output hash are both required',async()=>{
  const f=fixture({postWriteFailure:true}),r=f.open();try{await r.tick();await r.tick();await assert.rejects(r.tick());await assert.rejects(r.reconcile({kind:'action',id:'action_3',outcome:'applied',evidence:{}}),{code:'PROJECT_RECONCILIATION_AUTHORITY'});assert.equal(r.status().pending.length,1);}finally{r.close();}
});
test('confirmed complete output drift stops before another model and is not repaired',async()=>{
  const f=fixture(),r=f.open();try{await r.tick();await r.tick();await r.tick();fs.writeFileSync(path.join(f.root,'result.json'),'tampered');await assert.rejects(r.tick());assert.equal(f.calls.length,3);assert.equal(r.status().status,'BLOCKED');assert.equal(fs.readFileSync(path.join(f.root,'result.json'),'utf8'),'tampered');}finally{r.close();}
});
test('model allowance persists and budget exhaustion is durable, not new-call authority',async()=>{
  const f=fixture();f.grant.budgets.maxModelCalls=1;const r=f.open();await r.tick();assert.equal((await r.tick()).status,'BUDGET_STOP');r.close();const reopened=f.open();try{assert.equal((await reopened.tick()).status,'BUDGET_STOP');assert.equal(f.calls.length,1);}finally{reopened.close();}
});
test('action allowance independent from model budget prevents second effect',async()=>{
  const f=fixture();f.grant.budgets.maxActions=1;const r=f.open();try{await r.tick();assert.equal((await r.tick()).status,'BUDGET_STOP');assert.equal(f.calls.length,1);assert.equal(r.status().actions,1);}finally{r.close();}
});
test('expired persisted wall deadline cannot be extended by reopen or duplicate enrollment',async()=>{
  const f=fixture(),r=f.open(),deadline=r.status().deadline;r.close();f.setClock(deadline);const reopened=f.open();try{assert.equal((await reopened.tick()).status,'BUDGET_STOP');assert.equal(f.calls.length,0);assert.equal(reopened.status().deadline,deadline);}finally{reopened.close();}
});
test('remaining deadline clamps model and approved native timeout',async()=>{
  const f=fixture({command:true}),r=f.open();try{await r.tick();await r.tick();await r.tick();f.setClock(r.status().deadline-10000);await r.tick();assert.equal(f.calls.at(-1).meta.timeoutMs,10000);assert.equal(f.nativeCalls[0].request.timeoutMs,10000);assert.equal(f.nativeCalls[0].meta.deadline,r.status().deadline);}finally{r.close();}
});
test('clock reversal fails before another model and original error is not replaced by collector failure',async()=>{
  const f=fixture(),r=f.open();try{const first=f.now();await r.tick();f.setClock(first-1);const error=await r.tick().then(()=>null,e=>e);assert.equal(error.code,'PROJECT_CLOCK_REVERSED');assert.equal(error.collectorError.code,'PROJECT_CLOCK_REVERSED');assert.equal(f.calls.length,1);}finally{f.advance(2);r.close();}
});
test('deadline expiration during model response stores consumed receipt but no effect',async()=>{
  const f=fixture(),r=f.open({modelPort:{async plan(context,meta){f.calls.push({context,meta});f.setClock(context.deadline);return reply(meta.callId);}}});try{const v=await r.tick();assert.equal(v.status,'BUDGET_STOP');assert.equal(v.modelCalls,1);assert.equal(v.actions,0);}finally{r.close();}
});
test('pause/cancel are durable; pause during model response forbids following action',async()=>{
  const f=fixture();let r;r=f.open({modelPort:{async plan(context,meta){r.control('pause');assert.equal(meta.signal.aborted,true);return reply(meta.callId);}}});try{assert.equal((await r.tick()).status,'PAUSED');assert.equal(r.status().actions,0);r.control('cancel');assert.equal((await r.tick()).status,'CANCELLED');assert.throws(()=>r.control('resume'),{code:'PROJECT_CONTROL_TERMINAL'});}finally{r.close();}
});
test('model STOP pauses without authority widening or effect',async()=>{
  const f=fixture(),r=f.open({modelPort:{async plan(context,meta){const value=reply(meta.callId);value.proposal.choice='STOP';return value;}}});try{assert.equal((await r.tick()).status,'PAUSED');assert.equal(r.status().modelCalls,1);assert.equal(r.status().actions,0);assert.equal(fs.existsSync(path.join(f.root,'result.json')),false);}finally{r.close();}
});
test('cancel during awaited STOP model reply never writes invalid PAUSE after CANCEL',async()=>{
  const f=fixture();let r;r=f.open({modelPort:{async plan(context,meta){r.control('cancel');const value=reply(meta.callId);value.proposal.choice='STOP';return value;}}});const result=await r.tick();assert.equal(result.status,'CANCELLED');assert.equal(result.modelCalls,1);assert.equal(result.actions,0);assert.deepEqual(f.history().filter(e=>e.type==='CONTROL').map(e=>e.payload.desired),['CANCEL']);r.close();const reopened=f.open();try{assert.equal(reopened.status().status,'CANCELLED');assert.equal(reopened.status().modelCalls,1);}finally{reopened.close();}
});
test('confirmed paused decision clean-close/reopen executes once without a fresh model call',async()=>{
  const f=fixture();let r;r=f.open({modelPort:{async plan(context,meta){f.calls.push({context,meta});r.control('pause');return reply(meta.callId);}}});
  const paused=await r.tick();assert.equal(paused.status,'PAUSED');assert.equal(paused.modelCalls,1);assert.equal(paused.actions,0);const deadline=paused.deadline;r.close();
  const reopened=f.open();try{reopened.control('resume');assert.equal(reopened.status().status,'READY_TO_EXECUTE_CONFIRMED_DECISION');await reopened.tick();assert.equal(f.calls.length,1);assert.equal(reopened.status().modelCalls,1);assert.equal(reopened.status().actions,1);assert.equal(reopened.status().deadline,deadline);}finally{reopened.close();}
});
test('confirmed model receipt crash gap reopens at same call without repeating inference',async()=>{
  const f=fixture(),r=f.open();await r.tick();r.close();const file=path.join(f.stateRoot,'HISTORY.jsonl'),events=f.history(),receiptAt=events.findIndex(e=>e.type==='MODEL_RECEIPT');fs.writeFileSync(file,events.slice(0,receiptAt+1).map(canonical).join('\n')+'\n');const reopened=f.open();try{assert.equal(reopened.status().status,'READY_TO_EXECUTE_CONFIRMED_DECISION');await reopened.tick();assert.equal(f.calls.length,1);assert.equal(reopened.status().actions,1);}finally{reopened.close();}
});
test('bad/expanded model reply is uncertain and cannot become native or file authority',async()=>{
  const f=fixture(),r=f.open({modelPort:{async plan(context,meta){return {...reply(meta.callId),tool:'run_shell'};}}});try{await assert.rejects(r.tick());assert.equal(r.status().status,'RECONCILIATION_REQUIRED');assert.equal(r.status().actions,0);}finally{r.close();}
});
test('input and executable source drift before model is rejected without new call/effect',async()=>{
  const f=fixture({command:true}),r=f.open();try{fs.appendFileSync(f.sourcePath,'changed');await assert.rejects(r.tick());assert.equal(f.calls.length,0);assert.equal(f.nativeCalls.length,0);assert.equal(r.status().status,'BLOCKED');assert.equal(fs.existsSync(path.join(f.root,'result.json')),false);}finally{r.close();}
});
test('output appeared after enrollment is not overwritten; ambiguous attempt is latched',async()=>{
  const f=fixture(),r=f.open();try{await r.tick();await r.tick();fs.writeFileSync(path.join(f.root,'result.json'),'belongs to someone else');await assert.rejects(r.tick(),{code:'EEXIST'});assert.equal(fs.readFileSync(path.join(f.root,'result.json'),'utf8'),'belongs to someone else');assert.equal(r.status().status,'RECONCILIATION_REQUIRED');}finally{r.close();}
});
test('native failure proof never marks command complete or hides original failure',async()=>{
  const f=fixture({command:true}),r=f.open({nativePort:async()=>({...nativeResult(),exitCode:7})});try{await r.tick();await r.tick();await r.tick();await assert.rejects(r.tick(),{code:'PROJECT_NATIVE_RECEIPT'});assert.equal(r.status().completedSteps.includes('approved_command'),false);assert.equal(r.status().status,'RECONCILIATION_REQUIRED');assert.equal(f.history().at(-1).type,'ACTION_FAILURE');}finally{r.close();}
});
test('file port reply cannot claim acceptance for different bytes or omit held proof marker',async()=>{
  const f=fixture({filePort:true}),r=f.open({filePort:{...f.files,readPinned:async()=>({validated:true,sha256:'0'.repeat(64),bytes:1,text:'x',proofSha256:'d'.repeat(64)})}});try{await assert.rejects(r.tick(),{code:'PROJECT_FILE_PORT_RECEIPT'});assert.equal(f.calls.length,0);}finally{r.close();}
});
test('pause in awaited final input preflight prevents create-only after action intent; uncertainty preserved',async()=>{
  const f=fixture({filePort:true});let r,creates=0;r=f.open({filePort:{async readPinned(request,meta){assert.equal(meta.deadline,r.status().deadline);assert.ok(meta.timeoutMs>0);const last=f.history().at(-1);if(meta.purpose==='input_preflight'&&last.type==='ACTION_INTENT'&&last.payload.stepId==='write_output')r.control('pause');return f.files.readPinned(request,meta);},async createOnly(request,meta){creates++;return f.files.createOnly(request,meta);}}});
  try{await r.tick();await r.tick();await assert.rejects(r.tick(),{code:'PROJECT_EFFECT_NOT_STARTED_CONTROL'});assert.equal(creates,0);assert.equal(fs.existsSync(path.join(f.root,'result.json')),false);assert.equal(r.status().desired,'PAUSE');assert.equal(r.status().pending.length,1);assert.equal(r.status().actions,3);assert.equal(f.history().at(-1).type,'ACTION_FAILURE');}finally{r.close();}
});
test('pause during final acceptance read never publishes FINAL_ACCEPTED or a false budget stop',async()=>{
  const f=fixture({filePort:true});let r;r=f.open({filePort:{...f.files,async readPinned(request,meta){if(meta.purpose==='acceptance')r.control('pause');return f.files.readPinned(request,meta);}}});
  try{await r.tick();await r.tick();await r.tick();assert.equal((await r.tick()).status,'PAUSED');assert.equal(f.history().some(e=>e.type==='FINAL_ACCEPTED'||e.type==='BUDGET_STOP'),false);assert.equal(r.status().completedSteps.length,3);}finally{r.close();}
});
test('remaining native timeout is recomputed after awaited action preflight',async()=>{
  const f=fixture({command:true,filePort:true});let r;r=f.open({filePort:{...f.files,async readPinned(request,meta){const last=f.history().at(-1);if(meta.purpose==='input_preflight'&&last.type==='ACTION_INTENT'&&last.payload.stepId==='approved_command')f.setClock(r.status().deadline-500);return f.files.readPinned(request,meta);}}});
  try{await r.tick();await r.tick();await r.tick();await r.tick();assert.equal(f.nativeCalls[0].request.timeoutMs,500);assert.equal(f.nativeCalls[0].meta.deadline,r.status().deadline);}finally{r.close();}
});
test('reconciliation reserves async execution slot and preserves counts',async()=>{
  const f=fixture({modelFailure:true});let release;const r=f.open({reconcilePort:request=>new Promise(resolve=>{release=()=>resolve({verified:true,outcome:request.outcome,evidenceSha256:'b'.repeat(64),receipt:null});})});
  try{await assert.rejects(r.tick(),{code:'MODEL_PORT_FAILURE'});const reconciliation=r.reconcile({kind:'model',id:'call_1',outcome:'not_started',evidence:{independentCloseProof:true}});await assert.rejects(r.tick(),{code:'PROJECT_BUSY'});assert.throws(()=>r.close(),{code:'PROJECT_CLOSE_BUSY'});release();await reconciliation;assert.equal(r.status().modelCalls,1);assert.equal(r.status().pending.length,0);assert.equal(f.calls.length,1);}finally{r.close();}
});
test('reconciliation refuses stale proof when durable control changes during awaited verification',async()=>{
  const f=fixture({modelFailure:true});let release;const r=f.open({reconcilePort:request=>new Promise(resolve=>{release=()=>resolve({verified:true,outcome:request.outcome,evidenceSha256:'b'.repeat(64),receipt:null});})});
  try{await assert.rejects(r.tick());const reconciliation=r.reconcile({kind:'model',id:'call_1',outcome:'not_started',evidence:{}});r.control('pause');release();await assert.rejects(reconciliation,{code:'PROJECT_RECONCILIATION_CHANGED_WHILE_AWAIT'});assert.equal(r.status().pending.length,1);assert.equal(r.status().desired,'PAUSE');assert.equal(f.history().some(e=>e.type==='RECONCILED'),false);}finally{r.close();}
});
test('completed action receipt itself preserves outbox across missing separate publication record',async()=>{
  const f=fixture(),r=f.open();await r.tick();r.close();const file=path.join(f.stateRoot,'HISTORY.jsonl'),events=f.history();assert.equal(events.at(-1).type,'OUTBOX');fs.writeFileSync(file,events.slice(0,-1).map(canonical).join('\n')+'\n');const reopened=f.open();try{assert.equal(reopened.status().completedSteps.length,1);assert.equal(reopened.status().outbox.length,1);assert.equal(reopened.status().modelCalls,1);}finally{reopened.close();}
});
test('journal torn tail is preserved, not silently trimmed or replayed',()=>{
  const f=fixture(),r=f.open();r.close();const file=path.join(f.stateRoot,'HISTORY.jsonl');fs.appendFileSync(file,'{"torn":');const before=fs.readFileSync(file);assert.throws(()=>f.open(),{code:'PROJECT_JOURNAL_TORN_NO_REPAIR'});assert.deepEqual(fs.readFileSync(file),before);assert.equal(f.calls.length,0);
});
test('duplicate decoded keys are denied before journal authority parsing',()=>{
  assert.throws(()=>parseStrictJson('{"x":1,"\\u0078":2}'),{code:'CATALOG_JSON_DUPLICATE'});assert.throws(()=>parseStrictJson('{"nested":{"same":1,"same":2}}'),{code:'CATALOG_JSON_DUPLICATE'});assert.throws(()=>parseStrictJson(Buffer.from([0xff])));assert.throws(()=>parseStrictJson('\ufeff{}'));
});
test('tampered journal with a recomputed chain cannot change catalog step or owner grant',()=>{
  const f=fixture(),r=f.open();r.close();const file=path.join(f.stateRoot,'HISTORY.jsonl'),events=f.history();events[0].payload.grant.owner='emad';const {sha256:ignored,...u}=events[0];events[0].sha256=hashData(u);fs.writeFileSync(file,canonical(events[0])+'\n');const before=fs.readFileSync(file);assert.throws(()=>f.open());assert.deepEqual(fs.readFileSync(file),before);assert.equal(f.calls.length,0);
});
for(const change of [p=>p.receipt.sha256='0'.repeat(64),p=>p.receipt.extra='not authorized',p=>p.receipt.kind='write_text'])test('recomputed journal cannot admit malformed or unrelated stored receipt '+String(change),async()=>{
  const f=fixture(),r=f.open();await r.tick();r.close();rewriteHistory(f,events=>change(events.find(e=>e.type==='ACTION_RECEIPT').payload));const before=fs.readFileSync(path.join(f.stateRoot,'HISTORY.jsonl'));assert.throws(()=>f.open());assert.deepEqual(fs.readFileSync(path.join(f.stateRoot,'HISTORY.jsonl')),before);assert.equal(f.calls.length,1);
});
test('recomputed action timeout beyond original wall grant is denied during reopen',async()=>{
  const f=fixture(),r=f.open();await r.tick();r.close();rewriteHistory(f,events=>{events.find(e=>e.type==='ACTION_INTENT').payload.effectiveTimeoutMs=7200001;});assert.throws(()=>f.open());assert.equal(f.calls.length,1);
});
test('out-of-order model step is denied even with recomputed catalog action SHA and chain',async()=>{
  const f=fixture(),r=f.open();await r.tick();r.close();rewriteHistory(f,events=>{const p=events.find(e=>e.type==='MODEL_INTENT').payload;p.stepId=f.grant.catalog[1].id;p.catalogActionSha256=hashData(f.grant.catalog[1]);});assert.throws(()=>f.open(),{code:'PROJECT_JOURNAL_ADMISSION'});assert.equal(f.calls.length,1);
});
test('FINAL_ACCEPTED replay requires RUN and exact durable counts, not only completed output',async()=>{
  for(const kind of ['pause','counts','expanded']){const f=fixture(),r=f.open();await finish(r,3);r.close();rewriteHistory(f,events=>{const final=events.find(e=>e.type==='FINAL_ACCEPTED');if(kind==='pause'){const at=events.indexOf(final);events.splice(at,0,{schema:1,seq:0,type:'CONTROL',at:final.at,payload:{desired:'PAUSE'},previousSha256:'',sha256:''});}else if(kind==='counts')final.payload.actions=0;else final.payload.extra=true;});assert.throws(()=>f.open());assert.equal(f.calls.length,3);}
});
test('stored failure and checkpoint event payloads remain closed and counts must match',async()=>{
  const f=fixture({modelFailure:true}),r=f.open();await assert.rejects(r.tick());r.close();rewriteHistory(f,events=>{events.find(e=>e.type==='MODEL_FAILURE').payload.error.extra=true;});assert.throws(()=>f.open());
  const second=fixture(),q=second.open();await q.tick();q.checkpoint();q.close();rewriteHistory(second,events=>{events.find(e=>e.type==='CHECKPOINT').payload.modelCalls=0;});assert.throws(()=>second.open(),{code:'PROJECT_CHECKPOINT_DRIFT'});
});
test('not-started reconcile cannot carry an invented receipt or refund consumed model budget',async()=>{
  const f=fixture({modelFailure:true}),r=f.open({reconcilePort:async request=>({verified:true,outcome:request.outcome,evidenceSha256:'b'.repeat(64),receipt:{invented:true}})});try{await assert.rejects(r.tick());await assert.rejects(r.reconcile({kind:'model',id:'call_1',outcome:'not_started',evidence:{}}),{code:'PROJECT_RECONCILIATION_RECEIPT'});assert.equal(r.status().pending.length,1);assert.equal(r.status().modelCalls,1);}finally{r.close();}
});
test('recomputed reconciled event must have closed supported outcome and null not-started receipt',async()=>{
  const f=fixture({modelFailure:true}),r=f.open({reconcilePort:async request=>({verified:true,outcome:request.outcome,evidenceSha256:'b'.repeat(64),receipt:null})});await assert.rejects(r.tick());await r.reconcile({kind:'model',id:'call_1',outcome:'not_started',evidence:{}});r.close();rewriteHistory(f,events=>{events.find(e=>e.type==='RECONCILED').payload.receipt={invented:true};});assert.throws(()=>f.open(),{code:'PROJECT_RECONCILE_ORDER'});assert.equal(f.calls.length,1);
});
test('changed grant budgets, arguments or checks do not reset or migrate existing state',async()=>{
  const f=fixture({command:true}),r=f.open();await r.tick();const before=r.status();r.close();const changed=structuredClone(f.grant);changed.budgets.maxModelCalls=10;assert.throws(()=>f.open({grant:changed}),{code:'PROJECT_ENROLLMENT_DRIFT'});assert.equal(f.history().filter(e=>e.type==='MODEL_INTENT').length,1);const reopen=f.open();try{assert.equal(reopen.status().deadline,before.deadline);}finally{reopen.close();}
});
test('hardlinked input is refused before enrollment DB/journal/model',()=>{
  const f=fixture();fs.linkSync(path.join(f.root,'input.txt'),path.join(f.base,'hardlink.txt'));assert.throws(()=>f.open(),{code:'CATALOG_FILE_ALIAS_OR_BOUND'});assert.equal(fs.existsSync(path.join(f.stateRoot,'HISTORY.jsonl')),false);assert.equal(f.calls.length,0);
});
test('directory junction and path alias are denied; actual foreign files remain unchanged',()=>{
  const f=fixture(),outside=path.join(f.base,'outside');fs.mkdirSync(outside);const linked=path.join(f.base,'linked');fs.symlinkSync(outside,linked,process.platform==='win32'?'junction':'dir');const changed=structuredClone(f.grant);changed.root=linked;assert.throws(()=>f.open({grant:changed}),{code:'CATALOG_DIRECTORY_ALIAS'});assert.equal(fs.readdirSync(outside).length,0);
});
for(const target of ['../escape.txt','x.txt:stream','C:\\outside.txt','folder/../file.txt','folder/con.txt','tail.','tail '])test('catalog refuses unsafe output '+target,()=>{const f=fixture(),g=structuredClone(f.grant);g.catalog[2].path=target;g.acceptance[0].path=target;assert.throws(()=>admitGrant(g));assert.equal(f.calls.length,0);});
for(const kind of ['run_shell','game','video','gui_click','browser_send'])test('no catalog for paused/unknown tool '+kind,()=>{const f=fixture(),g=structuredClone(f.grant);g.catalog[0].kind=kind;assert.throws(()=>admitGrant(g),{code:'CATALOG_TOOL_FORBIDDEN'});});
test('closed data schema rejects getters/Proxy/cycles without invoking traps or instructions',()=>{
  const f=fixture();let calls=0;const g={...f.grant};Object.defineProperty(g,'owner',{enumerable:true,get(){calls++;return 'saeed';}});assert.throws(()=>admitGrant(g));assert.equal(calls,0);assert.throws(()=>admitGrant(new Proxy(f.grant,{ownKeys(){calls++;return [];}})));assert.equal(calls,0);const cycle={...f.grant};cycle.extra=cycle;assert.throws(()=>admitGrant(cycle));
});
test('exact argv, cwd, registered source, checks and finite upper budgets are mandatory',()=>{
  const f=fixture({command:true});for(const change of [g=>g.catalog[3].cwd=f.base,g=>g.catalog[3].args='node --eval unsafe',g=>g.catalog[3].sourcePins=[],g=>g.catalog[3].sourcePins[0]={...g.catalog[3].sourcePins[0],sha256:'0'.repeat(64)},g=>g.acceptance=[],g=>g.budgets.wallTimeMs=7200001,g=>g.budgets.maxActions=65,g=>g.budgets.maxModelCalls=0]){const g=structuredClone(f.grant);change(g);assert.throws(()=>admitGrant(g));}
});
