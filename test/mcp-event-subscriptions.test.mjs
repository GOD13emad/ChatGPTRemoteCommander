import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {EVENT_NAME} from '../src/mcp-events-security.mjs';
import {createEventSubscriptionService,buildVerifiedHttpsSender} from '../src/mcp-event-subscriptions.mjs';

const secret='whsec_'+randomBytes(32).toString('base64');
const params={name:EVENT_NAME,arguments:{project_id:'owner-qa'},cursor:null,
 delivery:{mode:'webhook',url:'https://callbacks.chatgpt.com/test',secret},ttlMs:60000};
const authorize=async ({accessToken,projectId,catalog})=>{
 if(accessToken!=='verified-host-token')throw new Error('unauthorized');
 if(catalog)return {catalog:true};
 if(projectId!=='owner-qa')throw new Error('forbidden');
 return {projectId,ownerSubject:'person-1',tenantId:'tenant-1'};
};
async function fixture(fn){
 const d=await mkdtemp(path.join(os.tmpdir(),'mcp-event-store-'));
 try{return await fn(path.join(d,'subscriptions.json'));}
 finally{await rm(d,{recursive:true,force:true});}
}
test('persistent subscription, verification, refresh, unsubscribe and redaction',()=>fixture(async file=>{
 let count=0;
 const service=()=>{
  return createEventSubscriptionService({file,authorize,now:()=>1730000000000,
   send:async ({body,secret:bytes,url})=>{
    count++;assert.equal(url,params.delivery.url);
    assert.equal(bytes.length,32);
    const data=JSON.parse(body);
    assert.equal(data.type,'verification');
    return {status:200,body:JSON.stringify({challenge:data.challenge})};
   }});
 };
 const first=await service().subscribe(params,'verified-host-token');
 assert.match(first.id,/^sub_[a-f0-9]{40}$/);
 assert.ok(first.refreshBefore);
 assert.equal(first.cursor,null);
 assert.equal((await service().inspect()).count,1);
 assert.equal((await stat(file)).mode&0o777,0o600);
 const persisted=JSON.parse(await readFile(file,'utf8'));
 assert.equal(persisted.subscriptions.length,1);
 assert.ok(!JSON.stringify(first).includes(secret));
 assert.equal((await service().subscribe(params,'verified-host-token')).id,first.id);
 assert.equal((await service().inspect()).count,1);
 assert.equal(count,2);
 assert.deepEqual(await service().unsubscribe({
  name:params.name,arguments:params.arguments,delivery:{mode:'webhook',url:params.delivery.url}
 },'verified-host-token'),{});
 assert.deepEqual(await service().unsubscribe({
  name:params.name,arguments:params.arguments,delivery:{mode:'webhook',url:params.delivery.url}
 },'verified-host-token'),{});
 assert.equal((await service().inspect()).count,0);
}));
test('no authorization, challenge mismatch or invalid TTL can persist state',()=>fixture(async file=>{
 const service=createEventSubscriptionService({file,authorize,
  send:async()=>({status:200,body:'{"challenge":"invalid"}'})});
 await assert.rejects(service.subscribe(params,'unauthorized'),/unauthorized/);
 await assert.rejects(service.subscribe(params,'verified-host-token'),/CHALLENGE_FAILED/);
 await assert.rejects(service.subscribe({...params,ttlMs:-1},'verified-host-token'),/TTL_INVALID/);
 assert.equal((await service.inspect()).count,0);
}));
test('events list requires trusted token and publication cannot bypass owner revalidation',()=>fixture(async file=>{
 const send=async({body})=>({status:200,body:JSON.stringify({challenge:JSON.parse(body).challenge})});
 const service=createEventSubscriptionService({file,authorize,send});
 await assert.rejects(service.list('unverified'),/unauthorized/);
 assert.equal((await service.list('verified-host-token')).events[0].name,EVENT_NAME);
 await service.subscribe(params,'verified-host-token');
 await assert.rejects(service.publish({name:EVENT_NAME,eventId:'evt_1',
  timestamp:'2026-10-29T15:00:00Z',data:{project_id:'owner-qa'}}),
  /OWNER_REVALIDATION_REQUIRED/);
 assert.deepEqual(await service.publish({name:EVENT_NAME,eventId:'evt_2',
  timestamp:'2026-10-29T15:00:00Z',data:{project_id:'other'}}),{webhookReceipts:0,chatDelivered:0});
}));
test('actual outbound URL is TLS pinned, signed and redirects are not followed',async()=>{
 let opts;
 const fakeRequest=(options,handler)=>{
  opts=options;
  const hooks={};
  return {on(name,cb){hooks[name]=cb;return this;},end(body){
   const reply={statusCode:302,on(name,cb){
    if(name==='data')cb(Buffer.from(''));if(name==='end')cb();return this;}};
   handler(reply);
  },destroy(e){hooks.error?.(e)}};
 };
 const sender=buildVerifiedHttpsSender({
  resolve:async url=>({url,hostname:'events.chatgpt.com',address:'8.8.8.8'}),
  request:fakeRequest
 });
 const out=await sender({url:'https://events.chatgpt.com/callback',
  secret:randomBytes(32),id:'msg_test_1',subscriptionId:'sub_123',
  body:'{"type":"verification","challenge":"a"}'});
 assert.equal(out.status,302);
 assert.equal(opts.hostname,'events.chatgpt.com');
 assert.equal(opts.servername,'events.chatgpt.com');
 assert.equal(opts.rejectUnauthorized,true);
 assert.equal(opts.agent,false);
 assert.equal(opts.headers['X-MCP-Subscription-Id'],'sub_123');
 await new Promise((yes,no)=>opts.lookup('events.chatgpt.com',{},(err,address,family)=>{
  if(err)no(err);else{assert.equal(address,'8.8.8.8');assert.equal(family,4);yes();}
 }));
});

test('publication rechecks owner, retries transient callback errors only, never chat-acks',()=>fixture(async file=>{
 let call=0, ownerCalls=0;const slept=[];const delivered=[];
 const service=createEventSubscriptionService({
  file,authorize,now:()=>1730000000000,
  sleep:async ms=>slept.push(ms),
  revalidateOwner:async principal=>{
   ownerCalls++;assert.equal(principal.projectId,'owner-qa');
   return true;
  },
  send:async ({body,id,subscriptionId})=>{
   if(JSON.parse(body).type==='verification')
    return {status:200,body:JSON.stringify({challenge:JSON.parse(body).challenge})};
   call++;delivered.push({id,subscriptionId});
   return {status:call===1?503:204,body:''};
  }
 });
 await service.subscribe(params,'verified-host-token');
 const result=await service.publish({name:EVENT_NAME,eventId:'evt_test_stable',
  timestamp:'2026-10-29T15:00:00Z',data:{project_id:'owner-qa'}});
 assert.deepEqual(result,{webhookReceipts:1,chatDelivered:0});
 assert.equal(ownerCalls,1);
 assert.deepEqual(slept,[200]);
 assert.equal(delivered.length,2);
 assert.equal(delivered[0].id,delivered[1].id);
 assert.equal(delivered[0].subscriptionId,delivered[1].subscriptionId);
}));
test('revoked ownership prevents outbound event and no retry on 410',()=>fixture(async file=>{
 let sent=0;
 const send=async ({body})=>{
  if(JSON.parse(body).type==='verification')
   return {status:200,body:JSON.stringify({challenge:JSON.parse(body).challenge})};
  sent++;return {status:410,body:''};
 };
 const revoked=createEventSubscriptionService({file,authorize,send,
  revalidateOwner:async()=>false});
 await revoked.subscribe(params,'verified-host-token');
 const event={name:EVENT_NAME,eventId:'evt_revoked',
  timestamp:'2026-10-29T15:00:00Z',data:{project_id:'owner-qa'}};
 assert.deepEqual(await revoked.publish(event),{webhookReceipts:0,chatDelivered:0});
 assert.equal(sent,0);
 const allowed=createEventSubscriptionService({file,authorize,send,
  revalidateOwner:async()=>true,sleep:async()=>{throw Error('unexpected retry')}});
 assert.deepEqual(await allowed.publish(event),{webhookReceipts:0,chatDelivered:0});
 assert.equal(sent,1);
}));
