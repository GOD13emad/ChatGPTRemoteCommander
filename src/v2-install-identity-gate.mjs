// R1: compare actual running component receipts, never infer a single
// installation from package.json or process counts alone. No mutation.
import {createHash} from 'node:crypto';
const HASH=/^[a-f0-9]{64}$/;
const ID=/^[a-z][a-z0-9-]{1,63}$/;
const ROLE=new Set(['core','runtime','owner-gui','browser','control-center','workflow','updater','tunnel']);
const PLATFORMS=new Set(['windows','linux']);
function fail(code){throw Object.assign(new Error(code),{code});}
function plain(x){return x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;}
export function evaluateV2InstallIdentity({hostId,platform,components,expectedSource}={}){
 if(typeof hostId!=='string'||!ID.test(hostId)||!PLATFORMS.has(platform)||
   !Array.isArray(components)||components.length<1||components.length>100||
   !plain(expectedSource)||typeof expectedSource.commit!=='string'||
   !HASH.test(expectedSource.commit)||typeof expectedSource.version!=='string')
   fail('V2_INSTALL_INVENTORY_INVALID');
 const ids=new Set(),roots=new Map(),findings=[],roles=new Map();
 const normalized=[];
 for(const c of components){
  if(!plain(c)||Object.keys(c).some(k=>!['id','role','version','sha256','sourceCommit',
    'installationId','supervisorId','active','ownerAttested','scope'].includes(k))||
    typeof c.id!=='string'||!ID.test(c.id)||
    !ROLE.has(c.role)||typeof c.version!=='string'||c.version.length>90||
    typeof c.sha256!=='string'||!HASH.test(c.sha256)||
    (c.sourceCommit!==null&&(typeof c.sourceCommit!=='string'||!HASH.test(c.sourceCommit)))||
    typeof c.installationId!=='string'||!ID.test(c.installationId)||
    typeof c.supervisorId!=='string'||!ID.test(c.supervisorId)||
    typeof c.active!=='boolean'||typeof c.ownerAttested!=='boolean'||
    !['current-owner','other-user','system'].includes(c.scope))
    fail('V2_INSTALL_COMPONENT_INVALID');
  if(ids.has(c.id))fail('V2_INSTALL_COMPONENT_DUPLICATE');
  ids.add(c.id);
  const key=c.role+':'+c.scope;
  if(c.active) {
   const list=roles.get(key)||[];list.push(c.id);roles.set(key,list);
   const root=roots.get(c.scope)||new Set();root.add(c.installationId);roots.set(c.scope,root);
  }
  if(!c.ownerAttested)findings.push({id:c.id,code:'UNATTESTED_OWNER'});
  if(c.active&&c.role==='core'&&c.sourceCommit!==expectedSource.commit)
    findings.push({id:c.id,code:'CORE_SOURCE_NOT_CANDIDATE'});
  normalized.push(Object.freeze({...c}));
 }
 for(const [key,arr] of roles)if(key.startsWith('core:')&&arr.length>1)
  findings.push({id:key,code:'MULTIPLE_ACTIVE_CORE_PROCESSES_UNRESOLVED'});
 for(const [scope,rootsForScope] of roots)if(rootsForScope.size>1)
  findings.push({id:scope,code:'MULTIPLE_ACTIVE_INSTALLATION_IDENTITIES'});
 if(!normalized.some(c=>c.role==='core'&&c.active&&c.ownerAttested))
  findings.push({id:hostId,code:'NO_ATTESTED_ACTIVE_CORE'});
 // The active app payload can be intentionally older than the runtime.
 // Report candidate mismatch, never auto-delete or overwrite any layer.
 const candidateMatched=normalized.some(c=>c.active&&c.role==='core'&&
   c.sourceCommit===expectedSource.commit&&c.ownerAttested);
 return Object.freeze({schema:1,hostId,platform,
  candidateMatched,readyForCandidateCutover:candidateMatched&&findings.length===0,
  changesApplied:false,cleanupAuthorized:false,findings:Object.freeze(findings),
  componentCount:normalized.length,
  inventoryDigest:createHash('sha256').update(JSON.stringify(
    normalized.map(x=>[x.id,x.role,x.sha256,x.sourceCommit,x.installationId,x.active]).sort(
     (a,b)=>a[0].localeCompare(b[0],'en')))).digest('hex')
 });
}
