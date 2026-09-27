import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgentExtensionRegistry, validateAgentExtensionManifest } from '../src/agent-extensions.mjs';

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(),'rc-agent-ext-')); }
function writeExtension(base,name,manifest,{skill=true}={}) {
  const dir=path.join(base,name); fs.mkdirSync(dir,{recursive:true});
  if(skill) fs.writeFileSync(path.join(dir,'SKILL.md'),'# skill\n','utf8');
  fs.writeFileSync(path.join(dir,'agent.json'),JSON.stringify(manifest,null,2),'utf8');
  return dir;
}
function manifest(id='fixture-extension') {
  return {
    schemaVersion:1,
    id,
    version:'1.0.0',
    displayName:'Fixture Extension',
    description:'Generic reusable capability-pack fixture.',
    capabilities:['fixture.capability.alpha','fixture.capability.beta','fixture.capability.gamma'],
    triggers:['run fixture','run sample'],
    skill:'SKILL.md',
    projectRoot:path.join(os.tmpdir(),'rc-fixture-project'),
    router:{program:'python',args:['router.py']},
    runtimeDependencies:[
      {id:'runtime.shared',kind:'runtime',required:true,path:path.join(os.tmpdir(),'rc-shared-runtime')},
      {id:'tool.example',kind:'tool',required:true}
    ],
    hardware:{minRamMiB:1024,platforms:[process.platform]},
    safetyGates:['fixture.approval-required'],
    artifacts:['result.bin','evidence.json']
  };
}

test('valid manifest is discovered and matched by all requested capabilities',()=>{
  const base=tempRoot();
  try {
    writeExtension(base,'fixture-extension',manifest());
    const registry=createAgentExtensionRegistry({directories:[base]});
    const list=registry.execute('agent_extension_list',{});
    assert.equal(list.items.length,1);
    assert.equal(list.diagnostics.length,0);
    assert.equal(list.items[0].id,'fixture-extension');
    assert.ok(path.isAbsolute(list.items[0].skillPath));
    const match=registry.execute('agent_extension_match',{capabilities:['fixture.capability.alpha','fixture.capability.gamma']});
    assert.deepEqual(match.items.map(x=>x.id),['fixture-extension']);
    assert.equal(registry.execute('agent_extension_get',{id:'fixture-extension'}).version,'1.0.0');
  } finally { fs.rmSync(base,{recursive:true,force:true}); }
});

test('unknown fields and escaping skill paths fail validation',()=>{
  const base=tempRoot();
  try {
    const value=manifest();
    value.extra=true;
    value.skill='../outside.md';
    const validation=validateAgentExtensionManifest(value,path.join(base,'fixture-extension'));
    assert.equal(validation.valid,false);
    const codes=validation.errors.map(x=>x.code);
    assert.ok(codes.includes('AGENT_EXTENSION_UNKNOWN_FIELD'));
    assert.ok(codes.includes('AGENT_EXTENSION_SKILL_INVALID'));
  } finally { fs.rmSync(base,{recursive:true,force:true}); }
});

test('invalid extension is excluded without breaking registry',()=>{
  const base=tempRoot();
  try {
    const bad=manifest('Bad ID');
    writeExtension(base,'bad',bad);
    const registry=createAgentExtensionRegistry({directories:[base]});
    const list=registry.execute('agent_extension_list',{});
    assert.equal(list.items.length,0);
    assert.equal(list.diagnostics.length,1);
    assert.equal(list.diagnostics[0].code,'AGENT_EXTENSION_MANIFEST_INVALID');
  } finally { fs.rmSync(base,{recursive:true,force:true}); }
});

test('duplicate ids fail closed instead of selecting by path order',()=>{
  const a=tempRoot(),b=tempRoot();
  try {
    writeExtension(a,'one',manifest('fixture-extension'));
    writeExtension(b,'two',manifest('fixture-extension'));
    const registry=createAgentExtensionRegistry({directories:[a,b]});
    const list=registry.execute('agent_extension_list',{});
    assert.equal(list.items.length,0);
    assert.ok(list.diagnostics.some(x=>x.code==='AGENT_EXTENSION_ID_CONFLICT'));
  } finally { fs.rmSync(a,{recursive:true,force:true}); fs.rmSync(b,{recursive:true,force:true}); }
});

test('missing extension roots are benign and not reported as invalid extensions',()=>{
  const base=path.join(tempRoot(),'does-not-exist');
  const registry=createAgentExtensionRegistry({directories:[base]});
  const status=registry.status();
  assert.equal(status.count,0);
  assert.equal(status.invalidCount,0);
});

test('manifest file must be a regular bounded single-link file',()=>{
  const base=tempRoot();
  try {
    const dir=path.join(base,'x'); fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir,'SKILL.md'),'# x\n');
    fs.writeFileSync(path.join(dir,'agent.json'),'{}');
    const alias=path.join(dir,'agent-hardlink.json');
    fs.linkSync(path.join(dir,'agent.json'),alias);
    const registry=createAgentExtensionRegistry({directories:[base]});
    const list=registry.execute('agent_extension_list',{});
    assert.equal(list.items.length,0);
    assert.ok(list.diagnostics.some(x=>x.code==='AGENT_EXTENSION_FILE_INVALID'));
  } finally { fs.rmSync(base,{recursive:true,force:true}); }
});


test('three-way duplicate ids remain fully conflicted and never re-enter the catalog',()=>{
  const a=tempRoot(),b=tempRoot(),c=tempRoot();
  try {
    writeExtension(a,'one',manifest('fixture-extension'));
    writeExtension(b,'two',manifest('fixture-extension'));
    writeExtension(c,'three',manifest('fixture-extension'));
    const registry=createAgentExtensionRegistry({directories:[a,b,c]});
    const list=registry.execute('agent_extension_list',{});
    assert.equal(list.items.length,0);
    assert.ok(list.diagnostics.filter(x=>x.code==='AGENT_EXTENSION_ID_CONFLICT').length>=2);
  } finally {
    fs.rmSync(a,{recursive:true,force:true});
    fs.rmSync(b,{recursive:true,force:true});
    fs.rmSync(c,{recursive:true,force:true});
  }
});


test('skill path cannot escape through a junction or symlinked parent', t=>{
  const base=tempRoot(), outside=tempRoot();
  try {
    const dir=path.join(base,'fixture-extension');
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(outside,'SKILL.md'),'# outside\n');
    let linked=false;
    for(const kind of (process.platform==='win32'?['junction','dir']:['dir'])){
      try {
        fs.symlinkSync(outside,path.join(dir,'linked'),kind);
        linked=true;
        break;
      } catch {}
    }
    if(!linked) {
      t.skip('OS symlink/junction privilege unavailable');
      return;
    }
    const value=manifest();
    value.skill='linked/SKILL.md';
    fs.writeFileSync(path.join(dir,'agent.json'),JSON.stringify(value));
    const registry=createAgentExtensionRegistry({directories:[base]});
    const list=registry.execute('agent_extension_list',{});
    assert.equal(list.items.length,0);
    assert.ok(list.diagnostics.some(x=>x.code==='AGENT_EXTENSION_MANIFEST_INVALID'));
  } finally {
    fs.rmSync(base,{recursive:true,force:true});
    fs.rmSync(outside,{recursive:true,force:true});
  }
});
