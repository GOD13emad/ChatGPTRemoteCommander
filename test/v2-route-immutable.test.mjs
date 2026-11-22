import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeV2Route, assertV2CallerBinding,
  v2OperationKey, v2ResourceLeaseKey
} from '../src/v2-routing-contract.mjs';

const route=()=>({
  hostId:'host-a',principalId:'principal-a',profileId:'profile-a',
  conversationId:'chat-a',operationId:'op-a',target:{kind:'workflow-root',id:'project-a'}
});
const caller=()=>({
  hostId:'host-a',principalId:'principal-a',profileId:'profile-a',conversationId:'chat-a'
});
const rejects=(fn)=>assert.throws(fn,e=>e?.code==='V2_ROUTE_RECORD_REQUIRED');

test('top-level host getter cannot supply changing identity across validation and use',()=>{
  let calls=0;const r=route();
  Object.defineProperty(r,'hostId',{enumerable:true,get(){calls++;return calls===1?'host-a':'host-b';}});
  rejects(()=>normalizeV2Route(r));
  assert.equal(calls,0);
});

test('nested target getter cannot swap workflow resource identity',()=>{
  let calls=0;const r=route();
  Object.defineProperty(r.target,'id',{enumerable:true,get(){calls++;return calls===1?'project-a':'project-b';}});
  rejects(()=>normalizeV2Route(r));
  assert.equal(calls,0);
});

test('proxy route cannot run semantic get trap during identity parsing',()=>{
  let calls=0;const r=new Proxy(route(),{get(target,key,receiver){
    calls++;return Reflect.get(target,key,receiver);
  }});
  rejects(()=>normalizeV2Route(r));
  assert.equal(calls,0);
});

test('proxy nested target cannot run get trap during routing',()=>{
  let calls=0;const r=route();
  r.target=new Proxy(r.target,{get(target,key,receiver){calls++;return Reflect.get(target,key,receiver)}});
  rejects(()=>normalizeV2Route(r));
  assert.equal(calls,0);
});

test('authenticated observed caller must not be an accessor or proxy record',()=>{
  let calls=0;const observed=caller();
  Object.defineProperty(observed,'conversationId',{enumerable:true,get(){calls++;return 'chat-a'}});
  rejects(()=>assertV2CallerBinding(route(),observed));
  assert.equal(calls,0);
  const proxy=new Proxy(caller(),{get(target,key,receiver){calls++;return Reflect.get(target,key,receiver)}});
  rejects(()=>assertV2CallerBinding(route(),proxy));
  assert.equal(calls,0);
});

test('hidden or symbol fields cannot silently ride on principal records',()=>{
  const r=route();
  Object.defineProperty(r,'hidden',{value:'smuggled',enumerable:false});
  assert.throws(()=>normalizeV2Route(r),e=>e?.code==='V2_ROUTE_UNKNOWN_OR_MISSING_FIELD');
  const observed=caller();observed[Symbol('hidden')]=1;
  assert.throws(()=>assertV2CallerBinding(route(),observed),e=>e?.code==='V2_ROUTE_UNKNOWN_OR_MISSING_FIELD');
});

test('ordinary and null-prototype routes preserve exact frozen canonical identity',()=>{
  const input=route(), normalized=normalizeV2Route(input);
  assert.equal(normalized.hostId,'host-a');
  assert.deepEqual(normalized.target,{kind:'workflow-root',id:'project-a'});
  assert.ok(Object.isFrozen(normalized));assert.ok(Object.isFrozen(normalized.target));
  assert.equal(Object.getPrototypeOf(normalized),null);
  assert.deepEqual(assertV2CallerBinding(input,caller()),normalized);
  const c=Object.assign(Object.create(null),route());
  c.target=Object.assign(Object.create(null),input.target);
  assert.equal(v2OperationKey(c),v2OperationKey(input));
  assert.equal(v2ResourceLeaseKey(c),v2ResourceLeaseKey(input));
  const differentChat={...input,conversationId:'chat-b'};
  assert.equal(v2ResourceLeaseKey(differentChat),v2ResourceLeaseKey(input));
  assert.notEqual(v2OperationKey(differentChat),v2OperationKey(input));
});
