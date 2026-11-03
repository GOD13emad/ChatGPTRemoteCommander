import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createCompanionSession,validateCompanionBinding,validateCompanionConfiguration,validateCompanionObservation,
  serializeCompanionObservation,writeCompanionObservation,COMPANION_OBSERVATION_CONTRACT as contract} from '../src/companion-session.mjs';
import {createWorkflowTools,WORKFLOW_TOOL_DEFINITIONS} from '../src/workflow-tools.mjs';

const stamp=1900000000000,hash=value=>createHash('sha256').update(value).digest('hex');
const projectRoot=process.platform==='win32'?'C:\\private-project':'/private-project';
const binding={appId:'asdk_app_fixture',accountId:'owner-account',profileId:'owner-profile',workflowId:'project_one',projectRoot,chatUrl:'https://chatgpt.com/c/fixture-chat'};
const identity={appId:binding.appId,profile:binding.profileId,deviceName:'mutable name',version:'0.10.4',commit:null,configSha256:'a'.repeat(64),routeGeneration:null};
const state=()=>({id:binding.workflowId,root:projectRoot,revision:3,configSha256:identity.configSha256,device:'old display name',steps:[{status:'pending'}],
  goal:'PRIVATE GOAL NOT FOR UI',notes:[{text:'PRIVATE KNOWLEDGE NOT FOR UI'}],checkpoint:{nextAction:'PRIVATE NEXT ACTION NOT FOR UI',summary:'PRIVATE SUMMARY',
    evidence:[{path:'PRIVATE EVIDENCE PATH',sha256:'b'.repeat(64)}]}});
const chat=()=>({observedAtEpochMs:stamp-1000,expiresAtEpochMs:stamp+30000,binding:{...binding},toolNames:['workflow_get'],skills:['remote:commander'],plugins:['app_fixture@local']});
function factory(changes={}){return createCompanionSession({binding:{...binding},identity:{...identity},readWorkflow:async()=>({state:state()}),
  readOperations:async()=>[],readBackendTools:async()=>['workflow_get','system_status'],readCurrentChat:async()=>chat(),clock:()=>stamp,...changes});}
const observe=changes=>factory(changes).observe({id:binding.workflowId});
const clone=value=>JSON.parse(JSON.stringify(value));
const reject=(fn,code)=>assert.throws(fn,error=>error.companionCode===code && error.message===code);
function temporary(){return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-companion-v01-')));}
function removeOwned(directory){assert.match(path.basename(directory),/^rc-companion-v01-[A-Za-z0-9]+$/);assert.equal(path.dirname(directory),fs.realpathSync.native(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});}
// Synthetic proof adapters test the writer protocol only, not real Windows ACLs.
const writerHooks={verifyPrivateDirectory:pin=>({...pin,ownerVerified:true,privatePermissionsVerified:true,observedAtEpochMs:Date.now(),descriptorSha256:'c'.repeat(64)}),
  verifyPrivateFile:pin=>({...pin,ownerVerified:true,privatePermissionsVerified:true,observedAtEpochMs:Date.now(),descriptorSha256:'d'.repeat(64)})};
function writerTemporary(){const directory=temporary();if(process.platform!=='win32')fs.chmodSync(directory,0o700);return directory;}
const immutablePattern=/^commander-companion-[0-9]{16}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/;
const immutableFiles=directory=>fs.readdirSync(directory).filter(name=>immutablePattern.test(name));

test('complete independently supplied host binding can be BOUND but never authorizes action',async()=>{
  const snapshot=await observe();assert.equal(snapshot.reconciliation.state,'BOUND');assert.equal(snapshot.project.state,'BOUND');
  assert.equal(snapshot.reconciliation.actionAllowed,false);assert.equal(snapshot.currentChat.state,'CONFIRMED');
  assert.equal(validateCompanionObservation(snapshot,{now:stamp}),snapshot);assert.equal(Object.isFrozen(snapshot.binding),true);
});
test('default missing binding contains null fields and current-chat exposure stays UNKNOWN',async()=>{
  const snapshot=await observe({binding:null,identity:null,readCurrentChat:null});
  assert.deepEqual(snapshot.binding,Object.fromEntries(contract.bindingKeys.map(key=>[key,null])));
  assert.deepEqual(snapshot.currentChat,{state:'UNKNOWN',conversationUrl:null,appId:null,toolNames:[],skills:[],plugins:[]});
  assert.equal(snapshot.reconciliation.state,'UNPROVEN');assert.equal(snapshot.project.state,'UNKNOWN');
});
test('each App account profile workflow root or chat conflict produces STOP without changing binding',async()=>{
  const alternatives={appId:'different_app',accountId:'different_account',profileId:'different_profile',workflowId:'different_workflow',
    projectRoot:process.platform==='win32'?'C:\\other-project':'/other-project',chatUrl:'https://chatgpt.com/c/other-chat'};
  const codes=['APP_ID_MISMATCH','ACCOUNT_ID_MISMATCH','PROFILE_ID_MISMATCH','WORKFLOW_ID_MISMATCH','PROJECT_ROOT_MISMATCH','CHAT_URL_MISMATCH'];
  for(const [index,key]of contract.bindingKeys.entries()){
    const snapshot=await observe({readCurrentChat:async()=>({...chat(),binding:{...binding,[key]:alternatives[key]}})});
    assert.equal(snapshot.reconciliation.state,'STOP');assert.equal(snapshot.project.state,'STOP');assert.ok(snapshot.reconciliation.reasonCodes.includes(codes[index]));
    assert.deepEqual(snapshot.binding,binding);assert.equal(snapshot.reconciliation.actionAllowed,false);
  }
});
test('wrong workflow request stops before either workflow adapter is read',async()=>{
  let calls=0;const session=factory({readWorkflow:async()=>{calls++;},readOperations:async()=>{calls++;}});
  await assert.rejects(session.observe({id:'other_project'}),error=>error.companionCode==='COMPANION_WORKFLOW_ID_MISMATCH');assert.equal(calls,0);
  await assert.rejects(session.observe({id:binding.workflowId,binding}),error=>error.companionCode==='COMPANION_INVALID_FIELDS');
  const mismatch=await observe({readWorkflow:async()=>({state:{...state(),id:'wrong_project'}})});
  assert.equal(mismatch.reconciliation.state,'STOP');assert.ok(mismatch.reconciliation.reasonCodes.includes('WORKFLOW_ID_MISMATCH'));
});
test('stale expired future or excessive-lifetime host observation cannot rebind the current chat',async()=>{
  for(const times of [{observedAtEpochMs:stamp-50000,expiresAtEpochMs:stamp},
    {observedAtEpochMs:stamp+1,expiresAtEpochMs:stamp+10000},{observedAtEpochMs:stamp-1,expiresAtEpochMs:stamp+300000}]){
    const snapshot=await observe({readCurrentChat:async()=>({...chat(),...times})});
    assert.equal(snapshot.reconciliation.state,'STOP');assert.ok(snapshot.reconciliation.reasonCodes.includes('CHAT_OBSERVATION_STALE'));
    assert.equal(snapshot.currentChat.state,'UNKNOWN');assert.deepEqual(snapshot.binding,binding);
  }
});
test('async host receipts are rechecked at completion and never extend their authoritative expiry',async()=>{
  let actual=stamp;
  const stale=await observe({clock:()=>actual,readCurrentChat:async()=>{actual=stamp+10;return {...chat(),observedAtEpochMs:stamp-1,expiresAtEpochMs:stamp+5};}});
  assert.equal(stale.reconciliation.state,'STOP');assert.ok(stale.reconciliation.reasonCodes.includes('CHAT_OBSERVATION_STALE'));
  assert.equal(stale.currentChat.state,'UNKNOWN');assert.deepEqual(stale.binding,binding);
  actual=stamp;
  const bounded=await observe({clock:()=>actual,readCurrentChat:async()=>({...chat(),expiresAtEpochMs:stamp+500})});
  assert.equal(bounded.reconciliation.state,'BOUND');assert.ok(bounded.expiresAtEpochMs<=stamp+500);
  reject(()=>validateCompanionObservation(bounded,{now:stamp+500}),'COMPANION_STALE_OBSERVATION');
});
test('clock rollback during either asynchronous workflow or chat adapter fails closed',async()=>{
  for(const adapter of ['workflow','chat']){
    let actual=stamp;
    await assert.rejects(observe({clock:()=>actual,
      readWorkflow:async()=>{if(adapter==='workflow')actual=stamp-1;return {state:state()};},
      readCurrentChat:async()=>{if(adapter==='chat')actual=stamp-1;return chat();}}),error=>error.companionCode==='COMPANION_CLOCK_INVALID');
  }
});
test('UNCERTAIN durable receipt is observed and held without resume reconcile replay or dispatch',async()=>{
  let reads=0;const snapshot=await observe({readOperations:async()=>{reads++;return [{status:'UNCERTAIN',tool:'PRIVATE TOOL OUTPUT'}];}});
  assert.equal(reads,1);assert.equal(snapshot.reconciliation.state,'STOP');assert.equal(snapshot.project.nextAction,'RECONCILE_UNCERTAIN');
  assert.ok(snapshot.reconciliation.reasonCodes.includes('UNCERTAIN_OPERATION'));assert.equal(snapshot.reconciliation.actionAllowed,false);
});
test('mutable device display name does not masquerade as stable machine or account identity',async()=>{
  const snapshot=await observe({identity:{...identity,deviceName:'کامپیوتر عماد EMAD PC'}});
  assert.equal(snapshot.identity.deviceName,'کامپیوتر عماد EMAD PC');assert.equal(snapshot.reconciliation.state,'BOUND');
  assert.equal(contract.displayNameIsNotMachineIdentity,true);assert.equal(snapshot.reconciliation.reasonCodes.includes('MACHINE_MISMATCH'),false);
  reject(()=>factory({identity:{...identity,deviceName:'invalid\ud800'}}),'COMPANION_INVALID_ID');
});
test('redacted projection never copies private notes goal checkpoint text operation arguments or paths',async()=>{
  const snapshot=await observe(),text=serializeCompanionObservation(snapshot,{now:stamp});
  assert.equal(text.includes('PRIVATE'),false);assert.equal(snapshot.project.nextAction,'REVIEW_RECORDED_CHECKPOINT');
  assert.equal(snapshot.project.evidenceSha256,hash(JSON.stringify(['b'.repeat(64)])));
  assert.equal(text.includes('notes'),false);assert.equal(text.includes('checkpoint'),false);
});
test('backend tools catalog is independent from current-chat tools and skills',async()=>{
  const snapshot=await observe({readCurrentChat:null});assert.equal(snapshot.backend.state,'CONFIRMED');
  assert.deepEqual(snapshot.backend.toolNames,['system_status','workflow_get']);
  assert.equal(snapshot.backend.toolCatalogSha256,hash(JSON.stringify(snapshot.backend.toolNames)));
  assert.deepEqual(snapshot.currentChat.toolNames,[]);assert.deepEqual(snapshot.currentChat.skills,[]);assert.equal(snapshot.currentChat.state,'UNKNOWN');
});
test('unavailable or invalid backend cannot be promoted from declared or current-chat capabilities',async()=>{
  const absent=await observe({readBackendTools:null});assert.equal(absent.backend.state,'UNAVAILABLE');assert.equal(absent.reconciliation.state,'UNPROVEN');
  for(const list of [['duplicate','duplicate'],['bad tool'],Array.from({length:257},(_,i)=>'tool_'+i)]){
    const snapshot=await observe({readBackendTools:async()=>list});assert.equal(snapshot.backend.state,'MISMATCH');assert.equal(snapshot.reconciliation.state,'STOP');
    assert.deepEqual(snapshot.backend.toolNames,[]);assert.equal(snapshot.backend.toolCatalogSha256,null);
  }
});
test('project UNKNOWN may retain real metadata while BOUND and reconciliation BOUND must coincide',async()=>{
  const snapshot=await observe({readCurrentChat:null});assert.equal(snapshot.project.state,'UNKNOWN');assert.equal(snapshot.project.revision,3);
  const forged=clone(snapshot);forged.project.state='BOUND';reject(()=>validateCompanionObservation(forged,{now:stamp}),'COMPANION_BOUND_CONTRADICTION');
  const other=clone(await observe());other.project.state='UNKNOWN';reject(()=>validateCompanionObservation(other,{now:stamp}),'COMPANION_BOUND_CONTRADICTION');
  const conflict=clone(snapshot);conflict.project.root=process.platform==='win32'?'C:\\wrong-project':'/wrong-project';
  reject(()=>validateCompanionObservation(conflict,{now:stamp}),'COMPANION_CONFLICT_NOT_STOPPED');
  const noRevision=clone(await observe());noRevision.project.revision=null;
  reject(()=>validateCompanionObservation(noRevision,{now:stamp}),'COMPANION_BOUND_CONTRADICTION');
  const wrongStop=clone(snapshot);wrongStop.project.state='STOP';
  reject(()=>validateCompanionObservation(wrongStop,{now:stamp}),'COMPANION_STOP_CONTRADICTION');
});
test('snapshot closure rejects hidden fields symbols accessors and proxies before serializer effects',async()=>{
  const original=await observe();let getterCalls=0,proxyCalls=0;
  const getter=clone(original);Object.defineProperty(getter.identity,'version',{enumerable:true,get(){getterCalls++;return 'fake';}});
  reject(()=>serializeCompanionObservation(getter,{now:stamp}),'COMPANION_INVALID_FIELDS');
  const hidden=clone(original);Object.defineProperty(hidden,'secret',{value:'not returned'});reject(()=>serializeCompanionObservation(hidden,{now:stamp}),'COMPANION_INVALID_FIELDS');
  const symbolic=clone(original);symbolic[Symbol('hidden')]='value';reject(()=>serializeCompanionObservation(symbolic,{now:stamp}),'COMPANION_INVALID_FIELDS');
  const proxy=new Proxy(clone(original),{get(){proxyCalls++;throw Error('NO_PROXY_READ');}});reject(()=>serializeCompanionObservation(proxy,{now:stamp}),'COMPANION_INVALID_RECORD');
  const arrayProxy=clone(original);arrayProxy.backend.toolNames=new Proxy([],{get(){proxyCalls++;throw Error('NO_ARRAY_PROXY_READ');}});
  reject(()=>serializeCompanionObservation(arrayProxy,{now:stamp}),'COMPANION_INVALID_ARRAY');assert.equal(getterCalls,0);assert.equal(proxyCalls,0);
});
test('binding and URLs reject relative aliased roots credentials nonchat origins and secret-shaped IDs',()=>{
  for(const root of ['relative','/','//server/private','/private/../project','C:\\','C:\\Project.','C:\\Project ','C:\\Project?','C:\\Project*','C:\\Project|','/private\\alias','/private\u202ealias'])
    reject(()=>validateCompanionBinding({...binding,projectRoot:root}),'COMPANION_INVALID_ROOT');
  for(const url of ['http://chatgpt.com/c/x','https://user:pass@chatgpt.com/c/x','https://chatgpt.com/c/x?token=private','https://other.example/c/x','https://chatgpt.com/'])
    reject(()=>validateCompanionBinding({...binding,chatUrl:url}),'COMPANION_INVALID_CHAT_URL');
  reject(()=>validateCompanionBinding({...binding,accountId:'sk-'+'a'.repeat(32)}),'COMPANION_INVALID_ID');
  assert.equal(validateCompanionBinding({...binding,projectRoot:'C:\\Remote Project',chatUrl:'https://chatgpt.com/g/g-fixture/c/chat-fixture'}).projectRoot,'C:\\Remote Project');
});
test('display controls and Unicode case aliases cannot weaken native project-binding comparisons',async()=>{
  for(const control of ['\u200b','\u200e','\u200f','\u202a','\u202e','\u2066','\u2069'])
    reject(()=>factory({identity:{...identity,deviceName:'display'+control+'name'}}),'COMPANION_INVALID_ID');
  const windowsBinding={...binding,projectRoot:'C:\\Project'},windowsState={...state(),root:'c:\\project'};
  const matched=await observe({binding:windowsBinding,readWorkflow:async()=>({state:windowsState}),readCurrentChat:async()=>({...chat(),binding:windowsBinding})});
  assert.equal(matched.reconciliation.state,'BOUND');
  const unicodeBinding={...binding,projectRoot:'C:\\Ä'},unicodeState={...state(),root:'C:\\ä'};
  const distinct=await observe({binding:unicodeBinding,readWorkflow:async()=>({state:unicodeState}),readCurrentChat:async()=>({...chat(),binding:unicodeBinding})});
  assert.equal(distinct.reconciliation.state,'STOP');assert.ok(distinct.reconciliation.reasonCodes.includes('PROJECT_ROOT_MISMATCH'));
});
test('snapshot freshness generation revision catalog hash and maximum bytes have independent guards',async()=>{
  const original=clone(await observe());reject(()=>validateCompanionObservation(original,{now:stamp+60000}),'COMPANION_STALE_OBSERVATION');
  const ttl=clone(original);ttl.expiresAtEpochMs=stamp+300001;reject(()=>validateCompanionObservation(ttl,{now:stamp}),'COMPANION_INVALID_LIFETIME');
  const generation=clone(original);generation.identity.routeGeneration=0;reject(()=>validateCompanionObservation(generation,{now:stamp}),'COMPANION_INVALID_GENERATION');
  const revision=clone(original);revision.project.revision=0;reject(()=>validateCompanionObservation(revision,{now:stamp}),'COMPANION_INVALID_REVISION');
  const wrongHash=clone(original);wrongHash.backend.toolCatalogSha256='0'.repeat(64);reject(()=>validateCompanionObservation(wrongHash,{now:stamp}),'COMPANION_BACKEND_HASH_MISMATCH');
  const huge=clone(original),names=Array.from({length:256},(_,i)=>'t'+String(i).padStart(3,'0')+'x'.repeat(124));
  huge.backend.toolNames=names;huge.backend.toolCatalogSha256=hash(JSON.stringify([...names].sort()));huge.currentChat.toolNames=names;
  reject(()=>validateCompanionObservation(huge,{now:stamp}),'COMPANION_SNAPSHOT_LIMIT');
});
test('constructor and operator config cannot hide callback injection behind getters or unknown fields',()=>{
  let reads=0;const accessor={readOperations:async()=>[]};Object.defineProperty(accessor,'readWorkflow',{enumerable:true,get(){reads++;return async()=>({});}});
  reject(()=>createCompanionSession(accessor),'COMPANION_INVALID_FIELDS');assert.equal(reads,0);
  reject(()=>validateCompanionConfiguration({binding,command:'arbitrary'}),'COMPANION_INVALID_FIELDS');
  assert.deepEqual(validateCompanionConfiguration({binding}),binding);assert.equal(validateCompanionConfiguration(undefined),null);
});
test('actual workflow adapter preserves configured binding and all project state hashes under observation',async()=>{
  const directory=temporary();let api;
  try{
    const localBinding={...binding,projectRoot:directory},config={durableWorkflows:{enabled:true,directory:path.join(directory,'workflow-state'),companion:{binding:localBinding}}};
    api=createWorkflowTools({config,roots:[directory],device:'mutable name',configSha256:identity.configSha256,lookup:()=>null,validateSchema:()=>[],
      dispatch:async()=>{throw Error('NO_DISPATCH');},companionIdentity:{...identity},companionBackendTools:()=>['workflow_get','workflow_companion_snapshot']});
    await api.execute('workflow_create',{id:binding.workflowId,root:directory,goal:'Isolated fixture',acceptance:['Read-only'],steps:[{id:'step_one',title:'Wait'}]});
    const before=await api.execute('workflow_get',{id:binding.workflowId}),snapshot=await api.execute('workflow_companion_snapshot',{id:binding.workflowId});
    const after=await api.execute('workflow_get',{id:binding.workflowId});assert.deepEqual(after,before);assert.deepEqual(snapshot.binding,localBinding);
    assert.equal(snapshot.currentChat.state,'UNKNOWN');assert.equal(snapshot.project.revision,before.state.revision);
    const definition=WORKFLOW_TOOL_DEFINITIONS.find(item=>item.name==='workflow_companion_snapshot');assert.equal(definition.annotations.readOnlyHint,true);
    assert.deepEqual(definition.inputSchema.required,['id']);assert.deepEqual(Object.keys(definition.inputSchema.properties),['id']);
  }finally{api?.close();removeOwned(directory);}
});
test('immutable private file writer rejects unproved Windows ACL and never writes elsewhere',async()=>{
  const directory=temporary(),snapshot=await observe();
  try{
    if(process.platform==='win32'){
      reject(()=>writeCompanionObservation(directory,snapshot,{now:stamp}),'COMPANION_PRIVATE_ACL_UNPROVEN');
      assert.deepEqual(fs.readdirSync(directory),[]);return;
    }
    fs.chmodSync(directory,0o700);const receipt=writeCompanionObservation(directory,snapshot,{now:stamp});
    assert.match(path.basename(receipt.path),immutablePattern);assert.equal(path.dirname(receipt.path),directory);assert.equal(receipt.private,true);assert.equal(receipt.workflowMutation,false);
    assert.equal(receipt.sha256,hash(fs.readFileSync(receipt.path)));assert.equal(fs.statSync(receipt.path).mode&0o077,0);
    assert.deepEqual(fs.readdirSync(directory),[path.basename(receipt.path)]);
    fs.chmodSync(directory,0o755);reject(()=>writeCompanionObservation(directory,snapshot,{now:stamp}),'COMPANION_DIRECTORY_NOT_PRIVATE');
  }finally{removeOwned(directory);}
});
test('private child file proof is separately mandatory on Windows and invalid proofs cannot publish',async()=>{
  const directory=temporary(),snapshot=await observe(),target=path.join(directory,'commander-companion.json');
  const directoryProof=pin=>({...pin,ownerVerified:true,privatePermissionsVerified:true,observedAtEpochMs:Date.now(),descriptorSha256:'c'.repeat(64)});
  const proofSizes=[];
  const invalidFileProof=pin=>{proofSizes.push(fs.statSync(pin.filePath).size);return {...pin,ownerVerified:false,privatePermissionsVerified:true,observedAtEpochMs:Date.now(),descriptorSha256:'d'.repeat(64)};};
  try{
    if(process.platform!=='win32')fs.chmodSync(directory,0o700);
    if(process.platform==='win32')reject(()=>writeCompanionObservation(directory,snapshot,{now:stamp,verifyPrivateDirectory:directoryProof}),'COMPANION_PRIVATE_FILE_ACL_UNPROVEN');
    assert.deepEqual(fs.readdirSync(directory),[]);
    reject(()=>writeCompanionObservation(directory,snapshot,{now:stamp,verifyPrivateDirectory:directoryProof,verifyPrivateFile:invalidFileProof}),'COMPANION_PRIVATE_FILE_PROOF_INVALID');
    assert.deepEqual(proofSizes,[0,0]);assert.deepEqual(fs.readdirSync(directory),[contract.exportLockFile]);
    assert.equal(fs.statSync(path.join(directory,contract.exportLockFile)).size,0);assert.deepEqual(immutableFiles(directory),[]);
    assert.throws(()=>writeCompanionObservation(directory,snapshot,{now:stamp,...writerHooks}),error=>error.companionCode==='COMPANION_EXPORT_BUSY');
    let getterCalls=0;const unsafe={now:stamp};Object.defineProperty(unsafe,'verifyPrivateFile',{enumerable:true,get(){getterCalls++;return invalidFileProof;}});
    reject(()=>writeCompanionObservation(directory,snapshot,unsafe),'COMPANION_INVALID_FIELDS');assert.equal(getterCalls,0);
  }finally{removeOwned(directory);}
});
test('writer appends immutable snapshots while preserving prior bytes legacy unknown files and singleton link counts',async()=>{
  const directory=writerTemporary(),snapshot=await observe();
  try{
    fs.writeFileSync(path.join(directory,'commander-companion.json'),'isolated legacy personal content',{mode:0o600});
    fs.writeFileSync(path.join(directory,'unknown.bin'),'isolated unknown content',{mode:0o600});
    const first=writeCompanionObservation(directory,snapshot,{now:stamp,...writerHooks}),next=clone(snapshot);next.identity.deviceName='renamed display';
    const firstBytes=fs.readFileSync(first.path);
    const second=writeCompanionObservation(directory,next,{now:stamp,...writerHooks});assert.notEqual(second.sha256,first.sha256);
    assert.notEqual(second.path,first.path);assert.deepEqual(fs.readFileSync(first.path),firstBytes);assert.equal(immutableFiles(directory).length,2);
    assert.equal(second.sha256,hash(fs.readFileSync(second.path)));assert.equal(fs.statSync(first.path).nlink,1);assert.equal(fs.statSync(second.path).nlink,1);
    assert.equal(fs.readFileSync(path.join(directory,'commander-companion.json'),'utf8'),'isolated legacy personal content');
    assert.equal(fs.readFileSync(path.join(directory,'unknown.bin'),'utf8'),'isolated unknown content');assert.equal(fs.readdirSync(directory).length,4);
    assert.equal(validateCompanionObservation(JSON.parse(fs.readFileSync(second.path,'utf8')),{now:stamp}).identity.deviceName,'renamed display');
  }finally{removeOwned(directory);}
});
test('malformed reserved immutable candidates and duplicate JSON keys are preserved and stop publication',async()=>{
  const directory=writerTemporary(),snapshot=await observe(),filename='commander-companion-'+String(stamp).padStart(16,'0')+'-123e4567-e89b-42d3-a456-426614174000.json',target=path.join(directory,filename);
  try{
    for(const content of ['isolated personal fixture',serializeCompanionObservation(snapshot,{now:stamp}).replace('"schema":1','"schema":1,"schema":1')]){
      fs.writeFileSync(target,content,{mode:0o600});const before=hash(fs.readFileSync(target));
      assert.throws(()=>writeCompanionObservation(directory,snapshot,{now:stamp,...writerHooks}),error=>error.companionCode==='COMPANION_EXISTING_SNAPSHOT_UNRECOGNIZED'
        && error.companionWrite.published===false && error.companionWrite.reconciliationRequired===false);
      assert.equal(hash(fs.readFileSync(target)),before);assert.deepEqual(fs.readdirSync(directory),[filename]);
    }
  }finally{removeOwned(directory);}
});
test('post-publication proof failure preserves its immutable artifact and reports explicit reconciliation',async()=>{
  const directory=writerTemporary(),snapshot=await observe();let metadata;
  try{
    assert.throws(()=>writeCompanionObservation(directory,snapshot,{now:stamp,...writerHooks,
      verifyPrivateFile:pin=>({...writerHooks.verifyPrivateFile(pin),ownerVerified:!immutablePattern.test(path.basename(pin.filePath))})}),
      error=>{metadata=error.companionWrite;return error.companionCode==='COMPANION_PRIVATE_FILE_PROOF_INVALID' && metadata.published===true && metadata.reconciliationRequired===true;});
    assert.deepEqual(fs.readdirSync(directory),[metadata.publishedFile]);assert.equal(fs.statSync(path.join(directory,metadata.publishedFile)).nlink,1);
  }finally{removeOwned(directory);}
});
test('exclusive immutable collision never overwrites a competing same-name file or retries',async()=>{
  const directory=writerTemporary(),snapshot=await observe();let competingPath=null;
  try{
    assert.throws(()=>writeCompanionObservation(directory,snapshot,{now:stamp,...writerHooks,verifyPrivateFile:pin=>{
      const match=/^\.commander-companion-([a-f0-9-]{36})\.tmp$/.exec(path.basename(pin.filePath));
      if(match && competingPath===null){competingPath=path.join(directory,'commander-companion-'+String(stamp).padStart(16,'0')+'-'+match[1]+'.json');
        fs.writeFileSync(competingPath,'isolated competing file',{mode:0o600});}
      return writerHooks.verifyPrivateFile(pin);
    }}),error=>error.companionCode==='COMPANION_IMMUTABLE_COLLISION' && error.companionWrite.published===false && error.companionWrite.reconciliationRequired===false);
    assert.equal(fs.readFileSync(competingPath,'utf8'),'isolated competing file');assert.deepEqual(fs.readdirSync(directory),[path.basename(competingPath)]);
  }finally{removeOwned(directory);}
});
test('published immutable tamper is never removed restored or overwritten by failure cleanup',async()=>{
  const directory=writerTemporary(),snapshot=await observe();
  try{
    const first=writeCompanionObservation(directory,snapshot,{now:stamp,...writerHooks}),prior=fs.readFileSync(first.path);let metadata;
    assert.throws(()=>writeCompanionObservation(directory,snapshot,{now:stamp,...writerHooks,verifyPrivateFile:pin=>{
      if(pin.filePath!==first.path && immutablePattern.test(path.basename(pin.filePath)))fs.writeFileSync(pin.filePath,'isolated concurrent target');return writerHooks.verifyPrivateFile(pin);
    }}),error=>{metadata=error.companionWrite;return error.companionCode==='COMPANION_FILE_CONTENT_DRIFT' && metadata.published===true && metadata.reconciliationRequired===true;});
    assert.deepEqual(fs.readFileSync(first.path),prior);assert.equal(fs.readFileSync(path.join(directory,metadata.publishedFile),'utf8'),'isolated concurrent target');
    assert.equal(fs.readdirSync(directory).length,2);
  }finally{removeOwned(directory);}
});
test('temp child descriptor drift prevents publication and leaves no unrecognized artifact',async()=>{
  const directory=writerTemporary(),snapshot=await observe();let checks=0;
  try{
    assert.throws(()=>writeCompanionObservation(directory,snapshot,{now:stamp,...writerHooks,
      verifyPrivateFile:pin=>({...writerHooks.verifyPrivateFile(pin),descriptorSha256:path.basename(pin.filePath)===contract.exportLockFile?'d'.repeat(64):++checks===1?'d'.repeat(64):'e'.repeat(64)})}),
      error=>error.companionCode==='COMPANION_PRIVATE_FILE_PROOF_DRIFT' && error.companionWrite.published===false);
    assert.deepEqual(immutableFiles(directory),[]);assert.equal(fs.readdirSync(directory).length,1);assert.match(fs.readdirSync(directory)[0],/^\.commander-companion-[a-f0-9-]+\.tmp$/);
  }finally{removeOwned(directory);}
});
test('cooperative concurrent writer stops at an existing empty lock without taking over or retrying',async()=>{
  const directory=writerTemporary(),snapshot=await observe();let attempts=0;
  try{
    const result=writeCompanionObservation(directory,snapshot,{now:stamp,...writerHooks,verifyPrivateFile:pin=>{
      if(path.basename(pin.filePath)===contract.exportLockFile && attempts++===0)
        assert.throws(()=>writeCompanionObservation(directory,snapshot,{now:stamp,...writerHooks}),error=>error.companionCode==='COMPANION_EXPORT_BUSY');
      return writerHooks.verifyPrivateFile(pin);
    }});
    assert.equal(immutableFiles(directory).length,1);assert.deepEqual(fs.readdirSync(directory),[path.basename(result.path)]);
    const lockPath=path.join(directory,contract.exportLockFile);fs.writeFileSync(lockPath,'isolated unknown stale lock',{mode:0o600});
    assert.throws(()=>writeCompanionObservation(directory,snapshot,{now:stamp,...writerHooks}),error=>error.companionCode==='COMPANION_EXPORT_BUSY');
    assert.equal(fs.readFileSync(lockPath,'utf8'),'isolated unknown stale lock');
  }finally{removeOwned(directory);}
});
test('recognized stale archive cap is finite and never causes automatic retention deletion',async()=>{
  const directory=writerTemporary(),snapshot=await observe();
  try{
    for(let i=0;i<contract.maxSnapshots;i++){
      const prior=clone(snapshot);prior.observedAtEpochMs=stamp-600000+i;prior.expiresAtEpochMs=prior.observedAtEpochMs+30000;
      const name='commander-companion-'+String(prior.observedAtEpochMs).padStart(16,'0')+'-00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0')+'.json';
      fs.writeFileSync(path.join(directory,name),JSON.stringify(prior),{mode:0o600});
    }
    const before=fs.readdirSync(directory).map(name=>[name,hash(fs.readFileSync(path.join(directory,name)))]);
    reject(()=>writeCompanionObservation(directory,snapshot,{now:stamp,...writerHooks}),'COMPANION_ARCHIVE_LIMIT');
    assert.deepEqual(fs.readdirSync(directory).map(name=>[name,hash(fs.readFileSync(path.join(directory,name)))]),before);
  }finally{removeOwned(directory);}
});
test('immutable filename timestamps must bind to payload observation time without reading legacy content',async()=>{
  const directory=writerTemporary(),snapshot=await observe();
  try{
    const filename='commander-companion-'+String(stamp+1).padStart(16,'0')+'-123e4567-e89b-42d3-a456-426614174000.json';
    fs.writeFileSync(path.join(directory,filename),JSON.stringify(snapshot),{mode:0o600});
    reject(()=>writeCompanionObservation(directory,snapshot,{now:stamp,...writerHooks}),'COMPANION_EXISTING_SNAPSHOT_UNRECOGNIZED');
    assert.deepEqual(fs.readdirSync(directory),[filename]);
  }finally{removeOwned(directory);}
});
