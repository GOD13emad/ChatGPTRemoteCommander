// Narrow physical owner-local diagnostic effect, authenticated by an existing
// cross-host coordinator receipt + immutable private Coordinator artifact.
// This is never a general shell/GUI/browser effect, or ChatGPT OAuth evidence.
import {mkdir,lstat,readFile,writeFile,link,unlink} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {normalizeV2Route} from './v2-routing-contract.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
async function plainFile(file){
 const s=await lstat(file);
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>6144)
  fail('V2_OWNER_LOCAL_EFFECT_FILE_UNTRUSTED');
 if(process.platform!=='win32' && (s.mode&0o077)!==0)
  fail('V2_OWNER_LOCAL_EFFECT_FILE_PERMISSIONS');
 return readFile(file);
}
async function ensureOwnerFolder(root){
 const st=await lstat(root);
 if(!st.isDirectory()||st.isSymbolicLink()||
   (process.platform!=='win32' && ((st.mode&0o077)!==0||st.uid!==process.getuid())))
  fail('V2_OWNER_LOCAL_EFFECT_ROOT_UNTRUSTED');
}
export async function reconcileV2OwnerLocalDiagnosticEffect({
  client,route,content,ownerHome=homedir()
}={}){
 const r=normalizeV2Route(route);
 if(r.target.kind!=='workflow-root'||r.target.id!=='commander-v2-diagnostic'||
    r.conversationId!=='local-v2-diagnostic'||r.operationId!=='ali-tailnet-proof-20261031'||
    r.hostId!=='aliemad-Labtop'||r.principalId!=='aliemad'||
    r.profileId!=='owner')
  fail('V2_OWNER_LOCAL_EFFECT_ROUTE_NOT_APPROVED');
 if(typeof client?.getFencedReceipt!=='function'||
    typeof client?.observePrivateArtifact!=='function'||
    typeof content!=='string'||Buffer.byteLength(content,'utf8')<1||
    Buffer.byteLength(content,'utf8')>4096)
  fail('V2_OWNER_LOCAL_EFFECT_TRUSTED_INPUT_REQUIRED');
 if(typeof ownerHome!=='string'||!isAbsolute(ownerHome))
  fail('V2_OWNER_LOCAL_EFFECT_HOME_INVALID');
 const receipt=await client.getFencedReceipt({route:r,receiptId:r.operationId});
 const observed=await client.observePrivateArtifact({route:r,receiptId:r.operationId});
 const expected=sha(Buffer.from(content,'utf8'));
 if(!receipt||!observed||receipt.committed!==true||observed.committed!==true||
   receipt.receiptId!==r.operationId||observed.receiptId!==r.operationId||
   receipt.digest!==expected||observed.digest!==expected||
   !Number.isSafeInteger(receipt.fence)||receipt.fence<1||
   receipt.fence!==observed.fence)
  fail('V2_OWNER_LOCAL_EFFECT_CENTRAL_PROOF_REQUIRED');
 const worker=join(ownerHome,'.local','share','CommanderV2','Worker');
 await ensureOwnerFolder(worker);
 const folder=join(worker,'effects');
 await mkdir(folder,{mode:0o700,recursive:false}).catch(e=>{
  if(e.code!=='EEXIST')throw e;
 });
 await ensureOwnerFolder(folder);
 const dest=join(folder,r.operationId+'.artifact');
 let replayed=false;
 const tmp=join(folder,'.'+randomUUID()+'.pending');
 try{
  await writeFile(tmp,content,{flag:'wx',mode:0o600});
  if(sha(await plainFile(tmp))!==expected)fail('V2_OWNER_LOCAL_EFFECT_PRECOMMIT_HASH');
  try{await link(tmp,dest);}catch(e){
   if(e.code!=='EEXIST')throw e;
   replayed=true;
  }
 }finally{
  await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});
 }
 const bytes=await plainFile(dest);
 if(sha(bytes)!==expected)
  fail('V2_OWNER_LOCAL_EFFECT_LOCAL_TAMPER_DETECTED');
 // Re-observe Coordinator evidence after physical write before claiming proof.
 const post=await client.getFencedReceipt({route:r,receiptId:r.operationId});
 if(post?.committed!==true||post.digest!==expected||post.fence!==receipt.fence)
  fail('V2_OWNER_LOCAL_EFFECT_CENTRAL_RECHECK_FAILED');
 return Object.freeze({
  schema:1,state:'OWNER_LOCAL_DIAGNOSTIC_FILE_VERIFIED',
  hostId:r.hostId,operationId:r.operationId,
  privateCoordinatorReceiptVerified:true,ownerLocalFileVerified:true,
  digest:expected,fence:receipt.fence,replayed,
  generalDesktopOrBrowserEffectVerified:false,chatGPTOAuthVerified:false
 });
}
