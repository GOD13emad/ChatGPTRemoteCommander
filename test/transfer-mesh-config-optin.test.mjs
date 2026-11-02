import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const work=path.resolve('.');
function setup(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-mesh-optin-'));
 const root=path.join(dir,'pilot');fs.mkdirSync(root);
 for(const name of ['outbox','received'])fs.mkdirSync(path.join(root,name));
 for(const name of ['transfer.mjs','durable-send.mjs'])fs.writeFileSync(path.join(root,name),'// fixture\n');
 const cfg=JSON.parse(fs.readFileSync(path.join(work,'config.json'),'utf8'));
 cfg.powerMode.enabled=true;
 cfg.capabilityProfile={...cfg.capabilityProfile,tier:'FULL_POWER',explicitlyAuthorized:true,persistAcrossUpdates:true};
 const existing=path.join(dir,'existing.json');
 fs.writeFileSync(existing,JSON.stringify(cfg));
 const output=path.join(dir,'out.json');
 return {dir,root,existing,output,cleanup:()=>fs.rmSync(dir,{force:true,recursive:true})};
}
function run(x,extra=[]){
 return spawnSync(process.execPath,['tools/build-candidate-config.mjs',
  '--default',path.join(work,'config.json'),'--existing',x.existing,
  '--output',x.output,'--profile-id','default','--port','48993',
  '--state-dir',path.join(x.dir,'state'),'--mode','preserve',...extra],
  {cwd:work,encoding:'utf8',timeout:8000,maxBuffer:256*1024});
}
test('transfer is opt-in, never granted by default',()=>{
 const x=setup();try{
  const res=run(x);assert.equal(res.status,0,res.stderr);
  const cfg=JSON.parse(fs.readFileSync(x.output,'utf8'));
  assert.notEqual(cfg.transferMesh?.enabled,true);
 }finally{x.cleanup();}
});
test('explicit pilot root enables only owned outbox/received, durable CLI, and preserved identity',()=>{
 const x=setup();try{
  const res=run(x,['--transfer-root',x.root]);assert.equal(res.status,0,res.stderr);
  const cfg=JSON.parse(fs.readFileSync(x.output,'utf8'));
  assert.deepEqual(cfg.transferMesh,{
   enabled:true,durableEnabled:true,root:x.root,
   sourceRoots:[path.join(x.root,'outbox')],destinationRoots:[path.join(x.root,'received')]
  });
  assert.equal(cfg.instance.profile,'default');assert.equal(cfg.port,48993);
  assert.equal(cfg.capabilityProfile.tier,'FULL_POWER');
 }finally{x.cleanup();}
});
test('relative transfer root is rejected before configuration write',()=>{
 const x=setup();try{
  const r=run(x,['--transfer-root','relative-path']);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/TRANSFER_OPTIN_ROOT_ABSOLUTE/);
  assert.equal(fs.existsSync(x.output),false);
 }finally{x.cleanup();}
});
test('missing durable CLI rejects the opt-in',()=>{
 const x=setup();try{
  fs.rmSync(path.join(x.root,'durable-send.mjs'));
  const r=run(x,['--transfer-root',x.root]);
  assert.notEqual(r.status,0);assert.equal(fs.existsSync(x.output),false);
 }finally{x.cleanup();}
});
test('conflicting previously enabled root cannot be silently replaced',()=>{
 const x=setup();try{
  const prior=JSON.parse(fs.readFileSync(x.existing,'utf8'));
  prior.transferMesh={enabled:true,root:path.join(x.dir,'different'),
   sourceRoots:[path.join(x.dir,'different','outbox')],destinationRoots:[path.join(x.dir,'different','received')]};
  fs.writeFileSync(x.existing,JSON.stringify(prior));
  const r=run(x,['--transfer-root',x.root]);
  assert.notEqual(r.status,0);assert.match(r.stderr,/TRANSFER_OPTIN_EXISTING_POLICY_CONFLICT/);
  assert.equal(fs.existsSync(x.output),false);
 }finally{x.cleanup();}
});
test('symlinked pilot directory is rejected on Linux', {skip:process.platform!=='linux'},()=>{
 const x=setup();try{
  const other=path.join(x.dir,'link');fs.symlinkSync(x.root,other,'dir');
  const r=run(x,['--transfer-root',other]);
  assert.notEqual(r.status,0);assert.match(r.stderr,/TRANSFER_OPTIN_PATH_UNTRUSTED/);
  assert.equal(fs.existsSync(x.output),false);
 }finally{x.cleanup();}
});
