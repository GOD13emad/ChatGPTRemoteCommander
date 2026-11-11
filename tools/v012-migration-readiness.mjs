// M3 host-local recovery baseline. READ-ONLY for all live Commander instances.
// Writes a single narrow receipt under the existing private migration-stage.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const host=process.argv[2];
if(process.argv.length!==3||!host)throw Error('EXACT_HOST_REQUIRED');
const m=JSON.parse(fs.readFileSync(path.join(cwd,'docs/release-train-0.12.json'),'utf8')).migration;
if(!m?.ownerConfirmed||m.id!=='V012-FLEET-ACCOUNT-MAPPING-20261110')throw Error('OWNER_MAP_NOT_VERIFIED');
const entry=m.hosts.find(h=>h.host===host);
if(!entry)throw Error('UNKNOWN_HOST');
const stage=process.platform==='win32'
  ?path.join(process.env.LOCALAPPDATA??'', 'ChatGPTRemoteCommander','migration-stage')
  :path.join(os.homedir(),'.local','state','chatgpt-remote-commander','migration-stage');
const receiptFile=path.join(stage,'target-profiles','migration-canonical-receipt.json');
const canonical=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
if(canonical.host!==host||canonical.mapId!==m.id||canonical.profileCutover!==false||
   canonical.oldServiceStopped!==false||canonical.credentialsExported!==false)throw Error('CANONICAL_PRECONDITION_NOT_MET');
if(canonical.profiles.length!==entry.profiles.length)throw Error('PROFILE_COUNT_MISMATCH');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const checkFile=(p,expected)=>{
 const stat=fs.lstatSync(p);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2_000_000)throw Error('UNSAFE_CONFIG_FILE');
 if(sha(p)!==expected)throw Error('CONFIG_DRIFT');
};
const results=[];
for(const original of entry.profiles){
 const r=canonical.profiles.find(x=>x.legacy===original.legacyProfile&&x.account===original.account);
 if(!r||r.ingressPort!==original.sourcePort||r.stagedOnly!==true)throw Error('PROFILE_REMAP_DRIFT:'+original.account);
 checkFile(r.sourceConfigPath,r.sourceSha256);
 checkFile(r.targetConfigPath,r.targetSha256);
 const root=fs.realpathSync(stage)+path.sep;
 if(!fs.realpathSync(r.targetConfigPath).startsWith(root))throw Error('TARGET_OUTSIDE_STAGING');
 const target=JSON.parse(fs.readFileSync(r.targetConfigPath,'utf8'));
 if(target.instance?.profile!==original.account||
    target.capabilityProfile?.id!==original.account||
    target.capabilityProfile?.tier!==r.configuredTierPreserved||
    target.port!==r.backendPort)throw Error('TARGET_CONFIG_MISMATCH:'+original.account);
 let health;
 try{
  const response=await fetch('http://127.0.0.1:'+r.ingressPort+'/health',{signal:AbortSignal.timeout(2800)});
  if(!response.ok)throw Error('SOURCE_HEALTH_HTTP_'+response.status);
  health=await response.json();
 }catch(error){throw Error('SOURCE_HEALTH_NOT_PROVEN:'+original.account+':'+String(error.message??error))}
 if(health.ok!==true||health.instance?.profile!==original.legacyProfile)throw Error('LIVE_SOURCE_IDENTITY_MISMATCH:'+original.account);
 // Matching a staged file is not proof that the live process loaded it.
 // Bind the live loopback health-reported digest to the exact recovered file.
 if(typeof health.configSha256!=='string'
   || !/^[a-f0-9]{64}$/.test(health.configSha256)
   || health.configSha256!==r.sourceSha256)throw Error('LIVE_SOURCE_CONFIG_HASH_MISMATCH:'+original.account);
 results.push({
  legacyAlias:original.legacyProfile,account:original.account,sourcePort:r.ingressPort,
  sourceRuntimeVersion:String(health.version),liveProfileLabel:String(health.instance.profile),
  sourceConfigPath:r.sourceConfigPath,sourceConfigSha256:r.sourceSha256,
  targetConfigPath:r.targetConfigPath,targetConfigSha256:r.targetSha256,
  sourceHealth:'PASS',sourcePortStillLive:true,targetStagedOnly:true,
  nativeAdminEnrollment:'NOT_VERIFIED',chatgptAccountIdentity:'NOT_VERIFIED',
  rollbackSourceConfigVerified:true,serviceUnitBindingVerified:false,rollbackExecutionTested:false
 });
}
const state={
 schema:1,gate:'M3_SOURCE_RESTORE_BASELINE_DISCOVERED',
 host,sourceCommit:'a215dc857017c21f14bf5afcb74917f71e8e9e5d',
 mapId:m.id,profileCutover:false,oldServiceStopped:false,
 liveAccountAuthenticationVerified:false,liveServiceSwitchReady:false,
 recoveryPlanVerified:false,originalSourcesUnchanged:true,
 profiles:results
};
const target=path.join(stage,'migration-recovery-baseline.json');
const content=JSON.stringify(state,null,2)+'\n';
if(fs.existsSync(target)){
 const previous=fs.readFileSync(target,'utf8');
 if(previous!==content)throw Error('EXISTING_RECOVERY_BASELINE_DRIFT_RECONCILE_BEFORE_OVERWRITE');
}else{
 fs.writeFileSync(target,content,{flag:'wx',mode:0o600});
 if(process.platform!=='win32')fs.chmodSync(target,0o600);
}
console.log(JSON.stringify({
 host,gate:state.gate,profiles:results.map(p=>({alias:p.legacyAlias,account:p.account,
 oldVersion:p.sourceRuntimeVersion,port:p.sourcePort,sourceHashMatches:true,
 targetHashMatches:true,sourceStillLive:true})),
 accountProof:state.liveAccountAuthenticationVerified,rollbackTested:state.recoveryPlanVerified,
 servicesStopped:false
}));
