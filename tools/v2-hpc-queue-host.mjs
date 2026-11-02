// Owner-local headless HPC queue entrypoint. Windows Scheduled Task can invoke
// the fixed "run" action. No arbitrary command, path, shell, GUI or browser API.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const sha=s=>createHash('sha256').update(s).digest('hex');
const command=process.argv[2],id=process.argv[3];
if(process.platform!=='win32'||!['HPC-159-17','HPC-154-66'].includes(os.hostname()))
 fail('V2_HPC_QUEUE_UNENROLLED_HOST');
if((command!=='run'&&command!=='verify')||process.argv.length!==(command==='run'?3:4))
 fail('V2_HPC_QUEUE_COMMAND_NOT_ALLOWED');
const root=path.dirname(fileURLToPath(import.meta.url));
if(path.basename(root)!=='CommanderV2-ComputeBridge-QA')
 fail('V2_HPC_QUEUE_DEPLOYMENT_ROOT_INVALID');
const source=path.join(root,'src','v2-hpc-queue-worker.mjs');
const expectedSourceSha256='5f696cf0f7e94b3c6f01e316e80bf795973e1a56aba517d254115c2a4a02f4bf';
if(sha(fs.readFileSync(source))!==expectedSourceSha256)
 fail('V2_HPC_QUEUE_SOURCE_HASH_MISMATCH');
const {createV2HpcLocalQueue}=await import(pathToFileURL(source).href);
const worker=createV2HpcLocalQueue({root,host:os.hostname()});
let signedAutoAdmission;
let admission;
let ownerPublicKey;
if(command==='run'){
 const signedSource=path.join(root,'src','v2-hpc-signed-queue-admission.mjs');
 const signedVerifier=path.join(root,'src','v2-hpc-signed-job.mjs');
 const publicFile=path.join(root,'signed-qa-trust','signing-public.pem');
 if(sha(fs.readFileSync(signedSource))!=='3e92d41a06403aaf4b111e8f0e4fb817b1b66b4ea4a7fcbab0804cb717e3d670'||
  sha(fs.readFileSync(signedVerifier))!=='95102c0b1b97053dd0a179d3f1f36adc2f1bcd7af1a18b87d3734a878a94a7b7')
  fail('V2_HPC_QUEUE_SIGNED_INTAKE_HASH_MISMATCH');
 const publicKey=fs.readFileSync(publicFile);
 ownerPublicKey=publicKey;
 const {createV2HpcSignedAutoAdmission}=await import(pathToFileURL(signedSource).href);
 admission=createV2HpcSignedAutoAdmission({
  root,host:os.hostname(),publicKey,
  expectedPublicKeySha256:'daa7cbdbdbb26007254f56846ce0076d024f2cbe63cc59376ccdcf4456b0f40e'
 });
 signedAutoAdmission=admission.run();
}
const outcome=command==='run'?worker.run({
 authorizePendingJob:(operationId,inputSha256)=>
  admission.verifyForExecution(operationId,inputSha256)
}):worker.verify(id);
if(command==='run'&&!outcome.signedPendingEnforced)
 fail('V2_HPC_QUEUE_SIGNED_ONLY_NOT_ENFORCED');
let signedReturnProof;
if(command==='run'){
 const sourceReturn=path.join(root,'src','v2-hpc-signed-return-queue.mjs');
 const sourceResult=path.join(root,'src','v2-hpc-signed-receipt.mjs');
 if(sha(fs.readFileSync(sourceReturn))!=='354360220a1e0e79e674892b94529745da9ff12be53f20b61fd4aaf11e1f35e4'||
    sha(fs.readFileSync(sourceResult))!=='f23ceae3d91a760df38861d5ae8c844106788c607a5a5c623242c8bf715a8da6')
  fail('V2_HPC_RETURN_SIGNER_SOURCE_PIN_MISMATCH');
 const privateKey=fs.readFileSync(path.join(root,'signed-qa-identity','receipt-signing-private.pem'));
 const receiptPublicKey=fs.readFileSync(path.join(root,'signed-qa-identity','receipt-signing-public.pem'));
 const expectedHostPubHash={
  'HPC-159-17':'fc949537538f896556e63fdc764962ec4b6ddf0afd38915183f44a810d09e4fd',
  'HPC-154-66':'0b3365c45bb1006b270c84cbff849d2920946f8ab24af8196c237fe38532c245'
 };
 if(sha(receiptPublicKey)!==expectedHostPubHash[os.hostname()])
  fail('V2_HPC_RETURN_SIGNER_PUBLIC_KEY_PIN_MISMATCH');
 const {createV2HpcSignedReturnQueue}=await import(pathToFileURL(sourceReturn).href);
 signedReturnProof=createV2HpcSignedReturnQueue({
  root,host:os.hostname(),privateKey,receiptPublicKey,ownerPublicKey,worker
 }).seal();
}
process.stdout.write(JSON.stringify(command==='run'?
 {...outcome,signedAutoAdmission,signedReturnProof}:outcome)+'\n');
