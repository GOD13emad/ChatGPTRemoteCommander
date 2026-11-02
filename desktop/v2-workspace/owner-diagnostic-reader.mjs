// Optional native-owner *diagnostic* Coordinator reader.
// Never ChatGPT OAuth, desktop/browser success, or arbitrary receipt access.
import {hostname,homedir,platform,userInfo} from 'node:os';
import {lstat,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const SPEC=Object.freeze({
 'aliemad-Labtop':Object.freeze({username:'aliemad',module:'Worker',
  port:48789,token:'worker/mmz-coordinator.token',
  operationId:'ali-tailnet-proof-20261031'}),
 'mmz-LOQ-15IRX9':Object.freeze({username:'mmz',module:'Coordinator',
  port:48787,token:'coordinator/owner-worker.token',operationId:'proof-20261031'})
});
const PINNED=Object.freeze({
 'v2-coordinator-rpc-client.mjs':'0378b222ab848fb2e99aa74abde4b7c8131cf7af4773c26d03d5e895c0924952',
 'v2-routing-contract.mjs':'63d089ed43adf1918d3c11afcf96efb217d3c236428c7469deea31577a0479a4'
});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const deny=()=>{throw Error('V2_OWNER_DIAGNOSTIC_PROOF_UNVERIFIED');};
async function ownerFile(file,uid,maxBytes,privateFile=false){
 const st=await lstat(file);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.uid!==uid||
    (privateFile&&(st.mode&0o077)!==0)||st.size<1||st.size>maxBytes)deny();
 return readFile(file);
}
export function createV2DiagnosticProofReaders({client,route}={}){
 if(typeof client?.getFencedReceipt!=='function'||
    typeof client?.observePrivateArtifact!=='function'||
    typeof route?.operationId!=='string')deny();
 async function proof(){
  const [receipt,artifact]=await Promise.all([
   client.getFencedReceipt({route,receiptId:route.operationId}),
   client.observePrivateArtifact({route,receiptId:route.operationId})
  ]);
  if(receipt?.committed!==true||artifact?.committed!==true||
     receipt.receiptId!==route.operationId||artifact.receiptId!==route.operationId||
     receipt.digest!==artifact.digest||receipt.fence!==artifact.fence||
     typeof receipt.digest!=='string'||!/^[a-f0-9]{64}$/.test(receipt.digest)||
     !Number.isSafeInteger(receipt.fence)||receipt.fence<1)deny();
  return Object.freeze({digest:receipt.digest,fence:receipt.fence});
 }
 return Object.freeze({
  trustedReceiptReader:async()=>{
   const p=await proof();
   return {schema:1,source:'V2_CENTRAL_COORDINATOR',
    state:'COMMITTED_FENCED_RECEIPT',workflowId:'commander-v2-diagnostic',
    receiptId:route.operationId,digest:p.digest,fence:p.fence,
    coordinatorCommitted:true,workerEffectVerified:false};
  },
  trustedPrivateArtifactReader:async()=>{
   const p=await proof();
   return {schema:1,source:'V2_PRIVATE_ARTIFACT_ACTUATOR',
    state:'PRIVATE_ARTIFACT_HASH_VERIFIED',workflowId:'commander-v2-diagnostic',
    receiptId:route.operationId,digest:p.digest,fence:p.fence,
    coordinatorCommitted:true,privateArtifactVerified:true,
    workerEffectVerified:false};
  }
 });
}
export async function createV2OwnerDiagnosticReaders({
 currentHost=hostname(),currentUser=userInfo().username,currentPlatform=platform(),
 home=homedir(),uid=typeof process.getuid==='function'?process.getuid():null,
 importRpc=async file=>import(pathToFileURL(file).href)
}={}){
 const config=SPEC[currentHost];
 // Windows is NOT enrolled. The root/SYSTEM process may not borrow an owner.
 if(currentPlatform!=='linux'||!config||currentUser!==config.username||
    !Number.isSafeInteger(uid)||uid===0||typeof importRpc!=='function')return null;
 const src=join(home,'.local','share','CommanderV2',config.module,'src');
 const tokenFile=join(home,'.config','CommanderV2',config.token);
 let rpc;
 try{
  for(const [name,pin]of Object.entries(PINNED)){
   if(hash(await ownerFile(join(src,name),uid,30000))!==pin)return null;
  }
  // Only validate native-owner ACL at bootstrap, not expose the token.
  await ownerFile(tokenFile,uid,256,true);
  rpc=await importRpc(join(src,'v2-coordinator-rpc-client.mjs'));
  if(typeof rpc?.createV2CoordinatorRpcClient!=='function')return null;
 }catch{return null;}
 const route=Object.freeze({
  hostId:currentHost,principalId:config.username,profileId:'owner',
  conversationId:'local-v2-diagnostic',operationId:config.operationId,
  target:Object.freeze({kind:'workflow-root',id:'commander-v2-diagnostic'})
 });
 const client=rpc.createV2CoordinatorRpcClient({
  endpoint:'http://127.0.0.1:'+config.port,
  tokenProvider:async()=> (await ownerFile(tokenFile,uid,256,true)).toString('utf8'),
  observedCaller:async()=>Object.freeze({
   hostId:route.hostId,principalId:route.principalId,
   profileId:route.profileId,conversationId:route.conversationId
  }),timeoutMs:3500
 });
 return Object.freeze({
  identity:Object.freeze({schema:1,kind:'OWNER_LOCAL_DIAGNOSTIC_ONLY',
   chatGPTOAuthVerified:false,workerEffectVerified:false}),
  ...createV2DiagnosticProofReaders({client,route})
 });
}
