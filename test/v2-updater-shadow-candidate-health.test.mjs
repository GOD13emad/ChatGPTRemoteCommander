import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workflow=fs.readFileSync(path.join(source,'.github/workflows/windows-updater-e2e-r157.yml'),'utf8');
test('R157 NoPromote keeps allowed project root separate from private candidate delivery',()=>{
 assert.match(workflow,/\$projectRoot=Join-Path \$root 'PROJECT'/);
 assert.match(workflow,/\$c\.allowedRoots=@\(\$projectRoot\)/);
 assert.doesNotMatch(workflow,/\$c\.allowedRoots=@\(\$root\)/);
 assert.match(workflow,/liveStoreCompatibility -ne 'NOT_TESTED_SHADOW_ONLY'/);
 assert.match(workflow,/liveStoreCompatibility='NOT_TESTED_SHADOW_ONLY'/);
});
test('DeliveryStore rejects the old nested-root fixture before writing owner history',async()=>{
 const {DeliveryStore}=await import('../src/delivery-store.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-updater-nested-root-negative-'));
 const delivery=path.join(root,'STATE','ChatGPTRemoteCommander','delivery-shadow');
 try{
  assert.throws(()=>new DeliveryStore({directory:delivery,scope:'qa-updater',
    forbiddenRoots:[root]}),/DELIVERY_STORE_INSIDE_PROJECT/);
  assert.equal(fs.existsSync(delivery),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

const codeOf=error=>String(error?.code??'UNKNOWN').replace(/[^A-Z0-9_]/g,'').slice(0,72);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function reserveLoopback(){
 const server=net.createServer();
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 const port=server.address().port;
 await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
 return port;
}
test('NoPromote shadow candidate generated config starts exact-health V2 without touching owner state',
 {skip:process.platform!=='win32'?'Native Windows isolated updater candidate check':false,timeout:30000},
 async()=>{
 const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-sha-shadow-health-')));
 const dir=n=>path.join(root,n);
 const runtime=dir('runtime'),delivery=dir('shadow-delivery'),data=dir('data');
 const candidate=dir('diagnostic-config.json'),prior=dir('existing.json');
 const projectConfig=JSON.parse(fs.readFileSync(path.join(source,'config.json'),'utf8'));
 const base={...projectConfig,allowedRoots:[data],allowedPrograms:['node'],
   deviceName:'qa-shadow-device',autoUpdate:{enabled:false},
   powerMode:{...projectConfig.powerMode,enabled:false,fullFilesystem:false,
     allowShell:false,guiControl:{enabled:false},browserControl:{enabled:false}},
   durableWorkflows:{enabled:false,directory:dir('workflow-live-qa')}};
 let child=null,stderr='',phase='setup';
 try{
  fs.mkdirSync(data);
  fs.writeFileSync(prior,JSON.stringify(base),{mode:0o600});
  const port=await reserveLoopback();
  phase='builder';
  const args=[path.join(source,'tools/build-candidate-config.mjs'),
   '--default',path.join(source,'config.json'),'--existing',prior,
   '--output',candidate,'--profile-id','default','--port',String(port),
   '--state-dir',runtime,'--workflow-dir',dir('workflow-shadow'),
   '--async-operations-dir',dir('async-shadow'),
   '--delivery-directory',delivery,'--delivery-scope','diagnostic-qa-shadow',
   '--provider-root',dir('provider-shadow'),'--backup-root',dir('backup-shadow'),
   '--browser-profile-root',dir('browser-shadow'),'--mode','standard'];
  const built=spawnSync(process.execPath,args,{cwd:source,encoding:'utf8',timeout:10000});
  assert.equal(built.status,0,'SHADOW_BUILDER_FAILED_'+codeOf(built.error));
  const conf=JSON.parse(fs.readFileSync(candidate,'utf8'));
  assert.equal(conf.durableDelivery.directory,delivery);
  assert.equal(conf.instance.profile,'default');
  assert.equal(conf.port,port);
  const expected=createHash('sha256').update(fs.readFileSync(candidate)).digest('hex');
  const version=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8')).version;
  phase='startup';
  child=spawn(process.execPath,[path.join(source,'src/server-v0.3.mjs')],{
   cwd:source,env:{...process.env,REMOTE_COMMANDER_CONFIG:candidate},
   windowsHide:true,stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',b=>{stderr=(stderr+b.toString('utf8')).slice(-10000);});
  let response=null,status='NO_RESPONSE';
  for(let n=0;n<100;n++){
   if(child.exitCode!==null){status='EXITED_'+String(child.exitCode);break;}
   try{
    const reply=await fetch('http://127.0.0.1:'+port+'/health',
      {signal:AbortSignal.timeout(1200)});
    if(reply.ok){response=await reply.json();break;}
    status='HTTP_'+String(reply.status);
   }catch{status='CONNECT_UNAVAILABLE';}
   await wait(100);
  }
  const flags={
   alive:child.exitCode===null,
   health:Boolean(response?.ok),
   version:response?.version===version,
   configSha:response?.configSha256===expected,
   profile:response?.instance?.profile==='default'
  };
  // Fixed labels only: never disclose owner paths, raw child stderr or config.
  if(Object.values(flags).some(v=>v!==true)){
   const codes=[...new Set(stderr.match(/\b(?:CAPABILITY_GAP|DELIVERY|WORKFLOW|ASYNC|MUTATION|ERR)_[A-Z0-9_]+\b/g)||[])].slice(0,8);
   assert.fail('SHADOW_HEALTH_'+status+'_'+phase+'_'+
      Object.entries(flags).filter(([,v])=>!v).map(([k])=>k).join('_')+
      '_CODES_'+codes.join(','));
  }
 }finally{
  if(child&&child.exitCode===null){
   child.kill();
   await Promise.race([once(child,'exit'),wait(1800)]);
  }
  fs.rmSync(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
});
