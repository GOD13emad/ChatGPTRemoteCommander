import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {admitGrant,canonical,data,exact,fail,hash,hashData,HASH,inspectDirectory,integer,ownedPath,parseStrictJson,readPinned,sameIdentity,sameStatIdentity,identityFromStat,validateIdentity} from './project-catalog.mjs';

const ZERO='0'.repeat(64),MAX_JOURNAL=1048576,MAX_RECORD=262144;
function errorRecord(error){return {name:String(error?.name??'Error').slice(0,128),code:String(error?.code??'UNKNOWN').slice(0,256),message:String(error?.message??'Unknown failure').slice(0,4096)};}
function modelReply(input,callId){
  const result=data(input,{maxBytes:32768});exact(result,['proposal','receipt']);exact(result.proposal,['choice']);exact(result.receipt,['model','callId','validated','streamSha256','artifactSha256']);
  if(!['CONTINUE_STEP','STOP'].includes(result.proposal.choice)||result.receipt.model!=='gpt-6.1-sol'||result.receipt.callId!==callId||result.receipt.validated!==true||!HASH.test(result.receipt.streamSha256)||!HASH.test(result.receipt.artifactSha256))fail('PROJECT_MODEL_RECEIPT');return result;
}
function nativeReceipt(input,action){
  const value=data(input,{maxBytes:action.maxOutputBytes*3+32768});
  const proof=value.proof;
  if(!proof||proof.schema!==1||proof.status!=='COMPLETED'||proof.assignedBeforeResume!==true||proof.cleanupConfirmed!==true||proof.activeJobProcesses!==0||proof.ownedJobTerminated!==false||proof.win32Error!==0||proof.cleanupWin32Error!==0||value.exitCode!==0||value.signal!==null||value.closed!==true||value.overflow!==false||value.pipeError!==null||typeof value.stdout!=='string'||typeof value.stderr!=='string'||Buffer.byteLength(value.stdout)+Buffer.byteLength(value.stderr)>action.maxOutputBytes)fail('PROJECT_NATIVE_RECEIPT');
  return {kind:action.kind,exitCode:0,stdoutSha256:hash(value.stdout),stderrSha256:hash(value.stderr),stdoutBytes:Buffer.byteLength(value.stdout),stderrBytes:Buffer.byteLength(value.stderr),nativeProofSha256:hashData(proof),cleanupConfirmed:true};
}
function storedError(value){exact(value,['name','code','message']);for(const [key,max]of[['name',128],['code',256],['message',4096]])if(typeof value[key]!=='string'||value[key].length>max)fail('PROJECT_JOURNAL_ERROR');}
function storedReceipt(input,action){
  const value=data(input,{maxBytes:32768});if(value.kind!==action.kind)fail('PROJECT_JOURNAL_RECEIPT');
  if(action.kind==='run_project_command'){
    exact(value,['kind','exitCode','stdoutSha256','stderrSha256','stdoutBytes','stderrBytes','nativeProofSha256','cleanupConfirmed']);
    if(value.exitCode!==0||value.cleanupConfirmed!==true||!HASH.test(value.stdoutSha256)||!HASH.test(value.stderrSha256)||!HASH.test(value.nativeProofSha256))fail('PROJECT_JOURNAL_RECEIPT');integer(value.stdoutBytes,0,action.maxOutputBytes);integer(value.stderrBytes,0,action.maxOutputBytes);if(value.stdoutBytes+value.stderrBytes>action.maxOutputBytes)fail('PROJECT_JOURNAL_RECEIPT');
  }else{
    exact(value,action.kind==='write_text'?['kind','path','sha256','bytes','createOnly']:action.kind==='search_files'?['kind','path','sha256','bytes','querySha256','matches']:['kind','path','sha256','bytes']);
    if(value.path!==action.path||value.sha256!==action.sha256||value.bytes!==action.bytes||action.kind==='write_text'&&value.createOnly!==true)fail('PROJECT_JOURNAL_RECEIPT');
    if(action.kind==='search_files'){if(value.querySha256!==hash(action.query)||!Array.isArray(value.matches)||value.matches.length>action.maxMatches)fail('PROJECT_JOURNAL_RECEIPT');let previous=-action.query.length;for(const at of value.matches){integer(at,0,action.bytes);if(at<previous+action.query.length)fail('PROJECT_JOURNAL_RECEIPT');previous=at;}}
  }return value;
}
function decisionContext(grant,grantHash,action,state,currentTime){
  const declared=action.kind==='write_text'?Object.fromEntries(Object.entries(action).filter(([key])=>key!=='content')):action;
  const actionSummary={...declared,scope:{root:grant.root,target:action.kind==='run_project_command'?action.program:ownedPath(grant.root,action.path),mode:action.kind==='write_text'?'CREATE_ONLY_OWNED_FILE':action.kind==='run_project_command'?'EXACT_PINNED_NATIVE_PROGRAM':'READ_ONLY_PINNED_INPUT'}};
  if(action.kind==='write_text'){actionSummary.contentSha256=action.sha256;actionSummary.contentBytes=action.bytes;actionSummary.createOnly=true;}
  const context=data({schema:1,owner:grant.owner,projectId:grant.projectId,authorizationSha256:grant.authorizationSha256,grantHash,currentStep:action.id,kind:action.kind,catalogActionSha256:hashData(action),actionSummary,
    choices:['CONTINUE_STEP','STOP'],currentTime,deadline:state.enrolled.deadline,reservedCurrentModelCall:true,
    modelCallsBeforeReservation:state.models.size,modelCallBudget:grant.budgets.maxModelCalls,remainingModelCalls:grant.budgets.maxModelCalls-state.models.size-1,
    actionAttemptsBeforeDecision:state.actions.size,actionBudget:grant.budgets.maxActions,remainingActions:grant.budgets.maxActions-state.actions.size,
    executorPreflight:{status:'PINS_AND_COMPLETED_FILE_OUTPUTS_VERIFIED',checkedAt:currentTime,inputPinsVerified:grant.inputs.length,sourcePinsVerified:grant.sourcePins.length,completedSteps:state.completed.size,completedWriteOutputsRechecked:grant.catalog.filter(a=>a.kind==='write_text'&&state.completed.has(a.id)).length,rootAndExclusiveJournalOwnerVerified:true,scope:'EXECUTOR_CHECKS_AT_CHECKED_AT_NOT_NEW_AUTHORITY'}
  },{maxBytes:32768});
  function freeze(item){if(item&&typeof item==='object'){Object.values(item).forEach(freeze);Object.freeze(item);}return item;}return freeze(context);
}
function readJournal(file){
  const raw=readPinned(file,{maxBytes:MAX_JOURNAL});if(raw.bytes>1048576)fail('PROJECT_JOURNAL_READER_BOUND');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw.data);if(text&&!text.endsWith('\n'))fail('PROJECT_JOURNAL_TORN_NO_REPAIR');
  const records=[];let previous=ZERO;for(const line of text?text.slice(0,-1).split('\n'):[]){
    if(records.length>=1024||Buffer.byteLength(line)>MAX_RECORD)fail('PROJECT_JOURNAL_RECORD_BOUND');const record=data(parseStrictJson(line,MAX_RECORD),{maxBytes:MAX_RECORD});
    exact(record,['schema','seq','type','at','payload','previousSha256','sha256']);const {sha256,...unsigned}=record;
    if(record.schema!==1||record.seq!==records.length+1||record.previousSha256!==previous||sha256!==hashData(unsigned)||!Number.isSafeInteger(record.at)||typeof record.type!=='string')fail('PROJECT_JOURNAL_CHAIN');records.push(record);previous=sha256;
  }return records;
}
function reduce(records){
  if(!records.length||records[0].type!=='ENROLLED')fail('PROJECT_ENROLLMENT_MISSING');
  const enrolled=records[0].payload,models=new Map(),actions=new Map(),completed=new Map(),outbox=new Map();let desired='RUN',final=false,blocked=false,budgetStopped=false,lastAt=records[0].at;
  exact(enrolled,['grantHash','grant','rootIdentity','stateIdentity','createdAt','deadline']);const grant=admitGrant(enrolled.grant);
  if(hashData(grant)!==enrolled.grantHash||enrolled.createdAt!==records[0].at||enrolled.deadline!==enrolled.createdAt+grant.budgets.wallTimeMs)fail('PROJECT_ENROLLMENT_DRIFT');
  for(const identity of [enrolled.rootIdentity,enrolled.stateIdentity])validateIdentity(identity);
  function actionOf(id){const action=grant.catalog.find(a=>a.id===id);if(!action)fail('PROJECT_JOURNAL_ACTION_NOT_CATALOG');return action;}
  const pendingNow=()=>[...models.values(),...actions.values()].some(x=>x.pending);
  const nextAction=()=>grant.catalog.find(a=>!completed.has(a.id));
  function admissionAt(event,stepId){if(desired!=='RUN'||final||blocked||budgetStopped||pendingNow()||event.at>=enrolled.deadline||nextAction()?.id!==stepId)fail('PROJECT_JOURNAL_ADMISSION');}
  function eventFor(actionId,stepId,receipt){return {eventId:hashData({grantHash:enrolled.grantHash,actionId,receipt}),type:'STEP_COMPLETED',projectId:grant.projectId,stepId,receiptSha256:hashData(receipt)};}
  for(const event of records.slice(1)){
    if(event.at<lastAt)fail('PROJECT_CLOCK_REVERSED');lastAt=event.at;const p=event.payload;
    if(event.type==='MODEL_INTENT'){exact(p,['callId','stepId','budgetCall','catalogActionSha256']);admissionAt(event,p.stepId);const action=actionOf(p.stepId);if(models.has(p.callId)||p.callId!=='call_'+(models.size+1)||p.budgetCall!==models.size+1||models.size>=grant.budgets.maxModelCalls||p.catalogActionSha256!==hashData(action)||completed.has(p.stepId)||[...models.values()].some(m=>m.receipt&&m.stepId===p.stepId&&![...actions.values()].some(a=>a.callId===m.callId)))fail('PROJECT_DUPLICATE_INTENT');models.set(p.callId,{...p,pending:true});}
    else if(event.type==='MODEL_RECEIPT'){exact(p,['callId','stepId','reply']);const item=models.get(p.callId);if(!item?.pending||item.stepId!==p.stepId)fail('PROJECT_MODEL_ORDER');item.pending=false;item.receipt=modelReply(p.reply,p.callId);}
    else if(event.type==='MODEL_FAILURE'){exact(p,['callId','error']);storedError(p.error);if(!models.get(p.callId)?.pending)fail('PROJECT_MODEL_ORDER');}
    else if(event.type==='ACTION_INTENT'){exact(p,['actionId','callId','stepId','budgetAction','requestSha256','effectiveTimeoutMs']);admissionAt(event,p.stepId);const action=actionOf(p.stepId),call=models.get(p.callId);integer(p.effectiveTimeoutMs,1,Math.min(enrolled.deadline-event.at,action.kind==='run_project_command'?action.timeoutMs:grant.budgets.wallTimeMs));if(actions.has(p.actionId)||p.actionId!=='action_'+(actions.size+1)||p.budgetAction!==actions.size+1||actions.size>=grant.budgets.maxActions||p.requestSha256!==hashData(action)||!call?.receipt||call.stepId!==p.stepId||call.receipt.proposal.choice!=='CONTINUE_STEP'||completed.has(p.stepId)||[...actions.values()].some(a=>a.callId===p.callId))fail('PROJECT_ACTION_ORDER');actions.set(p.actionId,{...p,pending:true});}
    else if(event.type==='ACTION_RECEIPT'){exact(p,['actionId','stepId','receipt']);const item=actions.get(p.actionId);if(!item?.pending||item.stepId!==p.stepId||completed.has(p.stepId))fail('PROJECT_ACTION_ORDER');const receipt=storedReceipt(p.receipt,actionOf(p.stepId));item.pending=false;item.receipt=receipt;completed.set(p.stepId,receipt);const out=eventFor(p.actionId,p.stepId,receipt);outbox.set(out.eventId,{...out,acknowledged:false});}
    else if(event.type==='ACTION_FAILURE'){exact(p,['actionId','error']);storedError(p.error);if(!actions.get(p.actionId)?.pending)fail('PROJECT_ACTION_ORDER');}
    else if(event.type==='RECONCILED'){
      exact(p,['kind','id','outcome','evidenceSha256','receipt']);if(!['model','action'].includes(p.kind)||!['not_started','applied'].includes(p.outcome)||!HASH.test(p.evidenceSha256)||p.kind==='model'&&p.outcome!=='not_started'||p.outcome==='not_started'&&p.receipt!==null)fail('PROJECT_RECONCILE_ORDER');const table=p.kind==='model'?models:actions,item=table.get(p.id);if(!item?.pending)fail('PROJECT_RECONCILE_ORDER');item.pending=false;item.reconciled=p.outcome;
      if(p.kind==='action'&&p.outcome==='applied'){const action=actionOf(item.stepId);if(completed.has(item.stepId)||!['write_text','run_project_command'].includes(action.kind))fail('PROJECT_RECONCILE_ORDER');item.receipt=storedReceipt(p.receipt,action);completed.set(item.stepId,item.receipt);const out=eventFor(item.actionId,item.stepId,item.receipt);outbox.set(out.eventId,{...out,acknowledged:false});}
    }else if(event.type==='CONTROL'){exact(p,['desired']);if(!['RUN','PAUSE','CANCEL'].includes(p.desired)||desired==='CANCEL'||final)fail('PROJECT_CONTROL');desired=p.desired;if(desired==='RUN')blocked=false;}
    else if(event.type==='OUTBOX'){const old=outbox.get(p.eventId);if(!old||canonical(p)!==canonical(eventFor([...actions.values()].find(a=>a.stepId===p.stepId&&a.receipt)?.actionId,p.stepId,completed.get(p.stepId))))fail('PROJECT_OUTBOX_ORDER');}
    else if(event.type==='OUTBOX_ACK'){exact(p,['eventId']);if(!outbox.has(p.eventId))fail('PROJECT_OUTBOX_ORDER');outbox.get(p.eventId).acknowledged=true;}
    else if(event.type==='FINAL_ACCEPTED'){exact(p,['checks','modelCalls','actions']);if(final||desired!=='RUN'||blocked||budgetStopped||pendingNow()||completed.size!==grant.catalog.length||p.modelCalls!==models.size||p.actions!==actions.size||models.size>grant.budgets.maxModelCalls||actions.size>grant.budgets.maxActions||event.at>=enrolled.deadline||canonical(p.checks)!==canonical(grant.acceptance))fail('PROJECT_FINAL_UNPROVEN');final=true;}
    else if(event.type==='PREFLIGHT_FAILURE'){exact(p,['error']);storedError(p.error);blocked=true;}
    else if(event.type==='BUDGET_STOP'){exact(p,['kind']);if(desired!=='RUN'||final||!['deadline','acceptance_deadline','calls_or_actions','after_model_deadline','before_effect_deadline','preflight_deadline'].includes(p.kind))fail('PROJECT_BUDGET_RECORD');budgetStopped=true;}
    else if(event.type==='STOPPED'){exact(p,['callId','stepId']);const call=models.get(p.callId);if(desired!=='RUN'||final||!call?.receipt||call.stepId!==p.stepId||call.receipt.proposal.choice!=='STOP')fail('PROJECT_MODEL_ORDER');}
    else if(event.type==='CHECKPOINT'){exact(p,['status','completedSteps','modelCalls','actions','deadline','priorHeadSha256']);if(typeof p.status!=='string'||p.modelCalls!==models.size||p.actions!==actions.size||p.deadline!==enrolled.deadline||p.priorHeadSha256!==event.previousSha256||canonical(p.completedSteps)!==canonical(grant.catalog.filter(a=>completed.has(a.id)).map(a=>a.id)))fail('PROJECT_CHECKPOINT_DRIFT');}
    else fail('PROJECT_EVENT_UNKNOWN');
  }
  const consumedCalls=new Set([...actions.values()].map(a=>a.callId));
  const readyDecisions=[...models.values()].filter(m=>m.receipt&&!consumedCalls.has(m.callId)&&!completed.has(m.stepId));
  return {enrolled,models,actions,completed,outbox,desired,final,blocked,budgetStopped,lastAt,readyDecisions,pending:[...models.values()].filter(x=>x.pending).map(x=>({kind:'model',id:x.callId,...x})).concat([...actions.values()].filter(x=>x.pending).map(x=>({kind:'action',id:x.actionId,...x})))};
}

/** One immutable grant, one owned journal and exclusive lock. Ports are trusted
 * integration code, never model data. Native file-handle/SID proof belongs to
 * the injected operational file port; the built-in path checks are not an OS
 * sandbox and this module does not itself claim native installation acceptance.
 */
// Read-only scheduling admission: never creates a lock, journal, call or action.
// A live/abandoned exclusive lock or uncertain intent prevents automatic resume.
export function inspectProjectState({stateRoot,grant:input}){
  const grant=admitGrant(input),rootIdentity=inspectDirectory(grant.root),stateIdentity=inspectDirectory(stateRoot);
  if(fs.existsSync(path.join(stateRoot,'OWNER_LOCK.json')))fail('PROJECT_READ_ONLY_OWNER_LOCK_PRESENT');
  const journal=path.join(stateRoot,'HISTORY.jsonl');
  if(!fs.existsSync(journal)){
    if(fs.readdirSync(stateRoot).length)fail('PROJECT_FRESH_STATE_REQUIRED');
    return {schema:1,status:'FRESH',modelCalls:0,actions:0,pending:0,deadline:null};
  }
  const records=readJournal(journal),state=reduce(records);
  if(state.enrolled.grantHash!==hashData(grant)||canonical(state.enrolled.grant)!==canonical(grant)||!sameIdentity(state.enrolled.rootIdentity,rootIdentity)||!sameIdentity(state.enrolled.stateIdentity,stateIdentity))fail('PROJECT_ENROLLMENT_DRIFT');
  return {schema:1,status:state.pending.length?'RECONCILIATION_REQUIRED':state.final?'FINAL_ACCEPTED':state.desired==='CANCEL'?'CANCELLED':state.desired==='PAUSE'?'PAUSED':state.budgetStopped?'BUDGET_STOP':state.blocked?'BLOCKED':'READY',modelCalls:state.models.size,actions:state.actions.size,pending:state.pending.length,deadline:state.enrolled.deadline};
}
export function createProjectRunner({stateRoot,grant:input,modelPort,nativePort=null,filePort=null,reconcilePort=null,now=Date.now}){
  const grant=admitGrant(input);if(typeof modelPort?.plan!=='function'||typeof now!=='function')fail('PROJECT_PORT_REQUIRED');
  const rootIdentity=inspectDirectory(grant.root),stateIdentity=inspectDirectory(stateRoot);
  if(sameIdentity(rootIdentity,stateIdentity)||path.relative(grant.root,stateRoot).split(path.sep)[0]!=='..'&&!path.isAbsolute(path.relative(grant.root,stateRoot)))fail('PROJECT_STATE_ROOT_SEPARATE');
  const grantHash=hashData(grant),journal=path.join(stateRoot,'HISTORY.jsonl'),lockPath=path.join(stateRoot,'OWNER_LOCK.json'),modelsRoot=path.join(stateRoot,'models');
  const token=randomUUID(),lockFd=fs.openSync(lockPath,'wx',0o600);let closed=false,busy=false,records=[],journalFd=null,activeController=null;
  const lockBytes=Buffer.from(canonical({schema:1,token,pid:process.pid,grantHash})+'\n');let lockIdentity;
  try{fs.writeFileSync(lockFd,lockBytes);fs.fsyncSync(lockFd);lockIdentity=fs.fstatSync(lockFd,{bigint:true});identityFromStat(lockIdentity);}catch(error){try{fs.closeSync(lockFd);}catch(secondary){error.lockCloseError=errorRecord(secondary);}throw error;}
  function alive(){if(closed)fail('PROJECT_CLOSED');if(!sameIdentity(rootIdentity,inspectDirectory(grant.root))||!sameIdentity(stateIdentity,inspectDirectory(stateRoot)))fail('PROJECT_ROOT_DRIFT');const held=fs.fstatSync(lockFd,{bigint:true}),named=fs.lstatSync(lockPath,{bigint:true});if(!sameStatIdentity(held,lockIdentity)||held.nlink!==1n||!sameStatIdentity(named,held)||readPinned(lockPath,{sha256:hash(lockBytes),bytes:lockBytes.length}).sha256!==hash(lockBytes))fail('PROJECT_LOCK_DRIFT');}
  function append(type,payload,enrollmentAt){
    alive();if(enrollmentAt!==undefined&&(type!=='ENROLLED'||records.length||payload.createdAt!==enrollmentAt))fail('PROJECT_ENROLLMENT_CLOCK_AUTHORITY');
    const at=enrollmentAt===undefined?now():enrollmentAt;integer(at,0,Number.MAX_SAFE_INTEGER,'PROJECT_CLOCK');if(records.length&&at<records.at(-1).at)fail('PROJECT_CLOCK_REVERSED');
    if(records.length>=1024)fail('PROJECT_JOURNAL_EVENT_LIMIT');payload=data(payload,{maxBytes:MAX_RECORD-1024});
    if(type==='MODEL_INTENT'&&records[0].payload.deadline-at<100)fail('PROJECT_DEADLINE_EXPIRED');
    if(type==='ACTION_INTENT'){
      const remaining=records[0].payload.deadline-at;integer(payload.effectiveTimeoutMs,1,grant.budgets.wallTimeMs,'PROJECT_ACTION_TIMEOUT_AUTHORITY');
      if(remaining<100)fail('PROJECT_DEADLINE_EXPIRED');payload.effectiveTimeoutMs=Math.min(payload.effectiveTimeoutMs,remaining);
    }
    const unsigned={schema:1,seq:records.length+1,type,at,payload,previousSha256:records.at(-1)?.sha256??ZERO},record={...unsigned,sha256:hashData(unsigned)},bytes=Buffer.from(canonical(record)+'\n');
    // Validate the complete proposed transition BEFORE publication. A rejected
    // proposal never changes the valid disk journal or advances in-memory state.
    if(canonical(readJournal(journal))!==canonical(records))fail('PROJECT_JOURNAL_EXTERNAL_CHANGE');reduce([...records,record]);
    const held=fs.fstatSync(journalFd,{bigint:true}),named=fs.lstatSync(journal,{bigint:true});if(!held.isFile()||held.nlink!==1n||!sameStatIdentity(named,held)||held.size+BigInt(bytes.length)>1048576n)fail('PROJECT_JOURNAL_BOUND_OR_DRIFT');
    fs.writeFileSync(journalFd,bytes);fs.fsyncSync(journalFd);records.push(record);return record;
  }
  function fresh(){alive();const actual=readJournal(journal);if(canonical(actual)!==canonical(records))fail('PROJECT_JOURNAL_EXTERNAL_CHANGE');const state=reduce(records);if(state.enrolled.grantHash!==grantHash||canonical(state.enrolled.grant)!==canonical(grant)||!sameIdentity(state.enrolled.rootIdentity,rootIdentity)||!sameIdentity(state.enrolled.stateIdentity,stateIdentity))fail('PROJECT_ENROLLMENT_DRIFT');return state;}
  function staticPins(){alive();for(const p of grant.inputs)readPinned(ownedPath(grant.root,p.path),p);for(const p of grant.sourcePins)readPinned(p.path,p);for(const a of grant.catalog)if(a.kind==='run_project_command')readPinned(a.program,{sha256:a.executableSha256,maxBytes:1073741824});}
  function activeGate(signal,allowPaused=false){
    const state=fresh(),current=now();integer(current,0,Number.MAX_SAFE_INTEGER,'PROJECT_CLOCK');if(current<state.lastAt)fail('PROJECT_CLOCK_REVERSED');
    if(state.desired!=='RUN'&&!(allowPaused&&state.desired==='PAUSE'))fail('PROJECT_EFFECT_NOT_STARTED_CONTROL');
    if(current>=state.enrolled.deadline)fail('PROJECT_DEADLINE_EXPIRED');if(signal?.aborted)fail('PROJECT_EFFECT_NOT_STARTED_ABORT');return {state,currentTime:current,remaining:state.enrolled.deadline-current};
  }
  async function projectRead(pin,purpose,actionId=null,signal){
    const target=ownedPath(grant.root,pin.path),gate=activeGate(signal,purpose==='reconciliation');if(!filePort)return readPinned(target,pin);
    if(typeof filePort.readPinned!=='function')fail('PROJECT_FILE_PORT_REQUIRED');const reply=data(await filePort.readPinned({root:grant.root,path:pin.path,target,sha256:pin.sha256,bytes:pin.bytes,maxBytes:Math.max(1,pin.bytes)},{actionId,purpose,signal,deadline:gate.state.enrolled.deadline,timeoutMs:Math.max(1,Math.min(30000,gate.remaining))}),{maxBytes:1048576+32768});
    exact(reply,['validated','sha256','bytes','text','proofSha256']);if(reply.validated!==true||reply.sha256!==pin.sha256||reply.bytes!==pin.bytes||!HASH.test(reply.proofSha256)||reply.text!==null&&(typeof reply.text!=='string'||hash(reply.text)!==pin.sha256||Buffer.byteLength(reply.text)!==pin.bytes))fail('PROJECT_FILE_PORT_RECEIPT');
    alive();return {...reply,data:reply.text===null?null:Buffer.from(reply.text)};
  }
  async function pins(signal){staticPins();for(const p of grant.inputs)await projectRead(p,'input_preflight',null,signal);staticPins();}
  async function validateCompleted(state,signal){for(const action of grant.catalog)if(state.completed.has(action.id)&&action.kind==='write_text')await projectRead({path:action.path,sha256:action.sha256,bytes:action.bytes},'completed_recheck',null,signal);}
  function view(){const state=fresh();return {schema:1,projectId:grant.projectId,owner:grant.owner,grantHash,desired:state.desired,status:state.pending.length?'RECONCILIATION_REQUIRED':state.final?'FINAL_ACCEPTED':state.desired==='CANCEL'?'CANCELLED':state.desired==='PAUSE'?'PAUSED':state.budgetStopped?'BUDGET_STOP':state.blocked?'BLOCKED':state.readyDecisions.length?'READY_TO_EXECUTE_CONFIRMED_DECISION':'READY',modelCalls:state.models.size,actions:state.actions.size,completedSteps:grant.catalog.filter(a=>state.completed.has(a.id)).map(a=>a.id),pending:state.pending,deadline:state.enrolled.deadline,createdAt:state.enrolled.createdAt,budgets:grant.budgets,outbox:[...state.outbox.values()].filter(e=>!e.acknowledged),headSha256:records.at(-1).sha256,sequence:records.length,operationalAcceptance:'NOT_CLAIMED_BY_GENERIC_MODULE'};}
  try{
    if(fs.existsSync(journal)){
      records=readJournal(journal);const loaded=reduce(records);if(loaded.enrolled.grantHash!==grantHash||canonical(loaded.enrolled.grant)!==canonical(grant)||!sameIdentity(loaded.enrolled.rootIdentity,rootIdentity)||!sameIdentity(loaded.enrolled.stateIdentity,stateIdentity))fail('PROJECT_ENROLLMENT_DRIFT');
      inspectDirectory(modelsRoot);journalFd=fs.openSync(journal,'a');
    }else{
      const names=fs.readdirSync(stateRoot);if(names.some(n=>n!=='OWNER_LOCK.json'))fail('PROJECT_FRESH_STATE_REQUIRED');
      staticPins();for(const action of grant.catalog)if(action.kind==='write_text'){const target=ownedPath(grant.root,action.path);if(fs.existsSync(target))fail('PROJECT_CREATE_ONLY_TARGET_EXISTS');}
      fs.mkdirSync(modelsRoot);journalFd=fs.openSync(journal,'ax',0o600);const createdAt=now();integer(createdAt,0,Number.MAX_SAFE_INTEGER,'PROJECT_CLOCK');
      append('ENROLLED',{grantHash,grant,rootIdentity,stateIdentity,createdAt,deadline:createdAt+grant.budgets.wallTimeMs},createdAt);
    }
  }catch(error){try{if(journalFd!==null)fs.closeSync(journalFd);fs.closeSync(lockFd);const named=fs.lstatSync(lockPath,{bigint:true});if(sameStatIdentity(named,lockIdentity)&&named.nlink===1n&&hash(fs.readFileSync(lockPath))===hash(lockBytes))fs.unlinkSync(lockPath);}catch(secondary){error.cleanupError=errorRecord(secondary);}throw error;}
  async function execute(action,actionId,signal,effectiveTimeoutMs){
    await pins(signal);let gate=activeGate(signal);if(gate.remaining<100)fail('PROJECT_DEADLINE_EXPIRED');if(action.kind==='run_project_command'){
      if(typeof nativePort!=='function')fail('PROJECT_NATIVE_PORT_REQUIRED');
      const timeoutMs=Math.min(effectiveTimeoutMs,action.timeoutMs,gate.remaining);if(timeoutMs<100)fail('PROJECT_DEADLINE_EXPIRED');
      return nativeReceipt(await nativePort(Object.freeze({executable:action.program,executableSha256:action.executableSha256,cwd:grant.root,args:Object.freeze([...action.args]),sourcePins:action.sourcePins,timeoutMs,maxOutputBytes:action.maxOutputBytes,memoryMb:action.memoryMb,input:''}),{actionId,signal,deadline:gate.state.enrolled.deadline}),action);
    }
    const target=ownedPath(grant.root,action.path);
    if(action.kind==='write_text'){
      if(filePort){if(typeof filePort.createOnly!=='function')fail('PROJECT_FILE_PORT_REQUIRED');gate=activeGate(signal);await filePort.createOnly({root:grant.root,path:action.path,target,content:action.content,sha256:action.sha256,bytes:action.bytes},{actionId,signal,deadline:gate.state.enrolled.deadline,timeoutMs:Math.max(1,Math.min(30000,gate.remaining))});}
      else {const fd=fs.openSync(target,'wx',0o600);try{fs.writeFileSync(fd,action.content,'utf8');fs.fsyncSync(fd);const s=fs.fstatSync(fd,{bigint:true});identityFromStat(s);if(!s.isFile()||s.nlink!==1n||s.size!==BigInt(action.bytes))fail('PROJECT_WRITE_FILE_IDENTITY');}finally{fs.closeSync(fd);}}
      const actual=await projectRead({path:action.path,sha256:action.sha256,bytes:action.bytes},'post_write',actionId,signal);alive();return {kind:action.kind,path:action.path,sha256:actual.sha256,bytes:actual.bytes,createOnly:true};
    }
    const actual=await projectRead({path:action.path,sha256:action.sha256,bytes:action.bytes},'action_read',actionId,signal);if(actual.data===null)fail('PROJECT_READ_TEXT_REQUIRED');const text=new TextDecoder('utf-8',{fatal:true}).decode(actual.data);alive();
    if(action.kind==='read_text')return {kind:action.kind,path:action.path,sha256:actual.sha256,bytes:actual.bytes};
    const matches=[];let offset=0;while(matches.length<action.maxMatches){const at=text.indexOf(action.query,offset);if(at<0)break;matches.push(at);offset=at+action.query.length;}return {kind:action.kind,path:action.path,sha256:actual.sha256,bytes:actual.bytes,querySha256:hash(action.query),matches};
  }
  return Object.freeze({
    status:view,
    checkpoint(){const v=view();append('CHECKPOINT',{status:v.status,completedSteps:v.completedSteps,modelCalls:v.modelCalls,actions:v.actions,deadline:v.deadline,priorHeadSha256:v.headSha256});return view();},
    control(action){if(!['pause','resume','cancel'].includes(action))fail('PROJECT_CONTROL');const state=fresh();if(state.final||state.desired==='CANCEL')fail('PROJECT_CONTROL_TERMINAL');if(action==='resume'&&state.pending.length)fail('PROJECT_RECONCILIATION_REQUIRED');append('CONTROL',{desired:action==='resume'?'RUN':action==='pause'?'PAUSE':'CANCEL'});if(action!=='resume')activeController?.abort();return view();},
    acknowledge(eventId){const state=fresh();if(!state.outbox.has(eventId))fail('PROJECT_OUTBOX_UNKNOWN');if(!state.outbox.get(eventId).acknowledged)append('OUTBOX_ACK',{eventId});return view();},
    async tick(){
      if(busy)fail('PROJECT_BUSY');busy=true;let callId=null,actionId=null,phase='PREFLIGHT',timer=null;const controller=new AbortController();activeController=controller;
      try{
        let state=fresh();if(state.pending.length)fail('PROJECT_RECONCILIATION_REQUIRED');if(state.final||state.desired!=='RUN'||state.blocked||state.budgetStopped)return view();
        const initialNow=now();if(initialNow<state.lastAt)fail('PROJECT_CLOCK_REVERSED');if(initialNow>=state.enrolled.deadline){append('BUDGET_STOP',{kind:'deadline'});return view();}timer=setTimeout(()=>controller.abort(),Math.max(1,state.enrolled.deadline-initialNow));timer.unref?.();
        await pins(controller.signal);await validateCompleted(state,controller.signal);state=fresh();const current=now();if(current<state.lastAt)fail('PROJECT_CLOCK_REVERSED');
        if(state.desired!=='RUN')return view();if(current>=state.enrolled.deadline){append('BUDGET_STOP',{kind:'deadline'});return view();}
        const action=grant.catalog.find(a=>!state.completed.has(a.id));
        if(!action){for(const check of grant.acceptance)await projectRead(check,'acceptance',null,controller.signal);state=fresh();if(state.desired!=='RUN')return view();if(now()<state.lastAt)fail('PROJECT_CLOCK_REVERSED');if(now()>=state.enrolled.deadline||controller.signal.aborted){append('BUDGET_STOP',{kind:'acceptance_deadline'});return view();}staticPins();state=activeGate(controller.signal).state;if(state.pending.length||state.completed.size!==grant.catalog.length)fail('PROJECT_FINAL_UNPROVEN');append('FINAL_ACCEPTED',{checks:grant.acceptance,modelCalls:state.models.size,actions:state.actions.size});return view();}
        const ready=state.readyDecisions.find(m=>m.stepId===action.id);
        if(!ready&&state.models.size>=grant.budgets.maxModelCalls||state.actions.size>=grant.budgets.maxActions){append('BUDGET_STOP',{kind:'calls_or_actions'});return {...view(),status:'BUDGET_STOP'};}
        let reply;
        if(ready){callId=ready.callId;reply=ready.receipt;}
        else{
          const gate=activeGate(controller.signal);state=gate.state;const context=decisionContext(grant,grantHash,action,state,gate.currentTime);
          callId='call_'+(state.models.size+1);const directory=path.join(modelsRoot,callId);fs.mkdirSync(directory);append('MODEL_INTENT',{callId,stepId:action.id,budgetCall:state.models.size+1,catalogActionSha256:hashData(action)});phase='MODEL';
          reply=modelReply(await modelPort.plan(context,{callId,directory,signal:controller.signal,deadline:state.enrolled.deadline,timeoutMs:Math.max(1,Math.min(45000,state.enrolled.deadline-now()))}),callId);append('MODEL_RECEIPT',{callId,stepId:action.id,reply});phase='PREFLIGHT';
        }
        state=fresh();if(state.desired!=='RUN')return view();if(reply.proposal.choice==='STOP'){append('STOPPED',{callId,stepId:action.id});append('CONTROL',{desired:'PAUSE'});return view();}
        if(now()>=state.enrolled.deadline||controller.signal.aborted){append('BUDGET_STOP',{kind:'after_model_deadline'});return view();}
        await pins(controller.signal);await validateCompleted(state,controller.signal);state=fresh();const remaining=state.enrolled.deadline-now();if(now()<state.lastAt)fail('PROJECT_CLOCK_REVERSED');if(remaining<100||controller.signal.aborted||state.desired!=='RUN'){if(state.desired==='RUN')append('BUDGET_STOP',{kind:'before_effect_deadline'});return view();}
        const effectiveTimeoutMs=action.kind==='run_project_command'?Math.min(action.timeoutMs,remaining):remaining;actionId='action_'+(state.actions.size+1);append('ACTION_INTENT',{actionId,callId,stepId:action.id,budgetAction:state.actions.size+1,requestSha256:hashData(action),effectiveTimeoutMs});phase='ACTION';
        const receipt=await execute(action,actionId,controller.signal,effectiveTimeoutMs);await pins(controller.signal);append('ACTION_RECEIPT',{actionId,stepId:action.id,receipt});phase='SETTLED';
        append('OUTBOX',{eventId:hashData({grantHash,actionId,receipt}),type:'STEP_COMPLETED',projectId:grant.projectId,stepId:action.id,receiptSha256:hashData(receipt)});return view();
      }catch(error){try{if(phase==='MODEL')append('MODEL_FAILURE',{callId,error:errorRecord(error)});else if(phase==='ACTION')append('ACTION_FAILURE',{actionId,error:errorRecord(error)});else if(phase==='PREFLIGHT'&&error.code!=='PROJECT_RECONCILIATION_REQUIRED'){const state=fresh();if(error.code==='PROJECT_DEADLINE_EXPIRED'&&state.desired==='RUN')append('BUDGET_STOP',{kind:'preflight_deadline'});else if(!['PROJECT_EFFECT_NOT_STARTED_CONTROL','PROJECT_EFFECT_NOT_STARTED_ABORT'].includes(error.code))append('PREFLIGHT_FAILURE',{error:errorRecord(error)});}}catch(secondary){error.collectorError=errorRecord(secondary);}if(phase==='PREFLIGHT'&&['PROJECT_EFFECT_NOT_STARTED_CONTROL','PROJECT_EFFECT_NOT_STARTED_ABORT','PROJECT_DEADLINE_EXPIRED'].includes(error.code))return view();throw error;
      }finally{if(timer)clearTimeout(timer);activeController=null;busy=false;}
    },
    async reconcile({kind,id,outcome,evidence}){
      if(busy)fail('PROJECT_BUSY');if(!['model','action'].includes(kind)||!['not_started','applied'].includes(outcome)||kind==='model'&&outcome!=='not_started'||typeof reconcilePort!=='function')fail('PROJECT_RECONCILIATION_AUTHORITY');
      busy=true;try{const gate=activeGate(undefined,true),state=gate.state,pending=state.pending.find(p=>p.kind===kind&&p.id===id),head=records.at(-1).sha256;if(!pending)fail('PROJECT_NOT_UNCERTAIN');const action=grant.catalog.find(a=>a.id===pending.stepId);
      const proof=data(await reconcilePort({kind,id,outcome,pending:data(pending),action,grantHash,evidence:data(evidence)}),{maxBytes:65536});exact(proof,['verified','outcome','evidenceSha256','receipt']);if(proof.verified!==true||proof.outcome!==outcome||!HASH.test(proof.evidenceSha256))fail('PROJECT_RECONCILIATION_PROOF');
      if(outcome==='not_started'&&proof.receipt!==null)fail('PROJECT_RECONCILIATION_RECEIPT');
      if(kind==='action'&&outcome==='applied'){
        if(action.kind==='write_text'){const actual=await projectRead({path:action.path,sha256:action.sha256,bytes:action.bytes},'reconciliation',id);const expected={kind:action.kind,path:action.path,sha256:actual.sha256,bytes:actual.bytes,createOnly:true};if(canonical(proof.receipt)!==canonical(expected))fail('PROJECT_RECONCILIATION_RECEIPT');}
        else if(action.kind==='run_project_command')proof.receipt=nativeReceipt(proof.receipt,action);
        else fail('PROJECT_RECONCILIATION_READ_UNSUPPORTED');
      }
      const refreshed=activeGate(undefined,true).state;if(records.at(-1).sha256!==head||refreshed.desired!==state.desired||canonical(refreshed.pending.find(p=>p.kind===kind&&p.id===id))!==canonical(pending))fail('PROJECT_RECONCILIATION_CHANGED_WHILE_AWAIT');staticPins();append('RECONCILED',{kind,id,outcome,evidenceSha256:proof.evidenceSha256,receipt:proof.receipt});return view();}finally{busy=false;}
    },
    close(){if(closed)return;alive();if(busy)fail('PROJECT_CLOSE_BUSY');fs.closeSync(journalFd);fs.closeSync(lockFd);const named=fs.lstatSync(lockPath,{bigint:true});if(!sameStatIdentity(named,lockIdentity)||named.nlink!==1n||hash(fs.readFileSync(lockPath))!==hash(lockBytes))fail('PROJECT_LOCK_RELEASE_DRIFT');fs.unlinkSync(lockPath);closed=true;}
  });
}
