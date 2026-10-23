// Disposable J01 crash-state acceptance fixtures. NEVER run against real
// Commander state. None of these states authenticates a human or releases GUI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createGuiInputIncidentStore} from '../src/gui-incident-store.mjs';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const names={pending:'pending.json',prepared:'review-prepared.json',archive:'archived-pending.json'};
async function fixture(fn) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rc-j01-review-crash-fixture-'));
 const file=path.join(dir,names.pending);
 const store=createGuiInputIncidentStore({file});
 try {
  const live=await store.begin('gui_focus_window'); // NO native dispatcher exists.
  const original=await fs.readFile(file);
  const expected=sha256(original);
  return await fn({dir,file,store,live,original,expected});
 } finally {await fs.rm(dir,{recursive:true,force:true});}
}
async function readSafe(file) {
 let stat;
 try {stat=await fs.lstat(file);}
 catch(e){if(e.code==='ENOENT')return null;throw e;}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size<1||stat.size>2048)
  throw Error('UNSAFE_FILE_TYPE');
 return fs.readFile(file);
}
async function assess({dir,expected}) {
 const guard={canDispatch:false,ownerAuthenticated:false,nativeOutcome:'UNKNOWN',noReplay:true};
 const [pending,prepared,archive]=await Promise.all(Object.values(names).map(
  name=>readSafe(path.join(dir,name)).catch(error=>{
   if(error.message==='UNSAFE_FILE_TYPE')return 'UNSAFE';
   throw error;
  })
 ));
 if([pending,prepared,archive].includes('UNSAFE'))return {...guard,state:'UNSAFE_EVIDENCE_DENY'};
 if(pending&&sha256(pending)!==expected || archive&&sha256(archive)!==expected)
  return {...guard,state:'CORRUPT_ORIGINAL_DENY'};
 if(prepared) {
  let record;
  try {record=JSON.parse(prepared.toString('utf8'));}
  catch{return {...guard,state:'MALFORMED_PREPARE_DENY'};}
  if(record?.schema!=='rc-j01-fixture-prepared-v1'||
     record?.state!=='REVIEW_PREPARED'||record?.eventSha256!==expected||
     record?.scope!=='TEST_ONLY'||record?.authorization!==false||
     Object.keys(record).sort().join('|')!==
       ['schema','state','eventSha256','scope','authorization'].sort().join('|')||
     prepared.toString('utf8')!==JSON.stringify(record)+'\n')
    return {...guard,state:'INVALID_PREPARE_DENY'};
 }
 if(pending&&archive)return {...guard,state:'CONFLICTING_ORIGINALS_DENY'};
 if(!pending&&!prepared&&!archive)return {...guard,state:'MISSING_EVIDENCE_DENY'};
 if(pending&&!prepared&&!archive)return {...guard,state:'PENDING_NATIVE_EFFECT'};
 if(pending&&prepared&&!archive)return {...guard,state:'REVIEW_PREPARED_RECOVERY_REQUIRED'};
 if(!pending&&prepared&&archive)return {...guard,state:'ARCHIVED_UNTRUSTED_RECOVERY_REQUIRED'};
 return {...guard,state:'INCOMPLETE_RECOVERY_DENY'};
}
const crashScript=[
 "import fs from 'node:fs/promises';",
 "import path from 'node:path';",
 "const [dir,sha,phase]=process.argv.slice(1);",
 "const filename=path.join(dir,'review-prepared.json');",
 "const record={schema:'rc-j01-fixture-prepared-v1',state:'REVIEW_PREPARED',",
 " eventSha256:sha,scope:'TEST_ONLY',authorization:false};",
 "try {",
 " const fh=await fs.open(filename,'wx',0o600);",
 " try{await fh.writeFile(JSON.stringify(record)+'\\n');await fh.sync();}",
 " finally{await fh.close();}",
 "}catch(e){if(e.code==='EEXIST')process.exit(73);throw e;}",
 "if(phase==='after-prepare')process.exit(71);",
 "await fs.rename(path.join(dir,'pending.json'),path.join(dir,'archived-pending.json'));",
 "process.exit(72);"
].join('\n');

async function runCrash(dir,expected,phase) {
 const child=spawn(process.execPath,['--input-type=module','-e',crashScript,dir,expected,phase],{
  windowsHide:true,stdio:['ignore','pipe','pipe']
 });
 let stderr='';
 child.stderr.on('data',buf=>{stderr+=String(buf);});
 return await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGKILL');},10000);
  child.once('error',e=>{clearTimeout(timer);reject(e);});
  child.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal,stderr});});
 });
}
test('unreviewed pending state remains blocked without touching native input',()=>fixture(async f=>{
 const before=await fs.readFile(f.file);
 const value=await assess(f);
 assert.equal(value.state,'PENDING_NATIVE_EFFECT');
 assert.equal(value.canDispatch,false);
 assert.equal(value.ownerAuthenticated,false);
 assert.equal(value.nativeOutcome,'UNKNOWN');
 assert.deepEqual(await fs.readFile(f.file),before);
}));
test('crash after fsynced PREPARED leaves original and needs explicit recovery',()=>fixture(async f=>{
 const c=await runCrash(f.dir,f.expected,'after-prepare');
 assert.equal(c.code,71,c.stderr);
 const value=await assess(f);
 assert.equal(value.state,'REVIEW_PREPARED_RECOVERY_REQUIRED');
 assert.equal(value.canDispatch,false);
 assert.deepEqual(await fs.readFile(f.file),f.original);
 assert.equal((await f.store.pending()).id,f.live.id);
}));
test('crash after same-directory rename preserves exact bytes but is NOT authorization',()=>fixture(async f=>{
 const c=await runCrash(f.dir,f.expected,'after-archive');
 assert.equal(c.code,72,c.stderr);
 const value=await assess(f);
 assert.equal(value.state,'ARCHIVED_UNTRUSTED_RECOVERY_REQUIRED');
 assert.equal(value.ownerAuthenticated,false);
 assert.equal(value.nativeOutcome,'UNKNOWN');
 assert.equal(value.canDispatch,false);
 assert.deepEqual(await fs.readFile(path.join(f.dir,names.archive)),f.original);
 await assert.rejects(fs.lstat(f.file),{code:'ENOENT'});
 // A missing live pending alone does NOT permit a fresh input.
 assert.equal(value.noReplay,true);
}));
test('tampering with prepared trust claim fails closed despite correct incident SHA',()=>fixture(async f=>{
 const c=await runCrash(f.dir,f.expected,'after-prepare');
 assert.equal(c.code,71);
 const p=path.join(f.dir,names.prepared);
 const record=JSON.parse(await fs.readFile(p,'utf8'));
 record.authorization=true;
 await fs.writeFile(p,JSON.stringify(record)+'\n');
 assert.equal((await assess(f)).state,'INVALID_PREPARE_DENY');
 assert.equal((await f.store.pending()).id,f.live.id);
}));
test('archived original with altered bytes is corrupt even if PREPARED is valid',()=>fixture(async f=>{
 const c=await runCrash(f.dir,f.expected,'after-archive');
 assert.equal(c.code,72);
 const p=path.join(f.dir,names.archive);
 const bytes=await fs.readFile(p);
 bytes[0]^=1;
 await fs.writeFile(p,bytes);
 assert.equal((await assess(f)).state,'CORRUPT_ORIGINAL_DENY');
}));
test('two separate staged reviewers cannot both create PREPARED under wx',()=>fixture(async f=>{
 const [a,b]=await Promise.all([
  runCrash(f.dir,f.expected,'after-prepare'),
  runCrash(f.dir,f.expected,'after-prepare')
 ]);
 assert.deepEqual([a.code,b.code].sort((x,y)=>x-y),[71,73],
  a.stderr+' | '+b.stderr);
 assert.equal((await assess(f)).state,'REVIEW_PREPARED_RECOVERY_REQUIRED');
 assert.deepEqual(await fs.readFile(f.file),f.original);
}));
test('lost live record and absent archive never establishes permission',()=>fixture(async f=>{
 await fs.unlink(f.file); // TEST fixture ONLY.
 const value=await assess(f);
 assert.equal(value.state,'MISSING_EVIDENCE_DENY');
 assert.equal(value.canDispatch,false);
}));
test('hardlinked evidence is rejected even if bytes match expected SHA',()=>fixture(async f=>{
 const alias=path.join(f.dir,'hardlink-alias.json');
 await fs.link(f.file,alias);
 assert.equal((await assess(f)).state,'UNSAFE_EVIDENCE_DENY');
}));
test('symlinked evidence is rejected rather than followed',{
 skip:process.platform==='win32'
},()=>fixture(async f=>{
 const alias=path.join(f.dir,'legitimate-original.json');
 await fs.rename(f.file,alias);
 await fs.symlink(alias,f.file);
 assert.equal((await assess(f)).state,'UNSAFE_EVIDENCE_DENY');
}));
