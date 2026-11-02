// Owner-local QA signer for allowlisted computation. No automatic OAuth,
// no credential sharing, no V2 production grant. Signed envelopes transported
// separately using already authorized V1 tool calls.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {signV2HpcBoundedJob} from '../src/v2-hpc-signed-job.mjs';

const host=process.argv[2],id=process.argv[3],limit=Number(process.argv[4]);
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
if(process.argv.length!==5||!['HPC-159-17','HPC-154-66'].includes(host)||
 typeof id!=='string'||!ID.test(id)||!Number.isSafeInteger(limit)||
 limit<2||limit>50000)fail('V2_QA_SIGNER_ARGUMENT_NOT_ALLOWED');
if(process.platform!=='linux'||process.getuid()===0)
 fail('V2_QA_SIGNER_OWNER_LINUX_REQUIRED');
const root=path.join(os.homedir(),'.local/state/CommanderV2/QA/signed-hpc-intake-20261102');
const key=path.join(root,'signing-private.pem');
const stat=fs.lstatSync(key);
if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
 stat.uid!==process.getuid()||(stat.mode&0o077)!==0)
 fail('V2_QA_SIGNER_KEY_ACL_UNTRUSTED');
const privatePem=fs.readFileSync(key);
const issuedAtMs=Date.now();
const signed=signV2HpcBoundedJob({job:{schema:1,operationId:id,
 kind:'prime-statistics',limit},hostId:host,keyId:'mmz-hpc-qa-20261102',
 issuedAtMs,expiresAtMs:issuedAtMs+300000,privateKey:privatePem});
const dir=path.join(root,'signed-outbox');
fs.mkdirSync(dir,{recursive:true,mode:0o700});
if(fs.statSync(dir).uid!==process.getuid()||
 (fs.statSync(dir).mode&0o077)!==0)
 fail('V2_QA_SIGNER_OUTBOX_UNTRUSTED');
const target=path.join(dir,host+'-'+id+'.json');
const bytes=JSON.stringify(signed)+'\n';
fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:'SIGNED_BOUNDED_QA_NOT_OAUTH',host,id,
 limit,signedFileSha256:createHash('sha256').update(bytes).digest('hex'),
 expiresAtMs:issuedAtMs+300000,privateKeyTransferred:false}));
