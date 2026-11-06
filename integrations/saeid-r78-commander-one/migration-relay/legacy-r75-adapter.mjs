// Host-side migration preparation only. No listener, credential access, install,
// process control, route mutation, database copy, or command execution is exported.
import path from 'node:path';import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const fp=/^[a-f0-9]{64}$/,uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const fail=code=>{throw Object.assign(Error(code),{code});};
const canonical=x=>JSON.stringify(x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])):Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
function exact(x,names){if(!object(x)||Object.keys(x).sort().join('|')!==[...names].sort().join('|'))fail('MIGRATION_SCHEMA');}
function safeJsonClone(x){let text;try{text=JSON.stringify(x);}catch{fail('MIGRATION_CONFIG_JSON_REQUIRED');}if(!object(x)||Buffer.byteLength(text)>1048576)fail('MIGRATION_CONFIG_BOUND');return JSON.parse(text);}
export function coreFingerprint(core){
 exact(core,['device','profile','pid','creationFileTime','port','configSha256','sourceSha256']);
 if(!['device','profile'].every(k=>typeof core[k]==='string'&&/^[A-Za-z0-9._-]{1,80}$/.test(core[k]))
 ||!Number.isSafeInteger(core.pid)||core.pid<=0||!Number.isSafeInteger(core.port)||core.port<1024||core.port>65535
 ||typeof core.creationFileTime!=='string'||!/^[1-9][0-9]{0,19}$/.test(core.creationFileTime)
 ||![core.configSha256,core.sourceSha256].every(x=>typeof x==='string'&&fp.test(x)))fail('MIGRATION_CORE_IDENTITY');
 return sha(canonical(core));
}
function registryIdentity(registry,current,nowMs){
 exact(registry,['schema','core','observedAtMs','inventoryComplete','inventoryReceiptSha256','owners']);
 if(registry.schema!==1||coreFingerprint(registry.core)!==coreFingerprint(current))fail('MIGRATION_LEGACY_GENERATION_CHANGED');
 if(!Number.isSafeInteger(registry.observedAtMs)||registry.observedAtMs>nowMs||nowMs-registry.observedAtMs>5000)fail('MIGRATION_INVENTORY_STALE');
 if(typeof registry.inventoryComplete!=='boolean'||!Array.isArray(registry.owners)||registry.owners.length>10000
 ||(registry.inventoryReceiptSha256!==null&&!fp.test(registry.inventoryReceiptSha256)))fail('MIGRATION_INVENTORY_SCHEMA');
 const keys=new Set();
 for(const entry of registry.owners){
  exact(entry,['kind','id','state','unread']);
  if(!['operation','terminal','workflow','browser','gui'].includes(entry.kind)||typeof entry.id!=='string'||entry.id.length>128
   ||!['RUNNING','QUEUED','WAITING','UNCERTAIN','TERMINAL','RELEASED'].includes(entry.state)||typeof entry.unread!=='boolean')fail('MIGRATION_OWNER_SCHEMA');
  if(entry.kind==='operation'&&!uuid.test(entry.id))fail('MIGRATION_OPERATION_ID');
  if(entry.kind==='terminal'&&!/^term-[1-9][0-9]{0,12}$/.test(entry.id))fail('MIGRATION_TERMINAL_ID');
  const key=entry.kind+':'+entry.id;if(keys.has(key))fail('MIGRATION_OWNER_DUPLICATE');keys.add(key);
 }
 return registry;
}
export function assessLegacyDrain({registry,currentCore,nowMs=Date.now()}){
 registryIdentity(registry,currentCore,nowMs);
 const blockers=[];
 if(!registry.inventoryComplete||!registry.inventoryReceiptSha256)blockers.push('LEGACY_OWNER_INVENTORY_INCOMPLETE');
 for(const o of registry.owners)if(o.state!=='RELEASED'&&(o.state!=='TERMINAL'||o.unread))blockers.push('LEGACY_OWNER_RETAINED:'+o.kind+':'+o.id);
 return Object.freeze({status:blockers.length?'KEEP_OLD_CORE_AND_ROUTE':'READY_TO_REQUEST_SEPARATE_FRESH_CUTOVER_CAS',blockers,
  canStopOldCore:false,canSwitchRoute:false,canReplay:false,inventoryIsIndependentProof:false,
  externalGate:'Actual complete generation-bound inventory and parent-controlled route CAS; this module grants no authority'});
}
export function prepareLegacyReadRelay({registry,currentCore,tool,args,nowMs=Date.now()}){
 registryIdentity(registry,currentCore,nowMs);if(!object(args))fail('MIGRATION_RELAY_ARGUMENTS');
 let id,kind,forward;
 if(tool==='operation_status'){
  if(Object.keys(args).some(k=>!['operationId','waitMs'].includes(k))||!uuid.test(args.operationId)||!(args.waitMs===undefined||args.waitMs===0))fail('MIGRATION_RELAY_ARGUMENTS');
  id=args.operationId;kind='operation';forward={operationId:id,waitMs:0};
 }else if(tool==='read_terminal'){
  if(Object.keys(args).some(k=>!['id','consume','stdoutOffset','stderrOffset','maxChars','waitMs'].includes(k))
   ||!/^term-[1-9][0-9]{0,12}$/.test(args.id)||args.consume!==false||!Number.isSafeInteger(args.stdoutOffset)||args.stdoutOffset<0
   ||!Number.isSafeInteger(args.stderrOffset)||args.stderrOffset<0||!(args.waitMs===undefined||args.waitMs===0)
   ||!Number.isSafeInteger(args.maxChars)||args.maxChars<1||args.maxChars>4096)fail('MIGRATION_RELAY_ARGUMENTS');
  id=args.id;kind='terminal';forward={id,consume:false,stdoutOffset:args.stdoutOffset,stderrOffset:args.stderrOffset,maxChars:args.maxChars,waitMs:0};
 }else fail('MIGRATION_RELAY_READ_ONLY_ALLOWLIST');
 if(!registry.owners.some(o=>o.kind===kind&&o.id===id&&o.state!=='RELEASED'))fail('MIGRATION_RELAY_OWNER_UNKNOWN');
 return Object.freeze({kind:'PREPARED_ONLY_NO_TRANSPORT',legacyCoreFingerprint:coreFingerprint(currentCore),backendHost:'127.0.0.1',backendPort:currentCore.port,
  credential:'HOST_PRIVATE_BOUND_CREDENTIAL_REQUIRED_NOT_READ_HERE',method:'tools/call',params:{name:tool,arguments:forward},
  startsWork:false,stopsWork:false,replaysWork:false,mutatesTerminalCursor:false,
  limit:tool==='operation_status'?'Legacy status may repair its receipt projection; no execution replay':'Caller-authorized existing output forwarding only; this module does not read output'});
}
export function deriveInactiveStage({originalConfigBytes,expectedConfigSha256,stageRoot,targetPort,adjuncts,route}){
 if(!Buffer.isBuffer(originalConfigBytes)||!fp.test(expectedConfigSha256)||sha(originalConfigBytes)!==expectedConfigSha256)fail('MIGRATION_CONFIG_HASH_CHANGED');
 if(!path.isAbsolute(stageRoot)||/^(?:\\\\|\/\/)/.test(stageRoot)||!Number.isSafeInteger(targetPort)||targetPort<1024||targetPort>65535)fail('MIGRATION_STAGE_LAYOUT');
 let original;try{original=JSON.parse(originalConfigBytes.toString('utf8'));}catch{fail('MIGRATION_CONFIG_JSON_REQUIRED');}
 const config=safeJsonClone(original),prior=safeJsonClone(original);if(targetPort===original.port)fail('MIGRATION_STAGE_PORT_COLLISION');
 if(!Array.isArray(adjuncts)||adjuncts.length!==2||!['companion','safeRecovery'].every(n=>adjuncts.some(a=>a.name===n)))fail('MIGRATION_ADJUNCT_SET');
 for(const a of adjuncts){exact(a,['name','version','root','registrySha256']);if(!fp.test(a.registrySha256)||!path.isAbsolute(a.root)||typeof a.version!=='string')fail('MIGRATION_ADJUNCT_BINDING');}
 exact(route,['generation','sha256','port']);if(!Number.isSafeInteger(route.generation)||route.generation<0||!fp.test(route.sha256)||route.port!==original.port)fail('MIGRATION_ROUTE_BINDING');
 const state=path.join(stageRoot,'state');
 config.host='127.0.0.1';config.port=targetPort;config.runtimeState=path.join(state,'runtime.json');config.auditLog=path.join(state,'audit.jsonl');
 config.allowedRoots=[path.join(stageRoot,'app')];config.allowedPrograms=[];
 config.powerMode={...(config.powerMode??{}),enabled:false,fullFilesystem:false,allowShell:false,allowProcessControl:false,allowPermanentDelete:false,
  backupRoot:path.join(state,'backups'),guiControl:{...(config.powerMode?.guiControl??{}),enabled:false,ownerAuthorizedTakeover:false,workflowTakeoverAllowed:false},
  browserControl:{...(config.powerMode?.browserControl??{}),enabled:false,profileRoot:path.join(state,'browser')}};
 config.asyncOperations={...(config.asyncOperations??{}),enabled:false,stateDir:path.join(state,'async')};
 config.durableWorkflows={...(config.durableWorkflows??{}),enabled:false,directory:path.join(state,'workflows'),rootLeaseDirectory:path.join(state,'root-leases'),
  scheduler:{...(config.durableWorkflows?.scheduler??{}),enabled:false},continuation:{...(config.durableWorkflows?.continuation??{}),enabled:false}};
 config.durableDelivery={...(config.durableDelivery??{}),directory:path.join(state,'delivery'),scope:'migration-inactive-stage'};
 config.agentExtensions={...(config.agentExtensions??{}),enabled:false};config.autoUpdate={...(config.autoUpdate??{}),enabled:false,zeroDowntime:false};
 config.browserCompanionMonitor={...(config.browserCompanionMonitor??{}),enabled:false};config.guiOwnerRecovery={...(config.guiOwnerRecovery??{}),enabled:false};
 const changes=[];for(const key of new Set([...Object.keys(prior),...Object.keys(config)]))if(canonical(prior[key]??null)!==canonical(config[key]??null))changes.push(key);
 return {status:'INACTIVE_STAGE_CONFIG_ONLY',startupAllowed:false,sourceConfigSha256:expectedConfigSha256,targetConfig:config,targetConfigSha256:sha(canonical(config)),
  preservedOriginalConfigBytesSha256:sha(originalConfigBytes),changedTopLevelFields:changes,adjunctReferences:structuredClone(adjuncts),routeReference:{...route,action:'KEEP_OLD_ROUTE'},
  databaseCopy:'NOT_PERFORMED_LIVE_WRITERS_NOT_ADOPTED',legacyCore:'KEEP_RUNNING_NO_STOP',ownerReview:'FRESH_CODE_BOUND_REVIEW_REQUIRED',
  promotionGate:'UNIMPLEMENTED_REAL_HOST_MIGRATION_AND_COMPLETE_OWNERSHIP_INVENTORY',automaticPromotion:false};
}
