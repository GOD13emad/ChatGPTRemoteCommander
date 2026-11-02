// Per-host QA cryptographic intake. Existing Windows Scheduled Task still
// executes only bounded prime jobs. Signed intake is invoked over authorized V1
// transport for QA, NOT via a production V2 Coordinator.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const host=os.hostname(),id=process.argv[3],mode=process.argv[2];
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
if(process.platform!=='win32'||!['HPC-159-17','HPC-154-66'].includes(host)||
 process.argv.length!==4||mode!=='admit'||typeof id!=='string'||!ID.test(id))
 fail('V2_SIGNED_ADMISSION_QA_FIXED_COMMAND_REQUIRED');
const root=path.dirname(fileURLToPath(import.meta.url));
if(path.basename(root)!=='CommanderV2-ComputeBridge-QA')
 fail('V2_SIGNED_ADMISSION_QA_ROOT_INVALID');
const publicFile=path.join(root,'signed-qa-trust','signing-public.pem');
const moduleFile=path.join(root,'src','v2-hpc-signed-job.mjs');
const publicKey=fs.readFileSync(publicFile);
if(sha(publicKey)!=='daa7cbdbdbb26007254f56846ce0076d024f2cbe63cc59376ccdcf4456b0f40e')
 fail('V2_SIGNED_ADMISSION_QA_PUBLIC_KEY_PIN_MISMATCH');
if(sha(fs.readFileSync(moduleFile))!=='95102c0b1b97053dd0a179d3f1f36adc2f1bcd7af1a18b87d3734a878a94a7b7')
 fail('V2_SIGNED_ADMISSION_QA_SOURCE_PIN_MISMATCH');
const {verifyV2HpcBoundedJob}=await import(pathToFileURL(moduleFile).href);
const source=path.join(root,'signed-qa-inbox',id+'.json');
const st=fs.lstatSync(source);
if(st.isSymbolicLink()||!st.isFile()||st.nlink!==1||st.size<100||st.size>1300)
 fail('V2_SIGNED_ADMISSION_QA_SOURCE_UNSAFE');
const raw=fs.readFileSync(source);
if(raw.length!==st.size)fail('V2_SIGNED_ADMISSION_QA_SOURCE_CHANGED');
let envelope;
try{envelope=JSON.parse(raw.toString('utf8'))}
catch{fail('V2_SIGNED_ADMISSION_QA_INVALID_JSON')}
const verified=verifyV2HpcBoundedJob({envelope,expectedHostId:host,
 expectedKeyId:'mmz-hpc-qa-20261102',publicKey,now:Date.now()});
if(verified.operationId!==id)fail('V2_SIGNED_ADMISSION_QA_JOB_ID_CHANGED');
const target=path.join(root,'compute-inbox',id+'.json');
const body=JSON.stringify(verified.boundedJob)+'\n';
let status;
try{
 fs.writeFileSync(target,body,{flag:'wx',mode:0o600});
 status='SIGNED_JOB_ADMITTED_QA';
}catch(e){
 if(e.code!=='EEXIST')throw e;
 const old=fs.lstatSync(target);
 if(old.isSymbolicLink()||!old.isFile()||old.nlink!==1||
  fs.readFileSync(target,'utf8')!==body)
  fail('V2_SIGNED_ADMISSION_QA_CONFLICT');
 status='SIGNED_JOB_RECONCILED_QA';
}
console.log(JSON.stringify({status,host,operationId:id,
 sourceSha256:sha(raw),signedPayloadSha256:verified.signedPayloadSha256,
 admittedJobSha256:sha(body),chatGPTOAuthAttested:false,productionV2:false}));
