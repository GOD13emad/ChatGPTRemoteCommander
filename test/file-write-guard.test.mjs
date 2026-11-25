import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {guardFileWrite,readBoundHostConfiguration} from '../src/file-write-guard.mjs';
import {writeText} from '../src/tools-v0.3.mjs';

function fixture(t) {
  const parent=fs.realpathSync.native(os.tmpdir());
  const root=fs.realpathSync.native(fs.mkdtempSync(path.join(parent,'rc-write-guard-')));
  t.after(()=>{assert.equal(path.dirname(root),parent);fs.rmSync(root,{recursive:true,force:true});});
  return root;
}
test('authorized file and missing descendants retain full canonical-path validation',async t=>{
  const root=fixture(t),target=path.join(root,'new','nested','result.txt');
  const initial=await guardFileWrite(target);
  assert.equal(initial.leaf,null);assert.equal(initial.ancestors.at(-1).path,root);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  await guardFileWrite(target,initial);
  fs.writeFileSync(target,'result');
  await assert.rejects(guardFileWrite(target,initial),{code:'FILE_WRITE_TARGET_CHANGED'});
  const present=await guardFileWrite(target);
  assert.equal(present.leaf.nlink,1n);await guardFileWrite(target,present);
});
test('restricted-environment authorized text write remains backed up and hash checked',async t=>{
  const root=fixture(t),target=path.join(root,'result.txt');
  const ctx={config:{maxWriteBytes:10000},roots:[root],auditLog:path.join(root,'audit.jsonl')};
  const first=await writeText(ctx,{path:'result.txt',content:'before'});
  const second=await writeText(ctx,{path:'result.txt',content:'after',expectedSha256:first.sha256});
  assert.equal(fs.readFileSync(target,'utf8'),'after');
  assert.equal(fs.readFileSync(second.backupPath,'utf8'),'before');
  await assert.rejects(writeText(ctx,{path:'result.txt',content:'wrong',expectedSha256:first.sha256}),/expectedSha256/);
  assert.equal(fs.readFileSync(target,'utf8'),'after');
});
test('canonical-path compatibility retains hardlink and nonregular target rejection',async t=>{
  const root=fixture(t),target=path.join(root,'result.txt');fs.writeFileSync(target,'untouched');
  fs.linkSync(target,path.join(root,'alias.txt'));
  await assert.rejects(guardFileWrite(target),{code:'FILE_WRITE_HARDLINK'});
  await assert.rejects(guardFileWrite(root),{code:'FILE_WRITE_NOT_REGULAR'});
  assert.equal(fs.readFileSync(target,'utf8'),'untouched');
});
test('a junction ancestor cannot redirect a new target',async t=>{
  const root=fixture(t),outside=path.join(root,'outside'),alias=path.join(root,'alias');fs.mkdirSync(outside);
  fs.symlinkSync(outside,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(guardFileWrite(path.join(alias,'new.txt')),{code:'FILE_WRITE_ALIAS'});
  assert.equal(fs.existsSync(path.join(outside,'new.txt')),false);
});
test('replacement of an existing parent or leaf invalidates a write snapshot',async t=>{
  const root=fixture(t),parent=path.join(root,'parent');fs.mkdirSync(parent);
  const target=path.join(parent,'result.txt'),pending=await guardFileWrite(target);
  fs.renameSync(parent,path.join(root,'previous-parent'));fs.mkdirSync(parent);
  await assert.rejects(guardFileWrite(target,pending),{code:'FILE_WRITE_TARGET_CHANGED'});
  fs.writeFileSync(target,'original');const existing=await guardFileWrite(target);
  const replacement=path.join(parent,'replacement.txt');fs.writeFileSync(replacement,'replacement');
  fs.unlinkSync(target);fs.renameSync(replacement,target);
  await assert.rejects(guardFileWrite(target,existing),{code:'FILE_WRITE_TARGET_CHANGED'});
});

test('Host config selection reads exact local or explicit bytes, and falls back only on absence',async t=>{
  const root=fixture(t),localConfigPath=path.join(root,'config.local.json'),
    defaultConfigPath=path.join(root,'config.json');
  const options={localConfigPath,defaultConfigPath};
  fs.writeFileSync(defaultConfigPath,'{"source":"default"}');
  assert.deepEqual(await readBoundHostConfiguration(options),
    {configPath:defaultConfigPath,configRaw:'{"source":"default"}'});
  fs.writeFileSync(localConfigPath,'{"source":"local"}');
  assert.deepEqual(await readBoundHostConfiguration(options),
    {configPath:localConfigPath,configRaw:'{"source":"local"}'});
  assert.deepEqual(await readBoundHostConfiguration({...options,explicitConfigPath:defaultConfigPath}),
    {configPath:defaultConfigPath,configRaw:'{"source":"default"}'});
  await assert.rejects(readBoundHostConfiguration({...options,explicitConfigPath:path.join(root,'absent.json')}),
    {code:'HOST_CONFIG_NOT_FOUND'});
});
test('an existing nonregular, hardlinked, or aliased local Host config must not fall back',async t=>{
  const root=fixture(t),localConfigPath=path.join(root,'config.local.json'),
    defaultConfigPath=path.join(root,'config.json');
  const options={localConfigPath,defaultConfigPath};
  fs.writeFileSync(defaultConfigPath,'{"source":"default"}');
  fs.mkdirSync(localConfigPath);
  await assert.rejects(readBoundHostConfiguration(options),{code:'HOST_CONFIG_PATH_UNTRUSTED'});
  fs.rmdirSync(localConfigPath);
  fs.linkSync(defaultConfigPath,localConfigPath);
  await assert.rejects(readBoundHostConfiguration(options),{code:'HOST_CONFIG_PATH_UNTRUSTED'});
  fs.unlinkSync(localConfigPath);
  const dir=path.join(root,'actual'),alias=path.join(root,'alias');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir,'config.json'),'{"source":"alias"}');
  fs.symlinkSync(dir,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(readBoundHostConfiguration({...options,explicitConfigPath:path.join(alias,'config.json')}),
    {code:'HOST_CONFIG_PATH_UNTRUSTED'});
  assert.equal(fs.readFileSync(defaultConfigPath,'utf8'),'{"source":"default"}');
});
test('Host config reads are bounded before allocating bytes, without fallback',async t=>{
  const root=fixture(t),localConfigPath=path.join(root,'config.local.json'),
    defaultConfigPath=path.join(root,'config.json');
  fs.writeFileSync(defaultConfigPath,'{}');
  fs.writeFileSync(localConfigPath,'{}');
  fs.truncateSync(localConfigPath,8*1024*1024+1);
  await assert.rejects(readBoundHostConfiguration({localConfigPath,defaultConfigPath}),{code:'HOST_CONFIG_TOO_LARGE'});
});
