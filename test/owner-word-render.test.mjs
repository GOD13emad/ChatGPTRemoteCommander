import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {workspaceToolDefinitions,workspaceMutationEffectArgs,executeWorkspaceTool}
 from '../src/workspace-tools.mjs';
import {createOwnerWorkspaceProxy} from '../src/owner-workspace-proxy.mjs';
import {validateJsonSchema} from '../src/schema-validator.mjs';
const word=workspaceToolDefinitions.find(t=>t.name==='workspace_word_render');
const args={sourcePath:'C:/Users/Test/documents/source.docx',
 outputPdfPath:'C:/Users/Test/documents/result.pdf',
 requestId:'word-owner-qa-20261030-01',
 explicitUserAuthorization:'Authorized to render exactly this DOCX only'};
test('owner Word tool is available only with explicit input/output authority and stable receipt',()=>{
 assert.ok(word);
 assert.equal(word.annotations.readOnlyHint,false);
 assert.ok(word.inputSchema.required.includes('explicitUserAuthorization'));
 assert.equal(validateJsonSchema(args,word.inputSchema).length,0);
 assert.ok(validateJsonSchema({...args,sourcePath:undefined},word.inputSchema).length);
 assert.equal(workspaceMutationEffectArgs(word.name,args,'request-outer-20261030').requestId,
   'request-outer-20261030');
});
test('owner Word cannot fall through from the core process into System/Session0',async()=>{
 await assert.rejects(executeWorkspaceTool({config:{powerMode:{enabled:true,
  guiControl:{enabled:true}}}},word.name,args), e=>e.code==='WORKSPACE_OWNER_SESSION_REQUIRED');
});
test('authenticated owner proxy binds caller receipt and passes exact arguments without fallback',async()=>{
 const requests=[];
 const proxy=createOwnerWorkspaceProxy({config:{ownerWorkspaceDelegation:{
   enabled:true,port:48838,authFile:path.join(process.cwd(),'never-created-real-secret')}},
  readFileImpl:async()=> 'a'.repeat(64),
  fetchImpl:async(_url,options)=>{
   requests.push(JSON.parse(options.body));
   return {status:200,text:async()=>JSON.stringify({jsonrpc:'2.0',id:1,
     result:{structuredContent:{ok:true,effect:'RENDER_VERIFIED',
       mode:'OWNER_INTERACTIVE_NATIVE_WORD',bytes:31590,sha256:'f'.repeat(64)}}})};
  }});
 await assert.rejects(proxy.execute(word.name,args,{}),
  e=>e.code==='WORKSPACE_OWNER_REQUEST_ID_REQUIRED');
 const r=await proxy.execute(word.name,args,{requestId:'outer-word-render-20261030'});
 assert.equal(r.handled,true);
 assert.equal(r.value.effect,'RENDER_VERIFIED');
 assert.equal(requests.length,1);
 const sent=requests[0].params.arguments;
 assert.equal(sent.sourcePath,args.sourcePath);
 assert.equal(sent.outputPdfPath,args.outputPdfPath);
 assert.match(sent.requestId,/^owrk-[0-9a-f]{48}$/);
 assert.notEqual(sent.requestId,args.requestId);
});
test('native Word worker validates OS owner session and disables macros and overwrite',()=>{
 const s=fs.readFileSync(path.join(import.meta.dirname,'..','tools','native-word-render-owner.ps1'),'utf8');
 const broker=fs.readFileSync(path.join(import.meta.dirname,'..','tools','workspace-owner-broker.mjs'),'utf8');
 assert.match(s,/WORKSPACE_OWNER_SESSION_REQUIRED/);
 assert.match(s,/AutomationSecurity=3/);
 assert.match(s,/ReadOnly|\$true/);
 assert.match(s,/WORD_EXISTING_INSTANCE_KEEP/);
 assert.match(s,/Get-CimInstance Win32_Process/);
 assert.match(s,/\[IO.File\]::Move\(\$part,\$destination\)/);
 assert.match(s,/WORKSPACE_WORD_DESTINATION_EXISTS/);
 assert.match(s,/WORKSPACE_WORD_EFFECT_RECONCILIATION_REQUIRED/);
 assert.match(broker,/name==='workspace_word_render'\?nativeWordRender\(args\)/);
 assert.match(broker,/timeout:110000/);
 assert.match(broker,/WORKSPACE_WORD_EFFECT_UNKNOWN/);
});
