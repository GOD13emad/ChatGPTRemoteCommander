import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {proposeWithLocalLlamaCpp,validateLocalLlamaProposal} from '../tools/local-llamacpp-planner.mjs';
const context={goal:'Synthetic read-only verification',tools:[{name:'read_text'}]};
const proposal={action:'call',tool:'read_text',argumentsJson:'{"path":"PROJECT_BRAIN.md"}',summary:'Read only'};
function mock({value=proposal,status=200,custom}={}){
 return async(url,options)=>{
  assert.equal(url,'http://127.0.0.1:18080/v1/chat/completions');
  assert.equal(options.headers.authorization,'Bearer local-test-key');
  assert.equal(options.method,'POST');
  const body=JSON.parse(options.body);
  assert.equal(body.response_format.type,'json_schema');
  assert.equal(body.chat_template_kwargs.enable_thinking,false);
  assert.equal(body.stream,false);
  assert.equal(body.model,'rc-qwen3-4b:q4km');
  const text=JSON.stringify(custom??{choices:[{message:{content:JSON.stringify(value)}}]});
  return {ok:status===200,body:Readable.from([text])};
 };
}
test('synthetic constrained proposal parsed with trusted exact tool',async()=>{
 const v=await proposeWithLocalLlamaCpp(context,{key:'local-test-key',fetchImpl:mock()});
 assert.deepEqual(v,proposal);
});
test('wrong tool and arbitrary arguments fail closed',async()=>{
 for(const x of [
  {...proposal,tool:'run_shell'},
  {...proposal,tool:'read_text',argumentsJson:'[]'},
  {...proposal,tool:'read_text',argumentsJson:'not-json'},
  {...proposal,action:'read_text'},
  {...proposal,summary:'x',extra:'y'},
  {action:'block',tool:'read_text',argumentsJson:'{}',summary:'blocked'},
  {action:'block',tool:'',argumentsJson:'{"unsafe":true}',summary:'blocked'}
 ])await assert.rejects(proposeWithLocalLlamaCpp(context,{key:'local-test-key',fetchImpl:mock({value:x})}),/LOCAL_LLAMACPP_/);
});
test('no action block is permitted when exact empty structure',()=>{
 assert.deepEqual(validateLocalLlamaProposal({action:'block',tool:'',argumentsJson:'{}',summary:'Stop'},context),
  {action:'block',tool:'',argumentsJson:'{}',summary:'Stop'});
});
test('downstream runtime errors never leak HTTP or token text',async()=>{
 for(const v of [{status:403},{custom:{choices:[{message:{content:'not json'}}]}},
  {custom:{bad:true}}]){
  try{await proposeWithLocalLlamaCpp(context,{key:'local-test-key',fetchImpl:mock(v)});assert.fail('unexpected')}catch(err){
   assert.match(err.message,/^LOCAL_LLAMACPP_/);assert.doesNotMatch(err.message,/local-test-key/);
  }
 }
});
test('connection failure and no supplied credential never expose cause',async()=>{
 await assert.rejects(proposeWithLocalLlamaCpp(context,{key:'local-test-key',fetchImpl:async()=>{throw Error('secret-local-test-key')}}),
  /LOCAL_LLAMACPP_HTTP_UNAVAILABLE/);
 await assert.rejects(proposeWithLocalLlamaCpp(context,{}),/LOCAL_LLAMACPP_CONFIG_INVALID/);
});
test('response cap and invalid tool context reject synthetic input',async()=>{
 await assert.rejects(proposeWithLocalLlamaCpp(context,{key:'local-test-key',fetchImpl:async()=>({ok:true,body:Readable.from([Buffer.from('X'.repeat(140000))])})}),/LOCAL_LLAMACPP_RESPONSE_TOO_LARGE/);
 await assert.rejects(proposeWithLocalLlamaCpp({...context,tools:[]},{key:'local-test-key',fetchImpl:mock()}),/LOCAL_LLAMACPP_TOOL_NOT_ADMITTED/);
});
