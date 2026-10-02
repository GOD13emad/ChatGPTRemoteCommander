// Private read-only observation. Workflow memory remains data, never authority.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {types} from 'node:util';
import {parseCompanionJson} from './companion-json.mjs';
import {companionSafePosixAncestor} from './companion-private-directory.mjs';
import {createCompanionPrivateFileWindows,companionCreateUncertainty} from './companion-private-create-windows.mjs';

const BINDING_KEYS=['appId','accountId','profileId','workflowId','projectRoot','chatUrl'];
const IDENTITY_KEYS=['appId','profile','deviceName','version','commit','configSha256','routeGeneration'];
const REASONS=['BINDING_MISSING','APP_ID_MISSING','ACCOUNT_ID_MISSING','PROFILE_ID_MISSING','WORKFLOW_ID_MISSING',
  'PROJECT_ROOT_MISSING','CHAT_URL_MISSING','APP_ID_MISMATCH','ACCOUNT_ID_MISMATCH','PROFILE_ID_MISMATCH',
  'WORKFLOW_ID_MISMATCH','PROJECT_ROOT_MISMATCH','CHAT_URL_MISMATCH','CHAT_OBSERVATION_MISSING',
  'CHAT_OBSERVATION_STALE','UNCERTAIN_OPERATION','BACKEND_UNAVAILABLE','BACKEND_MISMATCH','WORKFLOW_UNAVAILABLE',
  'MACHINE_MISMATCH','CONFIG_MISMATCH'];
const ACTIONS=['REVIEW_RECORDED_CHECKPOINT','INSPECT_PROJECT_STATE','RECONCILE_UNCERTAIN',
  'REVIEW_SESSION_BINDING','AWAIT_AUTHORITATIVE_CHAT_OBSERVATION'];
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, WORKFLOW=/^[a-z][a-z0-9_-]{0,63}$/;
const TOOL=/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/, EXTENSION=/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/, MAX_BYTES=64*1024, MAX_TTL=300000;
const DISPLAY_CONTROL=/[\x00-\x1f\x7f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const IMMUTABLE_NAME=/^commander-companion-([0-9]{16})-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.json$/;
const MAX_SNAPSHOTS=32,MAX_DIRECTORY_ENTRIES=4096,EXPORT_LOCK='.commander-companion-export.lock';
const plain=value=>value!==null && typeof value==='object' && !types.isProxy(value) && Object.getPrototypeOf(value)===Object.prototype;
const fail=code=>{throw Object.assign(new Error(code),{companionCode:code});};
const hash=value=>createHash('sha256').update(value).digest('hex');
const frozen=value=>{if(value && typeof value==='object'){for(const item of Object.values(value))frozen(item);Object.freeze(value);}return value;};
function record(value,keys){
  if(!plain(value))fail('COMPANION_INVALID_RECORD');
  const descriptors=Object.getOwnPropertyDescriptors(value), names=Reflect.ownKeys(descriptors);
  if(names.length!==keys.length || names.some(name=>typeof name!=='string' || !keys.includes(name)
    || !Object.hasOwn(descriptors[name],'value') || !descriptors[name].enumerable))fail('COMPANION_INVALID_FIELDS');
}
function nullable(value,pattern){if(value!==null && (typeof value!=='string' || !value.isWellFormed() || DISPLAY_CONTROL.test(value) || !pattern.test(value)
  || /\b(?:sk|ghp|github_pat)[-_][A-Za-z0-9_-]{16,}|\bBearer\s+\S+|(?:password|api[_ -]?key|access[_ -]?token|secret)\s*[=:]\s*\S+/i.test(value)))fail('COMPANION_INVALID_ID');}
function integer(value,maximum=Number.MAX_SAFE_INTEGER){return Number.isSafeInteger(value) && value>0 && value<=maximum;}
function array(value,pattern,maximum){
  if(types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value)!==Array.prototype || value.length>maximum)fail('COMPANION_INVALID_ARRAY');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(descriptors).length!==value.length+1)fail('COMPANION_INVALID_ARRAY');
  for(let i=0;i<value.length;i++)if(!descriptors[i] || !Object.hasOwn(descriptors[i],'value') || !descriptors[i].enumerable
    || typeof descriptors[i].value!=='string' || !pattern.test(descriptors[i].value))fail('COMPANION_INVALID_ARRAY');
  if(new Set(value).size!==value.length)fail('COMPANION_DUPLICATE_ID');
}
function root(value){
  if(typeof value!=='string' || !value.isWellFormed() || value.length>4096 || DISPLAY_CONTROL.test(value) || /^(?:\\\\|\/\/)/.test(value))fail('COMPANION_INVALID_ROOT');
  const api=/^[A-Za-z]:\\/.test(value)?path.win32:path.posix;
  if(!api.isAbsolute(value) || api.normalize(value)!==value || value===api.parse(value).root
    || /(?:^|[\\/])[.]{1,2}(?:[\\/]|$)/.test(value) || value.endsWith(api.sep))fail('COMPANION_INVALID_ROOT');
  if(api===path.win32){if(value.includes('/') || value.slice(3).split('\\').some(part=>/[<>:"|?*]/.test(part) || /[. ]$/.test(part)))fail('COMPANION_INVALID_ROOT');}
  else if(value.includes('\\'))fail('COMPANION_INVALID_ROOT');
  return api===path.win32?value.replace(/[A-Z]/g,character=>character.toLowerCase()):value;
}
function chatUrl(value){
  if(typeof value!=='string' || value.length>1024)fail('COMPANION_INVALID_CHAT_URL');
  let url;try{url=new URL(value);}catch{fail('COMPANION_INVALID_CHAT_URL');}
  if(url.protocol!=='https:' || url.hostname!=='chatgpt.com' || url.port || url.username || url.password || url.search || url.hash
    || !/^\/(?:g\/[A-Za-z0-9_-]{1,128}\/)?c\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname) || url.href!==value)fail('COMPANION_INVALID_CHAT_URL');
  return value;
}
export const COMPANION_OBSERVATION_CONTRACT=frozen({schema:1,kind:'COMMANDER_COMPANION_OBSERVATION',
  producer:{id:'remote-commander-companion',version:'1'},maxBytes:MAX_BYTES,maxDepth:12,maxNodes:4096,maxLifetimeMs:MAX_TTL,
  bindingKeys:[...BINDING_KEYS],identityKeys:[...IDENTITY_KEYS],reasonCodes:[...REASONS],nextActions:[...ACTIONS],
  backendStates:['CONFIRMED','UNAVAILABLE','MISMATCH'],chatStates:['UNKNOWN','CONFIRMED'],projectStates:['UNKNOWN','BOUND','STOP'],
  reconciliationStates:['BOUND','STOP','UNPROVEN'],actionAllowed:false,legacySnapshotFile:'commander-companion.json',
  immutableSnapshotFilename:'commander-companion-<16-digit observedAtEpochMs>-<lowercase UUID>.json',
  maxSnapshots:MAX_SNAPSHOTS,maxDirectoryEntries:MAX_DIRECTORY_ENTRIES,exportLockFile:EXPORT_LOCK,
  publication:'APPEND_ONLY_EXCLUSIVE_LINK',retention:'OPERATOR_ONLY_NO_AUTOMATIC_DELETE',
  stateIsNotAuthority:true,currentChatExposureDefault:'UNKNOWN',displayNameIsNotMachineIdentity:true});
export function validateCompanionBinding(value){
  record(value,BINDING_KEYS);
  for(const key of ['appId','accountId','profileId'])nullable(value[key],TOKEN);
  nullable(value.workflowId,WORKFLOW);
  if(value.projectRoot!==null)root(value.projectRoot);
  if(value.chatUrl!==null)chatUrl(value.chatUrl);
  return value;
}
export function validateCompanionConfiguration(value){
  if(value===undefined)return null;
  record(value,['binding']);validateCompanionBinding(value.binding);
  return frozen(JSON.parse(JSON.stringify(value.binding)));
}
function validateIdentity(value){
  record(value,IDENTITY_KEYS);
  for(const key of ['appId','profile','version'])nullable(value[key],TOKEN);
  nullable(value.deviceName,/^[^\x00-\x1f\x7f]{1,128}$/u);
  nullable(value.commit,/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);nullable(value.configSha256,HASH);
  if(value.routeGeneration!==null && !integer(value.routeGeneration))fail('COMPANION_INVALID_GENERATION');
}
export function validateCompanionObservation(value,{now=Date.now(),requireFresh=true}={}){
  record(value,['schema','kind','observedAtEpochMs','expiresAtEpochMs','producer','identity','backend','currentChat','project','binding','reconciliation']);
  if(value.schema!==1 || value.kind!==COMPANION_OBSERVATION_CONTRACT.kind)fail('COMPANION_INVALID_SCHEMA');
  record(value.producer,['id','version']);if(value.producer.id!=='remote-commander-companion' || value.producer.version!=='1')fail('COMPANION_INVALID_PRODUCER');
  if(!integer(value.observedAtEpochMs) || !integer(value.expiresAtEpochMs) || value.expiresAtEpochMs<value.observedAtEpochMs
    || value.expiresAtEpochMs-value.observedAtEpochMs>MAX_TTL)fail('COMPANION_INVALID_LIFETIME');
  if(requireFresh && (!integer(now) || now<value.observedAtEpochMs || now>=value.expiresAtEpochMs))fail('COMPANION_STALE_OBSERVATION');
  validateIdentity(value.identity);validateCompanionBinding(value.binding);
  record(value.backend,['state','toolNames','toolCatalogSha256']);array(value.backend.toolNames,TOOL,256);nullable(value.backend.toolCatalogSha256,HASH);
  if(!COMPANION_OBSERVATION_CONTRACT.backendStates.includes(value.backend.state))fail('COMPANION_INVALID_BACKEND');
  if(value.backend.state==='CONFIRMED'){
    if(value.backend.toolCatalogSha256!==hash(JSON.stringify([...value.backend.toolNames].sort())))fail('COMPANION_BACKEND_HASH_MISMATCH');
  }else if(value.backend.toolNames.length || value.backend.toolCatalogSha256!==null)fail('COMPANION_UNPROVEN_BACKEND_FIELDS');
  record(value.currentChat,['state','conversationUrl','appId','toolNames','skills','plugins']);
  array(value.currentChat.toolNames,TOOL,256);array(value.currentChat.skills,EXTENSION,64);array(value.currentChat.plugins,EXTENSION,64);
  if(!COMPANION_OBSERVATION_CONTRACT.chatStates.includes(value.currentChat.state))fail('COMPANION_INVALID_CHAT_STATE');
  nullable(value.currentChat.appId,TOKEN);if(value.currentChat.conversationUrl!==null)chatUrl(value.currentChat.conversationUrl);
  if(value.currentChat.state==='UNKNOWN' && (value.currentChat.appId!==null || value.currentChat.conversationUrl!==null
    || value.currentChat.toolNames.length || value.currentChat.skills.length || value.currentChat.plugins.length))fail('COMPANION_UNPROVEN_CHAT_FIELDS');
  if(value.currentChat.state==='CONFIRMED' && (value.currentChat.appId===null || value.currentChat.conversationUrl===null))fail('COMPANION_CHAT_IDENTITY_MISSING');
  record(value.project,['state','projectId','root','revision','nextAction','evidenceSha256']);
  if(!COMPANION_OBSERVATION_CONTRACT.projectStates.includes(value.project.state))fail('COMPANION_INVALID_PROJECT_STATE');
  nullable(value.project.projectId,WORKFLOW);if(value.project.root!==null)root(value.project.root);
  if(value.project.revision!==null && !integer(value.project.revision,10000))fail('COMPANION_INVALID_REVISION');
  if(value.project.nextAction!==null && !ACTIONS.includes(value.project.nextAction))fail('COMPANION_INVALID_NEXT_ACTION');
  nullable(value.project.evidenceSha256,HASH);
  record(value.reconciliation,['state','reasonCodes','actionAllowed']);array(value.reconciliation.reasonCodes,/^[A-Z_]{1,64}$/,16);
  if(!COMPANION_OBSERVATION_CONTRACT.reconciliationStates.includes(value.reconciliation.state) || value.reconciliation.actionAllowed!==false
    || value.reconciliation.reasonCodes.some(code=>!REASONS.includes(code)))fail('COMPANION_INVALID_RECONCILIATION');
  if((value.project.state==='BOUND')!==(value.reconciliation.state==='BOUND'))fail('COMPANION_BOUND_CONTRADICTION');
  if((value.project.state==='STOP')!==(value.reconciliation.state==='STOP'))fail('COMPANION_STOP_CONTRADICTION');
  const conflicts=(value.identity.appId!==null && value.binding.appId!==null && value.identity.appId!==value.binding.appId)
    || (value.identity.profile!==null && value.binding.profileId!==null && value.identity.profile!==value.binding.profileId)
    || (value.project.projectId!==null && value.binding.workflowId!==null && value.project.projectId!==value.binding.workflowId)
    || (value.project.root!==null && value.binding.projectRoot!==null && root(value.project.root)!==root(value.binding.projectRoot))
    || (value.currentChat.state==='CONFIRMED' && ((value.binding.appId!==null && value.currentChat.appId!==value.binding.appId)
      || (value.binding.chatUrl!==null && value.currentChat.conversationUrl!==value.binding.chatUrl)));
  if(conflicts && value.reconciliation.state!=='STOP')fail('COMPANION_CONFLICT_NOT_STOPPED');
  if(value.reconciliation.state==='BOUND' && (value.reconciliation.reasonCodes.length || BINDING_KEYS.some(key=>value.binding[key]===null)
    || value.project.state!=='BOUND' || value.project.revision===null || value.project.root===null
    || value.currentChat.state!=='CONFIRMED' || value.backend.state!=='CONFIRMED'
    || value.identity.appId!==value.binding.appId || value.identity.profile!==value.binding.profileId
    || value.currentChat.appId!==value.binding.appId || value.currentChat.conversationUrl!==value.binding.chatUrl
    || value.project.projectId!==value.binding.workflowId || root(value.project.root)!==root(value.binding.projectRoot)))fail('COMPANION_BOUND_CONTRADICTION');
  if(value.reconciliation.state==='STOP' && (!value.reconciliation.reasonCodes.length || value.project.state!=='STOP'))fail('COMPANION_STOP_CONTRADICTION');
  if(Buffer.byteLength(JSON.stringify(value))>MAX_BYTES)fail('COMPANION_SNAPSHOT_LIMIT');
  return value;
}
const missingBinding=()=>Object.fromEntries(BINDING_KEYS.map(key=>[key,null]));
const missingIdentity=()=>Object.fromEntries(IDENTITY_KEYS.map(key=>[key,null]));
const unknownChat=()=>({state:'UNKNOWN',conversationUrl:null,appId:null,toolNames:[],skills:[],plugins:[]});

/** Host adapters are constructor-only trusted operator capabilities. MCP callers
 * may select the already-bound ID; they cannot inject chat/account evidence. */
export function createCompanionSession(options){
  if(!plain(options))fail('COMPANION_INVALID_RECORD');
  const descriptors=Object.getOwnPropertyDescriptors(options), keys=Reflect.ownKeys(descriptors);
  if(keys.some(key=>typeof key!=='string' || !['binding','identity','readWorkflow','readOperations','readBackendTools','readCurrentChat','clock'].includes(key)
    || !Object.hasOwn(descriptors[key],'value') || !descriptors[key].enumerable))fail('COMPANION_INVALID_FIELDS');
  const supplied=Object.create(null);for(const key of keys)supplied[key]=descriptors[key].value;
  const {binding=null,identity=null,readWorkflow,readOperations,readBackendTools=null,readCurrentChat=null,clock=Date.now}=supplied;
  if(typeof readWorkflow!=='function' || typeof readOperations!=='function' || typeof clock!=='function'
    || readBackendTools!==null && typeof readBackendTools!=='function' || readCurrentChat!==null && typeof readCurrentChat!=='function')fail('COMPANION_ADAPTER_REQUIRED');
  const pinnedBinding=JSON.parse(JSON.stringify(validateCompanionBinding(binding??missingBinding())));
  const pinnedIdentity=identity??missingIdentity();validateIdentity(pinnedIdentity);
  const identityCopy=JSON.parse(JSON.stringify(pinnedIdentity));
  return frozen({async observe(request){
    record(request,['id']);if(typeof request.id!=='string' || !WORKFLOW.test(request.id))fail('COMPANION_INVALID_WORKFLOW');
    if(pinnedBinding.workflowId!==null && request.id!==pinnedBinding.workflowId)fail('COMPANION_WORKFLOW_ID_MISMATCH');
    const now=clock();if(!integer(now))fail('COMPANION_CLOCK_INVALID');
    let lastNow=now;
    const currentNow=()=>{const moment=clock();if(!integer(moment) || moment<lastNow)fail('COMPANION_CLOCK_INVALID');lastNow=moment;return moment;};
    const reasons=[];let stop=false;
    const add=(code,blocking=false)=>{if(!reasons.includes(code))reasons.push(code);stop ||= blocking;};
    if(binding===null)add('BINDING_MISSING');
    const missingCodes=['APP_ID_MISSING','ACCOUNT_ID_MISSING','PROFILE_ID_MISSING','WORKFLOW_ID_MISSING','PROJECT_ROOT_MISSING','CHAT_URL_MISSING'];
    BINDING_KEYS.forEach((key,index)=>{if(pinnedBinding[key]===null)add(missingCodes[index]);});
    for(const [field,key]of [['appId','appId'],['profile','profileId']]){
      if(identityCopy[field]!==null && pinnedBinding[key]!==null && identityCopy[field]!==pinnedBinding[key])add(field==='appId'?'APP_ID_MISMATCH':'PROFILE_ID_MISMATCH',true);
    }
    let backend={state:'UNAVAILABLE',toolNames:[],toolCatalogSha256:null};
    if(readBackendTools){try{const names=await readBackendTools();array(names,TOOL,256);backend={state:'CONFIRMED',toolNames:[...names].sort(),toolCatalogSha256:hash(JSON.stringify([...names].sort()))};}catch{add('BACKEND_MISMATCH',true);backend.state='MISMATCH';}}
    else add('BACKEND_UNAVAILABLE');
    currentNow();
    let view,operations=[];
    try{view=await readWorkflow(request.id);operations=await readOperations(request.id);
      if(view?.state && view.state.id!==request.id)add('WORKFLOW_ID_MISMATCH',true);
      if(!view?.state || view.state.id!==request.id || !integer(view.state.revision,10000) || !Array.isArray(operations) || operations.length>4096)fail('COMPANION_WORKFLOW_UNAVAILABLE');
      root(view.state.root);
    }catch{view=null;add('WORKFLOW_UNAVAILABLE');}
    currentNow();
    const project={state:'UNKNOWN',projectId:null,root:null,revision:null,nextAction:null,evidenceSha256:null};
    if(view){
      project.projectId=view.state.id;project.root=view.state.root;project.revision=view.state.revision;
      const evidence=view.state.checkpoint?.evidence??[];
      if(!Array.isArray(evidence) || evidence.length>20 || evidence.some(item=>!HASH.test(item?.sha256??'')))fail('COMPANION_WORKFLOW_EVIDENCE_INVALID');
      project.evidenceSha256=evidence.length?hash(JSON.stringify(evidence.map(item=>item.sha256))):null;
      project.nextAction=view.state.checkpoint?'REVIEW_RECORDED_CHECKPOINT':'INSPECT_PROJECT_STATE';
      if(pinnedBinding.projectRoot!==null && root(project.root)!==root(pinnedBinding.projectRoot))add('PROJECT_ROOT_MISMATCH',true);
      if(identityCopy.configSha256!==null && view.state.configSha256!==identityCopy.configSha256)add('CONFIG_MISMATCH',true);
      if(operations.some(operation=>operation.status==='UNCERTAIN') || view.state.steps?.some(step=>step.status==='uncertain'))add('UNCERTAIN_OPERATION',true);
    }
    let currentChat=unknownChat(),chatReceiptExpiry=null;
    if(readCurrentChat){
      try{
        const chat=await readCurrentChat();record(chat,['observedAtEpochMs','expiresAtEpochMs','binding','toolNames','skills','plugins']);
        const chatNow=currentNow();
        validateCompanionBinding(chat.binding);array(chat.toolNames,TOOL,256);array(chat.skills,EXTENSION,64);array(chat.plugins,EXTENSION,64);
        if(!integer(chat.observedAtEpochMs) || !integer(chat.expiresAtEpochMs) || chat.expiresAtEpochMs<chat.observedAtEpochMs
          || chat.expiresAtEpochMs-chat.observedAtEpochMs>MAX_TTL || chatNow<chat.observedAtEpochMs || chatNow>=chat.expiresAtEpochMs)add('CHAT_OBSERVATION_STALE',true);
        else{
          BINDING_KEYS.forEach((key,index)=>{
            if(chat.binding[key]===null)add(missingCodes[index]);
            else if(pinnedBinding[key]!==null && (key==='projectRoot'?root(chat.binding[key])!==root(pinnedBinding[key]):chat.binding[key]!==pinnedBinding[key]))
              add(['APP_ID_MISMATCH','ACCOUNT_ID_MISMATCH','PROFILE_ID_MISMATCH','WORKFLOW_ID_MISMATCH','PROJECT_ROOT_MISMATCH','CHAT_URL_MISMATCH'][index],true);
          });
          if(!stop && chat.binding.appId!==null && chat.binding.chatUrl!==null){currentChat={state:'CONFIRMED',conversationUrl:chat.binding.chatUrl,appId:chat.binding.appId,
            toolNames:[...chat.toolNames].sort(),skills:[...chat.skills].sort(),plugins:[...chat.plugins].sort()};chatReceiptExpiry=chat.expiresAtEpochMs;}
        }
      }catch(error){if(error?.companionCode==='COMPANION_CLOCK_INVALID')throw error;add('CHAT_OBSERVATION_MISSING');}
    }else add('CHAT_OBSERVATION_MISSING');
    const finishedAt=currentNow();
    if(chatReceiptExpiry!==null && finishedAt>=chatReceiptExpiry){currentChat=unknownChat();chatReceiptExpiry=null;add('CHAT_OBSERVATION_STALE',true);}
    if(identityCopy.appId===null)add('APP_ID_MISSING');if(identityCopy.profile===null)add('PROFILE_ID_MISSING');
    const state=stop?'STOP':reasons.length?'UNPROVEN':'BOUND';
    project.state=state==='STOP'?'STOP':state==='BOUND'?'BOUND':'UNKNOWN';
    if(stop)project.nextAction=reasons.includes('UNCERTAIN_OPERATION')?'RECONCILE_UNCERTAIN':'REVIEW_SESSION_BINDING';
    else if(state==='UNPROVEN' && view)project.nextAction='AWAIT_AUTHORITATIVE_CHAT_OBSERVATION';
    const snapshot={schema:1,kind:COMPANION_OBSERVATION_CONTRACT.kind,observedAtEpochMs:finishedAt,expiresAtEpochMs:Math.min(finishedAt+60000,chatReceiptExpiry??Infinity),
      producer:{...COMPANION_OBSERVATION_CONTRACT.producer},identity:{...identityCopy},backend,currentChat,project,binding:{...pinnedBinding},
      reconciliation:{state,reasonCodes:reasons.slice(0,16),actionAllowed:false}};
    validateCompanionObservation(snapshot,{now:finishedAt});return frozen(snapshot);
  }});
}

export function serializeCompanionObservation(value,{now=Date.now()}={}){
  validateCompanionObservation(value,{now});return JSON.stringify(value)+'\n';
}
function privateDirectory(directory){
  if(typeof directory!=='string' || !path.isAbsolute(directory))fail('COMPANION_PRIVATE_DIRECTORY_REQUIRED');
  root(directory);
  let current=path.parse(directory).root;
  for(const segment of path.resolve(directory).slice(current.length).split(path.sep).filter(Boolean)){
    current=path.join(current,segment);const stat=fs.lstatSync(current);
    if(!stat.isDirectory() || stat.isSymbolicLink())fail('COMPANION_DIRECTORY_ALIAS');
    if(process.platform!=='win32' && !companionSafePosixAncestor(stat))fail('COMPANION_PROFILE_ROOT_UNSAFE');
  }
  const stat=fs.lstatSync(directory,{bigint:true});
  if(process.platform!=='win32' && (Number(stat.mode&0o077n)!==0 || stat.uid!==BigInt(process.getuid())))fail('COMPANION_DIRECTORY_NOT_PRIVATE');
  return {path:fs.realpathSync.native(directory),stat};
}
function verifyPrivateProof(pin,verifyPrivateDirectory){
  if(verifyPrivateDirectory===null){if(process.platform==='win32')fail('COMPANION_PRIVATE_ACL_UNPROVEN');return null;}
  if(typeof verifyPrivateDirectory!=='function')fail('COMPANION_PRIVATE_CHECKER_REQUIRED');
  const proof=verifyPrivateDirectory({directory:pin.path,dev:pin.stat.dev.toString(),ino:pin.stat.ino.toString()});
  record(proof,['directory','dev','ino','ownerVerified','privatePermissionsVerified','observedAtEpochMs','descriptorSha256']);
  if(proof.directory!==pin.path || proof.dev!==pin.stat.dev.toString() || proof.ino!==pin.stat.ino.toString()
    || proof.ownerVerified!==true || proof.privatePermissionsVerified!==true || !integer(proof.observedAtEpochMs)
    || Date.now()<proof.observedAtEpochMs || Date.now()-proof.observedAtEpochMs>5000
    || typeof proof.descriptorSha256!=='string' || !HASH.test(proof.descriptorSha256))fail('COMPANION_PRIVATE_PROOF_INVALID');
  return proof.descriptorSha256;
}
function fileStat(filePath,expected=null,{links=1n}={}){
  const stat=fs.lstatSync(filePath,{bigint:true});
  if(!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==links
    || (process.platform!=='win32' && (stat.uid!==BigInt(process.getuid()) || (stat.mode&0o077n)!==0n)))fail('COMPANION_SNAPSHOT_ALIAS');
  if(expected && (stat.dev!==expected.dev || stat.ino!==expected.ino))fail('COMPANION_FILE_IDENTITY_DRIFT');
  return stat;
}
function sameContentStat(left,right){return left.dev===right.dev && left.ino===right.ino && left.size===right.size && left.mtimeNs===right.mtimeNs;}
function verifyFileProof(filePath,expected,verifyPrivateFile){
  const before=fileStat(filePath,expected);let descriptorSha256=null;
  if(verifyPrivateFile===null){if(process.platform==='win32')fail('COMPANION_PRIVATE_FILE_ACL_UNPROVEN');}
  else{
    if(typeof verifyPrivateFile!=='function')fail('COMPANION_PRIVATE_FILE_CHECKER_REQUIRED');
    const proof=verifyPrivateFile({filePath,dev:before.dev.toString(),ino:before.ino.toString()});
    record(proof,['filePath','dev','ino','ownerVerified','privatePermissionsVerified','observedAtEpochMs','descriptorSha256']);
    if(proof.filePath!==filePath || proof.dev!==before.dev.toString() || proof.ino!==before.ino.toString()
      || proof.ownerVerified!==true || proof.privatePermissionsVerified!==true || !integer(proof.observedAtEpochMs)
      || Date.now()<proof.observedAtEpochMs || Date.now()-proof.observedAtEpochMs>5000
      || typeof proof.descriptorSha256!=='string' || !HASH.test(proof.descriptorSha256))fail('COMPANION_PRIVATE_FILE_PROOF_INVALID');
    descriptorSha256=proof.descriptorSha256;
  }
  const after=fileStat(filePath,before);if(!sameContentStat(before,after))fail('COMPANION_FILE_CONTENT_DRIFT');
  return {stat:after,descriptorSha256};
}
function readPinnedFile(filePath,expected,{links=1n}={}){
  const before=fileStat(filePath,expected,{links});if(before.size>BigInt(MAX_BYTES))fail('COMPANION_EXISTING_SNAPSHOT_LIMIT');
  let descriptor;
  try{
    descriptor=fs.openSync(filePath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    const opened=fs.fstatSync(descriptor,{bigint:true});
    if(!opened.isFile() || opened.nlink!==links || !sameContentStat(opened,before)
      || (process.platform!=='win32' && (opened.uid!==BigInt(process.getuid()) || (opened.mode&0o077n)!==0n)))fail('COMPANION_FILE_IDENTITY_DRIFT');
    const buffer=Buffer.alloc(MAX_BYTES+1);let length=0;
    while(length<buffer.length){const count=fs.readSync(descriptor,buffer,length,buffer.length-length,length);if(!count)break;length+=count;}
    if(length>MAX_BYTES)fail('COMPANION_EXISTING_SNAPSHOT_LIMIT');
    const after=fs.fstatSync(descriptor,{bigint:true});
    if(!sameContentStat(opened,after) || !sameContentStat(after,fileStat(filePath,before,{links})) || BigInt(length)!==after.size)fail('COMPANION_FILE_CONTENT_DRIFT');
    return {bytes:buffer.subarray(0,length),stat:after};
  }finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
}
function directoryStable(pin,verifyPrivateDirectory,descriptorSha256){
  const current=privateDirectory(pin.path);
  if(current.path!==pin.path || current.stat.dev!==pin.stat.dev || current.stat.ino!==pin.stat.ino)fail('COMPANION_DIRECTORY_DRIFT');
  if(verifyPrivateProof(pin,verifyPrivateDirectory)!==descriptorSha256)fail('COMPANION_PRIVATE_PROOF_DRIFT');
}
function createPosixPrivateArtifact(filePath,bytes,verifyPrivateFile,remember){
  let descriptor;
  try{
    descriptor=fs.openSync(filePath,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    const created=fs.fstatSync(descriptor,{bigint:true}),artifact={filePath,stat:created,sha256:hash(Buffer.alloc(0)),descriptorSha256:null};remember(artifact);
    const emptyProof=verifyFileProof(filePath,created,verifyPrivateFile);
    if(!sameContentStat(emptyProof.stat,fs.fstatSync(descriptor,{bigint:true})))fail('COMPANION_FILE_CONTENT_DRIFT');
    artifact.descriptorSha256=emptyProof.descriptorSha256;
    fs.writeFileSync(descriptor,bytes);fs.fsyncSync(descriptor);
    const written=fs.fstatSync(descriptor,{bigint:true});
    if(created.dev!==written.dev || created.ino!==written.ino || written.size!==BigInt(bytes.length) || written.nlink!==1n)fail('COMPANION_FILE_IDENTITY_DRIFT');
    artifact.sha256=hash(bytes);
    const proof=verifyFileProof(filePath,written,verifyPrivateFile);
    if(proof.descriptorSha256!==emptyProof.descriptorSha256)fail('COMPANION_PRIVATE_FILE_PROOF_DRIFT');
    if(!sameContentStat(proof.stat,fs.fstatSync(descriptor,{bigint:true})))fail('COMPANION_FILE_CONTENT_DRIFT');
    artifact.stat=proof.stat;artifact.descriptorSha256=proof.descriptorSha256;return artifact;
  }finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
}
function createPrivateArtifact(filePath,bytes,verifyPrivateFile,remember,context,createPrivateFile){
  if(process.platform!=='win32' && createPrivateFile===null)return createPosixPrivateArtifact(filePath,bytes,verifyPrivateFile,remember);
  const {pin,verifyPrivateDirectory,privateDescriptorSha256}=context,purpose=path.basename(filePath)===EXPORT_LOCK?'LOCK':'TEMP';
  let descriptor,adopted=false;
  try{
    const created=(createPrivateFile??createCompanionPrivateFileWindows)({filePath,directory:pin.path,
      dev:pin.stat.dev.toString(),ino:pin.stat.ino.toString(),descriptorSha256:privateDescriptorSha256,purpose});
    record(created,['descriptor','dev','ino','descriptorSha256']);
    if(!Number.isSafeInteger(created.descriptor) || created.descriptor<3)fail('COMPANION_CREATE_DESCRIPTOR_INVALID');
    descriptor=created.descriptor;
    if(typeof created.dev!=='string' || typeof created.ino!=='string' || typeof created.descriptorSha256!=='string'
      || !/^(?:0|[1-9][0-9]{0,19})$/.test(created.dev) || !/^(?:0|[1-9][0-9]{0,19})$/.test(created.ino) || !HASH.test(created.descriptorSha256))fail('COMPANION_CREATE_IDENTITY_INVALID');
    const opened=fs.fstatSync(descriptor,{bigint:true}),entry=fileStat(filePath);
    if(!opened.isFile() || opened.nlink!==1n || opened.size!==0n || opened.dev.toString()!==created.dev || opened.ino.toString()!==created.ino
      || !sameContentStat(opened,entry))fail('COMPANION_CREATE_ADOPTION_DRIFT');
    const emptyProof=verifyFileProof(filePath,opened,verifyPrivateFile);
    if(emptyProof.descriptorSha256!==created.descriptorSha256 || !sameContentStat(emptyProof.stat,fs.fstatSync(descriptor,{bigint:true})))fail('COMPANION_PRIVATE_FILE_PROOF_DRIFT');
    directoryStable(pin,verifyPrivateDirectory,privateDescriptorSha256);
    const artifact={filePath,stat:emptyProof.stat,sha256:hash(Buffer.alloc(0)),descriptorSha256:emptyProof.descriptorSha256};
    remember(artifact);adopted=true;
    fs.writeFileSync(descriptor,bytes);fs.fsyncSync(descriptor);
    const written=fs.fstatSync(descriptor,{bigint:true});
    if(opened.dev!==written.dev || opened.ino!==written.ino || written.size!==BigInt(bytes.length) || written.nlink!==1n)fail('COMPANION_FILE_IDENTITY_DRIFT');
    artifact.sha256=hash(bytes);
    const proof=verifyFileProof(filePath,written,verifyPrivateFile);
    if(proof.descriptorSha256!==emptyProof.descriptorSha256 || !sameContentStat(proof.stat,fs.fstatSync(descriptor,{bigint:true})))fail('COMPANION_PRIVATE_FILE_PROOF_DRIFT');
    artifact.stat=proof.stat;return artifact;
  }catch(error){
    // The constructor capability can fail with a primitive or frozen Error.
    // Own a mutable finite error before preserving the uncertain-create state.
    let sourceCode=null,candidate=null;
    try{if(error && (typeof error==='object' || typeof error==='function')){const incoming=Object.getOwnPropertyDescriptors(error);
      sourceCode=incoming.companionCode?.value??incoming.message?.value??null;candidate=incoming.companionCreate?.value??null;}}
    catch{}
    const code=typeof sourceCode==='string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(sourceCode)?sourceCode:'COMPANION_CREATE_FAILED';
    const failure=Object.assign(new Error(code),{companionCode:code});
    let nonCreated=false;
    try{record(candidate,['outcome','reconciliationRequired','basename','purpose']);
      nonCreated=['NOT_CREATED','NOT_CREATED_COLLISION'].includes(candidate.outcome) && candidate.reconciliationRequired===false
        && candidate.basename===path.basename(filePath) && candidate.purpose===purpose;
    }catch{}
    if(!adopted)failure.companionCreate=nonCreated?{...candidate}:companionCreateUncertainty(filePath,purpose);
    throw failure;
  }finally{if(descriptor!==undefined){try{fs.closeSync(descriptor);}catch{const failure=new Error('COMPANION_CREATE_CLOSE_UNCERTAIN');
    failure.companionCode=failure.message;failure.companionCreate=companionCreateUncertainty(filePath,purpose);throw failure;}}}
}
function assertOwnedArtifact(artifact,verifyPrivateFile){
  const proof=verifyFileProof(artifact.filePath,artifact.stat,verifyPrivateFile);
  if(artifact.descriptorSha256!==null && proof.descriptorSha256!==artifact.descriptorSha256)fail('COMPANION_PRIVATE_FILE_PROOF_DRIFT');
  const current=readPinnedFile(artifact.filePath,artifact.stat);if(hash(current.bytes)!==artifact.sha256)fail('COMPANION_SNAPSHOT_POST_HASH');
  return current;
}
function recognizedArchiveCount(directory,verifyPrivateFile){
  const listing=fs.opendirSync(directory);let scanned=0,count=0;
  try{let entry;while((entry=listing.readSync())!==null){
    if(++scanned>MAX_DIRECTORY_ENTRIES)fail('COMPANION_DIRECTORY_ENTRY_LIMIT');
    const match=IMMUTABLE_NAME.exec(entry.name);if(!match)continue;
    const observedAt=Number(match[1]);if(!integer(observedAt))fail('COMPANION_IMMUTABLE_NAME_INVALID');
    if(++count>MAX_SNAPSHOTS)fail('COMPANION_ARCHIVE_LIMIT');
    const filePath=path.join(directory,entry.name),proof=verifyFileProof(filePath,null,verifyPrivateFile),contents=readPinnedFile(filePath,proof.stat);
    try{const snapshot=parseCompanionJson(contents.bytes,{maxBytes:MAX_BYTES,maxDepth:12,maxNodes:4096});
      validateCompanionObservation(snapshot,{requireFresh:false});if(snapshot.observedAtEpochMs!==observedAt)fail('COMPANION_IMMUTABLE_NAME_INVALID');
    }catch{fail('COMPANION_EXISTING_SNAPSHOT_UNRECOGNIZED');}
  }}finally{listing.closeSync();}
  return count;
}
function unlinkPublishedTemporary(temporary,target){
  const left=fileStat(temporary.filePath,temporary.stat,{links:2n}),right=fileStat(target,temporary.stat,{links:2n});
  if(!sameContentStat(left,right))fail('COMPANION_FILE_CONTENT_DRIFT');
  const contents=readPinnedFile(temporary.filePath,temporary.stat,{links:2n});
  if(hash(contents.bytes)!==temporary.sha256 || !sameContentStat(contents.stat,fileStat(target,temporary.stat,{links:2n})))fail('COMPANION_SNAPSHOT_POST_HASH');
  // No callback, wait, or overwrite between the last identity check and unlink.
  fs.unlinkSync(temporary.filePath);
}
/** Finite append-only exporter. Old/legacy/unknown files are never replaced or
 * retained/deleted automatically. Existing export locks are never taken over.
 * A failed published artifact stays in place for explicit reconciliation. */
export function writeCompanionObservation(directory,snapshot,options={}){
  try{return writeCompanionObservationInternal(directory,snapshot,options);}
  catch(error){
    const failure=error instanceof Error?error:Object.assign(new Error('COMPANION_WRITER_FAILED'),{companionCode:'COMPANION_WRITER_FAILED'});
    failure.companionWrite??={published:false,reconciliationRequired:failure.companionCreate?.reconciliationRequired===true,publishedFile:null,temporaryFile:null,lockFile:null};throw failure;
  }
}
function writeCompanionObservationInternal(directory,snapshot,options){
  if(!plain(options))fail('COMPANION_INVALID_RECORD');
  const descriptors=Object.getOwnPropertyDescriptors(options),keys=Reflect.ownKeys(descriptors),supplied=Object.create(null);
  if(keys.some(key=>typeof key!=='string' || !['now','verifyPrivateDirectory','verifyPrivateFile','createPrivateFile'].includes(key)
    || !Object.hasOwn(descriptors[key],'value') || !descriptors[key].enumerable))fail('COMPANION_INVALID_FIELDS');
  for(const key of keys)supplied[key]=descriptors[key].value;
  const {now=Date.now(),verifyPrivateDirectory=null,verifyPrivateFile=null,createPrivateFile=null}=supplied;
  if(createPrivateFile!==null && typeof createPrivateFile!=='function')fail('COMPANION_PRIVATE_CREATOR_REQUIRED');
  const bytes=Buffer.from(serializeCompanionObservation(snapshot,{now})),pin=privateDirectory(directory);
  const privateDescriptorSha256=verifyPrivateProof(pin,verifyPrivateDirectory);
  if(verifyPrivateFile!==null && typeof verifyPrivateFile!=='function')fail('COMPANION_PRIVATE_FILE_CHECKER_REQUIRED');
  if(process.platform==='win32' && verifyPrivateFile===null)fail('COMPANION_PRIVATE_FILE_ACL_UNPROVEN');
  const generation=randomUUID(),target=path.join(pin.path,'commander-companion-'+String(snapshot.observedAtEpochMs).padStart(16,'0')+'-'+generation+'.json');
  let temporary=null,immutable=null,lock=null,published=false,reconciliationRequired=false;
  const creationContext={pin,verifyPrivateDirectory,privateDescriptorSha256};
  try{
    directoryStable(pin,verifyPrivateDirectory,privateDescriptorSha256);
    try{createPrivateArtifact(path.join(pin.path,EXPORT_LOCK),Buffer.alloc(0),verifyPrivateFile,artifact=>{lock=artifact;},creationContext,createPrivateFile);}
    catch(error){if((process.platform!=='win32' && createPrivateFile===null && error.code==='EEXIST')
      || error.companionCreate?.outcome==='NOT_CREATED_COLLISION' && error.companionCreate.reconciliationRequired===false)fail('COMPANION_EXPORT_BUSY');throw error;}
    if(recognizedArchiveCount(pin.path,verifyPrivateFile)>=MAX_SNAPSHOTS)fail('COMPANION_ARCHIVE_LIMIT');
    directoryStable(pin,verifyPrivateDirectory,privateDescriptorSha256);
    createPrivateArtifact(path.join(pin.path,'.commander-companion-'+generation+'.tmp'),bytes,verifyPrivateFile,artifact=>{temporary=artifact;},creationContext,createPrivateFile);
    directoryStable(pin,verifyPrivateDirectory,privateDescriptorSha256);
    assertOwnedArtifact(temporary,verifyPrivateFile);
    immutable={...temporary,filePath:target};
    try{fs.linkSync(temporary.filePath,target);}catch(error){if(error.code==='EEXIST')fail('COMPANION_IMMUTABLE_COLLISION');throw error;}
    published=true;unlinkPublishedTemporary(temporary,target);temporary=null;
    directoryStable(pin,verifyPrivateDirectory,privateDescriptorSha256);
    const output=assertOwnedArtifact(immutable,verifyPrivateFile);
    assertOwnedArtifact(lock,verifyPrivateFile);fs.unlinkSync(lock.filePath);lock=null;
    return {path:target,sha256:hash(output.bytes),bytes:output.bytes.length,private:true,workflowMutation:false};
  }catch(error){
    const uncertain=error.companionCreate?.reconciliationRequired===true?error.companionCreate:null;
    reconciliationRequired=published || uncertain!==null;
    if(published && temporary){try{directoryStable(pin,verifyPrivateDirectory,privateDescriptorSha256);unlinkPublishedTemporary(temporary,target);temporary=null;}catch{reconciliationRequired=true;}}
    for(const artifact of [published?null:temporary,lock])if(artifact){try{directoryStable(pin,verifyPrivateDirectory,privateDescriptorSha256);
      assertOwnedArtifact(artifact,verifyPrivateFile);fs.unlinkSync(artifact.filePath);if(artifact===temporary)temporary=null;else lock=null;
    }catch{reconciliationRequired=true;}}
    const failure=error instanceof Error?error:Object.assign(new Error('COMPANION_WRITER_FAILED'),{companionCode:'COMPANION_WRITER_FAILED'});
    failure.companionWrite={published,reconciliationRequired,publishedFile:published?path.basename(target):null,
      temporaryFile:temporary?path.basename(temporary.filePath):uncertain?.purpose==='TEMP'?uncertain.basename:null,
      lockFile:lock?path.basename(lock.filePath):uncertain?.purpose==='LOCK'?uncertain.basename:null};throw failure;
  }
}
