// Canonical test fixture: copy to isolated CoS 2.1.50 <checkout>/test/v2-local-ollama-live.qa.test.ts.
// Requires user-local Ollama qwen3:4b-instruct; does not execute tools or enable Goal.
// Disposable, owner-local integration QA. No app/tool execution or production settings.
import { test,expect,vi } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('electron', () => ({
  app: { getPath: () => '', getVersion: () => '0.0.0' },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptStringAsync: async (v:string) => Buffer.from(v),
    decryptStringAsync: async (v:Buffer) => ({result:v.toString(),shouldReEncrypt:false})
  }
}));
const {defaultConfig,initConfigPath,saveConfig}=await import('../src/main/config.js');
const {initSecretsPath}=await import('../src/main/secrets.js');
const {draftTaskPlan,resolveGoalBaseUrl}=await import('../src/main/goal.js');

test('REAL CoS Goal transport -> Ollama OpenAI-compatible planning, no tools',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cos-v2-real-ollama-'));
 try {
   initConfigPath(dir);initSecretsPath(dir);
   const before=defaultConfig();
   await saveConfig({...before,goal:{...before.goal,enabled:false,backend:'api',
     provider:{kind:'custom',baseUrl:'http://127.0.0.1:11434/v1'},
     model:'qwen3:4b-instruct',reasoning:'default'}});
   expect(resolveGoalBaseUrl({kind:'custom',baseUrl:'http://127.0.0.1:11434/v1'}))
    .toBe('http://127.0.0.1:11434/v1');
   const realFetch=globalThis.fetch;
   vi.stubGlobal('fetch',async(...args:Parameters<typeof fetch>)=>{
     const response=await realFetch(...args);
     const rawWire=await response.clone().text();
     const dataPackets=rawWire.split(String.fromCharCode(10)).filter(x=>x.startsWith('data: ')).map(x=>{
       try{return JSON.parse(x.slice(6));}catch{return null;}
     }).filter(Boolean);
     const req=JSON.parse(String(args[1]?.body??'{}'));
     const raw=dataPackets.map(x=>String(x?.choices?.[0]?.delta?.content??x?.choices?.[0]?.message?.content??'')).join('');
     console.log('COS_GOAL_NATIVE_RESPONSE_DIAGNOSTIC',JSON.stringify({
        status:response.status,format:req.response_format?.type??null,stream:req.stream,
        model:dataPackets[0]?.model??null,replyChars:raw.length,
        packets:dataPackets.length,wireChars:rawWire.length,finish:dataPackets.findLast(x=>x?.choices?.[0]?.finish_reason)?.choices?.[0]?.finish_reason??null
     }));
     return response;
   });
   const stages=await draftTaskPlan(
     'Plan a harmless static Hello World HTML page, with exactly 2 short workflow stages: implement and verify. Do not run commands or alter files. Return the plan only.',
     'api',undefined,AbortSignal.timeout(90000));
   expect(stages.length).toBeGreaterThanOrEqual(2);
   expect(stages.length).toBeLessThanOrEqual(12);
   expect(stages.every(x=>typeof x==='string' && x.trim().length>0)).toBe(true);
   console.log(JSON.stringify({gate:'COS_GOAL_TRANSPORT_REAL_OLLAMA_PASS',stages:stages.length,
      firstStageChars:stages[0]?.length,provider:'custom',model:'qwen3:4b-instruct',
      appGoalEnabled:false,toolsExecuted:false}));
 }finally{await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:80});}
},110000);


test('schema-native planner preserves quotes and fails closed on malformed or unsafe stages',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cos-v2-plan-guard-'));
 try{
   initConfigPath(dir);initSecretsPath(dir);
   const baseline=defaultConfig();
   await saveConfig({...baseline,goal:{...baseline.goal,enabled:false,backend:'api',
     provider:{kind:'custom',baseUrl:'http://127.0.0.1:11434/v1'},
     model:'qwen3:4b-instruct',reasoning:'default'}});
   let mocked:any={};
   vi.stubGlobal('fetch',async(_url:string,init?:RequestInit)=>{
     const body=JSON.parse(String(init?.body??'{}'));
     expect(body.response_format).toMatchObject({type:'json_schema',
       json_schema:{name:'goal_workflow_plan',strict:true}});
     expect(body.response_format.json_schema.schema.properties.stages.type).toBe('array');
     expect(body.response_format.json_schema.schema.properties).not.toHaveProperty('reply');
     expect(body).not.toHaveProperty('tools');
     expect(body).not.toHaveProperty('plugins');
     return Response.json({choices:[{message:{content:JSON.stringify(mocked)}}]});
   });
   mocked={action:'continue',stages:['Implement file named "hello-world.html"', 'Verify safely']};
   expect(await draftTaskPlan('Produce two safe workflow stages','api')).toEqual(mocked.stages);
   for(const malformed of [
     {action:'continue',stages:['only one']},
     {action:'continue',stages:['good','verify'],extra:'unexpected'},
     {action:'stop',stages:['stage 1','stage 2']},
     {action:'continue',stages:['stage 1','<|im_start|> destructive marker']},
   ]){
     mocked=malformed;
     await expect(draftTaskPlan('Produce safe workflow stages','api')).rejects.toThrow();
   }
   console.log(JSON.stringify({gate:'COS_GOAL_DIRECT_SCHEMA_FAIL_CLOSED_PASS',
     validQuotesPreserved:true,negativeCases:4,actualToolEffects:false}));
 }finally{
   vi.unstubAllGlobals();
   await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:80});
 }
},20000);
