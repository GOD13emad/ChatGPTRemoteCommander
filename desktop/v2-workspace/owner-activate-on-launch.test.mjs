import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {activateOwnerR7} from './owner-activate-on-launch.mjs';

const source=dirname(fileURLToPath(import.meta.url));
const names=['server.mjs','desktop-app.mjs','local-evidence.mjs',
 'owner-seat-evidence.mjs','workflow-view.mjs','app.js','app.css','index.html','README.md'];
async function fixture(t){
 const temp=await mkdtemp(join(tmpdir(),'rcv2-r7-owner-start-'));
 const runtime=join(temp,'runtime');await mkdir(runtime);
 t.after(()=>rm(temp,{recursive:true,force:true,maxRetries:4,retryDelay:30}));
 return {temp,runtime,lockPath:join(runtime,'app-instance.lock'),
  stage:join(temp,'no-stage'),archive:join(temp,'no-archive')};
}
test('R7 owner bootstrap cannot silently launch a future R8 runtime as R7',async t=>{
 const f=await fixture(t);
 for(const name of names)await copyFile(join(source,name),join(f.runtime,name));
 let calls=0;
 await assert.rejects(activateOwnerR7({...f,launch:async()=>calls++}),{code:'ENOENT'});
 assert.equal(calls,0);
});
test('running owner app lock never mutates or starts another GUI',async t=>{
 const f=await fixture(t);
 await writeFile(f.lockPath,'active');
 let calls=0;
 const x=await activateOwnerR7({...f,launch:async()=>calls++});
 assert.equal(x.state,'OWNER_APP_CURRENTLY_RUNNING');
 assert.equal(calls,0);
});
test('wrong, missing and modified baseline refuse to launch untrusted code',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.runtime,'server.mjs'),'untrusted');
 let calls=0;
 await assert.rejects(activateOwnerR7({...f,launch:async()=>calls++}),
  err=>['ENOENT','V2_R7_OWNER_FILE_UNSAFE'].includes(err?.code));
 assert.equal(calls,0);
 assert.equal((await readFile(join(f.runtime,'server.mjs'),'utf8')),'untrusted');
});
test('missing native-owned path or launch callback fails before effects',async()=>{
 await assert.rejects(activateOwnerR7(),{code:'V2_R7_OWNER_BOOTSTRAP_REQUIRED'});
});
test('R6 -> R7 only when exact owner archives are available to isolated QA',async t=>{
 const r6=process.env.RC_V2_R6_RUNTIME_FOR_QA;
 const stage=process.env.RC_V2_R7_STAGE_FOR_QA;
 const archive=process.env.RC_V2_R7_ARCHIVE_FOR_QA;
 if(!r6||!stage||!archive){t.skip('OWNER_ARCHIVE_TEST_PATHS_NOT_PROVIDED');return;}
 const f=await fixture(t);
 for(const name of names)await copyFile(join(r6,name),join(f.runtime,name));
 await mkdir(join(f.runtime,'browser-profile'));
 await writeFile(join(f.runtime,'browser-profile','drafts.db'),'owner user drafts');
 let calls=0;
 const x=await activateOwnerR7({...f,stage,archive,launch:async()=>calls++});
 assert.equal(x.state,'R7_UPGRADED_AND_LAUNCHED');
 assert.equal(calls,1);
 assert.equal((await readFile(join(f.runtime,'browser-profile','drafts.db'),'utf8')),'owner user drafts');
 for(const name of names)assert.deepEqual(await readFile(join(f.runtime,name)),await readFile(join(stage,name)));
});
