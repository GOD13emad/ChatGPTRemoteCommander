import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function portAvailable(){
  const server=createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}
test('owner-local 0.12 canary boots with full-capability intent while legacy privileged HTTP remains quarantined', {timeout:30000},async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'rc-v012-canary-'));
  let child,stderr='';
  try{
    const config=JSON.parse(await readFile(path.join(root,'config.json'),'utf8'));
    config.host='127.0.0.1';
    config.port=await portAvailable();
    config.allowedRoots=[root];
    config.auditLog=path.join(temp,'audit.jsonl');
    config.runtimeState=path.join(temp,'runtime.json');
    config.capabilityProfile={schemaVersion:4,id:'owner-local-canary',tier:'FULL_ACCESS',
      explicitlyAuthorized:true,persistAcrossUpdates:false,autoEnableNewCapabilities:true,disabledCapabilities:[],source:'explicit-local-test'};
    config.powerMode={...config.powerMode,enabled:true,fullFilesystem:true,allowShell:true,
      allowProcessControl:true,allowPermanentDelete:false,blockedShellPatterns:[],
      guiControl:{...config.powerMode.guiControl,enabled:true},
      browserControl:{...config.powerMode.browserControl,enabled:true}};
    config.requireTrustedIngress=true;
    config.trustedIngressConfigured=false;
    config.autoUpdate={...config.autoUpdate,enabled:false};
    const file=path.join(temp,'config.json');
    await writeFile(file,JSON.stringify(config));
    child=spawn(process.execPath,[path.join(root,'src','server-v0.3.mjs')],{
      cwd:root,env:{...process.env,REMOTE_COMMANDER_CONFIG:file,COMMANDER_ONE_REQUIRE_TRUSTED_INGRESS:'1'},
      windowsHide:true,stdio:['ignore','ignore','pipe']
    });
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-1500);});
    let health;
    for(let i=0;i<100;i++){
      if(child.exitCode!==null)throw Error('CANARY_EXITED '+child.exitCode+' '+stderr);
      try{
        const response=await fetch('http://127.0.0.1:'+config.port+'/health',{signal:AbortSignal.timeout(250)});
        if(response.ok){health=await response.json();break;}
      }catch{}
      await pause(100);
    }
    assert.ok(health,'CANARY_HEALTH_TIMEOUT '+stderr);
    assert.equal(health.version,'0.12.0-dev.1');
    assert.equal(health.access.configuredTier,'FULL_ACCESS');
    assert.equal(health.access.effectiveTier,'FULL_POWER');
    assert.equal(health.protectedIngress.ready,false);
    assert.equal(health.privilegedLegacyHttpQuarantined,true);
    const legacy=await fetch('http://127.0.0.1:'+config.port+'/mcp',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})
    });
    assert.equal(legacy.status,403,'privileged legacy MCP must remain denied');
    assert.equal((await legacy.json()).error,'trusted_transport_required');
  }finally{
    if(child && child.exitCode===null){
      child.kill();
      await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(3000)]);
    }
    await rm(temp,{recursive:true,force:true});
  }
});
