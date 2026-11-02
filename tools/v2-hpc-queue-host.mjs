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
const outcome=command==='run'?worker.run():worker.verify(id);
process.stdout.write(JSON.stringify(outcome)+'\n');
