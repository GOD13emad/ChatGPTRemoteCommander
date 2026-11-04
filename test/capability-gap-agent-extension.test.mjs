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
  assert.match(skill.skill,/not.*fleet-synchronized/i);
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
