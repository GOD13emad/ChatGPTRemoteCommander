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
const flags={
  appArmor:'/sys/module/apparmor/parameters/enabled',
  restricted:'/proc/sys/kernel/apparmor_restrict_unprivileged_userns',
  clone:'/proc/sys/kernel/unprivileged_userns_clone'
};
const fail=c=>{throw Object.assign(new Error(c),{code:c});};
const result=(status,extra={})=>Object.freeze({
  schema:'rc-native-linux-gui-sandbox-admission-v1',
  status,platform:'linux',nativeOwnerApprovalRequired:status==='OWNER_POLICY_REQUIRED',
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
  platform=process.platform
}={}){
  if(platform!=='linux'||!SHA.test(expectedProfileSha256??'')||
     typeof read!=='function'||typeof stat!=='function')
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
    return result('OWNER_POLICY_PRESENT_NEEDS_KERNEL_VERIFICATION',{
      installedProfileSha256:found,activeProfileMatchesPinnedRelease:true,
      installedGuiIdentityObserved:true,loadedProfileVerified:false
    });
  }
  return result('OWNER_POLICY_REQUIRED',{
    installedProfileSha256:found,profileMatchesPinnedRelease:true,
    installedGuiIdentityObserved:true,loadedProfileVerified:false
  });
}
