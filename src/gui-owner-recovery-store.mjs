// Candidate only: explicit owner review, not expiry/restart or automatic retry.
// The original UNKNOWN evidence is never deleted, renamed or marked applied.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createGuiInputIncidentStore} from './gui-incident-store.mjs';

const fail=()=>Object.assign(new Error('GUI_OWNER_RECOVERY_UNVERIFIED'),
  {guiCode:'GUI_OWNER_RECOVERY_UNVERIFIED'});
const sha=b=>createHash('sha256').update(b).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const productRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function guiRecoverySourceIdentity(root=productRoot){
  const files=['src/gui-owner-recovery-store.mjs','src/gui-incident-store.mjs',
    'src/gui-tools-windows.mjs','tools/gui-owner-recovery.ps1',
    'tools/gui-owner-recovery-inspect.mjs'];
  const entries=[];
  for(const name of files)entries.push([name,sha(await fs.readFile(path.join(root,name)))]);
  return sha(JSON.stringify(entries));
}
async function safeRead(file,max=8192){
  const a=await fs.lstat(file);
  if(!a.isFile()||a.isSymbolicLink()||a.nlink!==1||a.size<1||a.size>max)throw fail();
  const bytes=await fs.readFile(file);
  const b=await fs.lstat(file);
  if(a.ino!==b.ino||a.dev!==b.dev||a.size!==b.size||a.mtimeMs!==b.mtimeMs||
     b.isSymbolicLink()||b.nlink!==1||bytes.length!==a.size)throw fail();
  return {bytes,hash:sha(bytes),record:JSON.parse(bytes.toString('utf8'))};
}
export function createOwnerReviewedGuiStore({
  legacyFile=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),
    'chatgpt-remote-commander','gui-pending-native-input-v1.json'),
  root=productRoot,host=os.hostname(),user=os.userInfo().username,
  sourceIdentity=()=>guiRecoverySourceIdentity(root),now=()=>Date.now()
}={}){
  // Linux is outside this repair; its existing path/policy stays unchanged.
  if(!path.isAbsolute(legacyFile)||!path.isAbsolute(root))throw fail();
  const folder=path.dirname(legacyFile);
  const receiptFile=path.join(folder,'gui-owner-recovery-v1.json');
  const legacy=createGuiInputIncidentStore({file:legacyFile});
  const issued=new WeakMap();
  let admittedReceipt=null;
  async function choose(){
    let receipt;
    try {receipt=await safeRead(receiptFile);}
    catch(e){if(e.code==='ENOENT'&&!admittedReceipt)return {store:legacy,epoch:'legacy'};throw fail();}
    try{
      if(admittedReceipt&&admittedReceipt!==receipt.hash)throw fail();
      const r=receipt.record;
      const old=await safeRead(legacyFile,2048);
      const i=old.record;
      if(r.schema!=='rc-gui-owner-recovery-v1'||r.decision!=='OWNER_REVIEWED_FRESH_INPUT_ONLY'||
         r.historicalOutcome!=='UNKNOWN_NO_REPLAY'||r.noReplay!==true||
         r.reviewMethod!=='LOCAL_INTERACTIVE_BUTTON'||r.host!==host||r.user!==user||
         r.sourceRoot!==root||r.sourceSha256!==await sourceIdentity()||
         !uuid.test(r.epoch)||i.schema!=='rc-gui-pending-input-v1'||
         i.status!=='PENDING_NATIVE_EFFECT'||i.id!==r.incidentId||
         i.tool!==r.incidentTool||old.hash!==r.incidentSha256||
         !Number.isFinite(Date.parse(r.reviewedUtc))||!Number.isFinite(Date.parse(i.startedUtc))||
         Date.parse(r.reviewedUtc)<Date.parse(i.startedUtc)||
         Date.parse(r.reviewedUtc)>now()+30000||
         r.quiescence?.nativeMutexAcquired!==true||
         r.quiescence?.guiBusy!==false||r.quiescence?.guiLeased!==false)
        throw fail();
      // Also use the original parser. Corrupt or unsupported legacy tools fail closed.
      const original=await legacy.pending();
      if(!original||original.id!==r.incidentId)throw fail();
      admittedReceipt=receipt.hash;
      return {store:createGuiInputIncidentStore({file:path.join(folder,
        'gui-pending-reviewed-'+r.epoch+'.json')}),epoch:r.epoch,
        historical:{incidentId:i.id,incidentTool:i.tool,incidentSha256:old.hash,
          historicalOutcome:'UNKNOWN_NO_REPLAY',ownerReviewedUtc:r.reviewedUtc}};
    }catch{throw fail();}
  }
  return {
    async pending(){return (await choose()).store.pending();},
    async recoveryState(){
      const x=await choose();
      return x.historical?{ownerRecovery:true,...x.historical}:
        {ownerRecovery:false};
    },
    async begin(tool){
      const x=await choose();
      const inner=await x.store.begin(tool);
      const handle=Object.freeze({id:inner.id,tool:inner.tool});
      issued.set(handle,{inner,epoch:x.epoch,store:x.store});
      return handle;
    },
    async resolve(handle){
      const own=issued.get(handle);
      if(!own)throw fail();
      const current=await choose();
      if(current.epoch!==own.epoch)throw fail();
      await own.store.resolve(own.inner);
      issued.delete(handle);
    }
  };
}
