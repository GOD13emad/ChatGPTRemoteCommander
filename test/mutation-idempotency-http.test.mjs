import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}
async function post(port, id, name, args, extraHeaders = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ jsonrpc:'2.0', id, method:'tools/call', params:{ name, arguments:args } })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  return body;
}
async function startServer(serverRoot, configPath) {
  const child = spawn(process.execPath, [path.join(serverRoot, 'src', 'server-v0.3.mjs')], {
    cwd: serverRoot, env: { ...process.env, REMOTE_COMMANDER_CONFIG: configPath }, stdio:['ignore','pipe','pipe']
  });
  let stderr=''; child.stderr.on('data', c => { stderr += c.toString('utf8'); });
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  for (let i=0;i<400;i+=1) {
    try { const r=await fetch(`http://127.0.0.1:${config.port}/health`); if (r.ok) return { child, stderr:()=>stderr, health:await r.json() }; } catch {}
    await wait(25);
  }
  child.kill();
  throw new Error('server did not become healthy: '+stderr);
}
async function stopServer(child) {
  if (child && child.exitCode === null) { child.kill(); await Promise.race([once(child,'close'), wait(4000)]); }
}

test('direct mutation requestId deduplicates in permitted sessions and elevated legacy HTTP stays closed', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-mut-http-'));
  const serverRoot=path.join(root,'server');
  const dataRoot=path.join(root,'data');
  const deliveryRoot=path.join(root,'private-delivery');
  let running;
  try {
    await fs.mkdir(serverRoot,{recursive:true}); await fs.mkdir(dataRoot,{recursive:true});
    await fs.cp(new URL('../src/', import.meta.url), path.join(serverRoot,'src'), {recursive:true});
    const canonicalDataRoot=await fs.realpath(dataRoot);
    const target=path.join(canonicalDataRoot,'append.txt');
    await fs.writeFile(target,'');
    const port=await freePort();
    const config={
      host:'127.0.0.1', port, allowedRoots:[canonicalDataRoot], allowedPrograms:['node'],
      maxReadBytes:1024*1024, maxWriteBytes:1024*1024, maxCommandMs:300000,
      auditLog:'var/audit.jsonl',
      durableDelivery:{directory:deliveryRoot},
      asyncOperations:{enabled:false},
      capabilityProfile:{tier:'STANDARD'},
      powerMode:{enabled:false,fullFilesystem:false,allowShell:false,allowProcessControl:false,allowPermanentDelete:false,
        guiControl:{enabled:false},browserControl:{enabled:false}}
    };
    const configPath=path.join(serverRoot,'config.json');
    await fs.writeFile(configPath,JSON.stringify(config,null,2));
    running=await startServer(serverRoot,configPath);
    if (running.health.privilegedLegacyHttpQuarantined === true) {
      assert.equal(running.health.protectedIngress?.required, true);
      assert.equal(running.health.protectedIngress?.ready, false);
      const denied = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',
          params:{name:'write_text',arguments:{requestId:'mut-http-1',path:target,content:'x',mode:'append'}}})
      });
      assert.equal(denied.status,403);
      assert.deepEqual(await denied.json(),{error:'trusted_transport_required'});
      assert.equal(await fs.readFile(target,'utf8'),'');
      // Positive HTTP idempotency remains exercised on nonprivileged CI and
      // will require a separate trusted authenticated Windows Owner E2E gate.
      return;
    }

    const missing=await post(port,1,'write_text',{path:target,content:'x',mode:'append'});
    assert.equal(missing.result.isError,true);
    assert.match(missing.result.content[0].text,/MUTATION_REQUEST_ID_REQUIRED|requestId/i);
    assert.equal(await fs.readFile(target,'utf8'),'');

    const args={requestId:'mut-http-1',path:target,content:'x',mode:'append'};
    const first=await post(port,2,'write_text',args);
    assert.equal(first.result.isError,false);
    assert.equal(await fs.readFile(target,'utf8'),'x');

    const lostAckRetry=await post(port,3,'write_text',args);
    assert.equal(lostAckRetry.result.isError,false);
    assert.deepEqual(lostAckRetry.result.structuredContent, first.result.structuredContent);
    assert.equal(await fs.readFile(target,'utf8'),'x');

    const conflict=await post(port,4,'write_text',{...args,content:'y'});
    assert.equal(conflict.result.isError,true);
    assert.match(conflict.result.content[0].text,/MUTATION_REQUEST_ID_CONFLICT/);
    assert.equal(await fs.readFile(target,'utf8'),'x');

    await stopServer(running.child); running=null;
    running=await startServer(serverRoot,configPath);
    const afterRestart=await post(port,5,'write_text',args);
    assert.equal(afterRestart.result.isError,false);
    assert.deepEqual(afterRestart.result.structuredContent, first.result.structuredContent);
    assert.equal(await fs.readFile(target,'utf8'),'x');
  } finally {
    if (running) await stopServer(running.child);
    await fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:50});
  }
});


test('legacy x-request-id deduplicates in permitted sessions and elevated legacy HTTP stays closed', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-mut-legacy-xreq-'));
  const serverRoot=path.join(root,'server');
  const dataRoot=path.join(root,'data');
  const deliveryRoot=path.join(root,'private-delivery');
  let running;
  try {
    await fs.mkdir(serverRoot,{recursive:true}); await fs.mkdir(dataRoot,{recursive:true});
    await fs.cp(new URL('../src/', import.meta.url), path.join(serverRoot,'src'), {recursive:true});
    const canonicalDataRoot=await fs.realpath(dataRoot);
    const target=path.join(canonicalDataRoot,'append.txt');
    await fs.writeFile(target,'');
    const port=await freePort();
    const config={
      host:'127.0.0.1', port, allowedRoots:[canonicalDataRoot], allowedPrograms:['node'],
      maxReadBytes:1024*1024, maxWriteBytes:1024*1024, maxCommandMs:300000,
      auditLog:'var/audit.jsonl', durableDelivery:{directory:deliveryRoot},
      asyncOperations:{enabled:false},
      capabilityProfile:{tier:'STANDARD'},
      powerMode:{enabled:false,fullFilesystem:false,allowShell:false,allowProcessControl:false,allowPermanentDelete:false,
        guiControl:{enabled:false},browserControl:{enabled:false}}
    };
    const configPath=path.join(serverRoot,'config.json');
    await fs.writeFile(configPath,JSON.stringify(config,null,2));
    running=await startServer(serverRoot,configPath);
    if (running.health.privilegedLegacyHttpQuarantined === true) {
      assert.equal(running.health.protectedIngress?.required, true);
      assert.equal(running.health.protectedIngress?.ready, false);
      const denied=await fetch(`http://127.0.0.1:${port}/mcp`,{
        method:'POST', headers:{'content-type':'application/json','x-request-id':'legacy-client-call-1'},
        body:JSON.stringify({jsonrpc:'2.0',id:10,method:'tools/call',
          params:{name:'write_text',arguments:{path:target,content:'x',mode:'append'}}})
      });
      assert.equal(denied.status,403);
      assert.deepEqual(await denied.json(),{error:'trusted_transport_required'});
      assert.equal(await fs.readFile(target,'utf8'),'');
      return;
    }

    const legacyHeaders={'x-request-id':'legacy-client-call-1'};
    const first=await post(port,10,'write_text',{path:target,content:'x',mode:'append'},legacyHeaders);
    assert.equal(first.result.isError,false);
    assert.equal(await fs.readFile(target,'utf8'),'x');

    const replay=await post(port,11,'write_text',{path:target,content:'x',mode:'append'},legacyHeaders);
    assert.equal(replay.result.isError,false);
    assert.deepEqual(replay.result.structuredContent,first.result.structuredContent);
    assert.equal(await fs.readFile(target,'utf8'),'x');

    const conflict=await post(port,12,'write_text',{path:target,content:'y',mode:'append'},legacyHeaders);
    assert.equal(conflict.result.isError,true);
    assert.match(conflict.result.content[0].text,/MUTATION_REQUEST_ID_CONFLICT/);
    assert.equal(await fs.readFile(target,'utf8'),'x');

    // Explicit requestId must override the transport-derived fallback.
    const explicit=await post(port,13,'write_text',{requestId:'explicit-client-key-1',path:target,content:'z',mode:'append'},legacyHeaders);
    assert.equal(explicit.result.isError,false);
    assert.equal(await fs.readFile(target,'utf8'),'xz');

    const missingBoth=await post(port,14,'write_text',{path:target,content:'q',mode:'append'});
    assert.equal(missingBoth.result.isError,true);
    assert.match(missingBoth.result.content[0].text,/MUTATION_REQUEST_ID_REQUIRED/);
    assert.equal(await fs.readFile(target,'utf8'),'xz');

    await stopServer(running.child); running=null;
    running=await startServer(serverRoot,configPath);
    const afterRestart=await post(port,15,'write_text',{path:target,content:'x',mode:'append'},legacyHeaders);
    assert.equal(afterRestart.result.isError,false);
    assert.deepEqual(afterRestart.result.structuredContent,first.result.structuredContent);
    assert.equal(await fs.readFile(target,'utf8'),'xz');
  } finally {
    if (running) await stopServer(running.child);
    await fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:50});
  }
});

test('full-power legacy HTTP denies anonymous and forged access before mutation catalog or effects', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-mut-catalog-'));
  const serverRoot=path.join(root,'server');
  const dataRoot=path.join(root,'data');
  const deliveryRoot=path.join(root,'private-delivery');
  let running;
  try {
    await fs.mkdir(serverRoot,{recursive:true}); await fs.mkdir(dataRoot,{recursive:true});
    await fs.cp(new URL('../src/', import.meta.url), path.join(serverRoot,'src'), {recursive:true});
    const canonicalDataRoot=await fs.realpath(dataRoot);
    const destination=path.join(canonicalDataRoot,'unauthorized.txt');
    const port=await freePort();
    const config={
      host:'127.0.0.1', port, allowedRoots:[canonicalDataRoot], allowedPrograms:['node'],
      maxReadBytes:1024*1024, maxWriteBytes:1024*1024, maxCommandMs:300000,
      auditLog:'var/audit.jsonl', durableDelivery:{directory:deliveryRoot},
      asyncOperations:{enabled:true,backgroundFirst:true},
      powerMode:{enabled:true,fullFilesystem:true,allowShell:true,allowProcessControl:true,allowPermanentDelete:true,
        guiControl:{enabled:true,allowScreenshot:true,allowMouse:true,allowKeyboard:true,allowWindowFocus:true},
        browserControl:{enabled:true,allowNavigate:true,allowInput:true}}
    };
    const configPath=path.join(serverRoot,'config.json');
    await fs.writeFile(configPath,JSON.stringify(config,null,2));
    running=await startServer(serverRoot,configPath);
    const health=await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.privilegedLegacyHttpQuarantined,true);
    const requests=[
      {method:'tools/list',params:{}},
      {method:'tools/call',params:{name:'write_text',arguments:{
        path:destination,content:'forbidden',mode:'overwrite',requestId:'denied-write-1'
      }}},
      {method:'tools/call',params:{name:'kill_process',arguments:{pid:process.pid,requestId:'denied-kill-1'}}},
      {method:'tools/call',params:{name:'send_terminal',arguments:{
        id:'denied',input:'not-executed',requestId:'denied-terminal-1'
      }}}
    ];
    for(const headers of [
      {'content-type':'application/json'},
      {'content-type':'application/json',authorization:'Bearer forged',
        'x-chat-id':'forged','mcp-session-id':'forged'}
    ]){
      for(const [i,request] of requests.entries()){
        const response=await fetch(`http://127.0.0.1:${port}/mcp`,{
          method:'POST',headers,
          body:JSON.stringify({jsonrpc:'2.0',id:i+1,...request})
        });
        assert.equal(response.status,403,request.method);
        assert.deepEqual(await response.json(),{error:'trusted_transport_required'});
      }
    }
    await assert.rejects(fs.access(destination));
  } finally {
    if (running) await stopServer(running.child);
    await fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:50});
  }
});
