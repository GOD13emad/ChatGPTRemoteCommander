import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){
  const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');
  const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;
}
async function startServer(serverRoot,configPath){
  const child=spawn(process.execPath,[path.join(serverRoot,'src','server-v0.3.mjs')],{
    cwd:serverRoot,env:{...process.env,REMOTE_COMMANDER_CONFIG:configPath},stdio:['ignore','pipe','pipe']
  });
  let stderr='';child.stderr.on('data',c=>{stderr+=c.toString('utf8');});
  const config=JSON.parse(await fs.readFile(configPath,'utf8'));
  const startupDeadline=Date.now()+30000;
  while(Date.now()<startupDeadline){
    if(child.exitCode!==null)throw new Error(`server exited before healthy: exitCode=${child.exitCode}; stderr=${stderr}`);
    try{const r=await fetch(`http://127.0.0.1:${config.port}/health`);if(r.ok)return {child,stderr:()=>stderr};}catch{}
    await wait(25);
  }
  child.kill();throw new Error(`server did not become healthy within 30000ms: stderr=${stderr}`);
}
async function stop(child){if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),wait(2000)]);}}

test('accepted tool audit maps forwarded transport request ID to durable correlation identity without raw arguments',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-transport-correlation-'));
  const serverRoot=path.join(root,'server'),dataRoot=path.join(root,'data'),deliveryRoot=path.join(root,'delivery');
  let running;
  try{
    await fs.mkdir(serverRoot,{recursive:true});await fs.mkdir(dataRoot,{recursive:true});
    await fs.cp(new URL('../src/',import.meta.url),path.join(serverRoot,'src'),{recursive:true});
    const canonical=await fs.realpath(dataRoot);
    const target=path.join(canonical,'trace.txt');
    const port=await freePort();
    const config={
      host:'127.0.0.1',port,allowedRoots:[canonical],allowedPrograms:['node'],
      maxReadBytes:1024*1024,maxWriteBytes:1024*1024,maxCommandMs:300000,
      auditLog:'var/audit.jsonl',durableDelivery:{directory:deliveryRoot},
      asyncOperations:{enabled:false},
      powerMode:{enabled:false,fullFilesystem:false,allowShell:false,allowProcessControl:false,allowPermanentDelete:false,
        guiControl:{enabled:false},browserControl:{enabled:false}}
    };
    const configPath=path.join(serverRoot,'config.json');
    await fs.writeFile(configPath,JSON.stringify(config,null,2));
    running=await startServer(serverRoot,configPath);

    const secret='RAW_CONTENT_MUST_NOT_ENTER_TOOL_ACCEPT';
    const authMarker='audit-must-not-store-this';
    const authorization=['Be','arer ',authMarker].join('');
    const transportRequestId='cp-request-123';
    const requestId='corr-request-1';
    const response=await fetch(`http://127.0.0.1:${port}/mcp`,{
      method:'POST',
      headers:{'content-type':'application/json','x-request-id':transportRequestId,'authorization':authorization},
      body:JSON.stringify({jsonrpc:'2.0',id:'rpc-42',method:'tools/call',params:{name:'write_text',arguments:{requestId,path:target,content:secret,mode:'overwrite'}}})
    });
    const body=await response.json();
    assert.equal(response.status,200);
    assert.equal(body.result.isError,false);
    assert.equal(await fs.readFile(target,'utf8'),secret);

    const auditPath=path.join(serverRoot,'var','audit.jsonl');
    const rows=(await fs.readFile(auditPath,'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const accepted=rows.find(row=>row.action==='tool_accept'&&row.requestId===requestId);
    assert.ok(accepted,'tool_accept audit record missing');
    assert.deepEqual({
      action:accepted.action,ok:accepted.ok,tool:accepted.tool,
      transportRequestId:accepted.transportRequestId,rpcRequestId:accepted.rpcRequestId,
      requestId:accepted.requestId,correlationId:accepted.correlationId
    },{
      action:'tool_accept',ok:true,tool:'write_text',
      transportRequestId,rpcRequestId:'rpc-42',requestId,correlationId:requestId
    });
    const encoded=JSON.stringify(accepted);
    assert.equal(encoded.includes(secret),false,'tool_accept leaked raw content');
    assert.equal(encoded.includes(target),false,'tool_accept leaked raw path');
    assert.equal(encoded.includes(authMarker),false,'tool_accept leaked Authorization');
  }finally{
    if(running)await stop(running.child);
    await fs.rm(root,{recursive:true,force:true});
  }
});


test('transport-derived auto-deferred mutation keeps retry durability without polluting actionable delivery',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-transport-delivery-split-'));
  const serverRoot=path.join(root,'server'),dataRoot=path.join(root,'data'),deliveryRoot=path.join(root,'delivery'),opsRoot=path.join(root,'ops');
  let running;
  const call=async(port,id,name,args,headers={})=>{
    const response=await fetch(`http://127.0.0.1:${port}/mcp`,{
      method:'POST',headers:{'content-type':'application/json',...headers},
      body:JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})
    });
    const body=await response.json();
    assert.equal(response.status,200);
    assert.equal(body.result?.isError,false,body.result?.content?.[0]?.text);
    return body.result?.structuredContent;
  };
  const waitTerminal=async(port,operationId)=>{
    const deadline=Date.now()+15000;
    let state;
    while(Date.now()<deadline){
      state=await call(port,'status-'+Date.now(),'operation_status',{operationId});
      if(['SUCCEEDED','FAILED','TIMED_OUT','CANCELLED','UNCERTAIN'].includes(state.status)) return state;
      await wait(30);
    }
    throw new Error('operation did not finish: '+JSON.stringify(state));
  };
  try{
    await fs.mkdir(serverRoot,{recursive:true});
    await fs.mkdir(dataRoot,{recursive:true});
    await fs.cp(new URL('../src/',import.meta.url),path.join(serverRoot,'src'),{recursive:true});
    await fs.cp(new URL('../tools/',import.meta.url),path.join(serverRoot,'tools'),{recursive:true});
    const canonical=await fs.realpath(dataRoot);
    const source=path.join(canonical,'source.txt');
    const transportDest=path.join(canonical,'transport-copy.txt');
    const explicitDest=path.join(canonical,'explicit-copy.txt');
    await fs.writeFile(source,'payload');
    const port=await freePort();
    const config={
      host:'127.0.0.1',port,allowedRoots:[canonical],allowedPrograms:['node'],
      maxReadBytes:1024*1024,maxWriteBytes:1024*1024,maxCommandMs:300000,
      auditLog:path.join(root,'audit.jsonl'),durableDelivery:{directory:deliveryRoot},
      asyncOperations:{enabled:true,stateDir:opsRoot,deliveryReconcileMs:1000},
      powerMode:{enabled:true,fullFilesystem:false,allowShell:false,allowProcessControl:false,allowPermanentDelete:false,
        guiControl:{enabled:false},browserControl:{enabled:false}},
      capabilityProfile:{tier:'FULL_POWER',explicitlyAuthorized:true}
    };
    const configPath=path.join(serverRoot,'config.json');
    await fs.writeFile(configPath,JSON.stringify(config,null,2));
    running=await startServer(serverRoot,configPath);

    const transportStart=await call(port,100,'copy_path',{source,destination:transportDest},{'x-request-id':'transport-copy-http-1'});
    assert.ok(transportStart.operationId);
    const transportState=await waitTerminal(port,transportStart.operationId);
    assert.equal(transportState.status,'SUCCEEDED');
    assert.equal(transportState.deliveryMode,'transport-retry-only');
    assert.equal(await fs.readFile(transportDest,'utf8'),'payload');
    const transportDelivery=await call(port,101,'delivery_status',{});
    assert.equal(transportDelivery.pending,0);
    assert.equal(transportDelivery.transportReceipts,0);

    const explicitStart=await call(port,102,'copy_path',{requestId:'explicit-copy-http-1',source,destination:explicitDest});
    assert.ok(explicitStart.operationId);
    const explicitState=await waitTerminal(port,explicitStart.operationId);
    assert.equal(explicitState.status,'SUCCEEDED');
    assert.equal(explicitState.deliveryMode,'durable');
    assert.equal(await fs.readFile(explicitDest,'utf8'),'payload');
    const explicitDelivery=await call(port,103,'delivery_status',{});
    assert.equal(explicitDelivery.pending,1);
    const listed=await call(port,104,'delivery_list',{correlationId:'explicit-copy-http-1',includeDelivered:true});
    assert.equal(listed.items.length,1);
    assert.equal(listed.items[0].source,'operation');

    await stop(running.child); running=null;
    running=await startServer(serverRoot,configPath);
    const afterRestart=await call(port,105,'delivery_status',{});
    assert.equal(afterRestart.pending,1);
    const transportListed=await call(port,106,'delivery_list',{correlationId:transportStart.correlationId,includeDelivered:true});
    assert.equal(transportListed.items.length,0);
  }finally{
    if(running)await stop(running.child);
    await fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:50});
  }
});
