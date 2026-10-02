// Additive V03 backend monitor. Stored observations and ALLOW are never effect grants.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {types} from 'node:util';

const HASH=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const FEATURES=new Set(Array.from({length:10},(_,i)=>'DEV-'+String(i+1).padStart(2,'0')));
const ZERO='0'.repeat(64),JOURNAL='project-monitor.journal.jsonl',LOCK='.project-monitor.lock';
const MAX_BYTES=8*1024*1024,MAX_RECORD=64*1024,MAX_RECORDS=4096;
const STAT=['dev','ino','size','mtimeNs','ctimeNs','birthtimeNs','nlink','mode'];
const ownedErrors=new WeakSet(),ownedFailureRecords=new WeakSet();
const secret=/\b(?:sk|ghp|github_pat)[-_][A-Za-z0-9_-]{16,}|\bBearer\s+\S+|(?:password|api[_ -]?key|access[_ -]?token|secret)\s*[=:]\s*\S+/i;
const plain=v=>v!==null&&typeof v==='object'&&!types.isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype;
const frozen=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))frozen(child);Object.freeze(v);}return v;};
const clone=v=>JSON.parse(JSON.stringify(v));
const sha=v=>createHash('sha256').update(v).digest('hex');
function canonical(v){return Array.isArray(v)?v.map(canonical):plain(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
const encode=v=>JSON.stringify(canonical(v));
function fail(code){throw Object.assign(new Error(code),{code,monitorCode:code});}
function keys(v,allowed,required=allowed,code='MONITOR_SCHEMA'){
  if(!plain(v))fail(code);const descriptors=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(descriptors);
  if(names.some(k=>typeof k!=='string'||!allowed.includes(k)||!Object.hasOwn(descriptors[k],'value')||!descriptors[k].enumerable)
    ||required.some(k=>!Object.hasOwn(descriptors,k)))fail(code);
}
function integer(v,min=0,max=Number.MAX_SAFE_INTEGER){if(!Number.isSafeInteger(v)||v<min||v>max)fail('MONITOR_INTEGER');return v;}
function text(v,max=4096){if(typeof v!=='string'||!v.isWellFormed()||!v.trim()||v.length>max||/[\x00-\x1f\x7f]/u.test(v)||secret.test(v))fail('MONITOR_TEXT');return v;}
function identifier(v){text(v,128);if(!ID.test(v))fail('MONITOR_ID');return v;}
function list(v,max,check){
  if(types.isProxy(v)||!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||v.length>max)fail('MONITOR_ARRAY');
  const d=Object.getOwnPropertyDescriptors(v);
  if(Reflect.ownKeys(d).length!==v.length+1)fail('MONITOR_ARRAY');
  for(let i=0;i<v.length;i++)if(!d[i]||!Object.hasOwn(d[i],'value')||!d[i].enumerable)fail('MONITOR_ARRAY');else check(d[i].value);
}
function normalizedRoot(v){
  text(v,4096);const api=/^[A-Za-z]:[\\/]/.test(v)?path.win32:path.posix;
  if(!api.isAbsolute(v)||api.normalize(v)!==v||v===api.parse(v).root||/(?:^|[\\/])\.{1,2}(?:[\\/]|$)/.test(v)
    ||v.endsWith(api.sep)||/^(?:\\\\|\/\/)/.test(v))fail('MONITOR_ROOT');
  if(api===path.win32&&v.slice(3).split('\\').some(p=>/[<>:"|?*]/.test(p)||/[. ]$/.test(p)))fail('MONITOR_ROOT');
  return api===path.win32?v.toLowerCase():v;
}
function binding(v){
  keys(v,['hostId','profileId','projectId','root','rootIdentity']);keys(v.rootIdentity,['dev','ino']);
  for(const k of ['hostId','profileId','projectId'])identifier(v[k]);
  for(const k of ['dev','ino'])if(typeof v.rootIdentity[k]!=='string'||!/^(?:0|[1-9][0-9]{0,19})$/.test(v.rootIdentity[k])
    ||BigInt(v.rootIdentity[k])>18446744073709551615n)fail('MONITOR_ROOT_IDENTITY');
  return frozen({...v,root:normalizedRoot(v.root),rootIdentity:{...v.rootIdentity}});
}
function checkpoint(v){
  if(v===null)return null;keys(v,['revision','summary','evidence']);integer(v.revision,1);text(v.summary);
  const ids=new Set();list(v.evidence,32,item=>{
    keys(item,['id','sha256','kind']);identifier(item.id);
    if(typeof item.sha256!=='string'||!HASH.test(item.sha256)||!['SOURCE','CONFIG','REPRO_AUDIT','REPORT','HANDOFF'].includes(item.kind)||ids.has(item.id))fail('MONITOR_EVIDENCE');
    ids.add(item.id);
  });return clone(v);
}
function observation(v,expected,now){
  keys(v,['binding','observedAtEpochMs','heartbeatAtEpochMs','phase','status','uncertainOperationIds','checkpoint']);
  if(encode(binding(v.binding))!==encode(expected))fail('MONITOR_BINDING_MISMATCH');
  integer(v.observedAtEpochMs,1,now);integer(v.heartbeatAtEpochMs,1,v.observedAtEpochMs);
  identifier(v.phase);if(!['RUNNING','IDLE','WAITING_INPUT','COMPLETED','FAILED','PAUSED'].includes(v.status))fail('MONITOR_STATUS');
  list(v.uncertainOperationIds,32,identifier);if(new Set(v.uncertainOperationIds).size!==v.uncertainOperationIds.length)fail('MONITOR_DUPLICATE');
  const classification=v.uncertainOperationIds.length?'UNCERTAIN':now-v.observedAtEpochMs>300000?'STALE':
    v.status!=='RUNNING'?v.status:now-v.heartbeatAtEpochMs>60000?'STALLED':'HEALTHY';
  return frozen({observedAtEpochMs:v.observedAtEpochMs,heartbeatAtEpochMs:v.heartbeatAtEpochMs,phase:v.phase,
    status:v.status,classification,uncertainOperationIds:[...v.uncertainOperationIds].sort(),checkpoint:checkpoint(v.checkpoint)});
}
function dataValue(object,key){if(object===null||typeof object!=='object'||types.isProxy(object))return undefined;
  const descriptor=Object.getOwnPropertyDescriptor(object,key);return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;}
function capture(error,phase){
  const old=ownedErrors.has(error)?dataValue(error,'primaryRecord'):undefined;
  if(old&&ownedFailureRecords.has(old))return old;
  const raw=typeof error==='string'?error:dataValue(error,'message'),message=typeof raw==='string'?raw:'non-message exception';
  const supplied=dataValue(error,'code'),code=typeof supplied==='string'&&/^[A-Z0-9_]{1,96}$/.test(supplied)?supplied:'MONITOR_UNEXPECTED';
  let className='NonError';
  if(error!==null&&typeof error==='object'&&!types.isProxy(error)){
    const proto=Object.getPrototypeOf(error),constructor=proto&&!types.isProxy(proto)&&Object.getOwnPropertyDescriptor(proto,'constructor');
    const ctor=constructor&&Object.hasOwn(constructor,'value')?constructor.value:undefined;
    const name=typeof ctor==='function'&&!types.isProxy(ctor)&&Object.getOwnPropertyDescriptor(ctor,'name');
    if(name&&Object.hasOwn(name,'value')&&typeof name.value==='string')className=name.value;
  }
  const result=frozen({phase,class:className,code,
    message:secret.test(message)?'<redacted>':message.slice(0,256),messageChars:message.length,
    messageBytes:Buffer.byteLength(message),messageSha256:sha(message),messageTruncated:message.length>256});
  ownedFailureRecords.add(result);return result;
}
function preserved(error,phase,secondary=[],uncertain=false){
  const record=capture(error,phase),e=new Error(record.code);e.code=record.code;e.monitorCode=record.code;e.primaryRecord=record;
  const old=ownedErrors.has(error)?dataValue(error,'secondaryRecords'):undefined;
  e.secondaryRecords=frozen([...(old??[]),...secondary]);
  e.reconciliationRequired=uncertain||ownedErrors.has(error)&&dataValue(error,'reconciliationRequired')===true;
  e.mutationPossible=uncertain||ownedErrors.has(error)&&dataValue(error,'mutationPossible')===true;
  ownedErrors.add(e);return Object.freeze(e);
}
function closeHandle(fd,phase,primary,secondary){
  if(fd===undefined)return primary;
  try{fs.closeSync(fd);}catch(error){const record=capture(error,phase);
    if(primary){secondary.push(record);primary=preserved(primary,phase,[],true);}else primary=preserved(error,phase,[],true);}
  return primary;
}
function parse(line){
  // Duplicate decoded member guard; no ordinary JSON.parse last-wins authority.
  const stack=[];let tokens=0;
  for(let i=0;i<line.length;i++){
    const c=line[i];if(/\s/.test(c))continue;if(++tokens>20000)fail('MONITOR_JOURNAL_JSON');
    if(c==='{'||c==='['){stack.push({object:c==='{',members:new Set()});if(stack.length>16)fail('MONITOR_JOURNAL_JSON');}
    else if(c==='}'||c===']')stack.pop();
    else if(c==='"'){
      const begin=i;for(i++;i<line.length;i++){if(line[i]==='\\')i++;else if(line[i]==='"')break;}
      if(i>=line.length)fail('MONITOR_JOURNAL_JSON');let next=i+1;while(/\s/.test(line[next]??'')&&next<line.length)next++;
      if(line[next]===':'&&stack.at(-1)?.object){const name=JSON.parse(line.slice(begin,i+1));if(stack.at(-1).members.has(name))fail('MONITOR_JOURNAL_JSON');stack.at(-1).members.add(name);}
    }else if(c!==','&&c!==':')while(i+1<line.length&&!/[\s,\]}:]/.test(line[i+1]))i++;
  }
  try{return JSON.parse(line);}catch{fail('MONITOR_JOURNAL_JSON');}
}
function statToken(s){for(const k of STAT)if(typeof s[k]!=='bigint')fail('MONITOR_FILE_IDENTITY_UNAVAILABLE');return STAT.map(k=>String(s[k]));}
function same(a,b){return statToken(a).join('|')===statToken(b).join('|');}
function fileStat(file){const s=fs.lstatSync(file,{bigint:true});if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n)fail('MONITOR_FILE_ALIAS');return s;}

export const PROJECT_MONITOR_POLICY=frozen({schema:1,executionAuthority:'NONE',promotionAllowed:false,
  gameEnabled:false,videoEnabled:false,disabledFeatures:['DEV-09'],privateStorageQualification:'UNPROVEN_NATIVE_WINDOWS_Q5_STOP',
  maxJournalBytes:MAX_BYTES,maxRecords:MAX_RECORDS,maxRecordBytes:MAX_RECORD,heartbeatRecordIntervalMs:30000,
  noStaleLockTakeover:true,noAutomaticRetry:true,maxScheduledDurationMs:3600000,
  browserTransport:'HOST_METADATA_ADAPTER_ONLY_NO_BROWSER_OR_REAL_CHAT_CONTROL'});

export function createProjectMonitor(options){
  keys(options,['directory','binding','verifyPrivateDirectory','verifyPrivateFile','readBackendState','clock','scheduler','readTimeoutMs'],
    ['directory','binding','verifyPrivateDirectory','verifyPrivateFile'],'MONITOR_OPTIONS_SCHEMA');
  const {directory,verifyPrivateDirectory,verifyPrivateFile,readBackendState=null,clock=Date.now,
    scheduler={setTimeout,clearTimeout},readTimeoutMs=3000}=options;
  if(typeof verifyPrivateDirectory!=='function'||typeof verifyPrivateFile!=='function')fail('MONITOR_PRIVATE_VERIFIER_REQUIRED');
  if(typeof clock!=='function'||readBackendState!==null&&typeof readBackendState!=='function')fail('MONITOR_ADAPTER');
  keys(scheduler,['setTimeout','clearTimeout']);if(typeof scheduler.setTimeout!=='function'||typeof scheduler.clearTimeout!=='function')fail('MONITOR_SCHEDULER');
  integer(readTimeoutMs,10,30000);normalizedRoot(directory);
  const pinnedBinding=binding(options.binding),bindingSha256=sha(encode(pinnedBinding));
  const directoryPath=fs.realpathSync.native(directory);if(normalizedRoot(directoryPath)!==normalizedRoot(directory))fail('MONITOR_DIRECTORY_CANONICAL');
  let running=path.parse(directory).root;
  for(const segment of directory.slice(running.length).split(path.sep).filter(Boolean)){
    running=path.join(running,segment);const s=fs.lstatSync(running,{bigint:true});
    if(!s.isDirectory()||s.isSymbolicLink())fail('MONITOR_DIRECTORY_ALIAS');
  }
  const directoryPin=fs.lstatSync(directory,{bigint:true});
  const journalPath=path.join(directoryPath,JOURNAL),lockPath=path.join(directoryPath,LOCK);
  let cachedSequence=0,cachedHash=ZERO,inFlight=null,scheduled=false,scheduleToken=null,scheduleTicks=0,scheduleError=null,lastClock=0;
  function now(){const value=integer(clock(),1);if(value<lastClock)fail('MONITOR_CLOCK_REGRESSION');lastClock=value;return value;}
  function checkDirectory(){
    const s=fs.lstatSync(directoryPath,{bigint:true});
    if(!s.isDirectory()||s.isSymbolicLink()||s.dev!==directoryPin.dev||s.ino!==directoryPin.ino)fail('MONITOR_DIRECTORY_DRIFT');
    if(verifyPrivateDirectory(frozen({directory:directoryPath,dev:String(s.dev),ino:String(s.ino)}))!==true)fail('MONITOR_DIRECTORY_PRIVATE_UNPROVEN');
  }
  function proveFile(file,s,phase){
    try{if(verifyPrivateFile(frozen({filePath:file,dev:String(s.dev),ino:String(s.ino)}))!==true)fail('MONITOR_FILE_PRIVATE_UNPROVEN');}
    catch(error){throw preserved(error,phase);}
  }
  function readRecords(){
    checkDirectory();let fd,primary,result;const secondary=[];let phase='JOURNAL_STAT';
    try{
      let before;try{before=fileStat(journalPath);}catch(error){if(error.code==='ENOENT'){
        if(cachedSequence!==0)fail('MONITOR_JOURNAL_ROLLBACK');return [];
      }throw error;}
      if(before.size>BigInt(MAX_BYTES))fail('MONITOR_JOURNAL_LIMIT');phase='JOURNAL_PRIVATE_PROOF';proveFile(journalPath,before,phase);
      phase='JOURNAL_OPEN';fd=fs.openSync(journalPath,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
      const held=fs.fstatSync(fd,{bigint:true});if(!same(held,before))fail('MONITOR_FILE_DRIFT');
      const bytes=Buffer.alloc(Number(held.size)+1);let length=0;phase='JOURNAL_READ';
      while(length<bytes.length){const n=fs.readSync(fd,bytes,length,bytes.length-length,length);if(!n)break;length+=n;}
      if(length!==Number(held.size)||!same(held,fs.fstatSync(fd,{bigint:true}))||!same(held,fileStat(journalPath)))fail('MONITOR_FILE_DRIFT');
      const encoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length));
      if(encoded&&!encoded.endsWith('\n'))fail('MONITOR_JOURNAL_PARTIAL');
      const lines=encoded?encoded.slice(0,-1).split('\n'):[];if(lines.length>MAX_RECORDS)fail('MONITOR_JOURNAL_LIMIT');
      let prior=ZERO;result=[];phase='JOURNAL_VALIDATE';
      for(const line of lines){
        if(!line||Buffer.byteLength(line)>MAX_RECORD)fail('MONITOR_JOURNAL_LIMIT');
        const row=parse(line);keys(row,['schema','sequence','previousSha256','bindingSha256','kind','data','createdAtEpochMs','recordSha256']);
        integer(row.sequence,1);integer(row.createdAtEpochMs,1);if(row.schema!==1||row.sequence!==result.length+1
          ||row.previousSha256!==prior||row.bindingSha256!==bindingSha256||!HASH.test(row.recordSha256))fail('MONITOR_JOURNAL_CHAIN');
        const {recordSha256,...body}=row;if(sha(encode(body))!==recordSha256)fail('MONITOR_JOURNAL_HASH');
        if(!['OBSERVATION_CHANGE','HEARTBEAT','CONTINUE_REQUEST','FEATURE_DECISION'].includes(row.kind))fail('MONITOR_JOURNAL_KIND');
        validateRecordData(row.kind,row.data,row.createdAtEpochMs);prior=recordSha256;result.push(frozen(row));
      }
      if(result.length<cachedSequence||cachedSequence&&result[cachedSequence-1].recordSha256!==cachedHash)fail('MONITOR_JOURNAL_ROLLBACK');
      cachedSequence=result.length;cachedHash=prior;
    }catch(error){primary=preserved(error,phase);}
    finally{primary=closeHandle(fd,'JOURNAL_READ_CLOSE',primary,secondary);}
    if(primary)throw preserved(primary,phase,secondary);return result;
  }
  function validateRecordData(kind,data,when){
    if(kind==='OBSERVATION_CHANGE'||kind==='HEARTBEAT'){
      keys(data,['observedAtEpochMs','heartbeatAtEpochMs','phase','status','classification','uncertainOperationIds','checkpoint']);
      const {classification,...observed}=data;
      const rechecked=observation({binding:pinnedBinding,...observed},pinnedBinding,when);
      if(rechecked.classification!==classification)fail('MONITOR_JOURNAL_CLASSIFICATION');
      return rechecked;
    }
    if(kind==='CONTINUE_REQUEST'){keys(data,['requestId','reason']);identifier(data.requestId);text(data.reason,1000);return;}
    keys(data,['featureId','decision','reasonCodes']);validateFeature(data);
  }
  function validateFeature(data){
    if(!FEATURES.has(data.featureId)||!['ALLOW','DENY','PAUSED','UNPROVEN'].includes(data.decision))fail('MONITOR_FEATURE');
    if(data.featureId==='DEV-09'&&data.decision!=='PAUSED')fail('MONITOR_FEATURE_PAUSED');
    list(data.reasonCodes,16,code=>{if(typeof code!=='string'||!/^[A-Z0-9_]{1,64}$/.test(code))fail('MONITOR_REASON');});
    if(new Set(data.reasonCodes).size!==data.reasonCodes.length)fail('MONITOR_DUPLICATE');
  }
  function withLock(expectedSequence,action){
    integer(expectedSequence);checkDirectory();let lockFd,lockPin,primary,result,mutationPossible=false;const secondary=[];
    let phase='LOCK_CREATE';
    try{
      try{lockFd=fs.openSync(lockPath,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW??0),0o600);}
      catch(error){if(error.code==='EEXIST')fail('MONITOR_LOCK_BUSY');throw error;}
      lockPin=fs.fstatSync(lockFd,{bigint:true});if(!same(lockPin,fileStat(lockPath))||lockPin.size!==0n)fail('MONITOR_LOCK_IDENTITY');
      phase='LOCK_PRIVATE_PROOF';proveFile(lockPath,lockPin,phase);
      const records=readRecords();if(records.length!==expectedSequence)fail('MONITOR_CAS_CONFLICT');
      result=action(records,mark=>{mutationPossible=mark;});
    }catch(error){primary=preserved(error,phase,[],mutationPossible);}
    finally{
      primary=closeHandle(lockFd,'LOCK_CLOSE',primary,secondary);
      if(lockPin&&!mutationPossible&&!primary?.reconciliationRequired||lockPin&&!primary){
        try{checkDirectory();const current=fileStat(lockPath);if(!same(lockPin,current)||current.size!==0n)fail('MONITOR_LOCK_DRIFT');fs.unlinkSync(lockPath);}
        catch(error){if(primary)secondary.push(capture(error,'LOCK_RELEASE'));else primary=preserved(error,'LOCK_RELEASE',[],mutationPossible);}
      }
    }
    if(primary)throw preserved(primary,phase,secondary,mutationPossible);return result;
  }
  function append(records,kind,data,mark){
    if(records.length>=MAX_RECORDS)fail('MONITOR_JOURNAL_LIMIT');
    const body={schema:1,sequence:records.length+1,previousSha256:records.at(-1)?.recordSha256??ZERO,
      bindingSha256,kind,data,createdAtEpochMs:now()};
    const row={...body,recordSha256:sha(encode(body))},bytes=Buffer.from(encode(row)+'\n');
    if(bytes.length>MAX_RECORD)fail('MONITOR_RECORD_LIMIT');
    let fd,primary;const secondary=[];let phase='JOURNAL_WRITE_OPEN';
    try{
      let existing;try{existing=fileStat(journalPath);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(existing&&existing.size+BigInt(bytes.length)>BigInt(MAX_BYTES))fail('MONITOR_JOURNAL_LIMIT');
      fd=fs.openSync(journalPath,fs.constants.O_WRONLY|fs.constants.O_APPEND|(fs.constants.O_NOFOLLOW??0)
        |(existing?0:fs.constants.O_CREAT|fs.constants.O_EXCL),0o600);
      const before=fs.fstatSync(fd,{bigint:true});if(!same(before,fileStat(journalPath))||existing&&!same(existing,before))fail('MONITOR_FILE_DRIFT');
      phase='JOURNAL_PRIVATE_PROOF';proveFile(journalPath,before,phase);phase='JOURNAL_APPEND';
      mark(true);if(fs.writeSync(fd,bytes,0,bytes.length)!==bytes.length)fail('MONITOR_WRITE_UNCERTAIN');
      fs.fsyncSync(fd);phase='JOURNAL_POST';
      const after=fs.fstatSync(fd,{bigint:true});if(after.dev!==before.dev||after.ino!==before.ino||after.nlink!==1n
        ||after.size!==before.size+BigInt(bytes.length)||!same(after,fileStat(journalPath)))fail('MONITOR_WRITE_UNCERTAIN');
      proveFile(journalPath,after,'JOURNAL_POST_PRIVATE_PROOF');
    }catch(error){primary=preserved(error,phase,[],true);}
    finally{primary=closeHandle(fd,'JOURNAL_APPEND_CLOSE',primary,secondary);}
    if(primary)throw preserved(primary,phase,secondary,true);
    const verified=readRecords();if(verified.length!==row.sequence||verified.at(-1).recordSha256!==row.recordSha256)fail('MONITOR_WRITE_UNCERTAIN');
    mark(false);return frozen({changed:true,sequence:row.sequence,eventKey:row.recordSha256,kind,classification:data.classification??null,
      executionAuthority:'NONE',gameEnabled:false,videoEnabled:false,sentToChat:false});
  }
  function unchanged(records,record=null){return frozen({changed:false,sequence:records.length,eventKey:record?.recordSha256??null,
    executionAuthority:'NONE',gameEnabled:false,videoEnabled:false,sentToChat:false});}
  function lastObservation(records){return records.findLast(r=>r.kind==='OBSERVATION_CHANGE'||r.kind==='HEARTBEAT');}
  const signature=data=>sha(encode({phase:data.phase,status:data.status,classification:data.classification,
    uncertainOperationIds:data.uncertainOperationIds,checkpoint:data.checkpoint}));
  checkDirectory();readRecords();
  async function poll(request){
    keys(request,['expectedSequence']);integer(request.expectedSequence);
    if(inFlight)throw preserved(Object.assign(new Error('MONITOR_BUSY'),{code:'MONITOR_BUSY'}),'POLL_ADMISSION');
    if(readBackendState===null)throw preserved(Object.assign(new Error('MONITOR_BACKEND_ADAPTER_MISSING'),{code:'MONITOR_BACKEND_ADAPTER_MISSING'}),'POLL_ADMISSION');
    const controller=new AbortController();let expired=false,timer;
    // AbortSignal is a native mutable capability, not serialized workflow data.
    const pending=Promise.resolve().then(()=>readBackendState(Object.freeze({signal:controller.signal,binding:pinnedBinding})));
    inFlight=pending;pending.finally(()=>{if(inFlight===pending)inFlight=null;}).catch(()=>{});
    try{
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;controller.abort();
        reject(Object.assign(new Error('MONITOR_BACKEND_TIMEOUT'),{code:'MONITOR_BACKEND_TIMEOUT'}));},readTimeoutMs);});
      const incoming=await Promise.race([pending,timeout]);if(expired)fail('MONITOR_BACKEND_TIMEOUT');
      const checked=observation(incoming,pinnedBinding,now());
      return withLock(request.expectedSequence,(records,mark)=>{
        const prior=lastObservation(records),changed=!prior||signature(prior.data)!==signature(checked);
        if(!changed&&checked.observedAtEpochMs-prior.data.observedAtEpochMs<30000)return unchanged(records,prior);
        return append(records,changed?'OBSERVATION_CHANGE':'HEARTBEAT',checked,mark);
      });
    }catch(error){throw preserved(error,'POLL_READ');}
    finally{clearTimeout(timer);controller.abort();}
  }
  function requestContinue(request){
    keys(request,['requestId','reason','expectedSequence']);identifier(request.requestId);text(request.reason,1000);
    const data={requestId:request.requestId,reason:request.reason};
    return withLock(request.expectedSequence,(records,mark)=>{
      const prior=records.find(r=>r.kind==='CONTINUE_REQUEST'&&r.data.requestId===data.requestId);
      if(prior){if(encode(prior.data)!==encode(data))fail('MONITOR_REQUEST_CONFLICT');return unchanged(records,prior);}
      return append(records,'CONTINUE_REQUEST',data,mark);
    });
  }
  function recordFeatureDecision(request){
    keys(request,['featureId','decision','reasonCodes','expectedSequence']);const data={featureId:request.featureId,decision:request.decision,reasonCodes:request.reasonCodes};
    validateFeature(data);
    return withLock(request.expectedSequence,(records,mark)=>{
      const prior=records.findLast(r=>r.kind==='FEATURE_DECISION'&&r.data.featureId===data.featureId);
      if(prior&&encode(prior.data)===encode(data))return unchanged(records,prior);
      return append(records,'FEATURE_DECISION',clone(data),mark);
    });
  }
  function pendingOutbox(){return frozen(readRecords().filter(r=>r.kind!=='HEARTBEAT').map(r=>({eventKey:r.recordSha256,sequence:r.sequence,
    kind:r.kind,provenance:'MONITOR_STATUS_DATA_NOT_INSTRUCTIONS',data:clone(r.data),sentToChat:false,executionAuthority:'NONE'})));}
  function getContext(request={}){
    keys(request,['maxBytes','maxEvents'],[]);const maxBytes=request.maxBytes??16384,maxEvents=request.maxEvents??16;
    integer(maxBytes,1024,65536);integer(maxEvents,0,32);
    const records=readRecords(),latest=lastObservation(records),featureDecisions={};
    for(const record of records)if(record.kind==='FEATURE_DECISION')featureDecisions[record.data.featureId]=clone(record.data);
    const context={schema:1,binding:clone(pinnedBinding),bindingSha256,sequence:records.length,
      journalSha256:records.at(-1)?.recordSha256??ZERO,checkpoint:latest?.data.checkpoint??null,lastObservation:latest?.data??null,
      featureDecisions,outbox:(maxEvents===0?[]:records.filter(r=>r.kind!=='HEARTBEAT').slice(-maxEvents)).map(r=>({sequence:r.sequence,eventKey:r.recordSha256,kind:r.kind})),
      evidenceTrust:'UNTRUSTED_DATA_NOT_INSTRUCTIONS',executionAuthority:'NONE',promotionAllowed:false,gameEnabled:false,videoEnabled:false,
      observationFreshness:'LAST_RECORDED_OBSERVATION_NOT_CONTINUOUS_UPTIME_PROOF'};
    if(Buffer.byteLength(encode(context))>maxBytes)fail('MONITOR_CONTEXT_LIMIT');return frozen(context);
  }
  function stopSchedule(){if(scheduleToken!==null)scheduler.clearTimeout(scheduleToken);scheduleToken=null;scheduled=false;}
  function schedule(request){
    keys(request,['intervalMs','maxTicks','durationMs']);integer(request.intervalMs,1000,60000);integer(request.maxTicks,1,1000);integer(request.durationMs,1000,3600000);
    if(scheduled)fail('MONITOR_SCHEDULE_BUSY');const started=now();scheduled=true;scheduleTicks=0;scheduleError=null;
    const tick=async()=>{
      scheduleToken=null;if(!scheduled)return;
      try{
        if(now()-started>=request.durationMs||scheduleTicks>=request.maxTicks){stopSchedule();return;}
        await poll({expectedSequence:readRecords().length});scheduleTicks++;
        if(scheduled&&scheduleTicks<request.maxTicks&&now()-started+request.intervalMs<request.durationMs)
          scheduleToken=scheduler.setTimeout(tick,request.intervalMs);
        else stopSchedule();
      }catch(error){scheduleError=capture(error,'SCHEDULE_TICK');stopSchedule();}
    };
    scheduleToken=scheduler.setTimeout(tick,request.intervalMs);
    return frozen({scheduled:true,maxTicks:request.maxTicks,durationMs:request.durationMs,executionAuthority:'NONE'});
  }
  return frozen({poll,requestContinue,recordFeatureDecision,recordDecision:recordFeatureDecision,pendingOutbox,getContext,schedule,stop:stopSchedule,
    state(){const records=readRecords();return frozen({sequence:records.length,bindingSha256,lastRecordSha256:records.at(-1)?.recordSha256??ZERO,
      busy:inFlight!==null,scheduled,scheduleTicks,scheduleError,gameEnabled:false,videoEnabled:false,executionAuthority:'NONE',
      nativePrivateStorageQualified:false});}});
}
