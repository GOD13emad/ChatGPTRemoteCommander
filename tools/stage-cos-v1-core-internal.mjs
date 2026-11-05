#!/usr/bin/env node
// QA-only assembly of the PINNED V1 dev23 source bridge into ONE CoS Electron package.
// Never installs, starts, upgrades or replaces an owner V1 runtime.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execute as verifyQaBearer} from './stage-commander-v2-mcp-auth-qa.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=s=>{throw Error('COS_V1_BUNDLE_'+s)};
const B=Object.freeze({
 linux:'a49834ee73d22dca55535d9d2a5722bfe6e4bfc5d81be885fc834fac8fec641e',
 win32:'a19dd95515b0f51c05f5a084134b4899f8ff521a028aa74b9726ae9c0e3c3877'
});
const PACKAGE_SHA='d40ea4c3d960146933907ed805e2ad2b135df9a20ba872499ebb9ccfa95b129b';
const COS_PACKAGE_SHA_ACCEPTED=new Set(['589305b6576f9c09e46b0c10d4296d6ed596e04efc8eba1013e61c9fb254dd5a',
  'cb7b819a70f422b4668beb52c019247a9766807ce5ac0bfa79721943e4ea0742']);
const REGISTRY_SHA='23f0f7a18133b506fe7273920d91841b8fcbae7317e4b19e0684240b48a33683';
const SERVER_SHAS=new Set(['d62c98fd122b3492aac678593f5181ba765820f8383b68c365487338501e0219','dda3d17ebf62f16315f494a9160402cd8a040fba7f93400a3f9310565fc201ad']);
const SENTINEL='  - from: resources/commander-v2-workspace\n    to: commander-v2-workspace\n    filter:\n      - "**/*"';
const EXTRA='  - from: resources/commander-v1-core\n    to: commander-v1-core\n    filter:\n      - "**/*"';
const ensureFile=f=>{const s=fs.lstatSync(f);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)fail('SOURCE_FILE_INVALID');return fs.readFileSync(f)};
const ensureDir=f=>{const s=fs.lstatSync(f);if(!s.isDirectory()||s.isSymbolicLink())fail('SOURCE_DIR_INVALID')};
function ancestors(p){
 let c=path.parse(path.resolve(p)).root;
 for(const segment of path.resolve(p).slice(c.length).split(path.sep).filter(Boolean)){
  c=path.join(c,segment);if(fs.existsSync(c)&&fs.lstatSync(c).isSymbolicLink())fail('SYMLINK_ANCESTOR_DENIED');
 }
}
function paths(cos,source){
 if(!path.isAbsolute(cos)||!path.isAbsolute(source))fail('ABSOLUTE_PATH_REQUIRED');
 const root=path.resolve(cos),original=path.resolve(source);
 const expectedCos=process.platform==='win32'?'official-cos-tag2150-sparse-20261104':'cos2150-unified-rebuild-20261104';
 if(!['win32','linux'].includes(process.platform)||path.basename(root)!==expectedCos||path.basename(original)!=='v1-dev23-capgap-bridge')fail('QA_DESTINATION_NOT_ALLOWED');
 ancestors(root);ancestors(original);ensureDir(root);ensureDir(original);
 const marker=ensureFile(path.join(root,'.commander-v2-isolated-qa')).toString('utf8');
 const srcMarker=ensureFile(path.join(original,'.v1-dev23-capgap-disposable-qa')).toString('utf8');
 if(marker!=='V2_COS_DISPOSABLE_SOURCE_QA_ONLY\n'||srcMarker!=='DISPOSABLE_SOURCE_QA_ONLY\n')fail('QA_MARKER_INVALID');
 if(!COS_PACKAGE_SHA_ACCEPTED.has(sha(ensureFile(path.join(root,'package.json')))))fail('COS_PACKAGE_SHA_CHANGED');
 if(sha(ensureFile(path.join(original,'package.json')))!==PACKAGE_SHA)fail('V1_PACKAGE_SHA_CHANGED');
 const serverSha=sha(ensureFile(path.join(original,'src','server-v0.3.mjs')));
 if(!SERVER_SHAS.has(serverSha)||sha(ensureFile(path.join(original,'src','capability-gap-registry.mjs')))!==REGISTRY_SHA)fail('V1_BRIDGE_NOT_PINNED');
 const target=path.join(root,'resources','commander-v1-core');
 const yaml=path.join(root,'electron-builder.yml');
 const backup=path.join(root,'electron-builder.yml.capgap-qa-prior');
 ensureDir(path.dirname(target));
 return {root,original,target,yaml,backup,serverSha};
}
function fileList(original){
 const src=path.join(original,'src');ensureDir(src);
 const entries=fs.readdirSync(src,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));
 if(entries.length<65||entries.length>120)fail('V1_CORE_FILE_COUNT_INVALID');
 const result=[],srcBytes=[];
 for(const e of entries){
  if(!e.isFile()||(!/^[A-Za-z][A-Za-z0-9_.-]{1,95}\.mjs$/.test(e.name)&&e.name!=='gui-libei-receiver.c'))fail('V1_CORE_FILE_TYPE_DENIED');
  const bytes=ensureFile(path.join(src,e.name));
  if(bytes.length>600000)fail('V1_CORE_FILE_TOO_BIG');
  result.push({file:'src/'+e.name,bytes:bytes.length,sha256:sha(bytes)});
  srcBytes.push({name:e.name,bytes});
 }
 if(result.reduce((n,x)=>n+x.bytes,0)>3500000)fail('V1_CORE_TOTAL_TOO_BIG');
 const pkg=ensureFile(path.join(original,'package.json'));
 result.unshift({file:'package.json',bytes:pkg.length,sha256:sha(pkg)});
 return {files:result,srcBytes,pkg};
}
function verifyBundle(cos,source){
 const {target,yaml,serverSha}=paths(cos,source);
 if(!fs.existsSync(target))fail('BUNDLE_NOT_PRESENT');
 ensureDir(target);
 const b=JSON.parse(ensureFile(path.join(target,'MANIFEST.json')).toString('utf8'));
 if(b.schema!==1||b.mode!=='QA_INTERNAL_NOT_ACTIVATED'||!Array.isArray(b.files)||b.files.length<66||b.files.length>121)fail('BUNDLE_MANIFEST_INVALID');
 const guarded=b.qaTransportAuth==='QA_EPHEMERAL_PROCESS_BEARER_NOT_OWNER_LOGIN';
 if(guarded){
  // The new QA-only server is proven against exact original CoS/V1 bytes and its recoverable predecessor.
  const auth=verifyQaBearer('verify',cos);
  if(auth.serverSha!==b.serverSha||auth.manifestSha!==sha(ensureFile(path.join(target,'MANIFEST.json'))))
   fail('BUNDLE_QA_AUTH_PROVENANCE_INVALID');
 }else if(b.serverSha!==serverSha||b.qaTransportAuth!==undefined)fail('BUNDLE_MANIFEST_INVALID');
 let total=0;
 for(const f of b.files){
  if(typeof f.file!=='string'||!(/^(?:package\.json|src\/[A-Za-z][A-Za-z0-9_.-]{1,95}\.mjs|src\/gui-libei-receiver\.c)$/.test(f.file))||!Number.isSafeInteger(f.bytes)||f.bytes<0||!/^[a-f0-9]{64}$/.test(f.sha256))fail('BUNDLE_ENTRY_INVALID');
  const file=path.join(target,f.file);const data=ensureFile(file);
  if(data.length!==f.bytes||sha(data)!==f.sha256)fail('BUNDLE_CONTENT_CHANGED');
  total+=data.length;
 }
 if(total>3700000)fail('BUNDLE_SIZE_EXCEEDED');
 const normalized=ensureFile(yaml).toString('utf8').replace(/\r\n/g,'\n');
 if(normalized.split(EXTRA).length!==2)fail('BUILDER_RESOURCE_NOT_BUNDLED');
 return {status:'COS_V1_INTERNAL_RESOURCE_VERIFIED',fileCount:b.files.length,serverSha:b.serverSha,sourceBaselineSha:serverSha,qaAuthGated:guarded,manifestSha:sha(ensureFile(path.join(target,'MANIFEST.json'))),activeV1Modified:false,serviceStarted:false,productInstalled:false};
}
export function run(action,cos,source){
 const p=paths(cos,source);
 if(action==='verify')return verifyBundle(cos,source);
 if(action!=='stage')fail('ACTION_INVALID');
 if(fs.existsSync(p.target)||fs.existsSync(p.backup))fail('ALREADY_STAGED');
 const current=ensureFile(p.yaml);if(sha(current)!==B[process.platform])fail('BUILDER_SHA_NOT_ACCEPTED');
 const eol=current.includes(Buffer.from('\r\n'))?'\r\n':'\n';
 const y=current.toString('utf8').replace(/\r\n/g,'\n');
 if(y.split(SENTINEL).length!==2||y.includes(EXTRA))fail('BUILDER_ANCHOR_CHANGED');
 const next=y.replace(SENTINEL,SENTINEL+'\n'+EXTRA).replace(/\n/g,eol);
 const l=fileList(p.original);
 const manifest=Buffer.from(JSON.stringify({schema:1,mode:'QA_INTERNAL_NOT_ACTIVATED',sourceVersion:'0.11.0-dev.23-capgap-qa',
  sourcePackageSha:PACKAGE_SHA,serverSha:p.serverSha,registrySha:REGISTRY_SHA,
  files:l.files},null,2)+'\n');
 const temp=p.target+'.staging-'+process.pid;
 const yamlTemp=p.yaml+'.staging-'+process.pid;
 for(const f of [temp,yamlTemp])if(fs.existsSync(f))fail('TEMP_ALREADY_PRESENT');
 let created=false,backed=false,rewrote=false;
 try{
  fs.mkdirSync(temp,{mode:0o700});fs.mkdirSync(path.join(temp,'src'),{mode:0o700});
  fs.writeFileSync(path.join(temp,'package.json'),l.pkg,{flag:'wx',mode:0o600});
  for(const f of l.srcBytes)fs.writeFileSync(path.join(temp,'src',f.name),f.bytes,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(temp,'MANIFEST.json'),manifest,{flag:'wx',mode:0o600});
  fs.writeFileSync(yamlTemp,next,{flag:'wx',mode:0o600});
  if(sha(ensureFile(p.yaml))!==B[process.platform])fail('CONCURRENT_BUILDER_CHANGE');
  fs.renameSync(temp,p.target);created=true;
  fs.copyFileSync(p.yaml,p.backup,fs.constants.COPYFILE_EXCL);backed=true;
  fs.renameSync(yamlTemp,p.yaml);rewrote=true;
  const proof=verifyBundle(cos,source);
  return {...proof,status:'COS_V1_CORE_STAGED_IN_SINGLE_QA_INSTALLER',stagedOnly:true,builderSha:sha(ensureFile(p.yaml))};
 }catch(error){
  if(rewrote&&backed&&sha(ensureFile(p.yaml))===sha(Buffer.from(next)))fs.copyFileSync(p.backup,p.yaml);
  if(created&&fs.existsSync(p.target))fs.rmSync(p.target,{recursive:true,force:true});
  if(backed&&fs.existsSync(p.backup)&&sha(ensureFile(p.yaml))===B[process.platform])fs.rmSync(p.backup,{force:true});
  throw error;
 }finally{
  for(const f of [temp,yamlTemp])if(fs.existsSync(f))fs.rmSync(f,{recursive:true,force:true});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(run(process.argv[2],process.argv[3],process.argv[4])));}
 catch(e){console.error(String(e.message||e));process.exitCode=2;}
}
