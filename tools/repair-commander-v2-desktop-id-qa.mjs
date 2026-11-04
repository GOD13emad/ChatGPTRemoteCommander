#!/usr/bin/env node
// One-time exact-hash correction of packaged Electron desktop identity, QA source only.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex'),fail=s=>{throw Error('COMMANDER_V2_DESKTOP_ID_'+s)};
function read(p){const s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink())fail('NONFILE');return fs.readFileSync(p)}
export function repair(root){
 if(!path.isAbsolute(root)||!['win32','linux'].includes(process.platform))fail('INVALID_ROOT');
 const p=path.resolve(root),want=process.platform==='win32'?'official-cos-tag2150-sparse-20261104':'cos2150-unified-rebuild-20261104';
 if(path.basename(p)!==want||read(path.join(p,'.commander-v2-isolated-qa')).toString()!=='V2_COS_DISPOSABLE_SOURCE_QA_ONLY\n')fail('NOT_QA');
 const file=path.join(p,'package.json'),manifest=path.join(p,'.commander-v2-brand-backup','MANIFEST.json');
 const prev=read(file),old=sha(prev),stateBytes=read(manifest),state=JSON.parse(stateBytes);
 if(old!=='2be9e67725428dce802f1d1557c51b5569a969a419589adc110d86f8da311f25'||
 state.appId!=='io.github.god13emad.commanderv2'||state.files?.['package.json']!==old)fail('PIN_CHANGED');
 const obj=JSON.parse(prev);
 if(obj.desktopName!=='com.chatonsteroids.app.desktop'||obj.productName!=='Commander V2'||obj.name!=='chat-on-steroids')fail('VENDOR_BRAND_STATE_CHANGED');
 obj.desktopName='io.github.god13emad.commanderv2.desktop';
 const newer=Buffer.from(JSON.stringify(obj,null,2)+'\n');
 state.files['package.json']=sha(newer);
 state.desktopIdentityRepair='X11-WM_CLASS-and-Linux-Launcher';
 const nextManifest=Buffer.from(JSON.stringify(state,null,2)+'\n');
 try{
  if(sha(read(file))!==old)fail('CONCURRENT_PACKAGE_WRITE');
  fs.writeFileSync(file,newer);if(sha(read(file))!==sha(newer))fail('PACKAGE_READBACK');
  fs.writeFileSync(manifest,nextManifest);if(sha(read(manifest))!==sha(nextManifest))fail('STATE_READBACK');
 }catch(e){
  if(sha(read(file))===sha(newer))fs.writeFileSync(file,prev);
  if(sha(read(manifest))===sha(nextManifest))fs.writeFileSync(manifest,stateBytes);
  throw e;
 }
 return {gate:'COMMANDER_V2_OS_DESKTOP_ID_REPAIRED',platform:process.platform,desktopName:obj.desktopName,packageSha:sha(newer),installed:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(repair(process.argv[2])))}catch(e){console.error(String(e.message||e));process.exitCode=2}}
