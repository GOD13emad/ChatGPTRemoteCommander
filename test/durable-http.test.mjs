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
async function call(port,id,name,args){
  const response=await fetch(`http://127.0.0.1:${port}/mcp`,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})
  });
  return {status:response.status,body:JSON.parse(await response.text())};
}

test('HTTP direct mutations fail closed while durable_call suppresses lost-ack replay',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-durable-http-'));
  const serverRoot=path.join(root,'server'),dataRoot=path.join(root,'data'),deliveryRoot=path.join(root,'delivery-private');
  const port=await freePort();let child;
  try{
    await fs.mkdir(serverRoot,{recursive:true});await fs.mkdir(dataRoot,{recursive:true});
    const canonical=await fs.realpath(dataRoot);
    await fs.cp(new URL('../src/',import.meta.url),path.join(serverRoot,'src'),{recursive:true});
    const config={
      host:'127.0.0.1',port,allowedRoots:[canonical],allowedPrograms:['node'],
      maxReadBytes:1024*1024,maxWriteBytes:1024*1024,maxCommandMs:120000,
      auditLog:'var/audit.jsonl',
      durableDelivery:{directory:deliveryRoot,enforceDirectMutations:true},
      asyncOperations:{enabled:true,backgroundFirst:true},
      powerMode:{enabled:false,fullFilesystem:false,allowShell:false,allowProcessControl:false,allowPermanentDelete:false,
        guiControl:{enabled:false},browserControl:{enabled:false}}
    };
    const configPath=path.join(serverRoot,'config.json');await fs.writeFile(configPath,JSON.stringify(config));
    child=spawn(process.execPath,[path.join(serverRoot,'src','server-v0.3.mjs')],{
      cwd:serverRoot,env:{...process.env,REMOTE_COMMANDER_CONFIG:configPath},stdio:['ignore','pipe','pipe']
    });
    let stderr='';child.stderr.on('data',c=>{stderr+=c.toString('utf8');});
    let healthy=false;
    for(let i=0;i<100;i++){try{const r=await fetch(`http://127.0.0.1:${port}/health`);if(r.ok){healthy=true;break;}}catch{}await wait(25);}
    assert.equal(healthy,true,stderr);

    const target=path.join(canonical,'effect.txt');
    const direct=await call(port,1,'write_text',{path:target,content:'x',mode:'append'});
    assert.equal(direct.body.result.isError,true);
    assert.match(direct.body.result.content[0].text,/DIRECT_MUTATION_REQUIRES_DURABLE_CALL/);
    await assert.rejects(fs.stat(target),{code:'ENOENT'});

    const wrapped={
      requestId:'durable-http-one',correlationId:'chat-a',tool:'write_text',
      arguments:{path:target,content:'x',mode:'append'}
    };
    const first=await call(port,2,'durable_call',wrapped);
    assert.equal(first.body.result.isError,false);
    assert.equal(first.body.result.structuredContent.status,'COMPLETED');
    assert.equal(first.body.result.structuredContent.duplicate,false);
    assert.equal(await fs.readFile(target,'utf8'),'x');

    const retry=await call(port,3,'durable_call',wrapped);
    assert.equal(retry.body.result.isError,false);
    assert.equal(retry.body.result.structuredContent.status,'COMPLETED');
    assert.equal(retry.body.result.structuredContent.duplicate,true);
    assert.equal(retry.body.result.structuredContent.replayedEffect,false);
    assert.equal(await fs.readFile(target,'utf8'),'x');

    const conflict=await call(port,4,'durable_call',{...wrapped,arguments:{path:target,content:'y',mode:'append'}});
    assert.equal(conflict.body.result.isError,true);
    assert.match(conflict.body.result.content[0].text,/REQUEST_ID_CONFLICT/);
    assert.equal(await fs.readFile(target,'utf8'),'x');

    const command=await call(port,5,'run_project_command',{program:'node',args:['--version'],cwd:canonical});
    assert.equal(command.body.result.isError,true);
    assert.match(command.body.result.content[0].text,/DIRECT_COMMAND_REQUIRES_OPERATION_START/);

    const deliveries=await call(port,6,'delivery_list',{correlationId:'chat-a',includeDelivered:true});
    assert.equal(deliveries.body.result.isError,false);
    assert.equal(deliveries.body.result.structuredContent.items.length,1);
    assert.equal(deliveries.body.result.structuredContent.items[0].kind,'COMPLETED');
  }finally{
    if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),wait(2000)]);}
    await fs.rm(root,{recursive:true,force:true});
  }
});
