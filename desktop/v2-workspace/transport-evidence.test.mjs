import test from 'node:test';
import assert from 'node:assert/strict';
import {readV2LocalTransport} from './transport-evidence.mjs';
test('each pinned host only reports unauthenticated transport evidence',async()=>{
 for(const [hostname,platform,port,role] of [
  ['Emad-PC-Ultimate','win32',48789,'LOCAL_RELAY'],
  ['aliemad-Labtop','linux',48789,'LOCAL_RELAY'],
  ['mmz-LOQ-15IRX9','linux',48787,'LOCAL_COORDINATOR']
 ]){
  let seen;
  const result=await readV2LocalTransport({hostname,platform,
   fetchImpl:async(url,opts)=>{seen={url,opts};return {status:401};}
  });
  assert.equal(seen.url,'http://127.0.0.1:'+port+'/v2/lease/get-receipt');
  assert.equal(seen.opts.method,'POST');
  assert.equal(seen.opts.body,'{}');
  assert.equal(seen.opts.headers.authorization,undefined);
  assert.equal(result.state,'ANONYMOUS_DENIED');
  assert.equal(result.role,role);
  assert.equal(result.ownerRpcAuthenticated,false);
  assert.equal(result.chatGPTOAuthVerified,false);
  assert.equal(result.workerEffectVerified,false);
 }
});
test('replies other than 401 cannot promote authentication',async()=>{
 for(const status of [200,201,302,403,404,500]){
  const r=await readV2LocalTransport({hostname:'aliemad-Labtop',platform:'linux',
   fetchImpl:async()=>({status})});
  assert.equal(r.state,'RESPONSE_NOT_VERIFIED');
  assert.equal(r.ownerRpcAuthenticated,false);
 }
});
test('unknown hosts, different OS and invalid readers are never probed',async()=>{
 let calls=0;
 const reader=async()=>{calls++;return {status:401};};
 for(const [hostname,platform]of [['unknown','linux'],['Emad-PC-Ultimate','linux'],['mmz-LOQ-15IRX9','win32']]){
  const r=await readV2LocalTransport({hostname,platform,fetchImpl:reader});
  assert.equal(r.state,'NOT_CONFIGURED');
  assert.equal(r.endpoint,null);
 }
 const x=await readV2LocalTransport({hostname:'Emad-PC-Ultimate',platform:'win32',
  fetchImpl:null});
 assert.equal(x.state,'UNVERIFIED');
 assert.equal(calls,0);
});
test('network errors/timeout are no evidence of worker connection',async()=>{
 const r=await readV2LocalTransport({hostname:'Emad-PC-Ultimate',platform:'win32',
  fetchImpl:async()=>{throw Error('secret-from-transport');}});
 assert.equal(r.state,'UNREACHABLE');
 assert.doesNotMatch(JSON.stringify(r),/secret-from-transport/);
});
