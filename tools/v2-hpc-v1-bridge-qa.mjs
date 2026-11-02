// QA-only V2 compute through an already-authorized V1 shell/workflow transport.
// Not a production worker, ChatGPT OAuth assertion, or cross-host V2 Coordinator.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const sha=s=>createHash('sha256').update(s).digest('hex');
const action=process.argv[2];
if(process.argv.length!==3||!['compute','verify'].includes(action))
  throw Error('QA_ACTION_ALLOWLIST_REQUIRED');
const host=os.hostname();
if(!['HPC-159-17','HPC-154-66'].includes(host))
  throw Error('QA_ONLY_KNOWN_HPC_REQUIRED');
const root=path.dirname(fileURLToPath(import.meta.url));
if(path.basename(root)!=='CommanderV2-ComputeBridge-QA')
  throw Error('QA_WORKSPACE_ROOT_REQUIRED');
const base=path.join(process.env.LOCALAPPDATA||'',
  'ChatGPTRemoteCommander','qa','v2-compute-only-20261102','src');
const sourceFiles={
  'v2-compute-only-worker.mjs':'dbc31cc017e8089f1b084ae684a53b2c8371192f88c8bd766e6fd926ab640b23',
  'v2-routing-contract.mjs':'63d089ed43adf1918d3c11afcf96efb217d3c236428c7469deea31577a0479a4',
  'v2-central-coordinator.mjs':'c7ffef3735ae79f83b480cb7e9bcee67dbffe9405ec44beb7812cd94c7d91b6e',
  'v2-guarded-artifact-actuator.mjs':'84c6779874852513ca22cd5ca0cb25272719678aad47c6876e1820c16438afc4',
  'v2-coordinator-rpc.mjs':'72fb79e18d0252b429f77ae49d6d508c3fde534b216a3c3cfd1178241e8252a3',
  'v2-coordinator-rpc-client.mjs':'0378b222ab848fb2e99aa74abde4b7c8131cf7af4773c26d03d5e895c0924952'
};
for(const [name,digest] of Object.entries(sourceFiles)){
  if(sha(fs.readFileSync(path.join(base,name)))!==digest)
    throw Error('QA_SOURCE_PIN_MISMATCH:'+name);
}
const mod=async name=>import(pathToFileURL(path.join(base,name)).href);
const {V2CentralCoordinator}=await mod('v2-central-coordinator.mjs');
const {createV2GuardedArtifactActuator}=await mod('v2-guarded-artifact-actuator.mjs');
const route=Object.freeze({
 hostId:host,principalId:'qa-native-operator',profileId:'v1-qa',
 conversationId:'v1-durable-qa',operationId:'prime50000-20261102',
 target:Object.freeze({kind:'workflow-root',id:'bounded-prime-qa'})
});
const binding={hostId:route.hostId,principalId:route.principalId,
 profileId:route.profileId,conversationId:route.conversationId};
const directory=path.join(root,'private-v2-qa-coordinator');
const receiptFile=path.join(root,'prime50000-result.json');
const coordinator=new V2CentralCoordinator({directory,
 authorizeLease:async r=>JSON.stringify([
  r.hostId,r.principalId,r.profileId,r.conversationId,r.operationId,
  r.target.kind,r.target.id
 ])===JSON.stringify([
  route.hostId,route.principalId,route.profileId,route.conversationId,
  route.operationId,route.target.kind,route.target.id
 ]),
 resolveGlobalResource:async()=> 'hpc-native-prime-qa',
 requireGlobalResource:true
});
let server;
try{
 const actuator=createV2GuardedArtifactActuator({coordinator});
 if(action==='compute'){
   if(fs.existsSync(receiptFile))throw Error('QA_MANIFEST_ALREADY_EXISTS_USE_VERIFY');
   const {createV2RpcTokenLookup,createV2CoordinatorRpcServer}=await mod('v2-coordinator-rpc.mjs');
   const {createV2CoordinatorRpcClient}=await mod('v2-coordinator-rpc-client.mjs');
   const {createV2ComputeOnlyWorker}=await mod('v2-compute-only-worker.mjs');
   const token=randomBytes(32).toString('base64url');
   server=createV2CoordinatorRpcServer({coordinator,artifactActuator:actuator,
    lookupToken:createV2RpcTokenLookup([{tokenSha256:sha(token),binding}])});
   const {port}=await server.listen();
   const client=createV2CoordinatorRpcClient({
    endpoint:'http://127.0.0.1:'+port,tokenProvider:async()=>token,
    observedCaller:async()=>binding,timeoutMs:5000
   });
   const w=createV2ComputeOnlyWorker({coordinator:client});
   const reply=await w.execute({route,job:{schema:1,kind:'prime-statistics',limit:50000}});
   const observed=await client.observePrivateArtifact({route,receiptId:reply.receiptId});
   if(reply.status!=='COMMITTED'||observed.committed!==true||
      observed.digest!==reply.digest||observed.fence<1)
     throw Error('QA_COMPUTE_COORDINATOR_RECEIPT_INVALID');
   const record={
     schema:1,scope:'V1_DURABLE_TOOL_V2_LOCAL_COORDINATOR_QA_ONLY',
     host,mode:'compute-only',verifiedProductionV2:false,
     actualChatGPTOAuthAttested:false,realCrossHostCoordinator:false,
     job:{schema:1,kind:'prime-statistics',limit:50000},
     result:reply.result,receiptId:reply.receiptId,
     receiptDigest:reply.digest,receiptFence:observed.fence,
     artifactObserved:true,expectedSourceSha256:sourceFiles,
     nodeVersion:process.version
   };
   fs.writeFileSync(receiptFile,JSON.stringify(record,null,2)+'\n',
    {flag:'wx',mode:0o600});
   console.log(JSON.stringify({status:'COMMITTED_QA',host,
      count:reply.result.count,sum:reply.result.sum,
      receiptId:reply.receiptId,receiptDigest:reply.digest,
      manifestSha256:sha(fs.readFileSync(receiptFile))}));
 }else{
   const record=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
   const manifestDigest=sha(fs.readFileSync(receiptFile));
   if(record.host!==host||record.scope!=='V1_DURABLE_TOOL_V2_LOCAL_COORDINATOR_QA_ONLY'||
      record.job?.limit!==50000||record.result?.operationId!==route.operationId||
      record.result?.kind!=='prime-statistics'||record.result.limit!==50000||
      record.receiptDigest!==sha(JSON.stringify(record.result))||
      record.artifactObserved!==true)
     throw Error('QA_MANIFEST_IDENTITY_OR_DIGEST_INVALID');
   // Independent algorithm, not the worker's sieve implementation.
   let count=0,sum=0;
   for(let n=2;n<=50000;n++){
      let isPrime=true;
      for(let d=2;d*d<=n;d++)if(n%d===0){isPrime=false;break;}
      if(isPrime){count++;sum+=n;}
   }
   const observed=await actuator.observe({route,receiptId:record.receiptId});
   if(count!==5133||sum!==121013308||
      record.result.count!==count||record.result.sum!==sum||
      observed.committed!==true||observed.digest!==record.receiptDigest||
      observed.fence!==record.receiptFence)
      throw Error('QA_INDEPENDENT_RESULT_OR_ARTIFACT_FAILURE');
   console.log(JSON.stringify({status:'INDEPENDENT_VERIFIED_QA',host,count,sum,
     manifestSha256:manifestDigest,receiptDigest:observed.digest,
     fence:observed.fence}));
 }
}finally{
 if(server)await server.close();
 coordinator.close();
}
