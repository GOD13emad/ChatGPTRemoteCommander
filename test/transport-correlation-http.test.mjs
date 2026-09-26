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
  for(let i=0;i<120;i+=1){
    try{const r=await fetch(`http://127.0.0.1:${config.port}/health`);if(r.ok)return {child,stderr:()=>stderr};}catch{}
    await wait(25);
  }
  child.kill();throw new Error('server did not become healthy: '+stderr);
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
