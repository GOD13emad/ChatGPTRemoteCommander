// Disposable and read-only preflight regressions. No owner authorization,
// native input, process termination, GUI takeover, or original J01 mutation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {main} from '../tools/gui-incident-recover.mjs';
import {scanGuiDispatchers,observedReleaseVersion} from '../src/gui-dispatcher-preflight.mjs';
import {createGuiInputIncidentStore} from '../src/gui-incident-store.mjs';

async function fixture(run){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rc-j01-preflight-'));
 const file=path.join(dir,'pending.json');
 try{const store=createGuiInputIncidentStore({file});await store.begin('gui_mouse_click');return await run(store,file);}
 finally{await fs.rm(dir,{recursive:true,force:true});}
}
function channel(){let out='',err='';return{out:{write:s=>{out+=s;}},err:{write:s=>{err+=s;}},get data(){return JSON.parse(out);},get stderr(){return err;}};}
test('zero observed dispatchers never becomes a trusted quiescence or release',()=>fixture(async(store,file)=>{
 const before=await fs.readFile(file);
 const c=channel();
 const code=await main(['--preflight'],{
  store,scanDispatchers:async()=>({scan:'ADVISORY_ONLY',coverage:'PROCESS_CENSUS_ONLY',
   active:[],activeCount:0,quiescenceProven:false,releaseAuthorized:false,noReplay:true}),
  output:c.out,error:c.err});
 assert.equal(code,0);
 assert.equal(c.data.dispatchers.activeCount,0);
 assert.equal(c.data.dispatchers.quiescenceProven,false);
 assert.equal(c.data.releaseAuthorized,false);
 assert.equal(c.data.noReplay,true);
 assert.equal(c.data.nativeOutcome,'UNKNOWN');
 assert.deepEqual(await fs.readFile(file),before);
}));
test('observed cross-session processes are only blockers, not stoppable handles',()=>fixture(async(store,file)=>{
 const before=await fs.readFile(file);
 const c=channel();
 await main(['--preflight'],{
  store,scanDispatchers:async()=>({scan:'ADVISORY_ONLY',coverage:'PROCESS_CENSUS_ONLY',
   active:[{pid:201,session:1,role:'core'},{pid:302,session:3,role:'native-helper'}],
   activeCount:2,quiescenceProven:false,releaseAuthorized:false,noReplay:true}),
  output:c.out,error:c.err});
 assert.equal(c.data.dispatchers.activeCount,2);
 assert.deepEqual(c.data.dispatchers.active.map(x=>x.session),[1,3]);
 assert.equal(c.data.dispatchers.quiescenceProven,false);
 assert.equal(c.data.releaseAuthorized,false);
 assert.deepEqual(await fs.readFile(file),before);
}));
test('failed process inspection never implies quiescence or authorization',()=>fixture(async(store,file)=>{
 const c=channel();
 const code=await main(['--preflight'],{store,scanDispatchers:async()=>{throw Error('SENSITIVE_COMMAND_LINE');},
  output:c.out,error:c.err});
 assert.equal(code,0);
 assert.equal(c.data.dispatchers.scan,'FAILED');
 assert.equal(c.data.dispatchers.quiescenceProven,false);
 assert.equal(c.data.dispatchers.releaseAuthorized,false);
 assert.doesNotMatch(JSON.stringify(c.data),/SENSITIVE_COMMAND_LINE/);
 assert.ok(await store.pending());
}));
test('invalid or forged --review request never calls a scanner or touches J01',()=>fixture(async(store,file)=>{
 const original=await fs.readFile(file),c=channel();
 const code=await main(['--review'],{store,scanDispatchers:async()=>{throw Error('SCANNER_CALLED');},
  output:c.out,error:c.err});
 assert.equal(code,3);
 assert.match(c.stderr,/NOT_IMPLEMENTED/);
 assert.deepEqual(await fs.readFile(file),original);
}));
test('real process census never claims it is a native synchronization proof',async()=>{
 const result=await scanGuiDispatchers();
 assert.equal(result.releaseAuthorized,false);
 assert.equal(result.quiescenceProven,false);
 assert.equal(result.noReplay,true);
 assert.ok(['ADVISORY_ONLY','FAILED'].includes(result.scan));
 assert.ok(['PROCESS_CENSUS_ONLY','INCOMPLETE','UNKNOWN'].includes(result.coverage));
 if(result.scan==='ADVISORY_ONLY'){
  assert.ok(Array.isArray(result.active));
  for(const row of result.active){
   assert.equal(typeof row.pid,'number');
   assert.ok(['core','native-helper'].includes(row.role));
   assert.equal(Object.hasOwn(row,'commandLine'),false);
  }
 }
});

test('forged scan authorization and raw command lines never reach output',()=>fixture(async(store,file)=>{
 const c=channel(),original=await fs.readFile(file);
 await main(['--preflight'],{store,
  scanDispatchers:async()=>({
   scan:'ADVISORY_ONLY',coverage:'PROCESS_CENSUS_ONLY',activeCount:1,
   active:[{pid:101,session:1,role:'core',commandLine:'SENSITIVE_DO_NOT_LOG'}],
   quiescenceProven:true,releaseAuthorized:true,ownerAuthenticated:true,
   arbitrary:'SENSITIVE_DO_NOT_LOG'
  }),output:c.out,error:c.err});
 assert.equal(c.data.releaseAuthorized,false);
 assert.equal(c.data.dispatchers.releaseAuthorized,false);
 assert.equal(c.data.dispatchers.quiescenceProven,false);
 assert.equal(c.data.dispatchers.activeCount,1);
 assert.equal(Object.hasOwn(c.data.dispatchers.active[0],'commandLine'),false);
 assert.doesNotMatch(JSON.stringify(c.data),/SENSITIVE_DO_NOT_LOG/);
 assert.deepEqual(await fs.readFile(file),original);
}));
test('malformed or missing process census is not reported as no active processes',()=>fixture(async(store,file)=>{
 const c=channel();
 await main(['--preflight'],{
  store,scanDispatchers:async()=>({scan:'ADVISORY_ONLY',coverage:'PROCESS_CENSUS_ONLY',
   active:[{pid:-7,session:0,role:'core'}],quiescenceProven:true,releaseAuthorized:true}),
  output:c.out,error:c.err});
 assert.equal(c.data.dispatchers.scan,'FAILED');
 assert.equal(c.data.dispatchers.activeCount,null);
 assert.equal(c.data.dispatchers.active,null);
 assert.equal(c.data.dispatchers.quiescenceProven,false);
 assert.equal(c.data.dispatchers.releaseAuthorized,false);
 assert.ok(await store.pending());
}));

test('mixed active Core release versions are sanitized and prevent any false compatibility claim',()=>fixture(async(store,file)=>{
 const before=await fs.readFile(file),c=channel();
 await main(['--preflight'],{store,
  scanDispatchers:async()=>({scan:'ADVISORY_ONLY',coverage:'PROCESS_CENSUS_ONLY',
   activeCount:3,active:[
    {pid:101,session:1,role:'core',observedVersion:'0.10.24',commandLine:'DO_NOT_LEAK'},
    {pid:202,session:1,role:'core',observedVersion:'0.10.25'},
    {pid:303,session:1,role:'native-helper',observedVersion:null}],
   quiescenceProven:true,releaseAuthorized:true}),output:c.out,error:c.err});
 assert.equal(c.data.dispatchers.scan,'ADVISORY_ONLY');
 assert.deepEqual(c.data.dispatchers.active.map(x=>x.observedVersion),['0.10.24','0.10.25',null]);
 assert.equal(c.data.dispatchers.mixedVersionObserved,true);
 assert.equal(c.data.dispatchers.unknownVersionCount,1);
 assert.equal(c.data.dispatchers.compatibilityProven,false);
 assert.equal(c.data.dispatchers.releaseAuthorized,false);
 assert.equal(c.data.releaseAuthorized,false);
 assert.doesNotMatch(JSON.stringify(c.data),/DO_NOT_LEAK/);
 assert.deepEqual(await fs.readFile(file),before);
}));
test('invalid claimed version is not sanitized into false compatibility',()=>fixture(async(store)=>{
 const c=channel();
 await main(['--preflight'],{store,
  scanDispatchers:async()=>({scan:'ADVISORY_ONLY',coverage:'PROCESS_CENSUS_ONLY',
   active:[{pid:901,session:1,role:'core',observedVersion:'0.10.25;SENSITIVE_COMMAND_LINE'}],
   activeCount:1,quiescenceProven:true,releaseAuthorized:true}),output:c.out,error:c.err});
 assert.equal(c.data.dispatchers.scan,'FAILED');
 assert.equal(c.data.dispatchers.compatibilityProven,false);
 assert.equal(c.data.dispatchers.releaseAuthorized,false);
 assert.equal(c.data.dispatchers.active,null);
 assert.doesNotMatch(JSON.stringify(c.data),/SENSITIVE_COMMAND_LINE/);
}));

test('release labels parse from Linux/Windows paths without trusting protocol',()=>{
 assert.equal(observedReleaseVersion(String.raw`C:\x\releases\v0.10.24-abcdef012345\src\server-v0.3.mjs`),'0.10.24');
 assert.equal(observedReleaseVersion('/home/x/releases/v0.10.25-012345abcdef/src/server-v0.3.mjs'),'0.10.25');
 assert.equal(observedReleaseVersion('/home/x/releases/v0.10.25-unknown/src/server-v0.3.mjs'),null);
 assert.equal(observedReleaseVersion('/home/x/server-v0.3.mjs --secret PRIVATE'),null);
});
test('one version with unknown peers still cannot prove compatibility',()=>fixture(async(store)=>{
 const c=channel();
 await main(['--preflight'],{store,scanDispatchers:async()=>({
  scan:'ADVISORY_ONLY',coverage:'PROCESS_CENSUS_ONLY',activeCount:2,
  active:[{pid:101,session:1,role:'core',observedVersion:'0.10.25'},
          {pid:102,session:1,role:'core',observedVersion:null}],
  quiescenceProven:true,releaseAuthorized:true
 }),output:c.out,error:c.err});
 assert.equal(c.data.dispatchers.mixedVersionObserved,false);
 assert.equal(c.data.dispatchers.unknownVersionCount,1);
 assert.equal(c.data.dispatchers.compatibilityProven,false);
 assert.equal(c.data.dispatchers.releaseAuthorized,false);
}));
