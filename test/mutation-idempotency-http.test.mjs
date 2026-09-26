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
async function post(port, id, name, args) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
  for (let i=0;i<100;i+=1) {
    try { const r=await fetch(`http://127.0.0.1:${config.port}/health`); if (r.ok) return { child, stderr:()=>stderr }; } catch {}
    await wait(25);
  }
  child.kill();
  throw new Error('server did not become healthy: '+stderr);
}
async function stopServer(child) {
  if (child && child.exitCode === null) { child.kill(); await Promise.race([once(child,'exit'), wait(2000)]); }
}

test('direct mutation requestId prevents duplicate append across lost ack and restart', async () => {
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
      powerMode:{enabled:false,fullFilesystem:false,allowShell:false,allowProcessControl:false,allowPermanentDelete:false,
        guiControl:{enabled:false},browserControl:{enabled:false}}
    };
    const configPath=path.join(serverRoot,'config.json');
    await fs.writeFile(configPath,JSON.stringify(config,null,2));
    running=await startServer(serverRoot,configPath);

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
    await fs.rm(root,{recursive:true,force:true});
  }
});


test('full-power direct mutation catalog requires requestId across file/process/terminal/browser/GUI', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-mut-catalog-'));
  const serverRoot=path.join(root,'server');
  const dataRoot=path.join(root,'data');
  const deliveryRoot=path.join(root,'private-delivery');
  let running;
  try {
    await fs.mkdir(serverRoot,{recursive:true}); await fs.mkdir(dataRoot,{recursive:true});
    await fs.cp(new URL('../src/', import.meta.url), path.join(serverRoot,'src'), {recursive:true});
    const canonicalDataRoot=await fs.realpath(dataRoot);
    const port=await freePort();
    const config={
      host:'127.0.0.1', port, allowedRoots:[canonicalDataRoot], allowedPrograms:['node'],
      maxReadBytes:1024*1024, maxWriteBytes:1024*1024, maxCommandMs:300000,
      auditLog:'var/audit.jsonl', durableDelivery:{directory:deliveryRoot},
      asyncOperations:{enabled:true,backgroundFirst:true},
      powerMode:{enabled:true,fullFilesystem:true,allowShell:true,allowProcessControl:true,allowPermanentDelete:true,
        guiControl:{enabled:true,allowScreenshot:true,allowMouse:true,allowKeyboard:true,allowWindowFocus:true},
        browserControl:{enabled:true,allowNavigate:true,allowInput:true,allowScreenshot:true}}
    };
    const configPath=path.join(serverRoot,'config.json');
    await fs.writeFile(configPath,JSON.stringify(config,null,2));
    running=await startServer(serverRoot,configPath);
    const response=await fetch(`http://127.0.0.1:${port}/mcp`,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:20,method:'tools/list',params:{}})
    });
    const body=await response.json();
    assert.equal(response.status,200);
    const directMutations=body.result.tools.filter(tool =>
      tool.annotations?.readOnlyHint === false &&
      !/^(operation_|delivery_|workflow_)/.test(tool.name)
    );
    assert.ok(directMutations.length > 10, 'expected broad Full Power mutation catalog');
    for (const tool of directMutations) {
      assert.ok(tool.inputSchema?.properties?.requestId, `missing requestId schema: ${tool.name}`);
    }
    const names=new Set(directMutations.map(tool=>tool.name));
    assert.ok(names.has('write_text'), 'file mutation missing');
    assert.ok(names.has('kill_process'), 'process mutation missing');
    assert.ok(names.has('send_terminal'), 'terminal mutation missing');
    assert.ok([...names].some(name=>name.startsWith('browser_')), 'browser mutation missing');
    assert.ok([...names].some(name=>name.startsWith('gui_')), 'GUI mutation missing');
    const readOnly=body.result.tools.filter(tool => tool.annotations?.readOnlyHint === true);
    assert.ok(readOnly.some(tool=>tool.name==='system_status' && !tool.inputSchema?.properties?.requestId));
  } finally {
    if (running) await stopServer(running.child);
    await fs.rm(root,{recursive:true,force:true});
  }
});
