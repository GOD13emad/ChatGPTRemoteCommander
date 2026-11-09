import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runV2CoordinatorHost} from '../tools/v2-coordinator-host.mjs';

const supported=process.platform==='linux'&&process.getuid?.()!==0;
const route=(hostId,conversationId)=>({hostId,principalId:'owner',profileId:'profile',
 conversationId,operationId:'write',target:{kind:'workflow-root',id:'shared-project'}});
const a=route('host-a','chat-a'),b=route('host-b','chat-b');
const binding=r=>({hostId:r.hostId,principalId:r.principalId,profileId:r.profileId,conversationId:r.conversationId});
const sha=t=>createHash('sha256').update(t).digest('hex');
function makeConfig({grants=[a,b]}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-host-'));
 const tokenA=randomBytes(32).toString('base64url');
 const tokenB=randomBytes(32).toString('base64url');
 const data={schema:1,directory:path.join(dir,'state'),port:0,grants,
  resources:[{hostId:'host-a',target:a.target,globalId:'one-physical-project'},
             {hostId:'host-b',target:b.target,globalId:'one-physical-project'}],
  tokens:[{tokenSha256:sha(tokenA),binding:binding(a)},
          {tokenSha256:sha(tokenB),binding:binding(b)}]};
 const file=path.join(dir,'host.json');
 fs.writeFileSync(file,JSON.stringify(data),{mode:0o600,flag:'wx'});
 return {dir,file,tokenA,tokenB,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
async function request(addr,action,token,route,extra={}){
 const response=await fetch('http://'+addr.host+':'+addr.port+'/v2/lease/'+action,{
  method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
  body:JSON.stringify({route,...extra})});
 return {status:response.status,body:await response.json()};
}
test('owner-private bootstrap exposes a real loopback central lease authority', {skip:!supported}, async()=>{
 const f=makeConfig();let server;
 try{
  server=await runV2CoordinatorHost(f.file);
  assert.equal(server.addr.host,'127.0.0.1');
  const acquire=await request(server.addr,'acquire',f.tokenA,a);
  assert.equal(acquire.status,200);
  assert.equal(acquire.body.value.resource,'["global-v1","workflow-root","one-physical-project"]');
  const conflict=await request(server.addr,'acquire',f.tokenB,b);
  assert.equal(conflict.status,409);
  const release=await request(server.addr,'release',f.tokenA,a,{lease:acquire.body.value});
  assert.equal(release.status,200);
  const other=await request(server.addr,'acquire',f.tokenB,b);
  assert.equal(other.status,200);
  assert.equal(other.body.value.fence,2);
 }finally{await server?.close();f.cleanup();}
});
test('private host enforces explicit per-operation/host grants, even for enrolled tokens',{skip:!supported},async()=>{
 const f=makeConfig({grants:[a]});let server;
 try{
  server=await runV2CoordinatorHost(f.file);
  const denied=await request(server.addr,'acquire',f.tokenB,b);
  assert.equal(denied.status,403);
  const allowed=await request(server.addr,'acquire',f.tokenA,a);
  assert.equal(allowed.status,200);
 }finally{await server?.close();f.cleanup();}
});
test('unsafe world-readable inventory is refused before any port is opened',{skip:!supported},async()=>{
 const f=makeConfig();
 try{
  fs.chmodSync(f.file,0o644);
  await assert.rejects(runV2CoordinatorHost(f.file),{code:'V2_HOST_PRIVATE_CONFIG_REQUIRED'});
 }finally{f.cleanup();}
});
test('external Node owner host has distinct lifecycle and stops on SIGTERM',{skip:!supported},async()=>{
 const f=makeConfig();const cli=fileURLToPath(new URL('../tools/v2-coordinator-host.mjs',import.meta.url));
 const child=spawn(process.execPath,[cli,f.file],{stdio:['ignore','pipe','pipe']});
 let out='',err='';
 child.stdout.on('data',c=>out+=c);
 child.stderr.on('data',c=>err+=c);
 try{
  const addr=await new Promise((resolve,reject)=>{
   const limit=setTimeout(()=>reject(new Error('HOST_READY_TIMEOUT')),4000);
   child.once('error',e=>{clearTimeout(limit);reject(e);});
   const onData=()=>{
    const line=out.split('\n').find(s=>s.includes('V2_COORDINATOR_LOOPBACK_READY'));
    if(line){clearTimeout(limit);child.stdout.off('data',onData);resolve(JSON.parse(line));}
   };
   child.stdout.on('data',onData);onData();
  });
  assert.equal(addr.host,'127.0.0.1');
  const live=await request(addr,'acquire',f.tokenA,a);
  assert.equal(live.status,200);
  assert.equal(live.body.value.fence,1);
 }finally{
  child.kill('SIGTERM');
  await new Promise(resolve=>child.once('exit',resolve));
  assert.ok(err===''||(/^\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature[\s\S]*$/.test(err)),err);
  f.cleanup();
 }
});

test('actual owner-private host exposes authenticated create-once private artifact RPC',{skip:!supported},async()=>{
 const f=makeConfig();let server;
 try{
  server=await runV2CoordinatorHost(f.file);
  const acquired=await request(server.addr,'acquire',f.tokenA,a);
  assert.equal(acquired.status,200);
  const url='http://127.0.0.1:'+server.addr.port;
  const headers={authorization:'Bearer '+f.tokenA,'content-type':'application/json'};
  const create=await fetch(url+'/v2/lease/create-artifact',{method:'POST',headers,
    body:JSON.stringify({route:a,lease:acquired.body.value,
      receiptId:'private-host-1',content:'only inside owner private store'})});
  assert.equal(create.status,200);
  const body=await create.json();assert.equal(body.value.committed,true);
  const observe=await fetch(url+'/v2/lease/observe-artifact',{method:'POST',headers,
    body:JSON.stringify({route:a,receiptId:'private-host-1'})});
  assert.equal(observe.status,200);
  assert.equal((await observe.json()).value.digest,body.value.digest);
 }finally{await server?.close();f.cleanup();}
});
