#!/usr/bin/env node
// One-time exact-SHA correction for a disposable Commander V2 QA electron-builder 26 config.
import fs from 'node:fs'; import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=s=>{throw Error('BRAND_DEB_V26_FIX_'+s);};
const beforeHashes={linux:'7cc67ec6993c3858e4d34805e295250409d694cb1aeb73a4e277acd9a57fd7f3',
 win32:'3d6684b9262509eb158a25830709706f6c2dd5d96c2e0970673db587fdf33dfc'};
function read(f){const s=fs.lstatSync(f);if(!s.isFile()||s.isSymbolicLink())fail('NONFILE');return fs.readFileSync(f);}
function run(root){
 if(!path.isAbsolute(root)||!Object.hasOwn(beforeHashes,process.platform))fail('PLATFORM');
 const p=path.resolve(root);
 if(path.basename(p)!==(process.platform==='linux'?'cos2150-unified-rebuild-20261104':'official-cos-tag2150-sparse-20261104'))fail('UNAPPROVED_ROOT');
 if(read(path.join(p,'.commander-v2-isolated-qa')).toString()!=='V2_COS_DISPOSABLE_SOURCE_QA_ONLY\n')fail('NOT_QA');
 const config=path.join(p,'electron-builder.yml'),mf=path.join(p,'.commander-v2-brand-backup','MANIFEST.json');
 const old=read(config),prevManifest=read(mf);
 const oldHash=sha(old),state=JSON.parse(prevManifest);
 if(state.name!=='Commander V2'||state.appId!=='io.github.god13emad.commanderv2'||state.files?.['electron-builder.yml']!==oldHash)fail('MANIFEST_OR_HASH_MISMATCH');
 let y=old.toString().replace(/\r\n/g,'\n');
 const first='  executableName: commander-v2\n  packageName: commander-v2';
 const second='\ndeb:\n';
 if(oldHash!==beforeHashes[process.platform]||y.split(first).length!==2||y.split(second).length!==2)fail('UNEXPECTED_OLD_CONFIGURATION');
 y=y.replace(first,'  executableName: commander-v2').replace(second,'\ndeb:\n  packageName: commander-v2\n');
 const next=Buffer.from(old.includes(Buffer.from('\r\n'))?y.replace(/\n/g,'\r\n'):y);
 state.files['electron-builder.yml']=sha(next);
 state.debPackageNameSchemaRepair='electron-builder-v26-correct-deb-target';
 const updated=Buffer.from(JSON.stringify(state,null,2)+'\n');
 try{
  fs.writeFileSync(config,next);
  if(sha(read(config))!==sha(next))fail('CONFIG_READBACK');
  fs.writeFileSync(mf,updated);
  if(sha(read(mf))!==sha(updated))fail('MANIFEST_READBACK');
 }catch(e){
  if(sha(read(config))===sha(next))fs.writeFileSync(config,old);
  if(sha(read(mf))===sha(updated))fs.writeFileSync(mf,prevManifest);
  throw e;
 }
 return {gate:'COMMANDER_V2_DEB_CONFIGURATION_V26_REPAIRED',platform:process.platform,before:oldHash,after:sha(next),manifest:sha(updated),installed:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(run(process.argv[2])));}
 catch(e){console.error(String(e.message||e));process.exitCode=2;}
}
