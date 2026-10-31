#!/usr/bin/env node
import process from 'node:process';
import {createInterface} from 'node:readline/promises';
import {createV2NativeOwnerExecutor} from '../src/v2-v1-owner-executor.mjs';
import {confirmLowRiskV2OwnerDialog} from '../src/v2-native-owner-dialog.mjs';
const url='http://127.0.0.1:47831/mcp';
async function rpc(method,params={}){
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),15000);
 try{
  const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:c.signal});
  if(r.status!==200)throw new Error('V1_LOOPBACK_MCP_NOT_READY');
  const j=await r.json();
  if(j.error)throw new Error('V1_MCP_ERROR');
  return j.result;
 }finally{clearTimeout(timer)}
}
async function catalog(){
 const r=await rpc('tools/list');
 return r.tools.map(t=>t.name);
}
const [action,id]=process.argv.slice(2);
const guiMode=action==='approve-gui';
const executor=createV2NativeOwnerExecutor({
 loadCatalog:catalog,
 invokeTool:async(tool,args)=>{
  const result=await rpc('tools/call',{name:tool,arguments:args});
  return {isError:result?.isError===true};
 },
 requireOwnerConfirmation:async({requestId,tool,arguments:args})=>{
  if(guiMode)return confirmLowRiskV2OwnerDialog({requestId,tool,arguments:args});
  if(!process.stdin.isTTY||!process.stdout.isTTY)
    throw new Error('V2_OWNER_INTERACTIVE_TTY_REQUIRED');
  process.stdout.write('EXACT V2 request to execute using already installed V1 current-user permissions:\n');
  process.stdout.write(JSON.stringify({requestId,tool,arguments:args},null,2)+'\n');
  process.stdout.write('V1 may require independent GUI/session consent or host privilege.\n');
  const rl=createInterface({input:process.stdin,output:process.stdout});
  try{
   const answer=await rl.question('Type EXECUTE '+requestId.slice(0,8)+' to forward ONCE: ');
   return answer==='EXECUTE '+requestId.slice(0,8);
  }finally{rl.close()}
 }
});
if(action==='list'&&!id){
 const {createV2V1ToolBridge}=await import('../src/v2-v1-tool-bridge.mjs');
 for(const r of createV2V1ToolBridge({loadCatalog:catalog}).list())
  process.stdout.write(JSON.stringify({id:r.id,tool:r.tool,status:r.status,expired:r.expired})+'\n');
}else if(action==='approve'&&id){
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('V2_OWNER_INTERACTIVE_TTY_REQUIRED');
 process.stdout.write(JSON.stringify(await executor.approve(id))+'\n');
}else if(action==='approve-gui'&&id){
 // Interactive on-device GUI will ask the actual logged-in owner to accept.
 // This is explicitly for fixed read-only status methods, never arbitrary calls.
 const result=await executor.approve(id);
 process.stdout.write(JSON.stringify(result)+'\n');
}else if(action==='status'&&id){
 process.stdout.write(JSON.stringify(executor.status(id))+'\n');
}else{
 process.stderr.write('Usage: node v2-v1-owner-cli.mjs list | status <requestId> | approve <requestId> | approve-gui <requestId>\n');
 process.exitCode=2;
}
