import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {V2CentralCoordinator} from '../src/v2-central-coordinator.mjs';
import {createV2CoordinatorRpcServer,createV2RpcTokenLookup} from '../src/v2-coordinator-rpc.mjs';

const token=()=>randomBytes(32).toString('base64url');
const route=(hostId,conversationId)=>({hostId,principalId:'owner',profileId:'profile',
 conversationId,operationId:'write',target:{kind:'workflow-root',id:'shared-project'}});
const a=route('host-a','chat-a'),b=route('host-b','chat-b');
const binding=(r)=>({hostId:r.hostId,principalId:r.principalId,
 profileId:r.profileId,conversationId:r.conversationId});
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
async function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-rpc-'));
 let clock=250000;
 const one=token(),two=token();
 const auth=createV2RpcTokenLookup([
  {tokenSha256:sha(one),binding:binding(a)},
  {tokenSha256:sha(two),binding:binding(b)}
 ]);
 const coordinator=new V2CentralCoordinator({directory:dir,now:()=>clock,
  authorizeLease:async()=>true,
  resolveGlobalResource:async r=>r.target.kind==='workflow-root'?'corp-repo-root':null,
  requireGlobalResource:true});
 const server=createV2CoordinatorRpcServer({coordinator,lookupToken:auth});
 const {host,port}=await server.listen();
 const request=async(action,secret,body,{method='POST',headers={}}={})=>{
  const result=await fetch('http://'+host+':'+port+'/v2/lease/'+action,{
   method,headers:{
    'content-type':'application/json',
    ...(secret?{authorization:'Bearer '+secret}:{}),
    ...headers},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})
  });
  return {status:result.status,data:await result.json()};
 };
 return {dir,one,two,request,a,b,advance:n=>clock+=n,
  close:async()=>{await server.close();coordinator.close();fs.rmSync(dir,{recursive:true,force:true});},
  restart:async()=>{await server.close();coordinator.close();
    const next=new V2CentralCoordinator({directory:dir,now:()=>clock,authorizeLease:async()=>true,
      resolveGlobalResource:async()=> 'corp-repo-root',requireGlobalResource:true});
    const rpc=createV2CoordinatorRpcServer({coordinator:next,lookupToken:auth});
    const url=await rpc.listen();
    return {url,close:async()=>{await rpc.close();next.close();fs.rmSync(dir,{recursive:true,force:true});},
      request:async(action,secret,body)=>{const r=await fetch('http://'+url.host+':'+url.port+'/v2/lease/'+action,{
       method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secret},body:JSON.stringify(body)});
       return {status:r.status,data:await r.json()};}};}
 };
}
test('two authenticated host/chat clients contend on one globally fenced lease',async()=>{
 const f=await fixture();
 try{
  const first=await f.request('acquire',f.one,{route:f.a,ttlMs:2000});
  assert.equal(first.status,200);
  assert.equal(first.data.value.fence,1);
  assert.equal(first.data.value.resource,'["global-v1","workflow-root","corp-repo-root"]');
  const busy=await f.request('acquire',f.two,{route:f.b});
  assert.equal(busy.status,409);
  assert.equal(busy.data.error,'V2_COORDINATOR_RESOURCE_BUSY');
  const retry=await f.request('acquire',f.one,{route:f.a});
  assert.deepEqual(retry.data.value,first.data.value);
  const wrong=await f.request('assert',f.two,{route:f.b,lease:first.data.value});
  assert.equal(wrong.status,409);
  const ok=await f.request('assert',f.one,{route:f.a,lease:first.data.value});
  assert.equal(ok.status,200);
  const released=await f.request('release',f.one,{route:f.a,lease:first.data.value});
  assert.deepEqual(released,{status:200,data:{ok:true,value:true}});
  const successor=await f.request('acquire',f.two,{route:f.b});
  assert.equal(successor.status,200);
  assert.equal(successor.data.value.fence,2);
 }finally{await f.close();}
});
test('authenticated token cannot claim different host, chat, or profile identity',async()=>{
 const f=await fixture();
 try{
  for(const modified of [f.b,{...f.a,conversationId:'chat-b'},
   {...f.a,profileId:'other'}]){
   const result=await f.request('acquire',f.one,{route:modified});
   assert.equal(result.status,422);
   assert.equal(result.data.error,'V2_ROUTE_CALLER_MISMATCH');
  }
  assert.equal((await f.request('acquire',token(),{route:f.a})).status,401);
  assert.equal((await f.request('acquire',null,{route:f.a})).status,401);
 }finally{await f.close();}
});
test('HTTP boundary denies non-POST, origins, cookies, unknown paths and invalid body',async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.request('acquire',f.one,{}, {method:'GET'})).status,404);
  assert.equal((await f.request('other',f.one,{route:f.a})).status,404);
  assert.equal((await f.request('acquire',f.one,{route:f.a},{headers:{origin:'https://malicious.example'}})).status,400);
  assert.equal((await f.request('acquire',f.one,{route:f.a},{headers:{cookie:'x=1'}})).status,400);
  assert.equal((await f.request('acquire',f.one,'not json')).status,400);
  assert.equal((await f.request('acquire',f.one,{route:f.a,extra:'caller-grant'})).status,400);
  assert.equal((await f.request('acquire',f.one,{route:f.a,lease:{id:'fake'}})).status,400);
  assert.equal((await f.request('acquire',f.one,{route:f.a,ttlMs:20})).status,422);
 }finally{await f.close();}
});
test('restart retains fence and rejects earlier expired lease',async()=>{
 const f=await fixture();let next=null;
 try{
  const old=await f.request('acquire',f.one,{route:f.a,ttlMs:1000});
  assert.equal(old.status,200);
  f.advance(1001);
  next=await f.restart();
  const res=await next.request('acquire',f.two,{route:f.b});
  assert.equal(res.status,200);
  assert.equal(res.data.value.fence,2);
  const stale=await next.request('assert',f.one,{route:f.a,lease:old.data.value});
  assert.equal(stale.status,409);
 }finally{if(next)await next.close();else await f.close();}
});
test('oversized JSON and exceptions never disclose tokens or internal stack traces',async()=>{
 const f=await fixture();
 try{
  const oversize=await f.request('acquire',f.one,
    {route:f.a,untrustedPadding:'X'.repeat(9000)});
  assert.equal(oversize.status,413);
  const unavailable=await f.request('assert',f.one,{route:f.a,lease:{id:'forged'}});
  assert.equal(unavailable.status,422);
  assert.equal(JSON.stringify(unavailable.data).includes(f.one),false);
 }finally{await f.close();}
});
test('invalid trusted token registry, non-loopback claims and unknown bootstraps refuse setup',()=>{
 assert.throws(()=>createV2RpcTokenLookup([]),{code:'V2_RPC_TRUSTED_TOKENS_REQUIRED'});
 assert.throws(()=>createV2RpcTokenLookup([{tokenSha256:'bad',binding:binding(a)}]),
  {code:'V2_RPC_TRUSTED_TOKEN_INVALID'});
 const t=token();
 assert.throws(()=>createV2RpcTokenLookup([
  {tokenSha256:sha(t),binding:binding(a)},
  {tokenSha256:sha(t),binding:binding(b)}]),{code:'V2_RPC_DUPLICATE_TOKEN'});
 assert.throws(()=>createV2CoordinatorRpcServer({}),{code:'V2_RPC_TRUSTED_BOOTSTRAP_REQUIRED'});
});
