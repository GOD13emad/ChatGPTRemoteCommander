import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
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


test('pinned v0.1.0 metadata upgrades directly to 0.2.1-rc.1 with exact recoverable history and stable discovery',{skip:!running},()=>{
 // The two immutable historical fixtures came from source commit 7f58d868580aab8269299c92c1b94dc87c1cc086.
 // No git CLI or history is required by offline installers and native Linux QA.
 const fixture=name=>fs.readFileSync(fileURLToPath(new URL('./fixtures/capability-gaps-v0.1.0-'+name,import.meta.url)),'utf8');
 const old={'agent.json':fixture('agent.json'),'SKILL.md':fixture('SKILL.md')};
 const digest=value=>createHash('sha256').update(value).digest('hex');
 assert.equal(digest(old['agent.json']),'3b0b3f522dd6ce04f505bad1e1f971d9b1420e45e57196c1c55edc24b4fe7593','PINNED_V010_MANIFEST_DRIFT');
 assert.equal(digest(old['SKILL.md']),'74918cd9768e39d3c451351cbd7a76bfb0e53d91abc13172a29ca0afdc8b2a10','PINNED_V010_SKILL_DRIFT');
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

test('upgrade known V2 0.2.0 to routing RC preserves exact original and supports reversible owner-local rollback',{skip:!running},()=>{
 const fixture=fileURLToPath(new URL('./fixtures/capability-gaps-v0.2.0-agent.json',import.meta.url));
 const oldManifest=fs.readFileSync(fixture);
 const sha=b=>createHash('sha256').update(b).digest('hex');
 const oldHash='d94c646466037e29ddf3eafc2ecb683c882e529ec55d8012b21b092fe80cd1e4';
 assert.equal(sha(oldManifest),oldHash,'TEST_FIXTURE_SOURCE_CHANGED');
 const sourceSkill=fs.readFileSync(fileURLToPath(new URL('../extensions/commander-capability-gaps/SKILL.md',import.meta.url)));
 const home=tempHome(),root=path.join(home,'.agents','extensions'),dest=path.join(root,'commander-capability-gaps');
 try{
  fs.mkdirSync(dest,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(dest,'agent.json'),oldManifest,{mode:0o600});
  fs.writeFileSync(path.join(dest,'SKILL.md'),sourceSkill,{mode:0o600});
  let res=exec(home,'--status');assert.equal(res.status,0,res.stderr);
  assert.deepEqual(JSON.parse(res.stdout).status,'UPGRADE_AVAILABLE');
  assert.equal(JSON.parse(res.stdout).from,'0.2.0');
  assert.equal(JSON.parse(res.stdout).to,'0.2.1-rc.1');
  res=exec(home,'--install');assert.equal(res.status,2);
  assert.match(res.stderr,/EXPLICIT_UPGRADE_REQUIRED/);
  assert.deepEqual(fs.readFileSync(path.join(dest,'agent.json')),oldManifest);
  res=exec(home,'--upgrade');assert.equal(res.status,0,res.stderr);
  const proof=JSON.parse(res.stdout);
  assert.equal(proof.status,'DECLARATIVE_EXTENSION_UPGRADED');
  assert.equal(proof.manifestSHA256,'80f1a197408280390449e5a72291edcbc20b61b46aed9b593944ca1b332dd463');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest,'agent.json'),'utf8')).version,'0.2.1-rc.1');
  const backup=path.join(home,'.agents','capgap-recovery','commander-capability-gaps-v0.2.0');
  assert.deepEqual(fs.readFileSync(path.join(backup,'agent.json')),oldManifest);
  assert.deepEqual(fs.readFileSync(path.join(backup,'SKILL.md')),sourceSkill);
  res=exec(home,'--upgrade');assert.equal(res.status,0,res.stderr);
  assert.equal(JSON.parse(res.stdout).changed,false);
  // Controlled manual rollback rehearsal inside the test-only HOME; preserve the RC before restore.
  const newer=dest+'-rc-temporary';
  fs.renameSync(dest,newer);
  fs.renameSync(backup,dest);
  assert.deepEqual(fs.readFileSync(path.join(dest,'agent.json')),oldManifest);
  res=exec(home,'--status');assert.equal(res.status,0,res.stderr);
  assert.equal(JSON.parse(res.stdout).from,'0.2.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(newer,'agent.json'),'utf8')).version,'0.2.1-rc.1');
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('pinned rollback-slot collision refuses upgrade without modifying 0.2.0 installation',{skip:!running},()=>{
 const old=fs.readFileSync(fileURLToPath(new URL('./fixtures/capability-gaps-v0.2.0-agent.json',import.meta.url)));
 const sourceSkill=fs.readFileSync(fileURLToPath(new URL('../extensions/commander-capability-gaps/SKILL.md',import.meta.url)));
 const home=tempHome(),dest=path.join(home,'.agents','extensions','commander-capability-gaps');
 const backup=path.join(home,'.agents','capgap-recovery','commander-capability-gaps-v0.2.0');
 try{
  fs.mkdirSync(dest,{recursive:true,mode:0o700});
  fs.mkdirSync(backup,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(dest,'agent.json'),old,{mode:0o600});
  fs.writeFileSync(path.join(dest,'SKILL.md'),sourceSkill,{mode:0o600});
  fs.writeFileSync(path.join(backup,'preserve.txt'),'unrelated recovery data',{mode:0o600});
  const res=exec(home,'--upgrade');
  assert.equal(res.status,2);
  assert.match(res.stderr,/ROLLBACK_SLOT_OCCUPIED/);
  assert.deepEqual(fs.readFileSync(path.join(dest,'agent.json')),old);
  assert.equal(fs.readFileSync(path.join(backup,'preserve.txt'),'utf8'),'unrelated recovery data');
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
