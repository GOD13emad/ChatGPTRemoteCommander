import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectLinuxGuiSandbox,planLinuxGuiSandboxPolicy,revalidateLinuxGuiPolicyPlan} from '../tools/universal-install/native-linux-gui-sandbox.mjs';
import {createNativeOsAdapter} from '../tools/universal-install/native-os-adapters.mjs';
const ROOT='/opt/Remote Commander';
const p=ROOT+'/resources/apparmor-profile',gui=ROOT+'/remote-commander-unified';
const flags={
  enabled:'/sys/module/apparmor/parameters/enabled',
  restricted:'/proc/sys/kernel/apparmor_restrict_unprivileged_userns',
  clone:'/proc/sys/kernel/unprivileged_userns_clone'
};
const profile='abi <abi/4.0>,\nprofile "remote-commander-unified" "/opt/Remote Commander/remote-commander-unified" flags=(unconfined) {\n  userns,\n}\n';
const sha=createHash('sha256').update(profile).digest('hex');
const fileInfo=(bytes,{uid=0,mode=0o100644,nlink=1,size=bytes?.length??150,dev=1,ino=9}={})=>({
 uid,mode,nlink,size,dev,ino,mtimeMs:1,ctimeMs:1,isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false
});
const dirInfo=({uid=0,mode=0o40755,link=false}={})=>({
  uid,mode,nlink:2,size:4096,dev:1,ino:5,mtimeMs:1,ctimeMs:1,
  isFile:()=>false,isDirectory:()=>!link,isSymbolicLink:()=>link
});
function fixture({overrides={},data={},stats={}}={}){
  const bytes=new Map([
    [flags.enabled,Buffer.from('Y\n')],[flags.restricted,Buffer.from('1\n')],
    [flags.clone,Buffer.from('1\n')],[p,Buffer.from(profile)],...Object.entries(data).map(([k,v])=>[k,Buffer.from(v)])
  ]);
  const dirs=['/opt',ROOT,ROOT+'/resources','/etc','/etc/apparmor.d'];
  const files=new Map([
    ...dirs.map(d=>[d,dirInfo()]),
    [p,fileInfo(bytes.get(p))],[gui,fileInfo(Buffer.alloc(200),{ino:3})],
    ...Object.entries(stats)
  ]);
  for(const [k,v] of Object.entries(overrides)) bytes.set(k,Buffer.from(v));
  return {
    platform:'linux',expectedProfileSha256:sha,
    // A complete synthetic kernel listing with no Commander name.
    // Production never assumes this when securityfs is inaccessible.
    readKernelProfiles:()=>Buffer.from('fixture-other (enforce)\n'),
    read:f=>{if(!bytes.has(f))throw Object.assign(new Error('absent'),{code:'ENOENT'});return bytes.get(f);},
    stat:f=>{if(!files.has(f))throw Object.assign(new Error('absent'),{code:'ENOENT'});return files.get(f);}
  };
}
const check=(o)=>inspectLinuxGuiSandbox(fixture(o));
test('positive restricted host yields owner-policy requirement, NOT GUI acceptance',()=>{
 const r=check();assert.equal(r.status,'OWNER_POLICY_REQUIRED');
 assert.equal(r.profileMatchesPinnedRelease,true);
 assert.equal(r.osPolicyModified,false);assert.equal(r.guiStarted,false);
 assert.equal(r.stablePromotionAccepted,false);
});
test('AppArmor restriction disabled needs no profile effect',()=>{
 const r=check({overrides:{[flags.restricted]:'0'}});
 assert.equal(r.status,'APPARMOR_POLICY_NOT_REQUIRED');
 assert.equal(r.nativeOwnerApprovalRequired,false);
});
test('kernel user namespace disabled must not be bypassed',()=>{
 assert.equal(check({overrides:{[flags.clone]:'0'}}).status,'KERNEL_USERNS_DISABLED');
});
test('ambiguous kernel policy fails closed',()=>{
 assert.equal(check({overrides:{[flags.restricted]:'junk'}}).status,'UNKNOWN_KERNEL_SECURITY_STATE');
});
test('profile bytes different from signed pin rejected',()=>{
 assert.equal(check({data:{[p]:profile+'# changed'}}).status,'INSTALLED_PROFILE_SHA_MISMATCH');
});
test('foreign preexisting policy never overwritten implicitly',()=>{
 const path='/etc/apparmor.d/remote-commander-unified';
 const foreign='profile "foreign" "/opt/Remote Commander/remote-commander-unified" flags=(unconfined) {\\n  userns,\\n}\\n';
 const q=check({data:{[path]:foreign},stats:{[path]:fileInfo(Buffer.from(foreign),{ino:90})}});
 assert.equal(q.status,'OWNER_POLICY_EXISTING_REQUIRES_RECONCILIATION');
 assert.equal(q.osPolicyModified,false);
});
test('non-root and world-writable source rejected',()=>{
 const f=fixture();const badStat=fileInfo(Buffer.from(profile),{uid:1000});
 f.stat=x=>x===p?badStat:fixture().stat(x);
 assert.equal(inspectLinuxGuiSandbox(f).status,'INSTALLED_PROFILE_NOT_TRUSTED');
});
test('non-Linux platform rejected',()=>{
 assert.throws(()=>inspectLinuxGuiSandbox({...fixture(),platform:'win32'}),{code:'RC_GUI_POLICY_PREFLIGHT_ARGUMENT_INVALID'});
});
test('wrong owner-installed GUI binary rejected',()=>{
 const f=fixture();const original=f.stat;f.stat=x=>x===gui?fileInfo(Buffer.alloc(100),{uid:1001}):original(x);
 assert.equal(inspectLinuxGuiSandbox(f).status,'INSTALLED_GUI_NOT_TRUSTED');
});
test('untrusted installed profile content rejected even with matching digest',()=>{
 const modified='profile "bogus" "/opt/Remote Commander/remote-commander-unified" flags=(unconfined) {\n userns,\n}\n';
 const f=fixture({data:{[p]:modified}});
 f.stat=x=>x===p?fileInfo(Buffer.from(modified)):fixture().stat(x);
 f.expectedProfileSha256=createHash('sha256').update(modified).digest('hex');
 assert.equal(inspectLinuxGuiSandbox(f).status,'INSTALLED_PROFILE_CONTENT_MISMATCH');
});

test('shared native OS adapter exposes read-only Linux preflight, not on Windows',()=>{
 const linux=createNativeOsAdapter({platform:'linux',architecture:'x64',run:()=>{throw Error('unexpected OS effect');}});
 assert.equal(typeof linux.inspectGuiSandbox,'function');
 const q=linux.inspectGuiSandbox(fixture());
 assert.equal(q.status,'OWNER_POLICY_REQUIRED');
 assert.equal(q.osPolicyModified,false);
 const win=createNativeOsAdapter({platform:'windows',architecture:'x64',run:()=>{throw Error('unexpected OS effect');}});
 assert.equal(Object.hasOwn(win,'inspectGuiSandbox'),false);
});

test('symlinked GUI parent fails closed before trusting regular leaf',()=>{
 const q=check({stats:{[ROOT]:dirInfo({link:true})}});
 assert.equal(q.status,'OWNER_POLICY_PATH_UNTRUSTED');
});
test('group-writable package ancestor refuses admission even when hash matches',()=>{
 const q=check({stats:{[ROOT+'/resources']:dirInfo({mode:0o40775})}});
 assert.equal(q.status,'OWNER_POLICY_PATH_UNTRUSTED');
});
test('symlinked system AppArmor directory refuses policy admission',()=>{
 const q=check({stats:{'/etc/apparmor.d':dirInfo({link:true})}});
 assert.equal(q.status,'OWNER_POLICY_PATH_UNTRUSTED');
});
test('missing system policy parent fails closed',()=>{
 const f=fixture(),old=f.stat;
 f.stat=q=>q==='/etc/apparmor.d'?(()=>{throw Object.assign(new Error('not found'),{code:'ENOENT'});})():old(q);
 assert.equal(inspectLinuxGuiSandbox(f).status,'OWNER_POLICY_PATH_UNTRUSTED');
});
test('non-root ancestor refuses admission',()=>{
 const q=check({stats:{[ROOT]:dirInfo({uid:1000})}});
 assert.equal(q.status,'OWNER_POLICY_PATH_UNTRUSTED');
});

test('matching existing OS policy is detected but never treated as loaded kernel policy',()=>{
 const active='/etc/apparmor.d/remote-commander-unified';
 const f=fixture({data:{[active]:profile},stats:{[active]:fileInfo(Buffer.from(profile),{ino:73})}});
 f.readKernelProfiles=()=>{throw Object.assign(new Error('permission denied'),{code:'EACCES'});};
 const q=inspectLinuxGuiSandbox(f);
 assert.equal(q.status,'OWNER_POLICY_PRESENT_NEEDS_KERNEL_VERIFICATION');
 assert.equal(q.activeProfileMatchesPinnedRelease,true);
 assert.equal(q.loadedProfileVerified,false);
 assert.equal(q.nativeOwnerApprovalRequired,false);
 assert.equal(q.stablePromotionAccepted,false);
});
test('group-writable active system policy is not treated as reusable',()=>{
 const active='/etc/apparmor.d/remote-commander-unified';
 const q=check({data:{[active]:profile},stats:{[active]:fileInfo(Buffer.from(profile),{mode:0o100664,ino:73})}});
 assert.equal(q.status,'OWNER_POLICY_EXISTING_UNTRUSTED');
});
test('active system policy symlink is rejected even if bytes match',()=>{
 const active='/etc/apparmor.d/remote-commander-unified';
 const st={...fileInfo(Buffer.from(profile),{ino:73}),isSymbolicLink:()=>true};
 const q=check({data:{[active]:profile},stats:{[active]:st}});
 assert.equal(q.status,'OWNER_POLICY_EXISTING_UNTRUSTED');
});

test('bounded securityfs profile list proves only exact loaded AppArmor identity',()=>{
 const active='/etc/apparmor.d/remote-commander-unified';
 const f=fixture({data:{[active]:profile},stats:{[active]:fileInfo(Buffer.from(profile),{ino:73})}});
 f.readKernelProfiles=()=>Buffer.from('other-application (enforce)\nremote-commander-unified (unconfined)\n');
 const r=inspectLinuxGuiSandbox(f);
 assert.equal(r.status,'OWNER_POLICY_NAME_LOADED_CONTENT_UNVERIFIED');
 assert.equal(r.kernelProfileNameObserved,true);
 assert.equal(r.kernelProfileContentVerified,false);
 assert.equal(r.loadedProfileVerified,false);
 assert.equal(r.stablePromotionAccepted,false);
 assert.equal(r.guiStarted,false);
});
test('known complete kernel listing without exact target requires owner-approved load',()=>{
 const active='/etc/apparmor.d/remote-commander-unified';
 const f=fixture({data:{[active]:profile},stats:{[active]:fileInfo(Buffer.from(profile),{ino:73})}});
 f.readKernelProfiles=()=>Buffer.from('other-application (enforce)\nremote-commander-unified-extra (enforce)\n');
 const r=inspectLinuxGuiSandbox(f);
 assert.equal(r.status,'OWNER_POLICY_FILE_PRESENT_KERNEL_NOT_LOADED');
 assert.equal(r.nativeOwnerApprovalRequired,true);
 assert.equal(r.loadedProfileVerified,false);
});
test('kernel listing access denied remains unverifiable, not a false negative',()=>{
 const active='/etc/apparmor.d/remote-commander-unified';
 const f=fixture({data:{[active]:profile},stats:{[active]:fileInfo(Buffer.from(profile),{ino:73})}});
 f.readKernelProfiles=()=>{throw Object.assign(new Error('denied'),{code:'EACCES'});};
 assert.equal(inspectLinuxGuiSandbox(f).status,'OWNER_POLICY_PRESENT_NEEDS_KERNEL_VERIFICATION');
});
test('empty or oversized kernel listing remains unknown rather than unloaded',()=>{
 const active='/etc/apparmor.d/remote-commander-unified';
 const f=fixture({data:{[active]:profile},stats:{[active]:fileInfo(Buffer.from(profile),{ino:73})}});
 for(const raw of ['',Buffer.alloc(1024*1024+1)]){
   f.readKernelProfiles=()=>raw;
   assert.equal(inspectLinuxGuiSandbox(f).status,'OWNER_POLICY_PRESENT_NEEDS_KERNEL_VERIFICATION');
 }
});
test('read-only bounded kernel query cannot be used on invalid platform',()=>{
 const f=fixture();
 f.readKernelProfiles=()=>{throw new Error('should not be called');};
 assert.throws(()=>inspectLinuxGuiSandbox({...f,platform:'win32'}),{code:'RC_GUI_POLICY_PREFLIGHT_ARGUMENT_INVALID'});
});


test('data-only lifecycle intent never issues owner grants or changes OS policy',()=>{
 const p=planLinuxGuiSandboxPolicy(fixture());
 assert.equal(p.sourceState,'OWNER_POLICY_REQUIRED');
 assert.equal(p.status,'OWNER_APPROVAL_AND_NATIVE_SNAPSHOT_REQUIRED');
 assert.equal(p.requestedEffect,'REGISTER_AND_LOAD_PINNED_PROFILE');
 assert.equal(p.priorPolicyFile,'ABSENT');
 assert.equal(p.publisherProvenanceVerified,false);
 assert.equal(p.ownerApprovalIssued,false);
 assert.equal(p.nativeEffectAuthorized,false);
 assert.equal(p.ownerPolicyEffectPerformed,false);
 assert.equal(p.rollbackReceiptRequired,true);
 assert.equal(p.stablePromotionAccepted,false);
});
test('a fully matching existing policy but absent kernel name plans load only, never rewrite',()=>{
 const active='/etc/apparmor.d/remote-commander-unified';
 const f=fixture({data:{[active]:profile},stats:{[active]:fileInfo(Buffer.from(profile),{ino:73})}});
 f.readKernelProfiles=()=>Buffer.from('other (enforce)\n');
 const q=planLinuxGuiSandboxPolicy(f);
 assert.equal(q.status,'OWNER_APPROVAL_AND_NATIVE_SNAPSHOT_REQUIRED');
 assert.equal(q.requestedEffect,'LOAD_EXISTING_PINNED_PROFILE');
 assert.equal(q.priorPolicyFile,'PINNED_EXISTING');
 assert.equal(q.ownerApprovalIssued,false);
});
test('loaded profile name without a content digest must block policy effect',()=>{
 const active='/etc/apparmor.d/remote-commander-unified';
 const f=fixture({data:{[active]:profile},stats:{[active]:fileInfo(Buffer.from(profile),{ino:73})}});
 f.readKernelProfiles=()=>Buffer.from('remote-commander-unified (unconfined)\n');
 const q=planLinuxGuiSandboxPolicy(f);
 assert.equal(q.status,'BLOCKED_KERNEL_POLICY_BYTES_UNVERIFIED');
 assert.equal(q.requestedEffect,'NONE');
 assert.equal(q.kernelProfileContentVerified,false);
 assert.equal(q.nativeOwnerApprovalRequired,false);
});
test('unknown active kernel state fails closed even if policy file matches',()=>{
 const active='/etc/apparmor.d/remote-commander-unified';
 const f=fixture({data:{[active]:profile},stats:{[active]:fileInfo(Buffer.from(profile),{ino:73})}});
 f.readKernelProfiles=()=>{throw Object.assign(new Error('denied'),{code:'EACCES'});};
 const q=planLinuxGuiSandboxPolicy(f);
 assert.equal(q.status,'BLOCKED_KERNEL_OBSERVATION_UNAVAILABLE');
 assert.equal(q.requestedEffect,'NONE');
});
test('a foreign or unsafe profile never produces an executable intent',()=>{
 const active='/etc/apparmor.d/remote-commander-unified';
 const f=fixture({data:{[active]:profile},stats:{[active]:fileInfo(Buffer.from(profile),{mode:0o100664})}});
 const q=planLinuxGuiSandboxPolicy(f);
 assert.equal(q.status,'BLOCKED_UNVERIFIED_POLICY_STATE');
 assert.equal(q.requestedEffect,'NONE');
 assert.equal(q.nativeEffectAuthorized,false);
});
test('policy not required emits no native effect and is not GUI-ready',()=>{
 const q=planLinuxGuiSandboxPolicy(fixture({overrides:{[flags.restricted]:'0'}}));
 assert.equal(q.status,'NO_POLICY_EFFECT_REQUIRED');
 assert.equal(q.nativeOwnerApprovalRequired,false);
 assert.equal(q.guiStarted,false);
 assert.equal(q.stablePromotionAccepted,false);
});
test('native adapter uses the same read-only data-only policy plan and Windows has none',()=>{
 const linux=createNativeOsAdapter({platform:'linux',architecture:'x64',run:()=>{throw Error('OS command must not be used');}});
 assert.equal(typeof linux.planGuiSandboxPolicy,'function');
 const result=linux.planGuiSandboxPolicy(fixture());
 assert.equal(result.requestedEffect,'REGISTER_AND_LOAD_PINNED_PROFILE');
 const win=createNativeOsAdapter({platform:'windows',architecture:'x64',run:()=>{throw Error('OS command must not be used');}});
 assert.equal(Object.hasOwn(win,'planGuiSandboxPolicy'),false);
});

test('policy absent on disk but orphaned kernel profile blocks new registration',()=>{
 const f=fixture();
 f.readKernelProfiles=()=>Buffer.from('remote-commander-unified (enforce)\n');
 const q=inspectLinuxGuiSandbox(f);
 assert.equal(q.status,'OWNER_POLICY_ORPHANED_KERNEL_PROFILE');
 assert.equal(q.nativeOwnerApprovalRequired,false);
 assert.equal(planLinuxGuiSandboxPolicy(f).requestedEffect,'NONE');
});
test('policy file absent and kernel unreadable never authorizes registration',()=>{
 const f=fixture();
 f.readKernelProfiles=()=>{throw Object.assign(new Error('denied'),{code:'EACCES'});};
 const q=inspectLinuxGuiSandbox(f);
 assert.equal(q.status,'OWNER_POLICY_ABSENT_FILE_KERNEL_UNVERIFIED');
 assert.equal(planLinuxGuiSandboxPolicy(f).status,'BLOCKED_UNVERIFIED_POLICY_STATE');
});


test('pre-effect compare remains blocked for unchanged data despite fingerprint match',()=>{
 const f=fixture();
 const plan=planLinuxGuiSandboxPolicy(f);
 assert.equal(plan.requestedEffect,'REGISTER_AND_LOAD_PINNED_PROFILE');
 assert.match(plan.preEffectStateFingerprint,/^[a-f0-9]{64}$/);
 const compared=revalidateLinuxGuiPolicyPlan(plan,f);
 assert.equal(compared.status,'PRE_EFFECT_STATE_STABLE');
 assert.equal(compared.nativeEffectAuthorized,false);
 assert.equal(compared.ownerApprovalIssued,false);
 assert.equal(compared.publisherProvenanceVerified,false);
 assert.equal(compared.stablePromotionAccepted,false);
});
test('pre-effect changes of parent inode fail even when policy contents match',()=>{
 const f=fixture();
 const plan=planLinuxGuiSandboxPolicy(f);
 const old=f.stat;
 f.stat=x=>{
   const s=old(x);
   return x===ROOT?{...s,ino:s.ino+200}:s;
 };
 const r=revalidateLinuxGuiPolicyPlan(plan,f);
 assert.equal(r.status,'BLOCKED_PRE_EFFECT_STATE_DRIFT');
 assert.notEqual(r.latestStateFingerprint,r.originalStateFingerprint);
});
test('new foreign policy file before owner native effect blocks stale plan',()=>{
 const f=fixture(),plan=planLinuxGuiSandboxPolicy(f);
 const old=f.stat;
 f.stat=x=>{
   if(x==='/etc/apparmor.d/remote-commander-unified')
     return fileInfo(Buffer.from(profile),{ino:199});
   return old(x);
 };
 const r=revalidateLinuxGuiPolicyPlan(plan,f);
 assert.equal(r.status,'BLOCKED_PRE_EFFECT_STATE_DRIFT');
});
test('kernel profile appearing after approval preview blocks stale registration',()=>{
 const f=fixture(),plan=planLinuxGuiSandboxPolicy(f);
 f.readKernelProfiles=()=>Buffer.from('remote-commander-unified (enforce)\n');
 const r=revalidateLinuxGuiPolicyPlan(plan,f);
 assert.equal(r.status,'BLOCKED_PRE_EFFECT_STATE_DRIFT');
});
test('kernel access loss fails closed between plan and effect',()=>{
 const f=fixture(),plan=planLinuxGuiSandboxPolicy(f);
 f.readKernelProfiles=()=>{throw Object.assign(new Error('denied'),{code:'EACCES'});};
 assert.equal(revalidateLinuxGuiPolicyPlan(plan,f).status,'BLOCKED_PRE_EFFECT_STATE_DRIFT');
});
test('tampered or non-pinned policy plan fails before inspecting native state',()=>{
 const f=fixture(),plan=planLinuxGuiSandboxPolicy(f);
 assert.throws(()=>revalidateLinuxGuiPolicyPlan({...plan,preEffectStateFingerprint:'x'},f),
   {code:'RC_GUI_POLICY_PRE_EFFECT_PLAN_INVALID'});
 assert.throws(()=>revalidateLinuxGuiPolicyPlan(plan,{...f,expectedProfileSha256:'a'.repeat(64)}),
   {code:'RC_GUI_POLICY_PRE_EFFECT_PLAN_INVALID'});
});
test('shared adapter revalidates Linux policy intents without any OS command',()=>{
 const adapter=createNativeOsAdapter({
   platform:'linux',architecture:'x64',
   run:()=>{throw Error('forbidden native effect')}
 });
 const f=fixture(),plan=adapter.planGuiSandboxPolicy(f);
 assert.equal(adapter.revalidateGuiPolicyPlan(plan,f).status,'PRE_EFFECT_STATE_STABLE');
 const win=createNativeOsAdapter({platform:'windows',architecture:'x64',
   run:()=>{throw Error('forbidden native effect')}
 });
 assert.equal(Object.hasOwn(win,'revalidateGuiPolicyPlan'),false);
});
