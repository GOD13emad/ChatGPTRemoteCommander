#!/usr/bin/env node
// Offline, one-product v0.12 candidate assembler. Creates a *managed payload*
// for the proven universal engine, NOT a native signed/stable OS installer.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createManifest,validateManifest} from './v2-universal-install-engine.mjs';

const fail=code=>{throw Error('V012_ASSEMBLY_'+code)};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const version='0.12.0-rc.1';
const excluded=/(^|\/)(fixtures|test|tests|__tests__)\/|\.test\.(mjs|js|ps1|sh)$|\/\.[^/]+$/;
function git(root,args){
 const p=spawnSync('git',args,{cwd:root,encoding:null,timeout:12000,maxBuffer:2e6});
 if(p.error||p.status!==0||p.signal)fail('SOURCE_GIT_UNAVAILABLE');
 return p.stdout;
}
function regular(file){
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>512*1024*1024)fail('SOURCE_NONREGULAR');
 return st;
}
function noAlias(file){
 let p=path.resolve(file);
 while(true){
  if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())fail('ALIAS_PATH');
  const parent=path.dirname(p);if(parent===p)break;p=parent;
 }
}
function validatedRoot(root){
 if(typeof root!=='string'||!path.isAbsolute(root))fail('ABSOLUTE_SOURCE_REQUIRED');
 root=path.resolve(root);noAlias(root);
 if(!fs.statSync(root).isDirectory())fail('SOURCE_NOT_DIRECTORY');
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 if(pkg.name!=='chatgpt-remote-commander'||pkg.version!=='0.11.0-dev.19')
  fail('SOURCE_COMPONENT_VERSION_DRIFT');
 const verified=git(root,['rev-parse','--show-toplevel']).toString().trim();
 if(path.resolve(verified)!==root)fail('SOURCE_REPO_ROOT_MISMATCH');
 const head=git(root,['rev-parse','HEAD']).toString().trim();
 if(!/^[a-f0-9]{40}$/.test(head))fail('INVALID_SOURCE_COMMIT');
 return {root,head,pkg};
}
function tracked(root){
 const raw=git(root,['ls-files','-z','--','src','tools','desktop/v2-workspace','assets','package.json']);
 const files=raw.toString('utf8').split('\0').filter(Boolean).filter(s=>!excluded.test(s));
 if(files.length<130||files.length>2000)fail('SOURCE_FILE_COUNT_UNEXPECTED');
 const seen=new Set();
 let total=0;
 for(const rel of files){
  if(!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(rel)||rel.split('/').some(x=>x==='..'||x==='.'))
   fail('SOURCE_PATH_INVALID');
  const key=rel.toLowerCase();
  if(seen.has(key))fail('CASE_COLLISION');
  seen.add(key);
  const p=path.join(root,...rel.split('/'));
  noAlias(p);total+=regular(p).size;
  if(total>128*1024*1024)fail('SOURCE_PAYLOAD_TOO_LARGE');
 }
 if(!seen.has('src/server-v0.3.mjs')||!seen.has('desktop/v2-workspace/desktop-app.mjs'))
  fail('REQUIRED_RUNTIMES_MISSING');
 return files.sort((a,b)=>a.localeCompare(b,'en'));
}
export function assembleCandidate({sourceRoot,outputParent,mode='desktop',
 platform=process.platform,arch=process.arch}={}){
 if(!['win32','linux'].includes(platform)||!['x64','arm64'].includes(arch)||
   !['desktop','headless'].includes(mode))fail('TARGET_NOT_SUPPORTED');
 const {root,head,pkg}=validatedRoot(sourceRoot);
 const list=tracked(root);
 if(typeof outputParent!=='string'||!path.isAbsolute(outputParent))fail('ABSOLUTE_OUTPUT_REQUIRED');
 outputParent=path.resolve(outputParent);noAlias(outputParent);
 if(!fs.existsSync(outputParent)||!fs.lstatSync(outputParent).isDirectory())fail('OUTPUT_PARENT_MISSING');
 if(outputParent===root||outputParent.startsWith(root+path.sep)||
   root.startsWith(outputParent+path.sep))fail('SOURCE_OUTPUT_OVERLAP');
 const stage=path.join(outputParent,'v012-'+mode+'-'+crypto.randomUUID());
 let created=false;
 try{
  fs.mkdirSync(stage,{mode:0o700});created=true;
  const files=[];
  for(const rel of list){
   const source=path.join(root,...rel.split('/'));
   const dest=path.join(stage,...rel.split('/'));
   fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});
   fs.copyFileSync(source,dest,fs.constants.COPYFILE_EXCL);
   fs.chmodSync(dest,0o600);
   if(regular(source).size!==regular(dest).size||
      hash(fs.readFileSync(source))!==hash(fs.readFileSync(dest)))fail('COPY_INTEGRITY');
   files.push(rel);
  }
  fs.mkdirSync(path.join(stage,'bin'),{recursive:true,mode:0o700});
  const launcher=path.join(stage,'bin','commander-v2.mjs');
  const entry=path.join(root,'tools','v012-unified-release-entry.mjs');
  noAlias(entry);regular(entry);
  fs.copyFileSync(entry,launcher,fs.constants.COPYFILE_EXCL);
  fs.chmodSync(launcher,0o600);files.push('bin/commander-v2.mjs');
  const info={
   schema:1,product:'Commander V2',version,sourceCommit:head,
   sourceCoreVersion:pkg.version,mode,
   entry:'bin/commander-v2.mjs',
   featureScope:'CANDIDATE_RUNTIME_NOT_STABLE',
   productionChatGrant:false,realProfileMigration:false,
   nativeOsInstallerBuilt:false,stableReleased:false
  };
  fs.writeFileSync(path.join(stage,'PRODUCT.json'),JSON.stringify(info),
   {flag:'wx',mode:0o600});files.push('PRODUCT.json');
  const manifest=createManifest({source:stage,version,platform,arch,
   mode,entry:'bin/commander-v2.mjs',files});
  const meta=validateManifest(manifest);
  fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(manifest),
   {flag:'wx',mode:0o600});
  if(meta.files!==files.length)fail('MANIFEST_COUNT');
  return {product:'Commander V2',version,sourceCommit:head,
   sourceCoreVersion:pkg.version,bundle:stage,manifestSha256:meta.digest,
   entries:meta.files,bytes:meta.bytes,mode,platform,arch,
   nativeOsInstallerBuilt:false,fullPowerProved:false,stable:false};
 }catch(e){if(created)fs.rmSync(stage,{recursive:true,force:true});throw e;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const a=process.argv.slice(2);
  if(a.length!==6||a[0]!=='--source'||a[2]!=='--out'||a[4]!=='--mode')fail('REQUIRED_OPTIONS');
  process.stdout.write(JSON.stringify(assembleCandidate({
   sourceRoot:a[1],outputParent:a[3],mode:a[5]}))+'\n');
 }catch(e){console.error(e.message?.startsWith('V012_ASSEMBLY_')?e.message:'V012_ASSEMBLY_FAILED');process.exitCode=2;}
}
