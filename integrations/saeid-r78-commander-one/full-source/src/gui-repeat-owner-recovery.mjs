// Source candidate only. No receipt writer, remote reset, expiry or input replay.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createGuiInputIncidentStore} from './gui-incident-store.mjs';

const rootDefault=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const digest=b=>createHash('sha256').update(b).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash=/^[a-f0-9]{64}$/;
const fail=()=>Object.assign(new Error('GUI_REPEAT_REVIEW_UNVERIFIED'),{guiCode:'GUI_REPEAT_REVIEW_UNVERIFIED'});
export function repeatOwnerReviewReady({proposal,root,activeRoot,status,configHash,port,host,gui,stopPresent,mode,plan}){
  return !!proposal&&proposal.sourceRoot===root&&root===activeRoot&&
    status.configSha256===configHash&&status.port===port&&status.deviceName===host&&
    gui.busy===false&&gui.leased===false&&gui.reason==='GUI_INCIDENT_REVIEW_REQUIRED'&&
    gui.readOnlyAvailable===true&&gui.inputAvailable===false&&stopPresent===false&&
    gui.incident?.id===proposal.incidentId&&mode?.enabled===true&&mode.mode==='repeat-owner-review-v2'&&
    mode.anchorFile===plan.anchorFile&&mode.anchorSha256===plan.anchorSha256&&
    JSON.stringify(mode.preservePins)===JSON.stringify(plan.preservePins)&&
    JSON.stringify(mode.inheritedStopFiles)===JSON.stringify(plan.inheritedStopFiles);
}
async function safeRead(file,max=16384){
  // Refuse linked directories as well as linked/multiply-linked files.
  for(let p=path.dirname(file);;p=path.dirname(p)){
    const s=await fs.lstat(p);if(!s.isDirectory()||s.isSymbolicLink())throw fail();
    if(path.dirname(p)===p)break;
  }
  const a=await fs.lstat(file);
  if(!a.isFile()||a.isSymbolicLink()||a.nlink!==1||a.size<1||a.size>max)throw fail();
  const bytes=await fs.readFile(file),b=await fs.lstat(file);
  if(a.ino!==b.ino||a.dev!==b.dev||a.size!==b.size||a.mtimeMs!==b.mtimeMs||
    b.isSymbolicLink()||b.nlink!==1||bytes.length!==a.size)throw fail();
  return {bytes,sha256:digest(bytes),record:JSON.parse(bytes.toString('utf8'))};
}
export async function repeatRecoverySourceIdentity(root=rootDefault){
  const names=['src/gui-repeat-owner-recovery.mjs','src/gui-incident-store.mjs',
    'src/gui-tools-windows.mjs','tools/gui-repeat-owner-review.ps1',
    'tools/gui-repeat-owner-inspect.mjs','tools/gui-control.ps1',
    'tools/gui-native.cs','src/gui-process.mjs','src/gui-contract.mjs'];
  return digest(JSON.stringify(await Promise.all(names.map(async n=>[n,digest(await fs.readFile(path.join(root,n)))]))));
}
export function createRepeatOwnerReviewedGuiStore({anchorFile,anchorSha256,preservePins=[],
  root=rootDefault,folder=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),
    'chatgpt-remote-commander','gui-owner-recovery-v2'),host=os.hostname(),user=os.userInfo().username,
  sourceIdentity=()=>repeatRecoverySourceIdentity(root),now=()=>Date.now()}={}){
  if(!path.isAbsolute(anchorFile||'')||!path.isAbsolute(root)||!path.isAbsolute(folder)||
    !hash.test(anchorSha256||'')||!Array.isArray(preservePins)||preservePins.length>32||
    preservePins.some(p=>!path.isAbsolute(p.path||'')||!hash.test(p.sha256||'')))throw fail();
  const issued=new WeakMap(),admitted=new Map();
  let pinnedSource=null;
  async function choose(){
    try{
      const source=await sourceIdentity();if(!hash.test(source)||pinnedSource&&source!==pinnedSource)throw fail();
      const anchor=await safeRead(anchorFile,2048);if(anchor.sha256!==anchorSha256)throw fail();
      for(const p of preservePins)if((await safeRead(p.path,262144)).sha256!==p.sha256)throw fail();
      let currentFile=anchorFile,epoch='anchor',parent=null,reviewedUtc=null,depth=0;
      const epochs=new Set(),visited=new Set();
      while(depth<=32){
        const store=createGuiInputIncidentStore({file:currentFile});
        const pending=await store.pending();
        if(!pending){
          if([...admitted.keys()].some(k=>!visited.has(k)))throw fail();
          pinnedSource=source;
          return {store,epoch,source,depth,reviewedUtc,pending:null,currentFile};
        }
        if(!uuid.test(pending.id))throw fail();
        const intent=await safeRead(currentFile,2048);
        const receiptFile=path.join(folder,source,'review-'+pending.id+'.json');
        let receipt;
        try{receipt=await safeRead(receiptFile);}catch(e){
          if(e.code!=='ENOENT'||admitted.has(receiptFile)||[...admitted.keys()].some(k=>!visited.has(k)))throw fail();
          pinnedSource=source;
          return {store,epoch,source,depth,reviewedUtc,pending,currentFile,
            proposal:{receiptFile,incidentId:pending.id,incidentTool:pending.tool,
              incidentSha256:intent.sha256,incidentFile:currentFile,startedUtc:pending.startedUtc,
              parentReviewSha256:parent,parentEpoch:epoch,sourceRoot:root,sourceSha256:source,host,user}};
        }
        const r=receipt.record;
        if(r.schema!=='rc-gui-repeat-owner-review-v2'||r.decision!=='OWNER_REVIEWED_FRESH_INPUT_ONLY'||
          r.historicalOutcome!=='UNKNOWN_NO_REPLAY'||r.noReplay!==true||
          r.reviewMethod!=='LOCAL_INTERACTIVE_BUTTON'||r.deliberateGuiHelperRestart!==true||
          r.host!==host||r.user!==user||r.sourceRoot!==root||r.sourceSha256!==source||
          r.incidentId!==pending.id||r.incidentTool!==pending.tool||
          r.incidentSha256!==intent.sha256||r.incidentFile!==currentFile||
          r.parentEpoch!==epoch||r.parentReviewSha256!==parent||!uuid.test(r.epoch)||epochs.has(r.epoch)||
          !Number.isFinite(Date.parse(r.reviewedUtc))||!Number.isFinite(Date.parse(pending.startedUtc))||
          Date.parse(r.reviewedUtc)<Date.parse(pending.startedUtc)||Date.parse(r.reviewedUtc)>now()+30000||
          reviewedUtc&&Date.parse(r.reviewedUtc)<Date.parse(reviewedUtc)||
          r.quiescence?.nativeMutexAcquired!==true||r.quiescence.guiBusy!==false||r.quiescence.guiLeased!==false||
          admitted.has(receiptFile)&&admitted.get(receiptFile)!==receipt.sha256)throw fail();
        admitted.set(receiptFile,receipt.sha256);visited.add(receiptFile);epochs.add(r.epoch);
        parent=receipt.sha256;epoch=r.epoch;reviewedUtc=r.reviewedUtc;depth++;
        currentFile=path.join(folder,source,'intent-'+epoch+'.json');
      }
      throw fail();
    }catch{throw fail();}
  }
  return {
    async pending(){return (await choose()).pending;},
    async reviewPlan(){const c=await choose();return c.proposal??null;},
    async recoveryState(){const c=await choose();return {ownerReviewEpoch:c.epoch,
      ownerReviewDepth:c.depth,ownerReviewedUtc:c.reviewedUtc,ownerReviewSourceSha256:c.source,
      historicalOutcome:'UNKNOWN_NO_REPLAY',deliberateGuiHelperRestart:c.depth>0};},
    async begin(tool){const c=await choose(),inner=await c.store.begin(tool);
      const handle=Object.freeze({id:inner.id,tool:inner.tool});issued.set(handle,{inner,epoch:c.epoch,store:c.store});return handle;},
    async resolve(handle){const own=issued.get(handle);if(!own)throw fail();
      const c=await choose();if(c.epoch!==own.epoch)throw fail();await own.store.resolve(own.inner);issued.delete(handle);}
  };
}
