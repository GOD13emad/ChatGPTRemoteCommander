import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { migrateCapabilityConfig, normalizeCapabilityProfile } from '../src/capability-profile.mjs';
import { applyProjectRunnerConfig } from '../src/project-runner-config.mjs';
import { deliveryLocation, stableDeliveryScope } from '../src/delivery-store.mjs';

function parse(argv){
  const o={disableCapabilities:[],enableCapabilities:[],allowedRoots:[],allowedPrograms:[],mode:'preserve',requestGui:undefined,deploymentRole:null};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--headless-compute'){o.deploymentRole='headless-compute';continue;}
    const v=argv[++i];if(v===undefined)throw new Error('CANDIDATE_CONFIG_ARGUMENT');
    if(a==='--default')o.defaultPath=v;
    else if(a==='--existing')o.existingPath=v;
    else if(a==='--output')o.outputPath=v;
    else if(a==='--profile-id')o.profileId=v;
    else if(a==='--port')o.port=Number(v);
    else if(a==='--state-dir')o.stateDirectory=v;
    else if(a==='--async-operations-dir')o.asyncOperationsDirectory=v;
    else if(a==='--workflow-dir')o.workflowDirectory=v;
    else if(a==='--mode')o.mode=v;
    else if(a==='--gui')o.requestGui=v==='on'?true:v==='off'?false:undefined;
    else if(a==='--disable-capability')o.disableCapabilities.push(v);
    else if(a==='--enable-capability')o.enableCapabilities.push(v);
    else if(a==='--allowed-root')o.allowedRoots.push(v);
    else if(a==='--runner-planner-calls')o.runnerPlannerCalls=Number(v);
    else if(a==='--allowed-program')o.allowedPrograms.push(v);
    else if(a==='--device-name')o.deviceName=v;
    else if(a==='--backup-root')o.backupRoot=v;
    else if(a==='--provider-root')o.providerRoot=v;
    else if(a==='--transfer-root')o.transferRoot=v;
    else if(a==='--browser-executable')o.browserExecutable=v;
    else if(a==='--browser-profile-root')o.browserProfileRoot=v;
    else if(a==='--delivery-directory')o.deliveryDirectory=v;
    else if(a==='--delivery-scope')o.deliveryScope=v;
    else throw new Error('CANDIDATE_CONFIG_ARGUMENT');
  }
  for(const k of ['defaultPath','outputPath','profileId','port','stateDirectory'])if(!o[k])throw new Error('CANDIDATE_CONFIG_REQUIRED');
  if(!Number.isSafeInteger(o.port)||o.port<1024||o.port>65535)throw new Error('CANDIDATE_CONFIG_PORT');
  return o;
}
function atomic(file,text){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.tmp-'+process.pid+'-'+Date.now().toString(36);
  fs.writeFileSync(tmp,text,{encoding:'utf8',mode:0o600});fs.renameSync(tmp,file);
}
const a=parse(process.argv.slice(2));
const defaults=JSON.parse(fs.readFileSync(a.defaultPath,'utf8'));
const existing=a.existingPath ? JSON.parse(fs.readFileSync(a.existingPath,'utf8')) : null;
const workflowDirectory=a.workflowDirectory ?? existing?.durableWorkflows?.directory ?? path.join(a.stateDirectory,'workflows');
if(!['preserve','full','standard'].includes(a.mode))throw new Error('CANDIDATE_CONFIG_MODE');
const migrated=migrateCapabilityConfig({
  defaultConfig:defaults,existingConfig:existing,profileId:a.profileId,workflowDirectory,
  requestPower:a.mode==='full',requestStandard:a.mode==='standard',requestGui:a.requestGui,
  disableCapabilities:a.disableCapabilities,enableCapabilities:a.enableCapabilities,deploymentRole:a.deploymentRole
});
let config=migrated.config;
if(a.transferRoot!==undefined){
  // Explicit machine-local opt-in. Never grant the user's home or an
  // arbitrary transfer folder; only the already provisioned pilot outbox
  // and received directory are permitted for Core file operations.
  if(config.powerMode?.enabled!==true)throw Error('TRANSFER_OPTIN_POWER_REQUIRED');
  if(!path.isAbsolute(a.transferRoot))throw Error('TRANSFER_OPTIN_ROOT_ABSOLUTE');
  const root=path.resolve(a.transferRoot);
  if(root===path.parse(root).root)throw Error('TRANSFER_OPTIN_ROOT_TOO_BROAD');
  const strict=(file,type)=>{
    const st=fs.lstatSync(file);
    if(st.isSymbolicLink()||(type==='directory'&&!st.isDirectory())||
       (type==='file'&&!st.isFile())||
       (typeof process.getuid==='function'&&st.uid!==process.getuid()))
      throw Error('TRANSFER_OPTIN_PATH_UNTRUSTED');
    const physical=fs.realpathSync.native(file);
    if(physical!==file){
      // Windows may return canonical NTFS path casing even for an ordinary
      // non-reparse directory. Accept case-only changes ONLY when exact
      // (BigInt) file identity matches; Linux remains byte-exact.
      const caseOnly=process.platform==='win32'&&
        path.normalize(physical).toLowerCase()===path.normalize(file).toLowerCase();
      if(!caseOnly)throw Error('TRANSFER_OPTIN_INDIRECT_PATH');
      const requestedStat=fs.statSync(file,{bigint:true});
      const physicalStat=fs.statSync(physical,{bigint:true});
      if(requestedStat.dev!==physicalStat.dev||requestedStat.ino===0n||
         requestedStat.ino!==physicalStat.ino)throw Error('TRANSFER_OPTIN_INDIRECT_PATH');
    }
  };
  strict(root,'directory');
  for(const f of ['outbox','received'])strict(path.join(root,f),'directory');
  for(const f of ['transfer.mjs','durable-send.mjs'])strict(path.join(root,f),'file');
  const existingMesh=config.transferMesh;
  if(existingMesh?.enabled===true&&
    (existingMesh.root!==root||
     JSON.stringify(existingMesh.sourceRoots)!==JSON.stringify([path.join(root,'outbox')])||
     JSON.stringify(existingMesh.destinationRoots)!==JSON.stringify([path.join(root,'received')])))
    throw Error('TRANSFER_OPTIN_EXISTING_POLICY_CONFLICT');
  config.transferMesh={
    ...existingMesh,enabled:true,durableEnabled:true,root,
    sourceRoots:[path.join(root,'outbox')],
    destinationRoots:[path.join(root,'received')]
  };
}

if(a.allowedRoots.length)config.allowedRoots=[...a.allowedRoots];
if(a.allowedPrograms.length)config.allowedPrograms=[...a.allowedPrograms];
if(a.deviceName)config.deviceName=a.deviceName;
config.host='127.0.0.1';
config.port=a.port;
if(a.asyncOperationsDirectory){
  config.asyncOperations ??={};
  config.asyncOperations.stateDir=path.resolve(a.asyncOperationsDirectory);
}
config.runtimeState=path.join(a.stateDirectory,'mcp-runtime.json');
config.auditLog=path.join(a.stateDirectory,'audit.jsonl');
if(a.backupRoot){config.powerMode??={};config.powerMode.backupRoot=a.backupRoot;}
if(a.browserExecutable){config.powerMode??={};config.powerMode.browserControl??={};config.powerMode.browserControl.executable=path.resolve(a.browserExecutable);}
if(a.browserProfileRoot){config.powerMode??={};config.powerMode.browserControl??={};config.powerMode.browserControl.profileRoot=path.resolve(a.browserProfileRoot);}
config.durableWorkflows ??={};
if(config.durableWorkflows.enabled===true){
  config.durableWorkflows.directory=workflowDirectory;
  if(a.providerRoot) config.durableWorkflows.rootLeaseDirectory=path.join(path.resolve(a.providerRoot),'shared','root-leases');
}
const runner=applyProjectRunnerConfig(config);
config=runner.config;
if(a.runnerPlannerCalls!==undefined){
  const r=config.durableWorkflows?.runner;
  if(a.runnerPlannerCalls!==6 || r?.enabled!==true || r?.autoTick!==false
     || r?.maxPlannerCalls!==2 || r?.maxActions!==2 || r?.worker?.enabled!==false
     || JSON.stringify(r?.allowedTools)!=='["read_text"]'
     || r?.team?.workers?.length!==2 || r?.team?.maxParallel!==2)
    throw Error('CANDIDATE_RUNNER_BUDGET_UNAUTHORIZED');
  r.maxPlannerCalls=6;
}

config.capabilityProfile=normalizeCapabilityProfile(config.capabilityProfile,config,{id:a.profileId,legacyExplicit:!!existing});
if(a.profileId!=='default'){
  config.instance={profile:a.profileId,isolated:true};
}else{
  config.instance={profile:'default',isolated:false};
}
if ((a.deliveryDirectory && !a.deliveryScope) || (!a.deliveryDirectory && a.deliveryScope)) {
  throw new Error('CANDIDATE_CONFIG_DELIVERY_PAIR');
}
if (a.deliveryDirectory && a.deliveryScope) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(a.deliveryScope)) throw new Error('CANDIDATE_CONFIG_DELIVERY_SCOPE');
  config.durableDelivery={...(config.durableDelivery??{}),directory:path.resolve(a.deliveryDirectory),scope:a.deliveryScope};
} else if (existing && a.existingPath) {
  const prior=deliveryLocation(existing,a.existingPath);
  config.durableDelivery={...(config.durableDelivery??{}),directory:prior.directory,scope:prior.scope};
} else {
  const scope=stableDeliveryScope(config,a.profileId);
  config.durableDelivery={...(config.durableDelivery??{}),
    directory:path.join(os.homedir(),'.chatgpt-remote-commander','delivery','profiles',scope),
    scope};
}
const text=JSON.stringify(config,null,2)+'\n';
atomic(a.outputPath,text);
const sha256=createHash('sha256').update(text).digest('hex');
console.log(JSON.stringify({
  ok:true,profile:a.profileId,port:a.port,configSha256:sha256,
  capabilityProfile:config.capabilityProfile,powerMode:config.powerMode,durableWorkflows:config.durableWorkflows,
  autoUpdate:config.autoUpdate,projectRunner:{status:runner.status,provider:runner.provider}
}));
