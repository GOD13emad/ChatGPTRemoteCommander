#!/usr/bin/env node
// Owner-user only, no network listener and no per-command V2 GUI approval.
// Never used from the public noauth V2 MCP endpoint.
import fs from 'node:fs';
import {createV2V1LocalOwnerGateway} from '../src/v2-v1-local-owner-gateway.mjs';

const API='http://127.0.0.1:47831/mcp';
const MAX=1024*1024;
async function rpc(method,params={}){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),12000);
 try{
  const response=await fetch(API,{method:'POST',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),
   signal:controller.signal});
  if(response.status!==200)throw Error('V2_LOCAL_V1_UNAVAILABLE');
  const length=Number(response.headers.get('content-length'));
  if(Number.isFinite(length)&&length>MAX)throw Error('V2_LOCAL_V1_RESPONSE_TOO_LARGE');
  const reader=response.body?.getReader();
  if(!reader)throw Error('V2_LOCAL_V1_RESPONSE_INVALID');
  let chunks=[],total=0;
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   total+=value.byteLength;
   if(total>MAX){await reader.cancel();throw Error('V2_LOCAL_V1_RESPONSE_TOO_LARGE');}
   chunks.push(value);
  }
  const json=JSON.parse(Buffer.concat(chunks,total).toString('utf8'));
  if(json.error)throw Error('V2_LOCAL_V1_RPC_ERROR');
  return json.result;
 }finally{clearTimeout(timer)}
}
const gateway=createV2V1LocalOwnerGateway({rpc});
const [action,tool,arg]=process.argv.slice(2);
if(action==='list'&&!tool){
 process.stdout.write(JSON.stringify(await gateway.list())+'\n');
}else if(action==='call'&&tool){
 // Request arguments come only from a readable local input FILE with owner ACL.
 // '-': bounded stdin JSON, useful for current-user automation pipelines.
 let args={};
 if(arg){
  if(arg!=='-')throw Error('V2_LOCAL_ARGS_STDIN_ONLY');
  if(process.stdin.isTTY)throw Error('V2_LOCAL_ARGS_PIPE_REQUIRED');
  const chunks=[];let count=0;
  for await(const chunk of process.stdin){
   count+=chunk.length;
   if(count>8192)throw Error('V2_LOCAL_ARGS_TOO_LARGE');
   chunks.push(chunk);
  }
  args=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 const out=await gateway.call({tool,args});
 const r=out.result;
 // Current owner-user CLI may legitimately see results; anonymous V2 MCP
 // callers do not have access to this CLI or its full private response.
 process.stdout.write(JSON.stringify({
  requestId:out.requestId,tool:out.tool,
  isError:r.isError===true,result:r.structuredContent??r.content??null
 })+'\n');
 if(r.isError===true)process.exitCode=1;
}else{
 process.stderr.write('Usage: v2-v1-local-owner-cli.mjs list | call TOOL [- < JSON]\n');
 process.exitCode=2;
}
