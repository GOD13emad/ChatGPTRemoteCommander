// Owner-local central SQLite + Ed25519 result verification for V1-brokered QA.
// No production ChatGPT OAuth, production Worker enrollment or direct network dispatch.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createHash} from 'node:crypto';
import {verifyV2HpcBoundedJob} from '../src/v2-hpc-signed-job.mjs';
import {verifyV2HpcReceipt} from '../src/v2-hpc-signed-receipt.mjs';
import {V2CentralCoordinator} from '../src/v2-central-coordinator.mjs';
import {createV2GuardedArtifactActuator} from '../src/v2-guarded-artifact-actuator.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=c=>{throw Object.assign(new Error(c),{code:c});};
const [,,action,host,id]=process.argv;
if(process.platform!=='linux'||process.getuid?.()===0||
 !['seal','verify'].includes(action)||
 !['HPC-159-17','HPC-154-66'].includes(host)||
 typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)||
 process.argv.length!==5)
 fail('V2_HPC_SIGNED_CENTRAL_QA_ARGUMENT_INVALID');
const root=path.join(os.homedir(),'.local/state/CommanderV2/QA/signed-hpc-intake-20261102');
const evidenceRoot=path.join(root,'signed-return-evidence');
const coordinatorRoot=path.join(root,'signed-return-coordinator');
function privateFolder(p){
 if(!fs.existsSync(p))fs.mkdirSync(p,{recursive:true,mode:0o700});
 const stat=fs.lstatSync(p);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||
 (stat.mode&0o077)!==0)fail('V2_HPC_SIGNED_CENTRAL_QA_PRIVATE_ROOT_REQUIRED');
}
function dataFile(p,min,max){
 const stat=fs.lstatSync(p);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
 stat.size<min||stat.size>max)fail('V2_HPC_SIGNED_CENTRAL_QA_FILE_UNSAFE');
 const data=fs.readFileSync(p);
 if(data.length!==stat.size)fail('V2_HPC_SIGNED_CENTRAL_QA_FILE_CHANGED');
 return data;
}
privateFolder(root);privateFolder(evidenceRoot);privateFolder(coordinatorRoot);
const folder=path.join(evidenceRoot,host);
privateFolder(folder);
const signedRequest=dataFile(path.join(root,'signed-outbox',host+'-'+id+'.json'),50,1800);
const original=JSON.parse(signedRequest.toString('utf8'));
const ownerPub=dataFile(path.join(root,'signing-public.pem'),100,1000);
const ownerProof=verifyV2HpcBoundedJob({
 envelope:original,expectedHostId:host,expectedKeyId:'mmz-hpc-qa-20261102',
 publicKey:ownerPub,now:original?.payload?.issuedAtMs
});
if(ownerProof.operationId!==id)fail('V2_HPC_SIGNED_CENTRAL_QA_OWNER_REQUEST_MISMATCH');
const receipt=dataFile(path.join(folder,id+'.receipt.json'),100,3000);
const witness=dataFile(path.join(folder,id+'.witness.json'),100,2000);
const signedResult=dataFile(path.join(folder,id+'.return.json'),150,1800);
const nativePub=dataFile(path.join(root,'return-keys',host==='HPC-159-17'?'HPC159.pem':'HPC154.pem'),100,1000);
const expectedPub=host==='HPC-159-17'?
 'fc949537538f896556e63fdc764962ec4b6ddf0afd38915183f44a810d09e4fd':
 '0b3365c45bb1006b270c84cbff849d2920946f8ab24af8196c237fe38532c245';
if(sha(nativePub)!==expectedPub)fail('V2_HPC_SIGNED_CENTRAL_QA_PUBLIC_KEY_CHANGED');
const resultEnvelope=JSON.parse(signedResult.toString('utf8'));
const native=verifyV2HpcReceipt({envelope:resultEnvelope,
 expectedHost:host,receiptBytes:receipt,witnessBytes:witness,publicKey:nativePub});
const parsedReceipt=JSON.parse(receipt.toString('utf8'));
const parsedWitness=JSON.parse(witness.toString('utf8'));
const requestBytes=Buffer.from(JSON.stringify(ownerProof.boundedJob)+'\n');
if(parsedReceipt.inputSha256!==sha(requestBytes)||
 parsedWitness.signedEnvelopeSha256!==sha(signedRequest)||
 parsedWitness.signedPayloadSha256!==ownerProof.signedPayloadSha256||
 native.operationId!==id||native.resultDigest!==parsedReceipt.digest)
 fail('V2_HPC_SIGNED_CENTRAL_QA_BINDING_MISMATCH');
function independent(limit){
 let count=0,sum=0;
 for(let n=2;n<=limit;n++){
  let prime=true;
  for(let f=2;f*f<=n;f++)if(n%f===0){prime=false;break;}
  if(prime){count++;sum+=n;}
 }
 return {count,sum};
}
const checked=independent(native.limit);
if(checked.count!==native.count||checked.sum!==native.sum)
 fail('V2_HPC_SIGNED_CENTRAL_QA_INDEPENDENT_RESULT_FAILED');
const witnessText=JSON.stringify({
 schema:1,scope:'QA_V1_BROKERED_SIGNED_NATIVE_RESULT_NOT_V2_PRODUCTION',
 host,operationId:id,ownerRequestSha256:sha(signedRequest),
 nativeReceiptSha256:sha(receipt),nativeAdmissionWitnessSha256:sha(witness),
 nativeReturnProofSha256:sha(signedResult),resultDigest:native.resultDigest,
 count:native.count,sum:native.sum,limit:native.limit,
 receiptSignatureVerified:true,ownerSignatureVerified:true,
 chatGPTOAuthAttested:false,productionV2:false
});
const route=Object.freeze({
 hostId:host,principalId:'mmz-existing-v1-authorized-tool-qa',
 profileId:'V1-owner-brokered',conversationId:'signed-return-qa',
 operationId:id,target:Object.freeze({kind:'workflow-root',id:'signed-compute'})
});
const coordinator=new V2CentralCoordinator({
 directory:coordinatorRoot,
 authorizeLease:async r=>JSON.stringify(r)===JSON.stringify(route),
 resolveGlobalResource:async()=> 'hpc-signed-qa-'+host+'-'+id,
 requireGlobalResource:true
});
try{
 const act=createV2GuardedArtifactActuator({coordinator});
 const receiptId='signed-native-'+id;
 const digest=sha(witnessText);
 let observed=await act.observe({route,receiptId});
 if(action==='seal'){
  if(!observed.committed){
   observed=await coordinator.withFencedLease({route,run:async({lease,assertCurrent})=>{
    await assertCurrent();
    return act.create({route,lease,receiptId,content:witnessText});
   }});
  }
  if(observed.committed!==true||observed.digest!==digest)
   fail('V2_HPC_SIGNED_CENTRAL_QA_COMMIT_CONFLICT');
 }else if(observed.committed!==true||observed.digest!==digest||observed.fence<1)
  fail('V2_HPC_SIGNED_CENTRAL_QA_RECEIPT_UNVERIFIED');
 console.log(JSON.stringify({status:action==='seal'?'QA_CENTRAL_SIGNED_SEALED':
  'QA_CENTRAL_SIGNED_INDEPENDENT_VERIFIED',host,operationId:id,
  count:native.count,sum:native.sum,digest:observed.digest,fence:observed.fence,
  nativeReturnProofSha256:sha(signedResult),productionV2:false,
  chatGPTOAuthAttested:false}));
}finally{coordinator.close()}
