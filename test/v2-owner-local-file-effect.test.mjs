import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {reconcileV2OwnerLocalDiagnosticEffect} from '../src/v2-owner-local-file-effect.mjs';
const content='AliEmad owner-local Worker -> MMZ central via encrypted tailnet, isolated 2026-10-31';
const digest=createHash('sha256').update(content).digest('hex');
const route={hostId:'aliemad-Labtop',principalId:'aliemad',profileId:'owner',
 conversationId:'local-v2-diagnostic',operationId:'ali-tailnet-proof-20261031',
 target:{kind:'workflow-root',id:'commander-v2-diagnostic'}};
const row={committed:true,receiptId:route.operationId,digest,fence:1};
function client(){return {getFencedReceipt:async()=>row,observePrivateArtifact:async()=>row};}
async function homeFixture(t){
 const root=await mkdtemp(join(tmpdir(),'rcv2-effect-'));
 const worker=join(root,'.local','share','CommanderV2','Worker');
 await mkdir(worker,{recursive:true,mode:0o700});
 t.after(()=>rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:50}));
 return {root,worker,dest:join(worker,'effects',route.operationId+'.artifact')};
}
test('real physical file bytes are exactly checked against Coordinator receipt',async t=>{
 const f=await homeFixture(t);
 const result=await reconcileV2OwnerLocalDiagnosticEffect({client:client(),route,content,ownerHome:f.root});
 assert.equal(result.ownerLocalFileVerified,true);
 assert.equal(result.privateCoordinatorReceiptVerified,true);
 assert.equal(result.generalDesktopOrBrowserEffectVerified,false);
 assert.equal(result.chatGPTOAuthVerified,false);
 assert.equal(result.digest,digest);
 assert.equal(result.replayed,false);
 assert.equal(await readFile(f.dest,'utf8'),content);
 const repeat=await reconcileV2OwnerLocalDiagnosticEffect({client:client(),route,content,ownerHome:f.root});
 assert.equal(repeat.replayed,true);
 assert.equal(await readFile(f.dest,'utf8'),content);
});
test('absent/mismatched Coordinator proof refuses any physical local effect',async t=>{
 const f=await homeFixture(t);
 for(const obj of [
  {getFencedReceipt:async()=>null,observePrivateArtifact:async()=>null},
  {getFencedReceipt:async()=>row,observePrivateArtifact:async()=>({...row,digest:'e'.repeat(64)})},
  {getFencedReceipt:async()=>({...row,committed:false}),observePrivateArtifact:async()=>row}
 ]){
  await assert.rejects(reconcileV2OwnerLocalDiagnosticEffect({client:obj,route,content,ownerHome:f.root}),
    {code:'V2_OWNER_LOCAL_EFFECT_CENTRAL_PROOF_REQUIRED'});
 }
 await assert.rejects(readFile(f.dest),{code:'ENOENT'});
});
test('route pinning and input bounds fail before remote calls',async t=>{
 const f=await homeFixture(t);
 for(const r of [{...route,conversationId:'user-chat'},{...route,hostId:'forged'},
  {...route,operationId:'other-operation'},{...route,target:{kind:'host-shell',id:'commander-v2-diagnostic'}}]){
  await assert.rejects(reconcileV2OwnerLocalDiagnosticEffect({client:client(),route:r,content,ownerHome:f.root}),
   {code:'V2_OWNER_LOCAL_EFFECT_ROUTE_NOT_APPROVED'});
 }
 await assert.rejects(reconcileV2OwnerLocalDiagnosticEffect({client:client(),route,content:'',ownerHome:f.root}),
  {code:'V2_OWNER_LOCAL_EFFECT_TRUSTED_INPUT_REQUIRED'});
});
test('mutated local file is never silently overwritten or reported verified',async t=>{
 const f=await homeFixture(t);
 await reconcileV2OwnerLocalDiagnosticEffect({client:client(),route,content,ownerHome:f.root});
 await writeFile(f.dest,'tampered bytes');
 await assert.rejects(reconcileV2OwnerLocalDiagnosticEffect({client:client(),route,content,ownerHome:f.root}),
  {code:'V2_OWNER_LOCAL_EFFECT_LOCAL_TAMPER_DETECTED'});
 assert.equal(await readFile(f.dest,'utf8'),'tampered bytes');
});
test('symlinked effect root is rejected rather than used',async t=>{
 const f=await homeFixture(t);
 const parent=join(f.worker,'elsewhere');
 await mkdir(parent,{mode:0o700});
 try{
  await symlink(parent,join(f.worker,'effects'),'dir');
 }catch(e){
  // Windows standard owner sessions may lack SeCreateSymbolicLinkPrivilege.
  // A junction is still an NTFS reparse-point alias and must be rejected.
  if(process.platform!=='win32'||e.code!=='EPERM')throw e;
  await symlink(parent,join(f.worker,'effects'),'junction');
 }
 await assert.rejects(reconcileV2OwnerLocalDiagnosticEffect({client:client(),route,content,ownerHome:f.root}),
  {code:'V2_OWNER_LOCAL_EFFECT_ROOT_UNTRUSTED'});
});
test('Coordinator post-commit change prevents claiming verified effect',async t=>{
 const f=await homeFixture(t);let reads=0;
 const changing={
  getFencedReceipt:async()=>++reads===1?row:{...row,fence:2},
  observePrivateArtifact:async()=>row
 };
 await assert.rejects(reconcileV2OwnerLocalDiagnosticEffect({client:changing,route,content,ownerHome:f.root}),
  {code:'V2_OWNER_LOCAL_EFFECT_CENTRAL_RECHECK_FAILED'});
 assert.equal(await readFile(f.dest,'utf8'),content);
});
