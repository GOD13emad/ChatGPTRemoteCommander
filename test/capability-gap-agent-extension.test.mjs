import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createAgentExtensionRegistry} from '../src/agent-extensions.mjs';
const cli=fileURLToPath(new URL('../tools/install-capability-gap-extension.mjs',import.meta.url));
const running=process.platform==='linux';
const tempHome=()=>fs.mkdtempSync(path.join(os.tmpdir(),'commander-gap-ext-'));
function exec(home,flag){
 return spawnSync(process.execPath,[cli,flag],{encoding:'utf8',timeout:5000,env:{...process.env,HOME:home}});
}
test('declarative capability gap extension is installable without MCP backend restarts or special privileges',{skip:!running},()=>{
 const home=tempHome(),root=path.join(home,'.agents','extensions');
 try{
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  let result=exec(home,'--status');assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).status,'NOT_INSTALLED');
  result=exec(home,'--install');assert.equal(result.status,0,result.stderr);
  const proof=JSON.parse(result.stdout);
  assert.equal(proof.changed,true);assert.equal(proof.mcpMethodsInstalled,false);
  assert.equal(fs.statSync(path.join(root,'commander-capability-gaps','agent.json')).mode&0o777,0o600);
  const registry=createAgentExtensionRegistry({directories:[root]});
  let list=registry.execute('agent_extension_list',{});
  assert.equal(list.items.length,1);
  assert.equal(list.items[0].id,'commander-capability-gaps');
  assert.equal(list.diagnostics.length,0);
  const route=registry.execute('agent_extension_route',{task:'کمبود قابلیت کامندر',limit:3});
  assert.equal(route.items[0].id,'commander-capability-gaps');
  const skill=registry.execute('agent_extension_skill',{id:'commander-capability-gaps'});
  assert.match(skill.skill,/capability_gap_report/);
  assert.match(skill.skill,/nor synchronizes data between owners or hosts/i);
  result=exec(home,'--install');assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).changed,false);
  assert.equal(fs.readdirSync(root).filter(x=>x==='commander-capability-gaps').length,1);
  fs.appendFileSync(path.join(root,'commander-capability-gaps','SKILL.md'),'conflict\n');
  result=exec(home,'--install');assert.equal(result.status,2);
  assert.match(result.stderr,/COMMANDER_GAP_EXTENSION_EXISTING_EXTENSION_CONFLICT/);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('installer denies symlink extension roots rather than following external writable paths',{skip:!running},()=>{
 const home=tempHome(),outside=tempHome();
 try{
  fs.mkdirSync(path.join(home,'.agents'),{mode:0o700});
  fs.symlinkSync(outside,path.join(home,'.agents','extensions'),'dir');
  const result=exec(home,'--install');
  assert.equal(result.status,2);
  assert.match(result.stderr,/COMMANDER_GAP_EXTENSION_SYMLINK_PATH_DENIED/);
  assert.deepEqual(fs.readdirSync(outside),[]);
 }finally{fs.rmSync(home,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
});


test('pinned v0.1.0 metadata upgrades to v0.2.0 with an exact recoverable old copy and stable discovery',{skip:!running},t=>{
 const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const commit='7f58d868580aab8269299c92c1b94dc87c1cc086';
 const old={};
 for(const n of ['agent.json','SKILL.md']){
  const result=spawnSync('git',['-C',repo,'show',commit+':extensions/commander-capability-gaps/'+n],{encoding:'utf8',timeout:5000});
  if(result.status!==0)return t.skip('Pinned historical extension source not available in this checkout');
  old[n]=result.stdout;
 }
 const home=tempHome(),root=path.join(home,'.agents','extensions'),dest=path.join(root,'commander-capability-gaps');
 try{
  fs.mkdirSync(dest,{recursive:true,mode:0o700});
  for(const n of Object.keys(old))fs.writeFileSync(path.join(dest,n),old[n],{mode:0o600});
  let res=exec(home,'--status');
  assert.equal(res.status,0,res.stderr);assert.equal(JSON.parse(res.stdout).status,'UPGRADE_AVAILABLE');
  res=exec(home,'--install');
  assert.equal(res.status,2);assert.match(res.stderr,/EXPLICIT_UPGRADE_REQUIRED/);
  assert.equal(fs.readFileSync(path.join(dest,'agent.json'),'utf8'),old['agent.json']);
  res=exec(home,'--upgrade');
  assert.equal(res.status,0,res.stderr);assert.equal(JSON.parse(res.stdout).status,'DECLARATIVE_EXTENSION_UPGRADED');
  const rollback=path.join(home,'.agents','capgap-recovery','commander-capability-gaps-v0.1.0');
  assert.equal(fs.readFileSync(path.join(rollback,'SKILL.md'),'utf8'),old['SKILL.md']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest,'agent.json'),'utf8')).version,'0.2.0');
  res=exec(home,'--upgrade');assert.equal(res.status,0,res.stderr);
  assert.equal(JSON.parse(res.stdout).changed,false);
  const reg=createAgentExtensionRegistry({directories:[root]});
  assert.equal(reg.execute('agent_extension_list',{}).items.length,1);
  assert.equal(reg.execute('agent_extension_get',{id:'commander-capability-gaps'}).version,'0.2.0');
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
