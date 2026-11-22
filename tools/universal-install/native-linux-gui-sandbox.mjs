// Read-only Linux GUI sandbox preflight for the ONE native Commander installer.
// Does not load AppArmor, request privilege, approve installation or claim GUI
// readiness. Exact OS policy admission and rollback belong to native transaction.
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const SHA=/^[a-f0-9]{64}$/;
const ROOT='/opt/Remote Commander';
const GUI=ROOT+'/remote-commander-unified';
const PROFILE=ROOT+'/resources/apparmor-profile';
const ACTIVE='/etc/apparmor.d/remote-commander-unified';
const KERNEL_PROFILES='/sys/kernel/security/apparmor/profiles';
const MAX_KERNEL_LIST_BYTES=1024*1024;
function readKernelProfileListing(){
  // Only a bounded, read-only kernel securityfs observation. No escalation,
  // subprocess, policy load or disclosure of other installed profile names.
  const fd=fs.openSync(KERNEL_PROFILES,'r');
  const parts=[],buf=Buffer.alloc(8192);let used=0;
  try{
    for(;;){
      const size=fs.readSync(fd,buf,0,buf.length,null);
      if(size===0)break;
      used+=size;
      if(used>MAX_KERNEL_LIST_BYTES)return null;
      parts.push(Buffer.from(buf.subarray(0,size)));
    }
    return Buffer.concat(parts);
  }finally{buf.fill(0);fs.closeSync(fd);}
}
function observedKernelPolicy(readKernelProfiles){
  let raw;
  try{raw=readKernelProfiles();}catch{return null;}
  if(!(typeof raw==='string'||Buffer.isBuffer(raw)))return null;
  const bytes=Buffer.isBuffer(raw)?raw:Buffer.from(raw,'utf8');
  if(bytes.length===0||bytes.length>MAX_KERNEL_LIST_BYTES)return null;
  const names=bytes.toString('utf8').split(/\r?\n/);
  return names.some(name=>/^remote-commander-unified \((?:enforce|complain|unconfined|kill)\)$/.test(name.trim()));
}

const flags={
  appArmor:'/sys/module/apparmor/parameters/enabled',
  restricted:'/proc/sys/kernel/apparmor_restrict_unprivileged_userns',
  clone:'/proc/sys/kernel/unprivileged_userns_clone'
};
const fail=c=>{throw Object.assign(new Error(c),{code:c});};
const result=(status,extra={})=>Object.freeze({
  schema:'rc-native-linux-gui-sandbox-admission-v1',
  status,platform:'linux',nativeOwnerApprovalRequired:['OWNER_POLICY_REQUIRED',
    'OWNER_POLICY_FILE_PRESENT_KERNEL_NOT_LOADED'].includes(status),
  osPolicyModified:false,guiStarted:false,stablePromotionAccepted:false,...extra
});
function smallText(read,p,n=32){
  let value;
  try{value=read(p);}catch{return null;}
  if(!Buffer.isBuffer(value))value=Buffer.from(value);
  if(value.length>n)return null;
  return value.toString('utf8').trim();
}
const TRUSTED_PARENT_DIRS=Object.freeze([
  '/opt',ROOT,ROOT+'/resources','/etc','/etc/apparmor.d'
]);
function trustedParentDirs(stat){
  // lstat every ancestor: a symlinked parent can redirect a trusted leaf
  // into attacker-controlled storage while the leaf remains a regular file.
  return TRUSTED_PARENT_DIRS.every(dir=>{
    let node;
    try{node=stat(dir);}catch{return false;}
    return !!node&&node.isDirectory()&&!node.isSymbolicLink()
      &&node.uid===0&&(node.mode&0o022)===0;
  });
}
function trustedFile(file,read,stat,max){
  let s;
  try{s=stat(file);}catch{return null;}
  if(!s||!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==0||
     (s.mode&0o022)!==0||s.size<80||s.size>max)return null;
  let b;
  try{b=read(file);}catch{return null;}
  if(!Buffer.isBuffer(b))b=Buffer.from(b);
  if(b.length!==s.size||b.length>max)return null;
  let s2;
  try{s2=stat(file);}catch{return null;}
  if(!s2||s2.dev!==s.dev||s2.ino!==s.ino||
     s2.mtimeMs!==s.mtimeMs||s2.ctimeMs!==s.ctimeMs||s2.size!==s.size||
     s2.nlink!==1||!s2.isFile()||s2.isSymbolicLink())return null;
  return b;
}
export function inspectLinuxGuiSandbox({
  expectedProfileSha256,read=fs.readFileSync,stat=fs.lstatSync,
  readKernelProfiles=readKernelProfileListing,platform=process.platform
}={}){
  if(platform!=='linux'||!SHA.test(expectedProfileSha256??'')||
     typeof read!=='function'||typeof stat!=='function'||
     typeof readKernelProfiles!=='function')
    fail('RC_GUI_POLICY_PREFLIGHT_ARGUMENT_INVALID');
  const appArmor=smallText(read,flags.appArmor);
  const restricted=smallText(read,flags.restricted);
  const clone=smallText(read,flags.clone);
  if(!['Y','N'].includes(appArmor)||!['0','1',null].includes(restricted)
     ||!['0','1',null].includes(clone))
    return result('UNKNOWN_KERNEL_SECURITY_STATE');
  if(clone==='0')return result('KERNEL_USERNS_DISABLED');
  if(appArmor==='N'&&restricted==='1')
    return result('UNKNOWN_KERNEL_SECURITY_STATE');
  if(appArmor==='N'||restricted==='0')
    return result('APPARMOR_POLICY_NOT_REQUIRED');
  // With AppArmor enabled and a restricted or unknown kernel setting, do not
  // claim readiness based on the mere presence of a profile file.
  if(restricted===null)return result('UNKNOWN_KERNEL_SECURITY_STATE');
  if(!trustedParentDirs(stat))return result('OWNER_POLICY_PATH_UNTRUSTED');
  const executable=(()=>{try{return stat(GUI);}catch{return null;}})();
  if(!executable?.isFile()||executable.isSymbolicLink()||
     executable.uid!==0||executable.nlink!==1||(executable.mode&0o022)!==0)
    return result('INSTALLED_GUI_NOT_TRUSTED');
  const profile=trustedFile(PROFILE,read,stat,16384);
  if(!profile)return result('INSTALLED_PROFILE_NOT_TRUSTED');
  const found=createHash('sha256').update(profile).digest('hex');
  if(found!==expectedProfileSha256)return result('INSTALLED_PROFILE_SHA_MISMATCH');
  const text=profile.toString('utf8');
  if(!/^profile "remote-commander-unified" "\/opt\/Remote Commander\/remote-commander-unified" flags=\(unconfined\)\s*\{/m.test(text)
    ||!/^\s*userns,\s*$/m.test(text))
    return result('INSTALLED_PROFILE_CONTENT_MISMATCH');
  let existing;
  try{existing=stat(ACTIVE);}catch(e){
    if(e?.code!=='ENOENT')return result('OWNER_POLICY_PATH_UNCERTAIN');
  }
  if(existing){
    // Installed-file identity is NOT proof that AppArmor accepted the policy
    // into the running kernel. The native coordinator must separately verify.
    const live=trustedFile(ACTIVE,read,stat,16384);
    if(!live)return result('OWNER_POLICY_EXISTING_UNTRUSTED');
    if(createHash('sha256').update(live).digest('hex')!==found)
      return result('OWNER_POLICY_EXISTING_REQUIRES_RECONCILIATION');
    const loaded=observedKernelPolicy(readKernelProfiles);
    // A kernel listing proves ONLY that a profile name is registered. It
    // cannot attest the policy bytes currently loaded by the kernel; stale
    // earlier rules might still be active even when the on-disk SHA matches.
    return result(loaded===true?'OWNER_POLICY_NAME_LOADED_CONTENT_UNVERIFIED':
      loaded===false?'OWNER_POLICY_FILE_PRESENT_KERNEL_NOT_LOADED':
      'OWNER_POLICY_PRESENT_NEEDS_KERNEL_VERIFICATION',{
      installedProfileSha256:found,activeProfileMatchesPinnedRelease:true,
      installedGuiIdentityObserved:true,kernelProfileNameObserved:loaded===true,
      kernelProfileContentVerified:false,loadedProfileVerified:false
    });
  }
  // Absence of an /etc policy file is not evidence that an orphaned
  // profile name is absent from the running kernel. An unknown kernel state
  // must not authorize registering a new file over an unidentified policy.
  const noFileKernel=observedKernelPolicy(readKernelProfiles);
  if(noFileKernel===true)return result('OWNER_POLICY_ORPHANED_KERNEL_PROFILE');
  if(noFileKernel===null)return result('OWNER_POLICY_ABSENT_FILE_KERNEL_UNVERIFIED');
  return result('OWNER_POLICY_REQUIRED',{
    installedProfileSha256:found,profileMatchesPinnedRelease:true,
    installedGuiIdentityObserved:true,loadedProfileVerified:false
  });
}


const POLICY_IDENTITY_PATHS=Object.freeze([
  ...TRUSTED_PARENT_DIRS,GUI,PROFILE,ACTIVE
]);
function policyStateFingerprint(stat,expectedSha256,status,effect){
  const identities=[];
  for(const item of POLICY_IDENTITY_PATHS){
    let n;
    try{n=stat(item);}catch(error){
      if(item===ACTIVE&&error?.code==='ENOENT'){
        identities.push([item,'ABSENT']);
        continue;
      }
      return null;
    }
    if(!n||!Number.isSafeInteger(n.dev)||!Number.isSafeInteger(n.ino)
      ||!Number.isSafeInteger(n.uid)||!Number.isSafeInteger(n.mode)
      ||!Number.isSafeInteger(n.nlink)||!Number.isSafeInteger(n.size)
      ||!Number.isFinite(n.ctimeMs)||!Number.isFinite(n.mtimeMs)
      ||typeof n.isSymbolicLink!=='function'
      ||typeof n.isFile!=='function'||typeof n.isDirectory!=='function'
      ||n.isSymbolicLink()||(!n.isFile()&&!n.isDirectory()))return null;
    identities.push([item,n.dev,n.ino,n.uid,n.mode,n.nlink,n.size,
      n.ctimeMs,n.mtimeMs,n.isDirectory()?'DIR':'FILE']);
  }
  return createHash('sha256').update(JSON.stringify([
    'rc-gui-policy-pre-effect-v1',expectedSha256,status,effect,identities
  ])).digest('hex');
}

// A data-only intent for the existing native installer transaction.
// No method in this module executes a privileged command or grants owner
// approval. A caller-supplied SHA is not publisher provenance by itself.
export function planLinuxGuiSandboxPolicy(options={}){
  const observed=inspectLinuxGuiSandbox(options);
  const common={
    schema:'rc-native-linux-gui-policy-plan-v1',
    sourceState:observed.status,
    expectedProfileSha256:options.expectedProfileSha256,
    ownerApprovalIssued:false,
    publisherProvenanceVerified:false,
    nativeEffectAuthorized:false,
    kernelProfileContentVerified:false,
    guiStarted:false,
    stablePromotionAccepted:false
  };
  let status='BLOCKED_UNVERIFIED_POLICY_STATE';
  let requestedEffect='NONE',priorPolicyFile='UNKNOWN';
  switch(observed.status){
    case 'APPARMOR_POLICY_NOT_REQUIRED':
      status='NO_POLICY_EFFECT_REQUIRED';
      requestedEffect='NONE';
      break;
    case 'OWNER_POLICY_REQUIRED':
      status='OWNER_APPROVAL_AND_NATIVE_SNAPSHOT_REQUIRED';
      requestedEffect='REGISTER_AND_LOAD_PINNED_PROFILE';
      priorPolicyFile='ABSENT';
      break;
    case 'OWNER_POLICY_FILE_PRESENT_KERNEL_NOT_LOADED':
      status='OWNER_APPROVAL_AND_NATIVE_SNAPSHOT_REQUIRED';
      requestedEffect='LOAD_EXISTING_PINNED_PROFILE';
      priorPolicyFile='PINNED_EXISTING';
      break;
    case 'OWNER_POLICY_NAME_LOADED_CONTENT_UNVERIFIED':
      status='BLOCKED_KERNEL_POLICY_BYTES_UNVERIFIED';
      requestedEffect='NONE';
      priorPolicyFile='PINNED_EXISTING';
      break;
    case 'OWNER_POLICY_PRESENT_NEEDS_KERNEL_VERIFICATION':
      status='BLOCKED_KERNEL_OBSERVATION_UNAVAILABLE';
      requestedEffect='NONE';
      priorPolicyFile='PINNED_EXISTING';
      break;
    default:
      // No unsafe source, foreign policy, indeterminate kernel or denied
      // preflight may produce a native operation intention.
      break;
  }
  const preEffectStateFingerprint=requestedEffect==='NONE'
    ?null:policyStateFingerprint(options.stat??fs.lstatSync,
      options.expectedProfileSha256,observed.status,requestedEffect);
  if(requestedEffect!=='NONE'&&!preEffectStateFingerprint){
    status='BLOCKED_UNVERIFIED_POLICY_STATE';
    requestedEffect='NONE';
  }
  return Object.freeze({
    ...common,status,requestedEffect,priorPolicyFile,
    preEffectStateFingerprint,
    nativeOwnerApprovalRequired:requestedEffect!=='NONE',
    exactPriorStateSnapshotRequired:requestedEffect!=='NONE',
    rollbackReceiptRequired:requestedEffect!=='NONE',
    ownerPolicyEffectPerformed:false
  });
}


// Must run immediately before native privilege transfer, under the existing
// installer transaction's journal/owner lock. A true result is a state
// comparison only, NOT native authorization, stable release or GUI success.
export function revalidateLinuxGuiPolicyPlan(approvedPlan,options={}){
  if(!approvedPlan||approvedPlan.schema!=='rc-native-linux-gui-policy-plan-v1'
    ||!SHA.test(approvedPlan.expectedProfileSha256??'')
    ||!SHA.test(approvedPlan.preEffectStateFingerprint??'')
    ||approvedPlan.status!=='OWNER_APPROVAL_AND_NATIVE_SNAPSHOT_REQUIRED'
    ||!['REGISTER_AND_LOAD_PINNED_PROFILE',
      'LOAD_EXISTING_PINNED_PROFILE'].includes(approvedPlan.requestedEffect)
    ||options.expectedProfileSha256!==approvedPlan.expectedProfileSha256)
    fail('RC_GUI_POLICY_PRE_EFFECT_PLAN_INVALID');
  const latest=planLinuxGuiSandboxPolicy(options);
  const stable=latest.status===approvedPlan.status
    &&latest.sourceState===approvedPlan.sourceState
    &&latest.priorPolicyFile===approvedPlan.priorPolicyFile
    &&latest.requestedEffect===approvedPlan.requestedEffect
    &&latest.preEffectStateFingerprint===approvedPlan.preEffectStateFingerprint;
  return Object.freeze({
    schema:'rc-native-linux-gui-policy-pre-effect-v1',
    status:stable?'PRE_EFFECT_STATE_STABLE':'BLOCKED_PRE_EFFECT_STATE_DRIFT',
    originalStateFingerprint:approvedPlan.preEffectStateFingerprint,
    latestStateFingerprint:latest.preEffectStateFingerprint??null,
    nativeEffectAuthorized:false,
    ownerApprovalIssued:false,
    publisherProvenanceVerified:false,
    kernelProfileContentVerified:false,stablePromotionAccepted:false
  });
}


// Reconcile a failed or uncertain AppArmor effect without guessing that a
// failed parser/process call meant "no change". Pure read-only observation:
// an unchanged pre-effect fingerprint is evidence of baseline preservation,
// never proof of granted OS permission or a successfully loaded kernel policy.
// Any drift requires the existing native transaction journal and its trusted
// owner to reconcile before a destructive rollback is attempted.
export function reconcileLinuxGuiPolicyFailure(beforePlan,options={}){
  if(!beforePlan||beforePlan.schema!=='rc-native-linux-gui-policy-plan-v1'
    ||beforePlan.status!=='OWNER_APPROVAL_AND_NATIVE_SNAPSHOT_REQUIRED'
    ||!SHA.test(beforePlan.expectedProfileSha256??'')
    ||!SHA.test(beforePlan.preEffectStateFingerprint??'')
    ||!['REGISTER_AND_LOAD_PINNED_PROFILE',
      'LOAD_EXISTING_PINNED_PROFILE'].includes(beforePlan.requestedEffect)
    ||options.expectedProfileSha256!==beforePlan.expectedProfileSha256)
    fail('RC_GUI_POLICY_RECOVERY_PLAN_INVALID');
  const observed=planLinuxGuiSandboxPolicy(options);
  const preserved=observed.status===beforePlan.status
    &&observed.sourceState===beforePlan.sourceState
    &&observed.priorPolicyFile===beforePlan.priorPolicyFile
    &&observed.requestedEffect===beforePlan.requestedEffect
    &&observed.preEffectStateFingerprint===beforePlan.preEffectStateFingerprint;
  return Object.freeze({
    schema:'rc-native-linux-gui-policy-recovery-v1',
    status:preserved?'BASELINE_STATE_REOBSERVED':
      'NEEDS_MANUAL_RECONCILIATION',
    baselineFingerprint:beforePlan.preEffectStateFingerprint,
    observedFingerprint:observed.preEffectStateFingerprint??null,
    baselineMatched:preserved,
    // Even a matching observation does not prove a native effect never took
    // place. The journal must still account for an uncertain command outcome.
    effectOutcomeKnown:false,
    nativeRollbackAuthorized:false,
    ownerApprovalIssued:false,
    kernelProfileContentVerified:false,
    guiStarted:false,stablePromotionAccepted:false,
    journalReconciliationRequired:true
  });
}
