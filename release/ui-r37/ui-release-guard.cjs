#!/usr/bin/env node
'use strict';
/* Pure R37 UI release contract: never downloads, installs, mutates,
 * promotes, restarts or reads browser/profile state. */
const fs=require('node:fs');
const path=require('node:path');
const SHA=/^[a-f0-9]{64}$/;
const COMMIT=/^[a-f0-9]{40}$/;
const EXPECTED_HOSTS=['emad-linux','emad-win','mmz-linux','saeid-win'];
const PACKAGES=['browser-linux','browser-win','control-linux','control-win'];
const COMPONENTS=['browser','control-linux','control-windows'];
const WINDOWS=['browser-win','control-win'];
const KNOWN_REPOS=new Set(['Usefull-Skills/chatgpt-cef-linux','GOD13emad/ChatGPTRemoteCommander']);

function ensure(bool,message){if(!bool)throw Error('R37_SCHEMA_'+message);}
function isSha(value){return typeof value==='string'&&SHA.test(value);}
function safeSourceUrl(pkg,url){
 if(typeof url!=='string'||url.length>500)return false;
 if(!/^https:\/\/github\.com\/(?:Usefull-Skills\/chatgpt-cef-linux|GOD13emad\/ChatGPTRemoteCommander)\/releases\/download\/v[0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/.test(url))return false;
 return pkg.id.startsWith('browser')?url.includes('/Usefull-Skills/chatgpt-cef-linux/'):url.includes('/GOD13emad/ChatGPTRemoteCommander/');
}
function validate(m){
 ensure(m&&typeof m==='object'&&!Array.isArray(m),'DOCUMENT');
 ensure(m.schema===1&&m.releaseId==='RC-UI-2026-10-10-R37','IDENTITY');
 ensure(m.scope==='UI_ONLY'&&m.channel==='candidate','SCOPE_OR_CHANNEL');
 ensure(m.baselineCore?.version==='0.10.20'&&m.baselineCore.commit==='362375c464948be3001b307650c13fc3353ed05b'&&m.baselineCore.routerMustRemainUnchanged===true,'PRODUCTION_AUTHORITY');
 ensure(m.requestedAutomaticRollout===true&&typeof m.automaticPromotionEnabled==='boolean','PROMOTION_TYPES');
 ensure(['BLOCKED','APPROVED'].includes(m.status),'STATUS_ENUM');
 ensure(Array.isArray(m.components)&&m.components.length===3,'COMPONENT_COUNT');
 const cs=m.components.map(c=>c.id).sort();ensure(JSON.stringify(cs)===JSON.stringify([...COMPONENTS].sort()),'COMPONENT_IDS');
 for(const c of m.components){
  ensure(KNOWN_REPOS.has(c.repo)&&COMMIT.test(c.candidateCommit)&&Number.isInteger(c.pr)&&c.pr>0,'SOURCE_AUTHORITY');
  ensure(typeof c.version==='string'&&c.version.length<=50&&Array.isArray(c.platforms),'SOURCE_VERSION');
 }
 ensure(m.components.find(x=>x.id==='browser').version==='0.8.2','BROWSER_VERSION');
 ensure(Array.isArray(m.packages)&&m.packages.length===4,'PACKAGE_COUNT');
 const ps=m.packages.map(x=>x.id).sort();ensure(JSON.stringify(ps)===JSON.stringify(PACKAGES),'PACKAGE_IDS');
 for(const p of m.packages){
  ensure(['linux','windows'].includes(p.platform)&&p.id.endsWith(p.platform==='windows'?'-win':'-linux'),'PACKAGE_PLATFORM');
  ensure(p.sha256==null||isSha(p.sha256),'PACKAGE_SHA_FORMAT');
  ensure(p.downloadUrl==null||safeSourceUrl(p,p.downloadUrl),'PACKAGE_URL_AUTHORITY');
  ensure(p.rollbackReceiptSha256==null||isSha(p.rollbackReceiptSha256),'PACKAGE_ROLLBACK_PROOF');
  ensure(p.signatureEvidenceSha256==null||isSha(p.signatureEvidenceSha256),'PACKAGE_SIGNATURE_PROOF');
  ensure(p.signatureChainVerified===null||typeof p.signatureChainVerified==='boolean','PACKAGE_SIGNING_TYPE');
 }
 ensure(Array.isArray(m.hosts)&&m.hosts.length===4,'HOST_COUNT');
 const hs=m.hosts.map(x=>x.id).sort();ensure(JSON.stringify(hs)===JSON.stringify(EXPECTED_HOSTS),'HOST_IDENTITIES');
 for(const h of m.hosts){
  ensure(['linux','windows'].includes(h.platform)&&h.id.endsWith(h.platform==='windows'?'-win':'-linux'),'HOST_PLATFORM');
  for(const k of ['reportedConnected','verifiedNativeVisual','canaryRollbackAccepted'])ensure(typeof h[k]==='boolean','HOST_BOOL_'+k);
  ensure(h.ownerLocalPrivilegeReady===null||typeof h.ownerLocalPrivilegeReady==='boolean','HOST_PRIVILEGE_TYPE');
  ensure(h.validationReceiptSha256===null||isSha(h.validationReceiptSha256),'HOST_RECEIPT_SHA_FORMAT');
 }
 ensure(m.releaseGates&&typeof m.releaseGates==='object'&&!Array.isArray(m.releaseGates),'GATES_OBJECT');
 const gates=[
  'sourceCIWindows','sourceCILinux','browserNativeLoginAndRTL','controlWindowsPhysicalVisual',
  'controlLinuxPhysicalVisual','trustedWindowsCodeSignature','linuxBrowserSandboxOwnerAcceptance',
  'fourHostInstalledRuntimeProven','fourHostUninstallRollbackProven',
  'sessionAndProfilePreservationValidated','accountTransferBrainCurrent'];
 for(const key of gates)ensure(typeof m.releaseGates[key]==='boolean','GATE_BOOL_'+key);
 ensure(m.security?.productionCoreMutationAllowed===false&&
        m.security.userBrowserProfileMutationAllowed===false&&
        m.security.blindRepairAllowed===false&&
        m.security.ownerSudoPasswordInChatAllowed===false&&
        m.security.restartAllowed===false&&
        m.security.artifactNamesFromLatestGuessingAllowed===false&&
        m.security.localPackageShaAndSignatureMustBeIndependentlyChecked===true,'SECURITY_GUARDS');
 ensure(isSha(m.evidence?.acceptedBrainSha256),'ACCEPTED_BRAIN_SHA');
 return gates;
}
function inspect(m){
 const required=validate(m),blocked=[];
 if(m.status!=='APPROVED')blocked.push('RELEASE_NOT_APPROVED');
 if(m.automaticPromotionEnabled!==true)blocked.push('AUTOMATIC_PROMOTION_DISABLED');
 for(const key of required)if(!m.releaseGates[key])blocked.push('GATE_OPEN:'+key);
 for(const p of m.packages){
  if(!isSha(p.sha256)||!safeSourceUrl(p,p.downloadUrl))blocked.push('PACKAGE_MISSING_VERIFIED_ASSET:'+p.id);
  if(!isSha(p.rollbackReceiptSha256))blocked.push('ROLLBACK_RECEIPT_MISSING:'+p.id);
  if(WINDOWS.includes(p.id)&&!(p.signatureChainVerified===true&&isSha(p.signatureEvidenceSha256)))
   blocked.push('TRUSTED_CODE_SIGNING_NOT_VERIFIED:'+p.id);
 }
 for(const h of m.hosts){
  if(!h.reportedConnected)blocked.push('HOST_OFFLINE:'+h.id);
  if(!h.verifiedNativeVisual)blocked.push('NATIVE_VISUAL_NOT_ACCEPTED:'+h.id);
  if(!h.canaryRollbackAccepted||!isSha(h.validationReceiptSha256))blocked.push('HOST_CANARY_ROLLBACK_OPEN:'+h.id);
  if(h.platform==='linux'&&h.ownerLocalPrivilegeReady!==true)blocked.push('OWNER_LOCAL_SANDBOX_PRIVILEGE_REQUIRED:'+h.id);
 }
 blocked.sort();
 return {
  schema:1,releaseId:m.releaseId,channel:m.channel,status:blocked.length?'BLOCKED':'STAGE_ELIGIBLE_NOT_INSTALLED',
  automaticPromotionEnabled:m.automaticPromotionEnabled&&blocked.length===0,
  blockedReasons:blocked,hostCount:m.hosts.length,
  productionCoreMutationAllowed:false,ownerBrowserProfileTouched:false,
  signatureAndPackageMustBeVerifiedAgainLocally:true,
  nextAction:blocked.length?
    'Do not install/promote. Close native visual, trusted signature, privilege, four-host readiness and rollback gates.':
    'Only stage exact immutable artifacts after local independent signature/hash checks; canary+rollback acceptance required before actual activation.'
 };
}
function load(file){
 const stat=fs.lstatSync(file);
 ensure(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<65536,'MANIFEST_FILE');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
if(require.main===module){
 try{
  const mode=process.argv[2],file=process.argv[3];
  ensure((mode==='--status'||mode==='--enforce')&&typeof file==='string','CLI');
  const res=inspect(load(path.resolve(file)));
  console.log(JSON.stringify(res,null,2));
  if(mode==='--enforce'&&res.status!=='STAGE_ELIGIBLE_NOT_INSTALLED')process.exitCode=78;
 }catch(e){console.error(String(e.stack||e));process.exitCode=77;}
}
module.exports={validate,inspect,load,safeSourceUrl};
