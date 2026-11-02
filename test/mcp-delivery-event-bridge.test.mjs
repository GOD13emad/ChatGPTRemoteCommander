import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {DeliveryStore} from '../src/delivery-store.mjs';
import {createAsyncOperationTools} from '../src/async-operations.mjs';
import {createOperationEventPublisher,operationEventFromDelivery} from '../src/mcp-delivery-event-bridge.mjs';

const operationId=randomUUID(), deliveryId=randomUUID();
const state={operationId,requestId:'r1',correlationId:'cor-1',
  continuation:{projectId:'owned-project'},status:'SUCCEEDED',finishedAt:'2026-10-29T18:00:00Z'};
const delivery={deliveryId,source:'operation',sourceId:operationId,correlationId:'cor-1'};

test('project-scoped durable receipt yields deterministic minimal event, not an ACK',async()=>{
 const e=operationEventFromDelivery(delivery,state);
 assert.equal(e.name,'operation.completed');
 assert.match(e.eventId,/^evt_[0-9a-f]{64}$/);
 assert.deepEqual(e.data,{project_id:'owned-project',correlation_id:'cor-1',
   delivery_id:deliveryId,state:'SUCCEEDED'});
 assert.deepEqual(operationEventFromDelivery(delivery,state),e);
 assert.equal(createOperationEventPublisher(null),null);
 let observed;
 const publisher=createOperationEventPublisher({publish:async event=>{
   observed=event;return {webhookReceipts:1,chatDelivered:0};}});
 assert.deepEqual(await publisher(delivery,state),{webhookReceipts:1,chatDelivered:0});
 assert.deepEqual(observed,e);
});
test('missing or spoofed association never emits an event',async()=>{
 let calls=0;
 const publish=createOperationEventPublisher({publish:async()=>{calls++;}});
 for(const [d,s] of [
  [delivery,{...state,continuation:null}],
  [delivery,{...state,continuation:{projectId:'../other'}}],
  [{...delivery,source:'tool'},state],
  [{...delivery,sourceId:randomUUID()},state],
  [{...delivery,correlationId:'unrelated'},state],
  [delivery,{...state,status:'RUNNING'}],
  [delivery,{...state,finishedAt:'invalid-date'}]
 ])assert.deepEqual(await publish(d,s),{skipped:true,chatDelivered:0});
 assert.equal(calls,0);
});

test('real terminal operation preserves durable delivery and emits matching scoped event',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'commander-event-bridge-'));
 const fixture=fileURLToPath(new URL('./async-operation-fixture.mjs',import.meta.url));
 const worker=fileURLToPath(new URL('../tools/operation-worker.mjs',import.meta.url));
 const store=new DeliveryStore({directory:path.join(dir,'delivery'),scope:'event-bridge-test'});
 const observed=[];
 const manager=createAsyncOperationTools({
  config:{instance:{profile:'event-bridge-test'},asyncOperations:{enabled:true,
   stateDir:path.join(dir,'operations'),deliveryReconcileMs:60000}},
  workerPath:worker,deliveryStore:store,
  validateContinuation:async c=>{assert.equal(c.projectId,'owned-project');},
  onDeliveryEvent:createOperationEventPublisher({publish:async event=>{
    observed.push(event);return {webhookReceipts:1,chatDelivered:0};}}),
  prepare:async(_name,args)=>({file:process.execPath,args:[fixture,'sleep','20','done'],
   cwd:dir,timeoutMs:5000,outputLimit:65536})
 });
 try{
  const started=await manager.execute('operation_start',{requestId:'bridge-test-1',
   correlationId:'cor-1',tool:'run_project_command',arguments:{},
   continuation:{projectId:'owned-project',eventKey:'bridge-test-final',root:dir}});
  let finished;
  for(let i=0;i<200;i++){
    finished=await manager.execute('operation_status',{operationId:started.operationId});
    if(finished.status==='SUCCEEDED'&&observed.length)break;
    await new Promise(r=>setTimeout(r,20));
  }
  assert.equal(finished.status,'SUCCEEDED');
  assert.equal(observed.length>=1,true);
  const stored=store.list({correlationId:'cor-1'});
  const receipt=stored.items.find(x=>x.sourceId===started.operationId);
  assert.ok(receipt);
  assert.equal(observed[0].data.delivery_id,receipt.deliveryId);
  assert.equal(observed[0].data.project_id,'owned-project');
  assert.equal(store.summary().pending,1);
  assert.equal(store.summary().counts.DELIVERED??0,0);
 }finally{store.close();await rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:50});}
});


test('full fixture: scoped terminal delivery -> verified OAuth subscription -> signed webhook receipt, never chat ACK',async()=>{
 const {generateKeyPairSync,sign}=await import('node:crypto');
 const {createConfiguredEventsEndpoint}=await import('../src/mcp-events-endpoint.mjs');
 const dir=await mkdtemp(path.join(os.tmpdir(),'commander-webhook-e2e-'));
 try{
  const kp=generateKeyPairSync('rsa',{modulusLength:2048});
  const issuer='https://issuer.example.org',resource='https://resource.example.org/mcp';
  const owner='owner-1',tenant='tenant-1';
  const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const h=b64({alg:'RS256',typ:'JWT'});
  const body=b64({iss:issuer,aud:resource,sub:owner,tenant_id:tenant,
    exp:1730240000,scope:'commander.events.subscribe'});
  const token=h+'.'+body+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+body),kp.privateKey).toString('base64url');
  const config={mcpEvents:{enabled:true,authType:'oauth-pinned-rs256',issuer,resource,
    publicKeyPem:kp.publicKey.export({format:'pem',type:'spki'}),
    projects:[{id:'owned-project',ownerSubject:owner,tenantId:tenant,ownerIssuer:issuer}],
    storeFile:path.join(dir,'subscriptions.json')}};
  const received=[];
  const send=async({body,secret,id,subscriptionId})=>{
    const value=JSON.parse(body);
    if(value.type==='verification')return {status:200,body:JSON.stringify({challenge:value.challenge})};
    received.push({value,id,subscriptionId,secretLength:secret.length});
    return {status:204,body:''};
  };
  const opts={send,now:()=>1730232000000,
    revalidateOwner:async who=>who.projectId==='owned-project'&&who.principal==='tenant-1|owner-1'};
  const endpoint=createConfiguredEventsEndpoint(config,opts);
  const params={name:'operation.completed',arguments:{project_id:'owned-project'},
    delivery:{mode:'webhook',url:'https://callbacks.chatgpt.com/e2e',
      secret:'whsec_'+Buffer.alloc(32,14).toString('base64')},cursor:null};
  const sub=await endpoint.dispatch('events/subscribe',params,'Bearer '+token);
  const result=await createOperationEventPublisher(endpoint)(delivery,state);
  assert.deepEqual(result,{webhookReceipts:1,chatDelivered:0});
  assert.equal(received.length,1);
  assert.equal(received[0].subscriptionId,sub.id);
  assert.equal(received[0].id,received[0].value.eventId);
  assert.equal(received[0].value.data.delivery_id,deliveryId);
  assert.equal(received[0].value.cursor,null);
  assert.equal(received[0].secretLength,32);
  const failClosed=createConfiguredEventsEndpoint(config,{send,now:opts.now});
  await assert.rejects(createOperationEventPublisher(failClosed)(delivery,state),/OWNER_REVALIDATION_REQUIRED/);
  assert.equal(received.length,1,'no second outbound request without current owner verification');
 }finally{await rm(dir,{recursive:true,force:true});}
});
