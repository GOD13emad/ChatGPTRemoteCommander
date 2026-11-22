import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommanderTelemetry} from '../src/optional-observability-otel.mjs';

const privateMeta = {
  operationId: 'private-op-123', projectId:'private-project-123', kind:'tool', action:'write',
  token:'secret-sentinel-token', path:'/home/owner/private/file', prompt:'private-prompt-sentinel'
};
function fakeTracer({brokenStart=false,brokenEnd=false}={}) {
  const emitted=[];
  return {emitted,tracer:{startSpan(name,{attributes}) {
    if(brokenStart)throw Error('exporter failure');
    const item={name,attributes:{...attributes},ended:0};
    emitted.push(item);
    return {
      setAttribute(k,v){item.attributes[k]=v;},
      end(){item.ended++;if(brokenEnd)throw Error('exporter end failure');},
      recordException(){throw Error('must not serialize exception message or stack');}
    };
  }}};
}
test('no default export, even with tracer injected or consent omitted', async()=>{
  const r=fakeTracer(), original={status:'COMPLETED',raw:'private'};
  for(const settings of [{},{enabled:true},{ownerExportAuthorized:true},{enabled:true,ownerExportAuthorized:true}]){
    const o=createCommanderTelemetry({...settings,tracer:r.tracer});
    assert.strictEqual(await o.observe(privateMeta,async()=>original),original);
  }
  assert.equal(r.emitted.length,0);
});
test('opt-in uses only fixed enums and keyed digests, never raw data',async()=>{
  const r=fakeTracer(),key=Buffer.alloc(32,1);
  const o=createCommanderTelemetry({enabled:true,ownerExportAuthorized:true,verifyExportGrant:async()=>true,tracer:r.tracer,key});
  const result={status:'COMPLETED',content:'private-result-sentinel'};
  assert.strictEqual(await o.observe(privateMeta,async()=>result),result);
  const e=r.emitted[0];
  assert.equal(e.name,'commander.tool.operation');
  assert.equal(e.ended,1);
  assert.deepEqual(Object.keys(e.attributes).sort(),['commander.kind','commander.action','commander.operation_hash','commander.project_hash','commander.outcome'].sort());
  assert.equal(e.attributes['commander.outcome'],'reported_success');
  assert.match(e.attributes['commander.operation_hash'],/^[0-9a-f]{24}$/);
  const text=JSON.stringify(r.emitted);
  for(const value of ['private-op-123','private-project-123','secret-sentinel-token',
    '/home/owner/private/file','private-prompt-sentinel','private-result-sentinel'])
    assert.equal(text.includes(value),false,value);
});
test('identifiers stable within process key and change with other keys',async()=>{
  const a=fakeTracer(),b=fakeTracer();
  const one=createCommanderTelemetry({enabled:true,ownerExportAuthorized:true,verifyExportGrant:async()=>true,tracer:a.tracer,key:Buffer.alloc(32,1)});
  const two=createCommanderTelemetry({enabled:true,ownerExportAuthorized:true,verifyExportGrant:async()=>true,tracer:b.tracer,key:Buffer.alloc(32,2)});
  await one.observe(privateMeta,async()=>({status:'APPLIED'}));
  await one.observe(privateMeta,async()=>({status:'APPLIED'}));
  await two.observe(privateMeta,async()=>({status:'APPLIED'}));
  assert.equal(a.emitted[0].attributes['commander.project_hash'],a.emitted[1].attributes['commander.project_hash']);
  assert.notEqual(a.emitted[0].attributes['commander.project_hash'],b.emitted[0].attributes['commander.project_hash']);
});
test('unknown/uncertain/blocked results do not become success',async()=>{
  const r=fakeTracer(),o=createCommanderTelemetry({enabled:true,ownerExportAuthorized:true,verifyExportGrant:async()=>true,tracer:r.tracer});
  for(const code of ['UNCERTAIN','BLOCKED','DENIED','FAILED','NOT_APPLIED','strange']){
    await o.observe(privateMeta,async()=>({status:code}));
  }
  assert.deepEqual(r.emitted.map(x=>x.attributes['commander.outcome']),
    ['uncertain','blocked','blocked','error','not_applied','unknown']);
});
test('observer never leaks or modifies original errors and never retries',async()=>{
  const r=fakeTracer(),o=createCommanderTelemetry({enabled:true,ownerExportAuthorized:true,verifyExportGrant:async()=>true,tracer:r.tracer});
  const error=new Error('secret-private-stack-message');
  let called=0;
  await assert.rejects(()=>o.observe(privateMeta,async()=>{called++;throw error;}),e=>e===error);
  assert.equal(called,1);
  assert.equal(r.emitted[0].attributes['commander.outcome'],'error');
  assert.equal(JSON.stringify(r.emitted).includes(error.message),false);
});
test('observer failures do not change operation result, call count or retry',async()=>{
  for(const config of [{brokenStart:true},{brokenEnd:true}]){
    const r=fakeTracer(config),o=createCommanderTelemetry({enabled:true,ownerExportAuthorized:true,verifyExportGrant:async()=>true,tracer:r.tracer});
    let count=0;
    const v=await o.observe(privateMeta,async()=>{count++;return {status:'COMPLETED'};});
    assert.equal(v.status,'COMPLETED');
    assert.equal(count,1);
  }
});
test('untrusted extra fields and malformed identifiers cannot be emitted',async()=>{
  const r=fakeTracer(),o=createCommanderTelemetry({enabled:true,ownerExportAuthorized:true,verifyExportGrant:async()=>true,tracer:r.tracer});
  await o.observe({...privateMeta,kind:'other',action:'deleteEverything',operationId:'x'.repeat(300),
    projectId:'\0bad'},async()=>({status:'COMPLETED'}));
  assert.deepEqual(r.emitted[0].attributes,
    {'commander.kind':'unknown','commander.action':'unknown','commander.outcome':'reported_success'});
});
test('malicious metadata getters cannot block an authorized operation',async()=>{
  const r=fakeTracer(),o=createCommanderTelemetry({
    enabled:true,ownerExportAuthorized:true,verifyExportGrant:async()=>true,tracer:r.tracer
  });
  const meta=new Proxy({}, {get(){throw new Error('untrusted getter should not escape');}});
  let called=0;
  const result=await o.observe(meta,async()=>{called++;return {status:'COMPLETED'};});
  assert.equal(result.status,'COMPLETED');
  assert.equal(called,1);
  assert.deepEqual(r.emitted[0].attributes,{
    'commander.kind':'unknown','commander.action':'unknown','commander.outcome':'reported_success'
  });
});
test('invalid tracer property getter cannot block operations or enable export',async()=>{
  const tracer={};
  Object.defineProperty(tracer,'startSpan',{get(){throw Error('tracer getter failure');}});
  const observer=createCommanderTelemetry({enabled:true,ownerExportAuthorized:true,verifyExportGrant:async()=>true,tracer});
  let calls=0;
  const result=await observer.observe(privateMeta,async()=>{calls++;return {status:'COMPLETED'};});
  assert.equal(result.status,'COMPLETED');
  assert.equal(calls,1);
});

test('malicious status getter never leaks or changes returned receipt',async()=>{
  const r=fakeTracer(),o=createCommanderTelemetry({enabled:true,ownerExportAuthorized:true,verifyExportGrant:async()=>true,tracer:r.tracer});
  const result=new Proxy({}, {get(_target,field){if(field==='then')return undefined;throw Error('private receipt getter must not escape');}});
  const actual=await o.observe(privateMeta,async()=>result);
  assert.strictEqual(actual,result);
  assert.equal(r.emitted[0].attributes['commander.outcome'],'unknown');
});

test('per-operation owner grant revocation disables emission without blocking operation',async()=>{
  const r=fakeTracer();
  let allowed=true,verifyCount=0,calls=0;
  const o=createCommanderTelemetry({enabled:true,ownerExportAuthorized:true,
    verifyExportGrant:async()=>{verifyCount++;return allowed;},tracer:r.tracer});
  await o.observe(privateMeta,async()=>{calls++;return {status:'COMPLETED'};});
  allowed=false;
  await o.observe(privateMeta,async()=>{calls++;return {status:'COMPLETED'};});
  assert.equal(verifyCount,2);
  assert.equal(calls,2);
  assert.equal(r.emitted.length,1);
});
test('denied/throwing/missing verifier denies telemetry while preserving business outcome',async()=>{
  const r=fakeTracer();let called=0;
  const checks=[undefined,async()=>false,async()=>{throw new Error('private auth failure')}];
  for(const verifyExportGrant of checks){
    const o=createCommanderTelemetry({enabled:true,ownerExportAuthorized:true,
      verifyExportGrant,tracer:r.tracer});
    const response=await o.observe(privateMeta,async()=>{called++;return {status:'COMPLETED'};});
    assert.equal(response.status,'COMPLETED');
  }
  assert.equal(called,3);
  assert.equal(r.emitted.length,0);
});

test('a never-resolving grant verifier cannot hang an operation or emit a span',async()=>{
  const r=fakeTracer(),o=createCommanderTelemetry({enabled:true,ownerExportAuthorized:true,
    verifyExportGrant:()=>new Promise(()=>{}),grantTimeoutMs:20,tracer:r.tracer});
  let count=0;
  const started=Date.now();
  const receipt=await o.observe(privateMeta,async()=>{count++;return {status:'COMPLETED'};});
  assert.equal(receipt.status,'COMPLETED');
  assert.equal(count,1);
  assert.equal(r.emitted.length,0);
  assert.ok(Date.now()-started<2000,'bounded grant verification');
});
test('grant revoked while business operation executes suppresses its final span',async()=>{
  const r=fakeTracer();
  let permitted=true;
  const o=createCommanderTelemetry({enabled:true,ownerExportAuthorized:true,
    verifyExportGrant:async()=>permitted,tracer:r.tracer});
  const result=await o.observe(privateMeta,async()=>{
    permitted=false;
    return {status:'COMPLETED'};
  });
  assert.equal(result.status,'COMPLETED');
  assert.equal(r.emitted.length,0);
});
