import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectLinuxGuiSandbox} from '../tools/universal-install/native-linux-gui-sandbox.mjs';
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
 uid,mode,nlink,size,dev,ino,mtimeMs:1,ctimeMs:1,isFile:()=>true,isSymbolicLink:()=>false
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
 const q=check({data:{[active]:profile},stats:{[active]:fileInfo(Buffer.from(profile),{ino:73})}});
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
