// Trusted detached controller: the existing operation worker AND descendants
// run inside the existing native cgroup/Job Object provider. Raw spec stays on
// stdin; only reservation hashes and native completion proof are persisted.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {runContainedProjectCommand,serializeProcessCessationProof} from '../src/process-containment.mjs';
const terminal=new Set(['SUCCEEDED','FAILED','TIMED_OUT','CANCELLED']);
let raw=Buffer.alloc(0);
for await(const chunk of process.stdin){
 raw=Buffer.concat([raw,chunk]);
 if(raw.length>1024*1024)throw Error('NATIVE_OPERATION_SPEC_TOO_LARGE');
}
const spec=JSON.parse(raw.toString('utf8'));
if(!spec||typeof spec.operationId!=='string'||!/^[a-f0-9-]{36}$/.test(spec.operationId)
 ||!/^[a-f0-9]{64}$/.test(spec.inputHash??'')
 ||spec.nativeRootBinding?.operationId!==spec.operationId
 ||typeof spec.statePath!=='string'||!path.isAbsolute(spec.statePath)
 ||path.basename(spec.statePath)!=='state.json'
 ||typeof spec.resultPath!=='string'||path.dirname(spec.resultPath)!==path.dirname(spec.statePath)
 ||path.basename(spec.resultPath)!=='result.json'
 ||!Number.isSafeInteger(spec.timeoutMs)||spec.timeoutMs<1000||spec.timeoutMs>86400000)
 throw Error('NATIVE_OPERATION_SPEC_INVALID');
const state=JSON.parse(await fs.readFile(spec.statePath,'utf8'));
if(state.operationId!==spec.operationId||state.inputHash!==spec.inputHash
 ||state.status!=='QUEUED'||state.workerPid!==process.pid)
 throw Error('NATIVE_OPERATION_START_IDENTITY_CHANGED');
const worker=fileURLToPath(new URL('./operation-worker.mjs',import.meta.url));
try{
 const run=await runContainedProjectCommand({
   program:process.execPath,args:[worker],cwd:path.dirname(worker),
   timeoutMs:spec.timeoutMs+20000,outputLimit:4096,env:process.env,
   binding:spec.nativeRootBinding,input:raw
 });
 raw.fill(0);
 const proof=serializeProcessCessationProof(run.processCessationProof);
 const bytes=await fs.readFile(spec.resultPath);
 const receipt=JSON.parse(bytes.toString('utf8'));
 if(!proof||receipt.operationId!==spec.operationId||receipt.inputHash!==spec.inputHash
   ||!terminal.has(receipt.status))throw Error('NATIVE_OPERATION_CESSATION_UNVERIFIED');
 const value={schema:1,operationId:spec.operationId,inputHash:spec.inputHash,
   receiptSha256:createHash('sha256').update(bytes).digest('hex'),
   processCessationProof:proof};
 const target=path.join(path.dirname(spec.resultPath),'native-completion.json');
 await fs.writeFile(target,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx'});
 // Only the owner-spawned native controller can send through this anonymous
 // IPC endpoint; its contained operation-worker never inherits that handle.
 // A persisted file alone is NEVER acceptable cessation provenance.
 if(typeof process.send!=='function')throw Error('NATIVE_OPERATION_OWNER_IPC_REQUIRED');
 await new Promise((resolve,reject)=>process.send({
   schema:1,type:'V012_NATIVE_CESSATION',operationId:spec.operationId,
   inputHash:spec.inputHash,receiptSha256:value.receiptSha256,
   proofDigest:proof.proofDigest
 },error=>error?reject(error):resolve()));
}catch(error){
 raw.fill(0);
 // No synthetic proof, retry, deletion, or native lease release on failure.
 process.stderr.write('NATIVE_OPERATION_PROOF_UNAVAILABLE\n');
 process.exitCode=1;
}

