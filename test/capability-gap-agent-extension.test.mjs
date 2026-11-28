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


test('pinned v0.1.0 metadata upgrades to v0.2.1-rc.1 with an exact recoverable old copy and stable discovery',{skip:!running},t=>{
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
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest,'agent.json'),'utf8')).version,'0.2.1-rc.1');
  res=exec(home,'--upgrade');assert.equal(res.status,0,res.stderr);
  assert.equal(JSON.parse(res.stdout).changed,false);
  const reg=createAgentExtensionRegistry({directories:[root]});
  assert.equal(reg.execute('agent_extension_list',{}).items.length,1);
  assert.equal(reg.execute('agent_extension_get',{id:'commander-capability-gaps'}).version,'0.2.1-rc.1');
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});


test('pinned v0.2.0 metadata upgrades to v0.2.1-rc.1, retaining exact rollback and preventing accidental overwrite',{skip:!running},()=>{
 const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const before='58fef3a5112226f8ae0fecaf87556436cd6d3d0e';
 const old=spawnSync('git',['-C',repo,'show',before+':extensions/commander-capability-gaps/agent.json'],
   {encoding:'utf8',timeout:5000});
 assert.equal(old.status,0,'pinned v0.2.0 manifest unavailable');
 assert.equal(JSON.parse(old.stdout).version,'0.2.0');
 const home=tempHome(),root=path.join(home,'.agents','extensions');
 const dest=path.join(root,'commander-capability-gaps');
 try{
  fs.mkdirSync(dest,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(dest,'agent.json'),old.stdout,{mode:0o600});
  const skill=fs.readFileSync(new URL('../extensions/commander-capability-gaps/SKILL.md',import.meta.url));
  fs.writeFileSync(path.join(dest,'SKILL.md'),skill,{mode:0o600});
  let res=exec(home,'--status');
  assert.equal(res.status,0,res.stderr);
  assert.deepEqual({from:JSON.parse(res.stdout).from,to:JSON.parse(res.stdout).to},
   {from:'0.2.0',to:'0.2.1-rc.1'});
  res=exec(home,'--install');
  assert.equal(res.status,2);
  assert.match(res.stderr,/COMMANDER_GAP_EXTENSION_EXPLICIT_UPGRADE_REQUIRED/);
  assert.equal(fs.readFileSync(path.join(dest,'agent.json'),'utf8'),old.stdout);
  res=exec(home,'--upgrade');
  assert.equal(res.status,0,res.stderr);
  assert.equal(JSON.parse(res.stdout).status,'DECLARATIVE_EXTENSION_UPGRADED');
  const backup=path.join(home,'.agents','capgap-recovery','commander-capability-gaps-v0.2.0');
  assert.equal(fs.readFileSync(path.join(backup,'agent.json'),'utf8'),old.stdout);
  assert.deepEqual(fs.readFileSync(path.join(backup,'SKILL.md')),skill);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest,'agent.json'),'utf8')).version,'0.2.1-rc.1');
  res=exec(home,'--upgrade');
  assert.equal(res.status,0,res.stderr);
  assert.equal(JSON.parse(res.stdout).changed,false);
  const reg=createAgentExtensionRegistry({directories:[root]});
  const route=reg.execute('agent_extension_route',
   {task:'Commander permission blocked — report the missing tool',limit:2});
  assert.deepEqual(route.items.map(x=>x.id),['commander-capability-gaps']);
  const again=exec(home,'--status');
  assert.equal(JSON.parse(again.stdout).status,'EXACT_EXTENSION_ALREADY_INSTALLED');
  assert.equal(fs.readdirSync(path.join(home,'.agents','capgap-recovery')).length,1);
  // Exercise a guarded OS-local restore/reapply cycle inside the temporary fixture.
  // This does not enact a production rollback or modify user history/SQLite state.
  const forward=path.join(home,'.agents','capgap-recovery','commander-capability-gaps-v0.2.1-rc.1');
  assert.equal(fs.existsSync(forward),false);
  fs.renameSync(dest,forward);
  fs.renameSync(backup,dest);
  assert.equal(fs.readFileSync(path.join(dest,'agent.json'),'utf8'),old.stdout);
  assert.deepEqual(fs.readFileSync(path.join(dest,'SKILL.md')),skill);
  res=exec(home,'--status');
  assert.equal(JSON.parse(res.stdout).status,'UPGRADE_AVAILABLE');
  fs.renameSync(dest,backup);
  fs.renameSync(forward,dest);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest,'agent.json'),'utf8')).version,'0.2.1-rc.1');
  res=exec(home,'--status');
  assert.equal(JSON.parse(res.stdout).status,'EXACT_EXTENSION_ALREADY_INSTALLED');
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('occupied v0.2.0 rollback slot blocks upgrade without touching installed original',{skip:!running},()=>{
 const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const baseline=spawnSync('git',['-C',repo,'show','58fef3a5112226f8ae0fecaf87556436cd6d3d0e:extensions/commander-capability-gaps/agent.json'],{encoding:'utf8',timeout:5000});
 assert.equal(baseline.status,0);
 const home=tempHome(),root=path.join(home,'.agents','extensions');
 const dest=path.join(root,'commander-capability-gaps');
 const slot=path.join(home,'.agents','capgap-recovery','commander-capability-gaps-v0.2.0');
 try{
  fs.mkdirSync(dest,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(dest,'agent.json'),baseline.stdout,{mode:0o600});
  const skill=fs.readFileSync(new URL('../extensions/commander-capability-gaps/SKILL.md',import.meta.url));
  fs.writeFileSync(path.join(dest,'SKILL.md'),skill,{mode:0o600});
  fs.mkdirSync(slot,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(slot,'sentinel'),'keep',{mode:0o600});
  const res=exec(home,'--upgrade');
  assert.equal(res.status,2);
  assert.match(res.stderr,/COMMANDER_GAP_EXTENSION_ROLLBACK_SLOT_OCCUPIED/);
  assert.equal(fs.readFileSync(path.join(dest,'agent.json'),'utf8'),baseline.stdout);
  assert.deepEqual(fs.readFileSync(path.join(dest,'SKILL.md')),skill);
  assert.equal(fs.readFileSync(path.join(slot,'sentinel'),'utf8'),'keep');
  assert.equal(fs.readdirSync(path.join(root)).length,1);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
