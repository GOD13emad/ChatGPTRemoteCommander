import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createManifest,validateManifest,checkBundle,plan,apply as applyRaw,rollback,inspect} from '../tools/v2-universal-install-engine.mjs';
const pin=b=>createHash('sha256').update(JSON.stringify(JSON.parse(fs.readFileSync(path.join(b,'manifest.json'),'utf8')))).digest('hex');
const apply=opts=>applyRaw({...opts,expectedManifestSha256:pin(opts.bundle)});


const tool=fileURLToPath(new URL('../tools/v2-universal-install-engine.mjs',import.meta.url));
const make=()=>{const home=fs.mkdtempSync(path.join(os.tmpdir(),'v2-installer-engine-'));return {home,root:path.join(home,'managed'),source:path.join(home,'payload')};};
const cleanup=o=>fs.rmSync(o.home,{force:true,recursive:true});
function bundle(o,{version='0.12.0-qa.1',mode='desktop',platform=process.platform,arch=process.arch,content='synthetic Commander payload',separate=false}={}){
  const dir=separate?path.join(o.home,'payload-'+version.replaceAll('.','_')):o.source;
  fs.mkdirSync(path.join(dir,'bin'),{recursive:true});
  const file=path.join(dir,'bin','commander.mjs');
  fs.writeFileSync(file,'console.log('+JSON.stringify(content)+')\n');
  fs.writeFileSync(path.join(dir,'bin','data.bin'),'fixture-payload');
  const m=createManifest({source:dir,version,mode,platform,arch,entry:'bin/commander.mjs',files:['bin/commander.mjs','bin/data.bin']});
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(m));
  return dir;
}
test('read-only plan; managed first install; runnable exact verified entry; idempotency',()=>{
  const o=make();try{
    const b=bundle(o);
    assert.equal(plan({bundle:b,root:o.root}).action,'INSTALL');
    assert.equal(fs.existsSync(o.root),false);
    const a=apply({bundle:b,root:o.root});
    assert.equal(a.action,'INSTALL');
    assert.equal(a.verified,true);
    assert.equal(spawnSync(process.execPath,[a.entry],{encoding:'utf8'}).stdout.trim(),'synthetic Commander payload');
    assert.equal(fs.readdirSync(path.join(o.root,'releases')).length,1);
    assert.equal(apply({bundle:b,root:o.root}).action,'NOOP');
    assert.equal(fs.readdirSync(path.join(o.root,'releases')).length,1);
  }finally{cleanup(o);}
});
test('one active release, headless upgrade, rollback, forward replay preserve state',()=>{
  const o=make();try{
    const first=bundle(o);const old=apply({bundle:first,root:o.root});
    fs.mkdirSync(path.join(o.root,'state'));fs.writeFileSync(path.join(o.root,'state','owner.fixture'),'unchanged');
    const second=bundle(o,{version:'0.12.0-qa.2',mode:'headless',content:'upgrade',separate:true});
    assert.equal(apply({bundle:second,root:o.root}).mode,'headless');
    assert.equal(fs.readdirSync(path.join(o.root,'releases')).length,2);
    assert.equal(rollback({root:o.root}).release,old.release);
    assert.equal(rollback({root:o.root}).mode,'headless');
    assert.equal(apply({bundle:second,root:o.root}).action,'NOOP');
    assert.equal(fs.readFileSync(path.join(o.root,'state','owner.fixture'),'utf8'),'unchanged');
  }finally{cleanup(o);}
});
test('apply rejects absent or mismatched independent release pin before root creation',()=>{
  const o=make();try{
    const b=bundle(o);
    assert.throws(()=>applyRaw({bundle:b,root:o.root}),/EXTERNAL_MANIFEST_PIN_REQUIRED_OR_MISMATCH/);
    assert.throws(()=>applyRaw({bundle:b,root:o.root,expectedManifestSha256:'0'.repeat(64)}),/EXTERNAL_MANIFEST_PIN_REQUIRED_OR_MISMATCH/);
    assert.equal(fs.existsSync(o.root),false);
  }finally{cleanup(o);}
});
test('tampered manifest payload rejected before state creation',()=>{
  const o=make();try{
    const b=bundle(o);fs.appendFileSync(path.join(b,'bin','data.bin'),'evil');
    assert.throws(()=>apply({bundle:b,root:o.root}),/PAYLOAD_HASH_MISMATCH/);
    assert.equal(fs.existsSync(o.root),false);
  }finally{cleanup(o);}
});
test('same release version cannot replace an existing payload with different bytes',()=>{
  const o=make();try{
    const b=bundle(o);apply({bundle:b,root:o.root});
    const other=bundle(o,{separate:true,content:'changed'});
    assert.throws(()=>apply({bundle:other,root:o.root}),/SAME_VERSION_DIFFERENT_CONTENT|RELEASE_MANIFEST_CHANGED/);
  }finally{cleanup(o);}
});
test('injected failure before promotion cleans staging and is retryable',()=>{
  const o=make();try{
    const b=bundle(o);
    assert.throws(()=>apply({bundle:b,root:o.root,faultAt:'beforePromotion'}),/INJECTED_BEFORE_PROMOTION/);
    assert.equal(inspect({root:o.root}).status,'NOT_INSTALLED');
    assert.deepEqual(fs.readdirSync(path.join(o.root,'releases')),[]);
    assert.equal(apply({bundle:b,root:o.root}).action,'INSTALL');
  }finally{cleanup(o);}
});
test('crash after release promotion never switches active pointer; retry reuses release',()=>{
  const o=make();try{
    const b=bundle(o);const old=apply({bundle:b,root:o.root});
    const second=bundle(o,{version:'0.12.0-qa.2',separate:true});
    assert.throws(()=>apply({bundle:second,root:o.root,faultAt:'beforeActivation'}),/INJECTED_BEFORE_ACTIVATION/);
    assert.equal(inspect({root:o.root}).release,old.release);
    assert.equal(apply({bundle:second,root:o.root}).action,'UPGRADE');
    assert.equal(fs.readdirSync(path.join(o.root,'releases')).length,2);
  }finally{cleanup(o);}
});
test('unknown install root refuses takeover without modifying old files',()=>{
  const o=make();try{
    const b=bundle(o);fs.mkdirSync(o.root);fs.writeFileSync(path.join(o.root,'old.txt'),'owned elsewhere');
    assert.throws(()=>apply({bundle:b,root:o.root}),/UNOWNED_INSTALL_ROOT/);
    assert.equal(fs.readFileSync(path.join(o.root,'old.txt'),'utf8'),'owned elsewhere');
  }finally{cleanup(o);}
});
test('corrupted active release blocks verify and rollback',()=>{
  const o=make();try{
    apply({bundle:bundle(o),root:o.root});
    apply({bundle:bundle(o,{version:'0.12.0-qa.2',separate:true}),root:o.root});
    const file=path.join(o.root,'releases',inspect({root:o.root}).release,'bin','commander.mjs');
    fs.appendFileSync(file,'tamper');
    assert.throws(()=>inspect({root:o.root}),/PAYLOAD_HASH_MISMATCH/);
    assert.throws(()=>rollback({root:o.root}),/PAYLOAD_HASH_MISMATCH/);
  }finally{cleanup(o);}
});
test('case collisions, traversal and reserved Windows device filenames reject',()=>{
  const o=make();try{
    const b=bundle(o),m=JSON.parse(fs.readFileSync(path.join(b,'manifest.json'),'utf8'));
    for(const name of ['../private','/root/private','a\\b','COM1.txt','foo//bar','folder/../ok']){
      assert.throws(()=>validateManifest({...m,entry:name}),/ENTRY_NOT_IN_MANIFEST|INVALID_MANIFEST/);
    }
    assert.throws(()=>validateManifest({...m,files:[...m.files,{...m.files[0],path:'BIN/COMMANDER.MJS'}]}),/CASE_COLLIDING_PATH/);
    assert.throws(()=>validateManifest({...m,files:[...m.files,{...m.files[0],path:'../private'}]}),/INVALID_FILE_RECORD/);
  }finally{cleanup(o);}
});
test('cross-platform manifest cannot install on current OS',()=>{
  const o=make();try{
    const b=bundle(o,{platform:process.platform==='win32'?'linux':'win32'});
    assert.throws(()=>plan({bundle:b,root:o.root}),/HOST_PLATFORM_MISMATCH/);
    assert.equal(fs.existsSync(o.root),false);
  }finally{cleanup(o);}
});
test('hardlink payloads and aliased roots rejected',()=>{
  const o=make();try{
    const b=bundle(o),original=path.join(b,'bin','data.bin'),linked=path.join(b,'bin','linked.bin');
    fs.linkSync(original,linked);
    assert.throws(()=>createManifest({source:b,version:'0.12.0-qa.2',mode:'desktop',platform:process.platform,arch:process.arch,entry:'bin/linked.bin',files:['bin/linked.bin']}),/NONREGULAR_FILE/);
    fs.unlinkSync(linked);
    if(process.platform!=='win32'){
      const real=path.join(o.home,'elsewhere');fs.mkdirSync(real);fs.symlinkSync(real,o.root,'dir');
      assert.throws(()=>plan({bundle:b,root:o.root}),/ALIAS_ANCESTOR/);
      fs.unlinkSync(o.root);
      const file=path.join(b,'bin','commander.mjs');fs.unlinkSync(file);fs.symlinkSync(original,file);
      assert.throws(()=>checkBundle(b),/ALIAS_ANCESTOR|NONREGULAR_FILE/);
    }
  }finally{cleanup(o);}
});
test('concurrent lock, unrecognized incomplete staging fail closed',()=>{
  const o=make();try{
    const b=bundle(o);apply({bundle:b,root:o.root});
    const lock=path.join(o.root,'.engine.lock');fs.writeFileSync(lock,'some other writer');
    assert.throws(()=>apply({bundle:b,root:o.root}),/EEXIST/);
    fs.unlinkSync(lock);
    const stage=path.join(o.root,'releases','.staging-foreign');fs.mkdirSync(stage);
    assert.throws(()=>inspect({root:o.root}),/UNRECONCILED_STAGING/);
    fs.rmdirSync(stage);assert.equal(inspect({root:o.root}).verified,true);
  }finally{cleanup(o);}
});
test('rollback without verified previous version refused',()=>{
  const o=make();try{apply({bundle:bundle(o),root:o.root});assert.throws(()=>rollback({root:o.root}),/NO_PREVIOUS_RELEASE/);}finally{cleanup(o);}
});
test('single CLI engine handles plan/apply/inspect/rollback without device settings',()=>{
  const o=make();try{
    const b=bundle(o),args=(verb,src)=>[tool,verb,...(src?['--bundle',src]:[]),'--root',o.root];
    const call=a=>spawnSync(process.execPath,a,{encoding:'utf8',timeout:10000});
    let r=call(args('plan',b));assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).changesApplied,false);
    assert.equal(call([...args('apply',b),'--expected-manifest-sha256',pin(b)]).status,0);
    const second=bundle(o,{version:'0.12.0-qa.2',separate:true});
    assert.equal(call([...args('apply',second),'--expected-manifest-sha256',pin(second)]).status,0);
    r=call(args('rollback'));assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).action,'ROLLBACK');
    r=call([tool,'apply','--root',o.root]);assert.equal(r.status,2);assert.match(r.stderr,/BUNDLE_REQUIRED/);
  }finally{cleanup(o);}
});
