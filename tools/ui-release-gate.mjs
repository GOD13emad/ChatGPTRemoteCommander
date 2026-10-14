#!/usr/bin/env node
// R47 read-only safety preflight; no network, installer, shell or auto-promotion.
import fs from 'node:fs';
import path from 'node:path';
export const PRODUCTS=['browser','windows-control-center','linux-control-center'];
export const HOSTS=['windows-primary','windows-secondary','linux-primary','linux-secondary'];
export const GATES=[
 'G1_NATIVE_GUI_STOP_MUTEX','G2_NATIVE_CEF_BROWSER','G3_CONTROL_CENTER_NATIVE',
 'G4_SMART_WORKFLOW_JOURNAL','G5_RUNNER_SAME_CHAT_ACK','G6_LINUX_SANDBOX_MMZ',
 'G7_GAME_VIDEO_OWNER_ACCEPTANCE','G8_SIGNED_INSTALL_ROLLBACK'];
const h40=/^[0-9a-f]{40}$/,h64=/^[0-9a-f]{64}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const has=(x,k)=>object(x)&&Object.hasOwn(x,k);
function requireFact(p,id){if(!p)throw Error('INVALID_UI_RELEASE_MANIFEST:'+id);}
function exactKeys(o,keys){return object(o)&&Object.keys(o).length===keys.length&&keys.every(k=>has(o,k));}
const systems={'windows-primary':'windows','windows-secondary':'windows','linux-primary':'linux','linux-secondary':'linux'};
export function evaluate(m){
 requireFact(object(m)&&m.schema===1&&m.campaign==='RC_UI_R47','IDENTITY');
 requireFact(m.phase==='candidate'&&m.productionPromoted===false,'CANDIDATE_ONLY');
 requireFact(object(m.baseline)&&m.baseline.coreVersion==='0.10.20'&&h64.test(m.baseline.lastAcceptedBrainSha256),'BASELINE');
 requireFact(exactKeys(m.components,PRODUCTS),'COMPONENT_SET');
 const issues=[];
 for(const id of PRODUCTS){
  const c=m.components[id];
  requireFact(object(c)&&c.id===id&&h40.test(c.commit),'SOURCE_'+id);
  requireFact(['GOD13emad/ChatGPTRemoteCommander','Usefull-Skills/chatgpt-cef-linux'].includes(c.repository),'REPO_'+id);
  requireFact(['0.8.2','0.10.20'].includes(c.version),'VERSION_'+id);
  requireFact(object(c.ci)&&['PASS','OPEN','FAILED'].includes(c.ci.status),'CI_'+id);
  if(c.ci.status==='PASS')requireFact(Array.isArray(c.ci.workflowRuns)&&c.ci.workflowRuns.length>0&&c.ci.workflowRuns.every(n=>Number.isInteger(n)&&n>0),'CI_EVIDENCE_'+id);
  requireFact(has(c,'stableArtifactSha256')&&(c.stableArtifactSha256===null||h64.test(c.stableArtifactSha256)),'STABLE_SHA_'+id);
  if(c.ci.status!=='PASS')issues.push('COMPONENT:'+id+':CI');
  if(c.stableArtifactSha256===null)issues.push('COMPONENT:'+id+':STABLE_ARTIFACT_MISSING');
 }
 requireFact(Array.isArray(m.hosts)&&m.hosts.length===4,'FOUR_HOSTS');
 const seen=new Set();
 for(const h of m.hosts){
  requireFact(object(h)&&HOSTS.includes(h.id)&&!seen.has(h.id),'HOST_IDENTITY');
  seen.add(h.id);requireFact(h.platform===systems[h.id],'HOST_PLATFORM_'+h.id);
  for(const key of ['connected','ownerVisualAccepted','rollbackReceiptAccepted',h.platform==='windows'?'trustedCodeSignature':'runtimeSandboxAccepted']){
   requireFact(typeof h[key]==='boolean','HOST_FIELD_'+h.id+'_'+key);
   if(h[key]===false)issues.push('HOST:'+h.id+':'+key);
  }
 }
 requireFact(exactKeys(m.gates,GATES),'PRODUCT_GATES');
 for(const id of GATES){
  const g=m.gates[id];requireFact(object(g)&&['OPEN','PASS'].includes(g.status),'GATE_STATUS_'+id);
  if(g.status==='PASS')requireFact(object(g.evidence)&&h64.test(g.evidence.sha256)&&typeof g.evidence.reference==='string'&&/^(https:\/\/github\.com\/|sha256:|local-audit:)/.test(g.evidence.reference),'GATE_EVIDENCE_'+id);
  if(g.status==='OPEN')issues.push('CRITICAL:'+id);
 }
 requireFact(has(m,'independentReleaseAttestation')&&m.independentReleaseAttestation===null,'UNTRUSTED_RELEASE_ATTESTATION');
 return {schema:1,campaign:m.campaign,status:issues.length?'BLOCKED':'AWAITING_INDEPENDENT_RELEASE_ATTESTATION',
  blockers:[...new Set(issues)].sort(),openCriticalGates:GATES.filter(g=>m.gates[g].status==='OPEN'),hostsChecked:seen.size,
  automaticDeploymentAuthorized:false,productionPromoted:false,policy:'READ_ONLY_DIAGNOSTIC_NEVER_RELEASE_AUTHORITY'};
}
if(process.argv[1]&&path.basename(process.argv[1])==='ui-release-gate.mjs'){
 const a=process.argv.slice(2);
 if((a.length!==2&&a.length!==3)||a[0]!=='--manifest'||(a[2]&&a[2]!=='--require-ready')){
  console.error('USAGE --manifest FILE [--require-ready]');process.exitCode=2;
 }else{
  try{const r=evaluate(JSON.parse(fs.readFileSync(path.resolve(a[1]),'utf8')));
   console.log(JSON.stringify(r,null,2));if(a[2]==='--require-ready')process.exitCode=3;
  }catch(e){console.error(String(e.message||e));process.exitCode=2;}
 }
}
