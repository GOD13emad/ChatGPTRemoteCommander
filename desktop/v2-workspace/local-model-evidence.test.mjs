import test from 'node:test';
import assert from 'node:assert/strict';
import {readLocalModelCatalog} from './local-model-evidence.mjs';
import {createWorkspace} from './server.mjs';

const hdr={'content-type':'application/json'};
const fake=(x)=>new Response(JSON.stringify(x),{status:200,headers:hdr});
test('Ollama is fixed loopback-only and returns bounded nonexecution inventory',async()=>{
 let url, method, redirect;
 const state=await readLocalModelCatalog({request:async(u,opt)=>{
   url=u;method=opt.method;redirect=opt.redirect;
   return fake({models:[{name:'qwen3:4b-instruct',size:1024,details:{secrets:'do not leak'}},
     {name:'llama3.2:3b',size:1048576}],token:'SECRET_PRIVATE'});
 }});
 assert.equal(url,'http://127.0.0.1:11434/api/tags');
 assert.equal(method,'GET'); assert.equal(redirect,'error');
 assert.deepEqual(state,{schema:1,source:'LOCAL_OLLAMA_CATALOG',
    state:'MODEL_CATALOG_OBSERVED',modelCount:2,models:['qwen3:4b-instruct','llama3.2:3b'],
    workerEffectVerified:false,canExecute:false,chatAuthenticated:false});
 assert.doesNotMatch(JSON.stringify(state),/SECRET_PRIVATE|do not leak/);
});
test('unavailable, forged or oversized catalog never implies inference readiness',async()=>{
 for(const response of [
   async()=>{throw Error('private endpoint auth');},
   async()=>fake({models:[{name:'<script>alert(1)</script>'}]}),
   async()=>fake({models:'not array'}),
   async()=>new Response('a'.repeat(140*1024),{headers:hdr})
 ]){
   const state=await readLocalModelCatalog({request:response});
   assert.notEqual(state.state,'MODEL_CATALOG_OBSERVED');
   assert.equal(state.canExecute,false);
   assert.equal(state.workerEffectVerified,false);
   assert.equal(JSON.stringify(state).includes('private endpoint auth'),false);
 }
 await assert.rejects(readLocalModelCatalog({request:42}),/CONFIG_INVALID/);
});
test('Workspace local-model API requires token and has strict nonexecution normalization',async t=>{
 let called=0;
 const app=await createWorkspace({port:0,localModelReader:async()=>{
   called++;
   return {schema:1,source:'LOCAL_OLLAMA_CATALOG',state:'MODEL_CATALOG_OBSERVED',
     modelCount:1,models:['qwen3:4b-instruct'],workerEffectVerified:false,canExecute:false,
     chatAuthenticated:false,secret:'MUST_NOT_LEAK'};
 }});
 t.after(()=>new Promise(r=>app.server.close(r)));
 const url='http://127.0.0.1:'+app.port+'/api/local-ai';
 assert.equal((await fetch(url)).status,403);
 assert.equal((await fetch(url,{method:'POST'})).status,405);
 assert.equal(called,0);
 const response=await fetch(url,{headers:{'X-Commander-Workspace-Token':app.token}});
 assert.equal(response.status,200);
 const text=await response.text();
 assert.equal(called,1);
 assert.doesNotMatch(text,/MUST_NOT_LEAK/);
 const obj=JSON.parse(text);
 assert.equal(obj.modelCount,1);
 assert.equal(obj.canExecute,false);
 assert.equal(obj.chatAuthenticated,false);
});
test('forged execution claims rejected without exposing model details',async t=>{
 const app=await createWorkspace({port:0,localModelReader:async()=>({
   schema:1,source:'LOCAL_OLLAMA_CATALOG',state:'MODEL_CATALOG_OBSERVED',
   modelCount:1,models:['qwen3:4b-instruct'],canExecute:true,
   workerEffectVerified:true,chatAuthenticated:true,secret:'DO_NOT_LEAK'})});
 t.after(()=>new Promise(r=>app.server.close(r)));
 const r=await fetch('http://127.0.0.1:'+app.port+'/api/local-ai',{
   headers:{'X-Commander-Workspace-Token':app.token}});
 assert.equal(r.status,503);
 const text=await r.text();
 assert.doesNotMatch(text,/DO_NOT_LEAK/);
 const data=JSON.parse(text);
 assert.equal(data.canExecute,false);
 assert.equal(data.workerEffectVerified,false);
});
