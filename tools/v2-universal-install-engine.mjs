#!/usr/bin/env node
// Commander V2 single-managed-install transaction engine (Windows/Linux, desktop/headless).
// This is an offline, user-local package activation engine, NOT an OS package
// registration, legacy-uninstall, owner-grant, or public-release authority.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const markerName='.commander-v2-managed.json';
const pointerName='active.json';
const maxFiles=10000;
const maxBytes=1024*1024*1024;
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const fail=code=>{throw Error('V2_UNIVERSAL_INSTALL_'+code)};
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const releaseId=m=>[m.version,m.platform,m.arch,m.mode].join('_');

export function defaultRoot(platform=process.platform,home=os.homedir()){
  if(platform==='win32'){
    const base=process.env.LOCALAPPDATA||path.join(home,'AppData','Local');
    return path.join(base,'CommanderV2','Managed');
  }
  if(platform==='linux')return path.join(home,'.local','share','CommanderV2','Managed');
  fail('UNSUPPORTED_PLATFORM');
}
function safeFileName(name){
  return typeof name==='string'&&name.length>0&&name.length<=180&&
    /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(name)&&
    !name.split('/').some(s=>!s||s==='.'||s==='..'||s.endsWith('.')||
      s.endsWith(' ')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s))&&
    !name.includes('\\')&&!name.includes('//');
}
function safeVersion(s){
  return typeof s==='string'&&/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9][a-z0-9.-]{0,45})?$/.test(s);
}
export function validateManifest(m){
  if(!m||m.schema!==1||m.product!=='Commander V2'||!safeVersion(m.version)||
     !['win32','linux'].includes(m.platform)||!['x64','arm64'].includes(m.arch)||
     !['desktop','headless'].includes(m.mode)||!safeFileName(m.entry)||
     !Array.isArray(m.files)||m.files.length===0||m.files.length>maxFiles)fail('INVALID_MANIFEST');
  let total=0;const paths=new Set();
  for(const f of m.files){
    if(!f||!safeFileName(f.path)||!Number.isSafeInteger(f.bytes)||f.bytes<0||
       !/^[a-f0-9]{64}$/.test(f.sha256||''))fail('INVALID_FILE_RECORD');
    total+=f.bytes;
    if(total>maxBytes)fail('PAYLOAD_BUDGET_EXCEEDED');
    const key=f.path.toLowerCase();
    if(paths.has(key))fail('CASE_COLLIDING_PATH');
    paths.add(key);
  }
  if(!paths.has(m.entry.toLowerCase()))fail('ENTRY_NOT_IN_MANIFEST');
  if(releaseId(m).length>120)fail('RELEASE_ID_TOO_LONG');
  return Object.freeze({id:releaseId(m),bytes:total,files:m.files.length,digest:hash(JSON.stringify(m))});
}
function existingAncestorsNoAliases(p){
  let current=path.resolve(p);
  while(true){
    if(fs.existsSync(current)){
      const st=fs.lstatSync(current);
      if(st.isSymbolicLink())fail('ALIAS_ANCESTOR');
    }
    const parent=path.dirname(current);if(parent===current)break;
    current=parent;
  }
}
function ensureFile(file){
  existingAncestorsNoAliases(file);
  const s=fs.lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)fail('NONREGULAR_FILE');
  return s;
}
function fileHash(file){
  const fd=fs.openSync(file,'r');const b=Buffer.allocUnsafe(65536);
  const h=crypto.createHash('sha256');
  try{let n;while((n=fs.readSync(fd,b,0,b.length,null))>0)h.update(b.subarray(0,n));}
  finally{fs.closeSync(fd);}
  return h.digest('hex');
}
function checkedFiles(root,m){
  for(const f of m.files){
    const dest=path.join(root,...f.path.split('/'));
    const st=ensureFile(dest);
    if(st.size!==f.bytes||fileHash(dest)!==f.sha256)fail('PAYLOAD_HASH_MISMATCH');
  }
}
export function checkBundle(bundle,{platform=process.platform,arch=process.arch}={}){
  if(typeof bundle!=='string'||!path.isAbsolute(bundle))fail('ABSOLUTE_BUNDLE_REQUIRED');
  existingAncestorsNoAliases(bundle);
  const mFile=path.join(bundle,'manifest.json');
  ensureFile(mFile);
  const manifest=readJson(mFile);
  const info=validateManifest(manifest);
  if(manifest.platform!==platform||manifest.arch!==arch)fail('HOST_PLATFORM_MISMATCH');
  checkedFiles(bundle,manifest);
  return {manifest,info};
}
function safeRoot(root){
  if(typeof root!=='string'||!path.isAbsolute(root))fail('ABSOLUTE_ROOT_REQUIRED');
  const p=path.resolve(root),parent=path.dirname(p);
  if(parent===p||path.dirname(parent)===parent)fail('ROOT_TOO_BROAD');
  existingAncestorsNoAliases(p);
  return p;
}
function assertRoot(root,{create=false}={}){
  root=safeRoot(root);
  const marker=path.join(root,markerName);
  if(!fs.existsSync(root)){
    if(!create)return false;
    fs.mkdirSync(root,{recursive:true,mode:0o700});
    const file={schema:1,product:'Commander V2',kind:'managed-install',createdBy:'v2-universal-install-engine'};
    fs.writeFileSync(marker,JSON.stringify(file),{flag:'wx',mode:0o600});
    fs.mkdirSync(path.join(root,'releases'),{mode:0o700});
    return true;
  }
  if(!fs.lstatSync(root).isDirectory())fail('ROOT_NOT_DIRECTORY');
  if(!fs.existsSync(marker))fail('UNOWNED_INSTALL_ROOT');
  ensureFile(marker);
  const m=readJson(marker);
  if(m.schema!==1||m.product!=='Commander V2'||m.kind!=='managed-install'||
     m.createdBy!=='v2-universal-install-engine')fail('FOREIGN_INSTALL_MARKER');
  if(!fs.existsSync(path.join(root,'releases'))||
    !fs.lstatSync(path.join(root,'releases')).isDirectory())fail('RELEASES_ROOT_MISSING');
  existingAncestorsNoAliases(path.join(root,'releases'));
  const leftovers=fs.readdirSync(path.join(root,'releases')).filter(n=>n.startsWith('.staging-'));
  if(leftovers.length)fail('UNRECONCILED_STAGING');
  return true;
}
function readActive(root){
  const file=path.join(root,pointerName);
  if(!fs.existsSync(file))return null;
  ensureFile(file);const p=readJson(file);
  if(p.schema!==1||!safeVersion(p.release?.split('_')[0])||
     !/^[a-zA-Z0-9._-]{8,120}$/.test(p.release)||!/^([a-f0-9]{64})$/.test(p.digest)||
     !(p.previous===null||typeof p.previous==='string'))fail('ACTIVE_POINTER_INVALID');
  return p;
}
function releaseFolder(root,id){
  if(!/^[a-z0-9A-Z._-]{8,120}$/.test(id)||id.includes('..'))fail('RELEASE_ID_INVALID');
  return path.join(root,'releases',id);
}
function verifyRelease(root,id,expectedDigest){
  const dir=releaseFolder(root,id);
  existingAncestorsNoAliases(dir);
  if(!fs.existsSync(dir)||!fs.lstatSync(dir).isDirectory())fail('RELEASE_MISSING');
  const manifestPath=path.join(dir,'manifest.json');
  ensureFile(manifestPath);
  const m=readJson(manifestPath),info=validateManifest(m);
  if(info.id!==id||info.digest!==expectedDigest)fail('RELEASE_MANIFEST_CHANGED');
  checkedFiles(dir,m);
  return {manifest:m,info};
}
function writeAtomic(file,obj){
  const staged=file+'.tmp-'+crypto.randomUUID();
  const fd=fs.openSync(staged,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(obj));fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  fs.renameSync(staged,file);
}
function locked(root,fn){
  const lock=path.join(root,'.engine.lock');
  const fd=fs.openSync(lock,'wx',0o600);
  try{return fn();}
  finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
function getInstalled(root){
  if(!assertRoot(root))return null;
  const active=readActive(root);
  if(!active)return null;
  const result=verifyRelease(root,active.release,active.digest);
  return {active,...result};
}
export function inspect({root=defaultRoot()}={}){
  root=safeRoot(root);const state=getInstalled(root);
  return state?{status:'INSTALLED',product:'Commander V2',release:state.active.release,
    version:state.manifest.version,mode:state.manifest.mode,platform:state.manifest.platform,
    entry:path.join(root,'releases',state.active.release,...state.manifest.entry.split('/')),
    previous:state.active.previous,verified:true}
    :{status:'NOT_INSTALLED',verified:false};
}
export function plan({bundle,root=defaultRoot(),platform=process.platform,arch=process.arch}={}){
  root=safeRoot(root);
  const source=path.resolve(bundle||'');
  if(root===source||root.startsWith(source+path.sep)||source.startsWith(root+path.sep))fail('ROOT_BUNDLE_OVERLAP');
  const {manifest,info}=checkBundle(source,{platform,arch});
  const state=getInstalled(root);
  if(state&&state.manifest.platform!==manifest.platform)fail('INSTALLED_PLATFORM_CONFLICT');
  return {schema:1,product:'Commander V2',target:info.id,
    action:state?state.active.release===info.id?'VERIFY_OR_NOOP':'UPGRADE':'INSTALL',
    installed:state?.active.release??null,sourceFiles:info.files,sourceBytes:info.bytes,
    sourceManifestSha256:info.digest,externalManifestPinRequired:true,
    oneManagedActiveRelease:true,legacyOSRegistrationsModified:false,
    externalIdentityGrantRequired:true,changesApplied:false};
}
export function apply({bundle,root=defaultRoot(),platform=process.platform,arch=process.arch,
  expectedManifestSha256='',faultAt=null}={}){
  root=safeRoot(root);
  const source=path.resolve(bundle||'');
  const checked=plan({bundle:source,root,platform,arch});
  const {manifest,info}=checkBundle(source,{platform,arch});
  if(!/^[a-f0-9]{64}$/.test(expectedManifestSha256)||
     expectedManifestSha256!==info.digest)fail('EXTERNAL_MANIFEST_PIN_REQUIRED_OR_MISMATCH');
  assertRoot(root,{create:true});
  return locked(root,()=>{
    const current=getInstalled(root);
    if(current&&current.active.release===info.id){
      if(current.active.digest!==info.digest)fail('SAME_VERSION_DIFFERENT_CONTENT');
      return {...inspect({root}),action:'NOOP'};
    }
    const destination=releaseFolder(root,info.id);
    if(fs.existsSync(destination)){
      verifyRelease(root,info.id,info.digest);
    }else{
      const stage=path.join(root,'releases','.staging-'+crypto.randomUUID());
      fs.mkdirSync(stage,{mode:0o700});
      try{
        for(const record of manifest.files){
          const src=path.join(source,...record.path.split('/'));
          const dst=path.join(stage,...record.path.split('/'));
          fs.mkdirSync(path.dirname(dst),{recursive:true,mode:0o700});
          fs.copyFileSync(src,dst,fs.constants.COPYFILE_EXCL);
          fs.chmodSync(dst,0o600);
          if(ensureFile(dst).size!==record.bytes||fileHash(dst)!==record.sha256)
            fail('STAGED_PAYLOAD_MISMATCH');
        }
        fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(manifest),{flag:'wx',mode:0o600});
        if(faultAt==='beforePromotion')fail('INJECTED_BEFORE_PROMOTION');
        fs.renameSync(stage,destination);
      }catch(e){
        if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});
        throw e;
      }
      verifyRelease(root,info.id,info.digest);
    }
    if(faultAt==='beforeActivation')fail('INJECTED_BEFORE_ACTIVATION');
    writeAtomic(path.join(root,pointerName),{
      schema:1,release:info.id,digest:info.digest,
      previous:current?.active.release??null,
      previousDigest:current?.active.digest??null
    });
    return {...inspect({root}),action:checked.action};
  });
}
export function rollback({root=defaultRoot()}={}){
  root=safeRoot(root);
  if(!assertRoot(root))fail('NOT_INSTALLED');
  return locked(root,()=>{
    const active=readActive(root);
    if(!active||!active.previous||!active.previousDigest)fail('NO_PREVIOUS_RELEASE');
    verifyRelease(root,active.release,active.digest);
    verifyRelease(root,active.previous,active.previousDigest);
    writeAtomic(path.join(root,pointerName),{
      schema:1,release:active.previous,digest:active.previousDigest,
      previous:active.release,previousDigest:active.digest
    });
    return {...inspect({root}),action:'ROLLBACK'};
  });
}
export function createManifest({source,version,platform,arch,mode,entry,files}){
  const listed=files.map(rel=>{
    if(!safeFileName(rel))fail('BAD_PAYLOAD_PATH');
    const file=path.join(source,...rel.split('/'));
    const s=ensureFile(file);
    return {path:rel,bytes:s.size,sha256:fileHash(file)};
  });
  const m={schema:1,product:'Commander V2',version,platform,arch,mode,entry,files:listed};
  validateManifest(m);return m;
}
function options(args){
  let verb=args.shift();const result={};
  for(let i=0;i<args.length;i+=2){
    if(!args[i].startsWith('--')||i+1>=args.length)fail('BAD_ARGUMENTS');
    const key=args[i].slice(2);
    if(!['bundle','root','expected-manifest-sha256'].includes(key)||Object.hasOwn(result,key))fail('BAD_OPTION');
    result[key]=args[i+1];
  }
  if(!['plan','apply','inspect','rollback'].includes(verb))fail('INVALID_COMMAND');
  if(['plan','apply'].includes(verb)&&!result.bundle)fail('BUNDLE_REQUIRED');
  if(result['expected-manifest-sha256']){
    result.expectedManifestSha256=result['expected-manifest-sha256'];
    delete result['expected-manifest-sha256'];
  }
  if(verb==='apply'&&!result.expectedManifestSha256)fail('EXTERNAL_MANIFEST_PIN_REQUIRED');
  return {verb,result};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {verb,result}=options(process.argv.slice(2));
    const output=verb==='plan'?plan(result):verb==='apply'?apply(result):
      verb==='inspect'?inspect(result):rollback(result);
    process.stdout.write(JSON.stringify(output)+'\n');
  }catch(e){
    console.error(e.message?.startsWith('V2_UNIVERSAL_INSTALL_')?e.message:'V2_UNIVERSAL_INSTALL_FAILED');
    process.exitCode=2;
  }
}
