'use strict';
// R40 release admission — read-only. Never installs, merges, restarts, or logs out.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const base=path.resolve(__dirname,'..');
const input=path.join(base,'release','UI_R40.json');
const hex40=x=>typeof x==='string'&&/^[0-9a-f]{40}$/.test(x);
const hex64=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const required=new Map([['saeid-windows','windows'],['emad-windows','windows'],['emad-linux','linux'],['mmz-linux','linux']]);
const sources=new Set(['browser','control-windows','control-linux']);
const gates=['trustedWindowsAuthenticode','linuxSandbox4755Accepted','threeUiNativeAcceptance','sessionPersistenceOwnerValidated','runnerExactChatAck','signedFourHostCanary','uninstallRollbackFourHost','acceptedFinalBrain'];
function evaluate(plan){
 const block=[];
 const deny=(gate,reason)=>block.push({gate,reason});
 if(!plan||typeof plan!=='object'||Array.isArray(plan))return {status:'BLOCKED',promotionAuthorized:false,blockers:[{gate:'SCHEMA',reason:'invalid plan'}]};
 if(plan.schema!==1||plan.id!=='UI_R40'||plan.stage!=='DRAFT_NOT_RELEASED')deny('AUTHORITY','only draft R40 recognized');
 if(plan.automaticPromotionAuthorized!==false||plan.releaseTag!==null)deny('NO_AUTOPROMOTION','tag/promotion forbidden');
 if(plan.core?.version!=='0.10.20'||!hex40(plan.core?.sha)||!hex64(plan.core?.routerSha)||plan.core?.acceptedBrain!=='MAIN_R29'||!hex64(plan.core?.brainSha))deny('BASELINE','exact accepted Core and Brain required');
 const seen=new Set();
 if(!Array.isArray(plan.components)||plan.components.length!==3)deny('COMPONENTS','three exact UI components required');
 for(const c of Array.isArray(plan.components)?plan.components:[]){
  if(!sources.has(c.id)||seen.has(c.id)||!hex40(c.sha)||!Number.isInteger(c.pr)||!/^[\w-]+\/[\w-]+$/.test(c.repo||''))deny('SOURCE_'+String(c.id),'exact reviewed commit missing');
  seen.add(c.id);
  if(c.merged!==true)deny('REVIEW_'+c.id,'PR draft/unmerged');
  if(c.visualAccepted!==true)deny('NATIVE_'+c.id,'real GUI validation pending');
  if(c.signatureValid!==true)deny('SIGN_'+c.id,'trusted signature not verified');
  if(c.rollbackAccepted!==true)deny('ROLLBACK_'+c.id,'canary rollback not accepted');
 }
 if(seen.size!==3||plan.components?.find(x=>x.id==='browser')?.version!=='0.8.2')deny('VERSION','Browser v0.8.2 candidate/version required');
 const hosts=Array.isArray(plan.hosts)?plan.hosts:[];
 if(hosts.length!==4)deny('FOUR_HOSTS','four hosts required');
 const seenHost=new Set();
 for(const h of hosts){
  if(!required.has(h.id)||seenHost.has(h.id)||h.os!==required.get(h.id)){deny('HOST_ID','duplicate/unrecognized OS');continue;}
  seenHost.add(h.id);
  if(h.connected!==true)deny('CONNECT_'+h.id,'online host with current receipt required');
  if(h.nativeGUIAccepted!==true||h.uncertain===true)deny('GUI_'+h.id,'Native STOP/Mutex uncertain or unvalidated');
  if(h.browserLease===true)deny('LEASE_'+h.id,'do not interrupt browser session');
  if(h.browserInstalled!==true||h.controlInstalled!==true)deny('INSTALL_'+h.id,'two UI components not accepted installed');
  if(h.ownerAccepted!==true||h.sessionPreserved!=='CONFIRMED')deny('OWNER_'+h.id,'session privacy/owner acceptance absent');
  if(!hex64(h.rollbackSha))deny('ROLLBACK_HOST_'+h.id,'rollback receipt hash absent');
  if(h.id==='mmz-linux'&&(h.localSudoRequired===true||h.sourceRootMissing===true||h.scope!=='Commander+Browser only'))deny('MMZ_LOCAL','source missing and owner-local sudo still required');
 }
 if(seenHost.size!==4)deny('HOST_COUNT','all mandatory host identities required');
 for(const key of gates)if(plan.gates?.[key]!==true)deny('GATE_'+key,'independent acceptance missing');
 if(!Array.isArray(plan.signedArtifacts)||plan.signedArtifacts.length<4)deny('ARTIFACTS','complete signed SHA-pinned Windows/Linux installers absent');
 else for(const a of plan.signedArtifacts)if(!hex64(a.sha256)||a.ownerAccepted!==true||a.signatureStatus!=='Valid')deny('ARTIFACT_SIGNATURE','invalid signed asset evidence');
 block.sort((a,b)=>a.gate.localeCompare(b.gate));
 return {schema:1,release:'UI_R40',status:'BLOCKED',promotionAuthorized:false,openChecks:block.length,blockers:block,
  note:'R40 is an evidence-only admission report. Production promotion is not implemented even if this diagnostic has zero blockers. A different independently accepted signed updater is required.'};
}
function load(){const b=fs.readFileSync(input);return {manifest:JSON.parse(b),sha256:sha(b)}}
function selfTest(){
 const {manifest:p}=load(),r=evaluate(p);
 if(r.status!=='BLOCKED'||r.openChecks<20||r.promotionAuthorized)throw Error('R40_BASELINE_SHOULD_BLOCK');
 const copy=x=>JSON.parse(JSON.stringify(x));
 const a=copy(p);a.hosts.pop();
 if(!evaluate(a).blockers.some(x=>x.gate==='FOUR_HOSTS'))throw Error('R40_HOST_MISSING_NOT_BLOCKED');
 const b=copy(p);b.releaseTag='ui-v0.8.2';b.automaticPromotionAuthorized=true;
 if(!evaluate(b).blockers.some(x=>x.gate==='NO_AUTOPROMOTION'))throw Error('R40_FORGED_PROMOTION');
 const c=copy(p);c.hosts[1].browserLease=true;
 if(!evaluate(c).blockers.some(x=>x.gate==='LEASE_emad-windows'))throw Error('R40_LEASE');
 const d=copy(p);d.hosts[3].connected=true;
 if(!evaluate(d).blockers.some(x=>x.gate==='MMZ_LOCAL'))throw Error('R40_MMZ_SUDO');
 console.log('R40_FAIL_CLOSED_SELFTEST_PASS openChecks='+r.openChecks);
}
if(require.main===module){
 const mode=process.argv[2];
 if(mode==='--self-test')selfTest();
 else if(mode==='--evaluate'){const loaded=load();console.log(JSON.stringify({...evaluate(loaded.manifest),manifestSha256:loaded.sha256},null,2));}
 else if(mode==='--assert-blocked'){const r=evaluate(load().manifest);if(r.promotionAuthorized||r.openChecks<1)process.exit(72);console.log('R40_RELEASE_CORRECTLY_BLOCKED openChecks='+r.openChecks);}
 else if(['--release','--install','--promote'].includes(mode)){console.error('R40_DO_NOT_PROMOTE — evidence-only gate; no host was modified');process.exit(73);}
 else{console.error('Use --evaluate | --assert-blocked | --self-test; automatic deployment is not available');process.exit(2);}
}
module.exports={evaluate,load};