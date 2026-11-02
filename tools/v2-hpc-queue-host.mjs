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
const expectedSourceSha256='b08f910e425821abe66cdf81ed261ea1cd87800e311c9137871758fd72f8870c';
if(sha(fs.readFileSync(source))!==expectedSourceSha256)
 fail('V2_HPC_QUEUE_SOURCE_HASH_MISMATCH');
const {createV2HpcLocalQueue}=await import(pathToFileURL(source).href);
const worker=createV2HpcLocalQueue({root,host:os.hostname()});
let signedAutoAdmission;
if(command==='run'){
 const signedSource=path.join(root,'src','v2-hpc-signed-queue-admission.mjs');
 const signedVerifier=path.join(root,'src','v2-hpc-signed-job.mjs');
 const publicFile=path.join(root,'signed-qa-trust','signing-public.pem');
 if(sha(fs.readFileSync(signedSource))!=='3113338e810e05b3fd6ced24ab53d46bc70d56694db724c11464c83882add667'||
  sha(fs.readFileSync(signedVerifier))!=='95102c0b1b97053dd0a179d3f1f36adc2f1bcd7af1a18b87d3734a878a94a7b7')
  fail('V2_HPC_QUEUE_SIGNED_INTAKE_HASH_MISMATCH');
 const publicKey=fs.readFileSync(publicFile);
 const {createV2HpcSignedAutoAdmission}=await import(pathToFileURL(signedSource).href);
 signedAutoAdmission=createV2HpcSignedAutoAdmission({
  root,host:os.hostname(),publicKey,
  expectedPublicKeySha256:'daa7cbdbdbb26007254f56846ce0076d024f2cbe63cc59376ccdcf4456b0f40e'
 }).run();
}
const outcome=command==='run'?worker.run():worker.verify(id);
process.stdout.write(JSON.stringify(command==='run'?{...outcome,signedAutoAdmission}:outcome)+'\n');
