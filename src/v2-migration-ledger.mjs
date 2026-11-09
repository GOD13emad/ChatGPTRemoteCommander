// V2-R8 nonsecret migration preservation gate.
// An attested owner-local inventory *producer*, not an RPC caller, must supply
// both snapshots. No secret bytes, tunnel rotation, file moves or cutover here.
import {createHash} from 'node:crypto';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const REF=/^(?:wincred|keyring|ownerref|managedref):[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const PLATFORMS=new Set(['win32','linux']);
function fail(code){throw Object.assign(new Error(code),{code});}
function record(value,keys,code){
 if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.getPrototypeOf(value)!==Object.prototype||
    Object.keys(value).sort().join(',')!==[...keys].sort().join(','))
  fail(code);
 return value;
}
function id(value,code){
 if(typeof value!=='string'||!ID.test(value))fail(code);
 return value;
}
function ref(value,code){
 if(typeof value!=='string'||!REF.test(value)||value.includes('..'))fail(code);
 return value;
}
function records(items,max,code){
 if(!Array.isArray(items)||items.length>max)fail(code);
 return items;
}
function unique(map,key,code){
 if(map.has(key))fail(code);
}
function deterministic(value){
 if(Array.isArray(value))return '['+value.map(deterministic).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(
   k=>JSON.stringify(k)+':'+deterministic(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
function canonicalInventory(data){
 record(data,['schema','hostId','platform','osPrincipalId','observedAtMs',
  'sourceBuild','profiles'],'V2_MIGRATION_SCHEMA_INVALID');
 if(data.schema!==1||!PLATFORMS.has(data.platform)||
    !Number.isSafeInteger(data.observedAtMs)||data.observedAtMs<0)
   fail('V2_MIGRATION_SCHEMA_INVALID');
 id(data.hostId,'V2_MIGRATION_HOST_INVALID');
 id(data.osPrincipalId,'V2_MIGRATION_OWNER_INVALID');
 id(data.sourceBuild,'V2_MIGRATION_BUILD_INVALID');
 const profiles=records(data.profiles,200,'V2_MIGRATION_PROFILES_INVALID');
 const profileMap=new Map();
 const tunnelIds=new Map();
 const projectIds=new Map();
 const receiptIds=new Map();
 const normalizedProfiles=profiles.map(item=>{
  record(item,['profileId','ownerOsPrincipalId','desktopSeatId','accountRef',
    'workspaceRef','browserProfileRef','tunnels','projects'],'V2_MIGRATION_PROFILE_SCHEMA');
  const profileId=id(item.profileId,'V2_MIGRATION_PROFILE_ID');
  unique(profileMap,profileId,'V2_MIGRATION_DUPLICATE_PROFILE');
  id(item.ownerOsPrincipalId,'V2_MIGRATION_PROFILE_OWNER');
  id(item.desktopSeatId,'V2_MIGRATION_SEAT_INVALID');
  ref(item.accountRef,'V2_MIGRATION_ACCOUNT_REFERENCE');
  ref(item.workspaceRef,'V2_MIGRATION_WORKSPACE_REFERENCE');
  ref(item.browserProfileRef,'V2_MIGRATION_BROWSER_REFERENCE');
  const tunnels=records(item.tunnels,300,'V2_MIGRATION_TUNNELS_INVALID').map(t=>{
   record(t,['enrollmentId','credentialRef','endpointRef',
     'supervisorRef','autostart'],'V2_MIGRATION_TUNNEL_SCHEMA');
   const enrollmentId=id(t.enrollmentId,'V2_MIGRATION_TUNNEL_ID');
   unique(tunnelIds,enrollmentId,'V2_MIGRATION_DUPLICATE_TUNNEL');
   if(typeof t.autostart!=='boolean')fail('V2_MIGRATION_AUTOSTART_INVALID');
   const out={enrollmentId,credentialRef:ref(t.credentialRef,'V2_MIGRATION_CREDENTIAL_REFERENCE'),
    endpointRef:ref(t.endpointRef,'V2_MIGRATION_ENDPOINT_REFERENCE'),
    supervisorRef:ref(t.supervisorRef,'V2_MIGRATION_SUPERVISOR_REFERENCE'),
    autostart:t.autostart};
   tunnelIds.set(enrollmentId,profileId);
   return Object.freeze(out);
  }).sort((a,b)=>a.enrollmentId.localeCompare(b.enrollmentId,'en'));
  const projects=records(item.projects,500,'V2_MIGRATION_PROJECTS_INVALID').map(project=>{
   record(project,['projectId','rootRef','brainRef','workflowSchema','receipts'],
     'V2_MIGRATION_PROJECT_SCHEMA');
   const projectId=id(project.projectId,'V2_MIGRATION_PROJECT_ID');
   unique(projectIds,projectId,'V2_MIGRATION_DUPLICATE_PROJECT');
   if(!Number.isSafeInteger(project.workflowSchema)||project.workflowSchema<1)
     fail('V2_MIGRATION_WORKFLOW_SCHEMA_INVALID');
   const receipts=records(project.receipts,10000,'V2_MIGRATION_RECEIPTS_INVALID').map(receipt=>{
    record(receipt,['receiptId','sha256'],'V2_MIGRATION_RECEIPT_SCHEMA');
    const receiptId=id(receipt.receiptId,'V2_MIGRATION_RECEIPT_ID');
    unique(receiptIds,receiptId,'V2_MIGRATION_DUPLICATE_RECEIPT');
    if(typeof receipt.sha256!=='string'||!HASH.test(receipt.sha256))
     fail('V2_MIGRATION_RECEIPT_DIGEST_INVALID');
    receiptIds.set(receiptId,projectId);
    return Object.freeze({receiptId,sha256:receipt.sha256});
   }).sort((a,b)=>a.receiptId.localeCompare(b.receiptId,'en'));
   projectIds.set(projectId,profileId);
   return Object.freeze({projectId,rootRef:ref(project.rootRef,'V2_MIGRATION_ROOT_REFERENCE'),
    brainRef:ref(project.brainRef,'V2_MIGRATION_BRAIN_REFERENCE'),
    workflowSchema:project.workflowSchema,receipts:Object.freeze(receipts)});
  }).sort((a,b)=>a.projectId.localeCompare(b.projectId,'en'));
  const out={profileId,ownerOsPrincipalId:item.ownerOsPrincipalId,
   desktopSeatId:item.desktopSeatId,accountRef:item.accountRef,
   workspaceRef:item.workspaceRef,browserProfileRef:item.browserProfileRef,
   tunnels:Object.freeze(tunnels),projects:Object.freeze(projects)};
  profileMap.set(profileId,out);
  return Object.freeze(out);
 }).sort((a,b)=>a.profileId.localeCompare(b.profileId,'en'));
 return Object.freeze({
  schema:1,hostId:data.hostId,platform:data.platform,osPrincipalId:data.osPrincipalId,
  observedAtMs:data.observedAtMs,sourceBuild:data.sourceBuild,
  profiles:Object.freeze(normalizedProfiles)
 });
}
export function captureV2MigrationManifest(data){
 const value=canonicalInventory(data);
 const digest=createHash('sha256').update(deterministic(value)).digest('hex');
 return Object.freeze({value,digest,counts:Object.freeze({
  profiles:value.profiles.length,
  tunnels:value.profiles.reduce((a,p)=>a+p.tunnels.length,0),
  projects:value.profiles.reduce((a,p)=>a+p.projects.length,0),
  receipts:value.profiles.reduce((a,p)=>a+p.projects.reduce((b,x)=>b+x.receipts.length,0),0)
 })});
}
function equal(x,y){return deterministic(x)===deterministic(y);}
export function verifyV2MigrationPreservation({baseline,proposed,baselineDigest}={}){
 const before=captureV2MigrationManifest(baseline),after=captureV2MigrationManifest(proposed);
 if(typeof baselineDigest!=='string'||!HASH.test(baselineDigest)||
    baselineDigest!==before.digest)fail('V2_MIGRATION_BASELINE_MISMATCH');
 if(before.value.hostId!==after.value.hostId||
    before.value.platform!==after.value.platform||
    before.value.osPrincipalId!==after.value.osPrincipalId)
    fail('V2_MIGRATION_HOST_REBOUND');
 if(after.value.observedAtMs<before.value.observedAtMs)
   fail('V2_MIGRATION_STALE_CANDIDATE');
 const changes=[];
 const index=arr=>new Map(arr.map(x=>[x.profileId??x.enrollmentId??x.projectId??x.receiptId,x]));
 const compare=(source,target,kind,parent,check)=>{
  const dest=index(target);
  for(const entry of source){
   const key=entry.profileId??entry.enrollmentId??entry.projectId??entry.receiptId;
   const candidate=dest.get(key);
   if(!candidate){changes.push({kind,parent,id:key,status:'MISSING'});continue;}
   check(entry,candidate,key);
  }
 };
 compare(before.value.profiles,after.value.profiles,'profile',before.value.hostId,(p,q,key)=>{
  for(const field of ['ownerOsPrincipalId','desktopSeatId','accountRef',
    'workspaceRef','browserProfileRef']){
   if(p[field]!==q[field])changes.push({kind:'profile',parent:before.value.hostId,
     id:key,field,status:'CHANGED'});
  }
  compare(p.tunnels,q.tunnels,'tunnel',key,(a,b,enrollmentId)=>{
   if(!equal(a,b))changes.push({kind:'tunnel',parent:key,id:enrollmentId,status:'CHANGED'});
  });
  compare(p.projects,q.projects,'project',key,(a,b,projectId)=>{
   for(const field of ['rootRef','brainRef','workflowSchema']){
    if(a[field]!==b[field])changes.push({kind:'project',parent:key,id:projectId,
      field,status:'CHANGED'});
   }
   compare(a.receipts,b.receipts,'receipt',projectId,(a,b,receiptId)=>{
    if(a.sha256!==b.sha256)changes.push({kind:'receipt',parent:projectId,
      id:receiptId,status:'DIGEST_CHANGED'});
   });
  });
 });
 return Object.freeze({
  schema:1,hostId:before.value.hostId,
  baselineDigest:before.digest,proposedDigest:after.digest,
  baselineCounts:before.counts,proposedCounts:after.counts,
  preservationReady:changes.length===0,
  // This is only metadata preservation; no physical cutover or token usability.
  cutoverAccepted:false,credentialUsability:'NOT_TESTED',
  differences:Object.freeze(changes.map(x=>Object.freeze(x)))
 });
}
