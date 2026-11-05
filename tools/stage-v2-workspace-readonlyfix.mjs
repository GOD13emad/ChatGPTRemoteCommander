#!/usr/bin/env node
// Deterministic source-only QA patch for disposable Commander V2 vendor trees.
// Does not touch installed V1, browser identities or system package managers.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=k=>{throw Object.assign(new Error('V2_READONLYFIX_QA_'+k),{code:k})};
export const PINS=Object.freeze({
 sourceOld:'bffb59410459b61ab547cb04a077d1408583eb2bce58f603256412c74d6fe36d',
 sourceNew:'7a1f500ce3071bff685876db8acbadf4d11b165a05659f69599fc24177ea16cd',
 manifestOld:'7512cbc77ed07281864355184da1db1a9d89c00321d50c77bf50b6216e2b9e2a',
 manifestNew:'1202e46e59162946452a255b03db98de77bd7bf81b978e3a1c867d2490937c64'
});
const BEFORE="const settled=await Promise.allSettled([...NAMES.slice(1),'tools/list'].map(n=>\n    invoke(n,request,{},target.endpoint)));";
const AFTER=[
"const names=[...NAMES.slice(1),'tools/list'];",
"  const first=['tools/list','gui_status','browser_status'];",
"  const prioritized=[...first,...names.filter(n=>!first.includes(n))];",
"  const observed=new Map();",
"  // Prioritize catalog and owner GUI/browser before slower optional delivery",
"  // telemetry. Preserve the existing fixed field mapping despite probe order.",
"  // No mutation, no auth promotion and never fabricate a timed-out result.",
"  for(let i=0;i<prioritized.length;i+=2){",
"    const batch=await Promise.allSettled(prioritized.slice(i,i+2).map(n=>",
"      invoke(n,request,{},target.endpoint)));",
"    for(const [j,result] of batch.entries())observed.set(prioritized[i+j],result);",
"  }",
"  const settled=names.map(n=>observed.get(n)??{status:'rejected',reason:Error('PROBE_UNVERIFIED')});"
].join('\n');
export function patchSource(s){
 if(typeof s!=='string'||s.split(BEFORE).length!==2)fail('SOURCE_ANCHOR_CHANGED');
 return s.replace(BEFORE,AFTER);
}
export function patchManifest(m,sourceSha,sourceBytes){
 if(!m||typeof m!=='object'||!Array.isArray(m.files))fail('BAD_MANIFEST');
 const record=m.files.filter(x=>x.path==='v1-runtime-bridge.mjs');
 if(record.length!==1||record[0].sha256!==PINS.sourceOld)fail('UNPINNED_MANIFEST');
 record[0].sha256=sourceSha;record[0].bytes=sourceBytes;
 m.qaOverlay='V2_ELECTRON_CLOSE_RACE_GUARD_AND_BOUNDED_OWNER_PROBES';
 return JSON.stringify(m,null,2)+'\n';
}
function pinned(f,expected){
 const stat=fs.lstatSync(f);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
  (typeof process.getuid==='function'&&stat.uid!==process.getuid()))
  fail('UNTRUSTED_FILE');
 const bytes=fs.readFileSync(f);
 if(sha(bytes)!==expected)fail('SOURCE_SHA_CHANGED');
 return bytes;
}
export function derive(original,manifest){
 if(sha(original)!==PINS.sourceOld||sha(manifest)!==PINS.manifestOld)fail('BASELINE_SHA_MISMATCH');
 const src=Buffer.from(patchSource(original.toString('utf8')),'utf8');
 const m=Buffer.from(patchManifest(JSON.parse(manifest.toString('utf8')),sha(src),src.length),'utf8');
 if(sha(src)!==PINS.sourceNew||sha(m)!==PINS.manifestNew)fail('PATCH_SHA_MISMATCH');
 return {src,m};
}
function noSymlinkParents(p){
 let curr=path.parse(p).root;
 for(const part of p.slice(curr.length).split(path.sep).filter(Boolean)){
  curr=path.join(curr,part);
  if(fs.existsSync(curr)&&fs.lstatSync(curr).isSymbolicLink())fail('SYMLINK_PATH');
 }
}
function roots(){
 const r=process.platform==='linux'
  ?path.join(os.homedir(),'.local','state','CommanderV2','QA','cos2150-unified-rebuild-20261104')
  :process.platform==='win32'
  ?path.join(process.env.LOCALAPPDATA||'','CommanderV2','QA','official-cos-tag2150-sparse-20261104')
  :null;
 if(!r||!path.isAbsolute(r))fail('NOT_NATIVE_OWNER_QA');
 noSymlinkParents(r);
 const marker=path.join(r,'.commander-v2-isolated-qa');
 const st=fs.lstatSync(marker);
 if(!st.isFile()||st.isSymbolicLink()||fs.readFileSync(marker,'utf8')!=='V2_COS_DISPOSABLE_SOURCE_QA_ONLY\n')
  fail('QA_MARKER_INVALID');
 const base=path.join(r,'resources','commander-v2-workspace');
 const backup=path.join(r,'.commander-v2-workspace-fairness-source-backup');
 noSymlinkParents(base);noSymlinkParents(backup);
 return {base,backup};
}
export function verify(){
 const {base,backup}=roots();
 const original=pinned(path.join(backup,'v1-runtime-bridge.mjs'),PINS.sourceOld);
 const manifest=pinned(path.join(backup,'MANIFEST.json'),PINS.manifestOld);
 derive(original,manifest);
 pinned(path.join(base,'v1-runtime-bridge.mjs'),PINS.sourceNew);
 pinned(path.join(base,'MANIFEST.json'),PINS.manifestNew);
 return Object.freeze({gate:'V2_READONLYFIX_REPRODUCIBLE_SOURCE_VERIFIED',
  patchSha:PINS.sourceNew,manifestSha:PINS.manifestNew,installedServiceChanged:false});
}
function exclusive(p,b){
 const fd=fs.openSync(p,'wx',0o600);
 try{fs.writeFileSync(fd,b);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
export function apply(){
 const {base,backup}=roots();
 if(fs.existsSync(backup))return verify();
 const a=path.join(base,'v1-runtime-bridge.mjs'),b=path.join(base,'MANIFEST.json');
 const original=pinned(a,PINS.sourceOld),manifest=pinned(b,PINS.manifestOld);
 const v=derive(original,manifest);
 fs.mkdirSync(backup,{mode:0o700});
 const ta=a+'.readonlyfix-tmp',tb=b+'.readonlyfix-tmp';
 let firstRenamed=false;
 try{
  exclusive(path.join(backup,'v1-runtime-bridge.mjs'),original);
  exclusive(path.join(backup,'MANIFEST.json'),manifest);
  exclusive(ta,v.src);exclusive(tb,v.m);
  pinned(a,PINS.sourceOld);pinned(b,PINS.manifestOld);
  fs.renameSync(ta,a);firstRenamed=true;
  fs.renameSync(tb,b);
  return verify();
 }catch(e){
  if(firstRenamed&&fs.existsSync(a)&&sha(fs.readFileSync(a))===PINS.sourceNew){
   exclusive(ta,original);fs.renameSync(ta,a);
  }
  throw e;
 }finally{
  for(const f of [ta,tb])if(fs.existsSync(f))fs.rmSync(f,{force:true});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3||!['--verify','--apply'].includes(process.argv[2]))
   fail('EXPLICIT_MODE_REQUIRED');
  console.log(JSON.stringify(process.argv[2]==='--apply'?apply():verify()));
 }catch(e){console.error(String(e?.message||'V2_READONLYFIX_QA_FAILED'));process.exitCode=2}
}
