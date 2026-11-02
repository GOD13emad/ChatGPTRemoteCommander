// V2-R8 V1-native, nonsecret migration preservation gate.
// An attested owner-local inventory producer, not an RPC caller, supplies both snapshots.
// Existing V1 tunnels, protected credential references and state stores are retained in place.
import {createHash} from 'node:crypto';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const REF=/^(?:wincred|keyring|ownerref|managedref):[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const PLATFORMS=new Set(['win32','linux']);
const ASSET_KINDS=Object.freeze([
 'commander-config','capability-profile','tool-and-plugin-registry',
 'integration-registry','workflow-store','operation-journal',
 'delivery-and-outbox','browser-state','desktop-gui-state',
 'service-and-scheduler-state','native-credential-index','app-registration-state'
]);
const ASSET_KIND_SET=new Set(ASSET_KINDS);
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
function optionalRef(value,code){return value===null?null:ref(value,code);}
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
  'sourceBuild','installRef','canonicalRouteRef','profiles'],'V2_MIGRATION_SCHEMA_INVALID');
 if(data.schema!==2||!PLATFORMS.has(data.platform)||
    !Number.isSafeInteger(data.observedAtMs)||data.observedAtMs<0)
   fail('V2_MIGRATION_SCHEMA_INVALID');
 id(data.hostId,'V2_MIGRATION_HOST_INVALID');
 id(data.osPrincipalId,'V2_MIGRATION_OWNER_INVALID');
 id(data.sourceBuild,'V2_MIGRATION_BUILD_INVALID');
 ref(data.installRef,'V2_MIGRATION_INSTALL_REFERENCE');
 ref(data.canonicalRouteRef,'V2_MIGRATION_ROUTE_REFERENCE');
 const profiles=records(data.profiles,200,'V2_MIGRATION_PROFILES_INVALID');
 const profileMap=new Map(),tunnelIds=new Map(),projectIds=new Map(),receiptIds=new Map();
 const normalizedProfiles=profiles.map(item=>{
  record(item,['profileId','ownerOsPrincipalId','desktopSeatId','accountRef',
    'workspaceRef','browserProfileRef','tunnels','projects','bindings','preservedAssets'],
    'V2_MIGRATION_PROFILE_SCHEMA');
  const profileId=id(item.profileId,'V2_MIGRATION_PROFILE_ID');
  unique(profileMap,profileId,'V2_MIGRATION_DUPLICATE_PROFILE');
  id(item.ownerOsPrincipalId,'V2_MIGRATION_PROFILE_OWNER');
  id(item.desktopSeatId,'V2_MIGRATION_SEAT_INVALID');
  ref(item.accountRef,'V2_MIGRATION_ACCOUNT_REFERENCE');
  ref(item.workspaceRef,'V2_MIGRATION_WORKSPACE_REFERENCE');
  ref(item.browserProfileRef,'V2_MIGRATION_BROWSER_REFERENCE');
  const tunnels=records(item.tunnels,300,'V2_MIGRATION_TUNNELS_INVALID').map(t=>{
   record(t,['enrollmentId','credentialRef','endpointRef','supervisorRef','autostart'],
     'V2_MIGRATION_TUNNEL_SCHEMA');
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
  const bindings=records(item.bindings,1000,'V2_MIGRATION_BINDINGS_INVALID').map(binding=>{
   record(binding,['bindingId','ownerOsPrincipalId','accountRef','workspaceRef',
    'tunnelEnrollmentId','chatRef','grantRef','active'],'V2_MIGRATION_BINDING_SCHEMA');
   const bindingId=id(binding.bindingId,'V2_MIGRATION_BINDING_ID');
   id(binding.ownerOsPrincipalId,'V2_MIGRATION_BINDING_OWNER');
   if(binding.ownerOsPrincipalId!==item.ownerOsPrincipalId)
    fail('V2_MIGRATION_BINDING_OWNER_MISMATCH');
   const tunnelEnrollmentId=id(binding.tunnelEnrollmentId,'V2_MIGRATION_BINDING_TUNNEL');
   if(tunnelIds.get(tunnelEnrollmentId)!==profileId)
    fail('V2_MIGRATION_BINDING_TUNNEL_MISMATCH');
   if(typeof binding.active!=='boolean')fail('V2_MIGRATION_BINDING_ACTIVE_INVALID');
   return Object.freeze({bindingId,ownerOsPrincipalId:binding.ownerOsPrincipalId,
    accountRef:ref(binding.accountRef,'V2_MIGRATION_BINDING_ACCOUNT'),
    workspaceRef:ref(binding.workspaceRef,'V2_MIGRATION_BINDING_WORKSPACE'),
    tunnelEnrollmentId,chatRef:optionalRef(binding.chatRef,'V2_MIGRATION_BINDING_CHAT'),
    grantRef:optionalRef(binding.grantRef,'V2_MIGRATION_BINDING_GRANT'),active:binding.active});
  }).sort((a,b)=>a.bindingId.localeCompare(b.bindingId,'en'));
  const bindingIds=new Set();
  for(const binding of bindings){
   if(bindingIds.has(binding.bindingId))fail('V2_MIGRATION_DUPLICATE_BINDING');
   bindingIds.add(binding.bindingId);
  }
  const assets=records(item.preservedAssets,100,'V2_MIGRATION_ASSETS_INVALID').map(asset=>{
   record(asset,['assetId','kind','present','referenceRef','sha256','schemaVersion'],
    'V2_MIGRATION_ASSET_SCHEMA');
   const assetId=id(asset.assetId,'V2_MIGRATION_ASSET_ID');
   if(typeof asset.kind!=='string'||!ASSET_KIND_SET.has(asset.kind))
    fail('V2_MIGRATION_ASSET_KIND_INVALID');
   if(typeof asset.present!=='boolean')fail('V2_MIGRATION_ASSET_PRESENCE_INVALID');
   if(asset.present){
    if(typeof asset.sha256!=='string'||!HASH.test(asset.sha256)||
      !Number.isSafeInteger(asset.schemaVersion)||asset.schemaVersion<1)
     fail('V2_MIGRATION_ASSET_DIGEST_INVALID');
    ref(asset.referenceRef,'V2_MIGRATION_ASSET_REFERENCE');
   }else if(asset.referenceRef!==null||asset.sha256!==null||asset.schemaVersion!==null){
    fail('V2_MIGRATION_ABSENT_ASSET_HAS_DATA');
   }
   return Object.freeze({assetId,kind:asset.kind,present:asset.present,
    referenceRef:asset.referenceRef,sha256:asset.sha256,schemaVersion:asset.schemaVersion});
  }).sort((a,b)=>a.kind.localeCompare(b.kind,'en'));
  const kinds=new Set(),assetIds=new Set();
  for(const asset of assets){
   if(assetIds.has(asset.assetId))fail('V2_MIGRATION_DUPLICATE_ASSET_ID');
   assetIds.add(asset.assetId);kinds.add(asset.kind);
  }
  if(ASSET_KINDS.some(kind=>!kinds.has(kind)))
   fail('V2_MIGRATION_ASSET_INVENTORY_INCOMPLETE');
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
   tunnels:Object.freeze(tunnels),projects:Object.freeze(projects),
   bindings:Object.freeze(bindings),preservedAssets:Object.freeze(assets)};
  profileMap.set(profileId,out);
  return Object.freeze(out);
 }).sort((a,b)=>a.profileId.localeCompare(b.profileId,'en'));
 return Object.freeze({schema:2,hostId:data.hostId,platform:data.platform,
  osPrincipalId:data.osPrincipalId,observedAtMs:data.observedAtMs,sourceBuild:data.sourceBuild,
  installRef:data.installRef,canonicalRouteRef:data.canonicalRouteRef,
  profiles:Object.freeze(normalizedProfiles)});
}
export function captureV2MigrationManifest(data){
 const value=canonicalInventory(data);
 const digest=createHash('sha256').update(deterministic(value)).digest('hex');
 return Object.freeze({value,digest,counts:Object.freeze({
  profiles:value.profiles.length,
  tunnels:value.profiles.reduce((a,p)=>a+p.tunnels.length,0),
  bindings:value.profiles.reduce((a,p)=>a+p.bindings.length,0),
  assets:value.profiles.reduce((a,p)=>a+p.preservedAssets.length,0),
  presentAssets:value.profiles.reduce((a,p)=>a+p.preservedAssets.filter(x=>x.present).length,0),
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
    before.value.osPrincipalId!==after.value.osPrincipalId||
    before.value.installRef!==after.value.installRef||
    before.value.canonicalRouteRef!==after.value.canonicalRouteRef)
  fail('V2_MIGRATION_HOST_REBOUND');
 if(after.value.observedAtMs<before.value.observedAtMs)
  fail('V2_MIGRATION_STALE_CANDIDATE');
 const changes=[];
 const index=(arr,key)=>new Map(arr.map(x=>[x[key],x]));
 const compare=(source,target,keyField,kind,parent,check)=>{
  const dest=index(target,keyField);
  for(const entry of source){
   const key=entry[keyField],candidate=dest.get(key);
   if(!candidate){changes.push({kind,parent,id:key,status:'MISSING'});continue;}
   check(entry,candidate,key);
  }
 };
 compare(before.value.profiles,after.value.profiles,'profileId','profile',before.value.hostId,(p,q,key)=>{
  for(const field of ['ownerOsPrincipalId','desktopSeatId','accountRef','workspaceRef','browserProfileRef']){
   if(p[field]!==q[field])changes.push({kind:'profile',parent:before.value.hostId,id:key,field,status:'CHANGED'});
  }
  compare(p.tunnels,q.tunnels,'enrollmentId','tunnel',key,(a,b,id)=>{
   if(!equal(a,b))changes.push({kind:'tunnel',parent:key,id,status:'CHANGED'});
  });
  compare(p.bindings,q.bindings,'bindingId','binding',key,(a,b,id)=>{
   if(!equal(a,b))changes.push({kind:'binding',parent:key,id,status:'CHANGED'});
  });
  compare(p.preservedAssets,q.preservedAssets,'assetId','asset',key,(a,b,assetId)=>{
   if(a.present&&!equal(a,b))changes.push({kind:'asset',parent:key,id:a.kind,assetId,status:'CHANGED'});
  });
  compare(p.projects,q.projects,'projectId','project',key,(a,b,id)=>{
   for(const field of ['rootRef','brainRef','workflowSchema']){
    if(a[field]!==b[field])changes.push({kind:'project',parent:key,id,field,status:'CHANGED'});
   }
   compare(a.receipts,b.receipts,'receiptId','receipt',id,(a,b,receiptId)=>{
    if(a.sha256!==b.sha256)changes.push({kind:'receipt',parent:id,id:receiptId,status:'DIGEST_CHANGED'});
   });
  });
 });
 return Object.freeze({schema:2,hostId:before.value.hostId,baselineDigest:before.digest,
  proposedDigest:after.digest,baselineCounts:before.counts,proposedCounts:after.counts,
  preservationReady:changes.length===0,cutoverAccepted:false,
  credentialUsability:'NOT_TESTED',
  differences:Object.freeze(changes.map(x=>Object.freeze(x)))});
}
