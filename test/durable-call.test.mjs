import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeliveryStore } from '../src/delivery-store.mjs';
import { createDurableCall } from '../src/durable-call.mjs';
import { validateJsonSchema } from '../src/schema-validator.mjs';

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-durable-call-'));
  const store=new DeliveryStore({directory:path.join(root,'delivery'),scope:'profile-a'});
  let effects=0;
  const definitions={
    mutate:{name:'mutate',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}},
    explode:{name:'explode',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}},
    read:{name:'read',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
    run_shell:{name:'run_shell',inputSchema:{type:'object',properties:{command:{type:'string'}},required:['command'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}}
  };
  const call=createDurableCall({
    deliveryStore:store,lookup:name=>definitions[name],validateSchema:validateJsonSchema,
    dispatch:async(name,args)=>{
      if(name==='mutate'){effects++;return {ok:true,value:args.value,effects};}
      if(name==='explode'){effects++;throw new Error('lost acknowledgement after possible effect');}
      throw new Error('unexpected dispatch');
    }
  });
  return {root,store,call,get effects(){return effects;},dispose(){store.close();fs.rmSync(root,{recursive:true,force:true});}};
}

test('exact retry returns one durable result and never repeats mutation',async()=>{
  const f=fixture();try{
    const input={requestId:'request-one',correlationId:'chat-a',tool:'mutate',arguments:{value:'x'}};
    const first=await f.call.execute(input);
    assert.equal(first.status,'COMPLETED');assert.equal(first.duplicate,false);assert.equal(f.effects,1);
    const retry=await f.call.execute(input);
    assert.equal(retry.status,'COMPLETED');assert.equal(retry.duplicate,true);assert.equal(retry.replayedEffect,false);assert.equal(f.effects,1);
    assert.equal(retry.deliveryId,first.deliveryId);
    const event=f.store.get(first.deliveryId,'chat-a');assert.equal(event.kind,'COMPLETED');
  }finally{f.dispose();}
});

test('same requestId with changed input or correlation fails closed',async()=>{
  const f=fixture();try{
    await f.call.execute({requestId:'request-two',correlationId:'chat-a',tool:'mutate',arguments:{value:'x'}});
    await assert.rejects(f.call.execute({requestId:'request-two',correlationId:'chat-a',tool:'mutate',arguments:{value:'y'}}),/REQUEST_ID_CONFLICT/);
    await assert.rejects(f.call.execute({requestId:'request-two',correlationId:'chat-b',tool:'mutate',arguments:{value:'x'}}),/REQUEST_ID_CONFLICT/);
    assert.equal(f.effects,1);
  }finally{f.dispose();}
});

test('ambiguous mutation error becomes durable UNCERTAIN and retry never replays',async()=>{
  const f=fixture();try{
    const input={requestId:'request-three',correlationId:'chat-a',tool:'explode',arguments:{}};
    const first=await f.call.execute(input);
    assert.equal(first.status,'UNCERTAIN');assert.equal(first.reconcileRequired,true);assert.equal(f.effects,1);
    const retry=await f.call.execute(input);
    assert.equal(retry.status,'UNCERTAIN');assert.equal(retry.duplicate,true);assert.equal(f.effects,1);
    const event=f.store.get(first.deliveryId,'chat-a');assert.equal(event.kind,'UNCERTAIN');
  }finally{f.dispose();}
});

test('read-only and command targets are refused before durable effect reservation',async()=>{
  const f=fixture();try{
    await assert.rejects(f.call.execute({requestId:'read-one',tool:'read',arguments:{}}),/DURABLE_CALL_MUTATION_REQUIRED/);
    await assert.rejects(f.call.execute({requestId:'cmd-one',tool:'run_shell',arguments:{command:'echo x'}}),/DURABLE_COMMAND_REQUIRES_OPERATION_START/);
    assert.throws(()=>f.store.request('read-one'),/DELIVERY_REQUEST_NOT_FOUND/);
    assert.throws(()=>f.store.request('cmd-one'),/DELIVERY_REQUEST_NOT_FOUND/);
  }finally{f.dispose();}
});
