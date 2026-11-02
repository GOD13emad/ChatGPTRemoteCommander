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
if(command==='run'){
 const signedSource=path.join(root,'src','v2-hpc-signed-queue-admission.mjs');
 const signedVerifier=path.join(root,'src','v2-hpc-signed-job.mjs');
 const publicFile=path.join(root,'signed-qa-trust','signing-public.pem');
 if(sha(fs.readFileSync(signedSource))!=='3e92d41a06403aaf4b111e8f0e4fb817b1b66b4ea4a7fcbab0804cb717e3d670'||
  sha(fs.readFileSync(signedVerifier))!=='95102c0b1b97053dd0a179d3f1f36adc2f1bcd7af1a18b87d3734a878a94a7b7')
  fail('V2_HPC_QUEUE_SIGNED_INTAKE_HASH_MISMATCH');
 const publicKey=fs.readFileSync(publicFile);
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
process.stdout.write(JSON.stringify(command==='run'?{...outcome,signedAutoAdmission}:outcome)+'\n');
