#!/usr/bin/env node
// QA-only Commander V2 identity overlay for pinned upstream CoS 2.1.50 and V1 core.
import fs from 'node:fs'; import path from 'node:path'; import {createHash} from 'node:crypto'; import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex'), fail=k=>{throw Error('COMMANDER_V2_BRAND_'+k)};
const name='Commander V2', appId='io.github.god13emad.commanderv2';
const pins={
'electron-builder.yml':['b0364b170eae5536a4e2d34f3ebd632e685e9a4d5fa5c4ecdf8be454abafb8df','017409cdce2f771700ea8c8819682f1a1d793b07acc6e50b868e9d44ac0fdcb8'],
'package.json':'589305b6576f9c09e46b0c10d4296d6ed596e04efc8eba1013e61c9fb254dd5a',
'scripts/windows-installer-acl.nsh':'c61c5fc9c9f1ea85851173f127fb58641b3c86cc0ebe5eb72368efd2110a72a9',
'src/main/index.ts':'000f74de6c9e5588621f99d3340ef752dfb469e6a4da40c0e90d17136f200374',
'src/renderer/index.html':'4da4eb7b0cfa8ee55cc68448051dfc5b421d1286b7c2f4c29d8aefcd58acaf20',
'src/renderer/cos-browser.html':'6d8a96173e5b60dec3c078de0ed1e69c1792fde5a329c09122f5b2ec5dfc2856',
'src/renderer/desktop-ask.html':'6ceca34265cf20225e892925b24c4937fffce0facd1da83e3eb538899c037f55',
'src/renderer/update-progress.html':'1521add1e9b9e7f2e544b16922ebc306bc4355e3c8a3045cb5fd3811ccbfd9a7',
'src/renderer/desktop-ask.ts':'621447a33148daa8603d6ebe6657afbf0ff6906872551a10127466682cddbcd9',
'src/renderer/update-progress.ts':'6c94d9ce86800e39f15de772b09b2d377a9edc68248b414cc09f2278e329c5e8',
'src/main/turn-notifications.ts':'f7665f150f02176be51fc03adbdb2159963e06948fe84380495688a6f34a85f4',
'src/renderer/plugins.ts':'25fe350168d5b5bec24f0de00f6310c27ee8920de892c1eeb3efab013f81dcda',
'build/icon.png':'8b3d845a0ec059959c7ce79b40d862371cf01d97ec73af3ed5afd5160437c521',
'build/icon.ico':'b188591b13767803e51ebd3a52d642ce77dbc172d01836d34bdcef47bcdc8c88',
'build/runtime-icon.png':'d536ba8c32085ccc8fd6546adb64ab24669d57b1c06e1b05295c144f43574fd3'};
const iconHashes={'icon.png':'532dd6e9bfcb6908759b985cbd4ef31265684e786849016fd54197273ce0136e',
'icon.ico':'c77a12d72448ed277196d6dd1e6e639598786e793fbe54e9598febeb8bb10345'};
function file(p){const s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)fail('UNSAFE_FILE');return fs.readFileSync(p)}
function dir(p){const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink())fail('UNSAFE_DIRECTORY')}
function once(s,a,b){if(s.split(a).length!==2)fail('SOURCE_ANCHOR_CHANGED');return s.replace(a,b)}
function preflight(root){
 if(!path.isAbsolute(root)||!['linux','win32'].includes(process.platform))fail('PATH_PLATFORM');
 const p=path.resolve(root),want=process.platform==='linux'?'cos2150-unified-rebuild-20261104':'official-cos-tag2150-sparse-20261104';
 if(path.basename(p)!==want)fail('NOT_ISOLATED_ALLOWLIST');dir(p);
 let cur=path.parse(p).root;for(const s of p.slice(cur.length).split(path.sep).filter(Boolean)){cur=path.join(cur,s);if(fs.existsSync(cur)&&fs.lstatSync(cur).isSymbolicLink())fail('SYMLINK_ANCESTOR')}
 if(file(path.join(p,'.commander-v2-isolated-qa')).toString()!=='V2_COS_DISPOSABLE_SOURCE_QA_ONLY\n')fail('QA_MARKER');
 const c=process.platform==='linux'?'c6c64886301c427bae8b8934304eaf82ee6382fefc01aee8e013e0745c4f1306':'aff379a6ffccbf6e0837d2dcf01415283b0a44205ce4aece6b19cfe914a4c923';
 if(sha(file(path.join(p,'resources','commander-v1-core','MANIFEST.json')))!==c)fail('V1_COMPONENT_NOT_PINNED');
 return p;
}
function patch(rel,raw,root){
 if(rel==='electron-builder.yml'){
  let s=raw.toString().replace(/\r\n/g,'\n');
  for(const [a,b] of [
   ['appId: com.chatonsteroids.app','appId: '+appId],
   ['productName: Chat On Steroids','productName: Commander V2'],
   ['Chat-On-Steroids-Setup-','Commander-V2-Windows-'],
   ['Chat-On-Steroids-Linux-','Commander-V2-Linux-'],
   ['Chat-On-Steroids-macOS-','Commander-V2-macOS-'],
   ['  executableName: chat-on-steroids','  executableName: commander-v2'],
   ['  shortcutName: Chat On Steroids','  shortcutName: Commander V2'],
   ['  uninstallDisplayName: Chat On Steroids','  uninstallDisplayName: Commander V2'],
   ['deb:\n','deb:\n  packageName: commander-v2\n']
  ])s=once(s,a,b);
  return Buffer.from(raw.includes(Buffer.from('\r\n'))?s.replace(/\n/g,'\r\n'):s);
 }
 if(rel==='scripts/windows-installer-acl.nsh'){
  const text=raw.toString('utf8');
  if(text.split('Chat On Steroids').length!==5)fail('NSIS_VENDOR_SOURCE_DRIFT');
  return Buffer.from(text.replaceAll('Chat On Steroids','Commander V2'));
 }
 if(rel==='package.json'){
  const p=JSON.parse(raw);
  if(p.name!=='chat-on-steroids'||p.version!=='2.1.50'||p.productName)fail('UPSTREAM_PACKAGE_CHANGED');
  if(p.desktopName!=='com.chatonsteroids.app.desktop')fail('UPSTREAM_DESKTOP_ID_CHANGED');p.productName=name;p.desktopName=appId+'.desktop';return Buffer.from(JSON.stringify(p,null,2)+'\n');
 }
 if(rel.startsWith('src/')){
  let s=raw.toString();
  if(rel==='src/main/index.ts'){if(s.split('Chat On Steroids').length!==4)fail('WINDOW_TITLE_CHANGED');s=s.replaceAll('Chat On Steroids',name);}
  else if(rel==='src/main/turn-notifications.ts'){if(s.split("session.title || 'Chat On Steroids'").length!==3)fail('NOTIFICATION_FALLBACK_DRIFT');s=s.replaceAll("session.title || 'Chat On Steroids'","session.title || 'Commander V2'");}
  else if(rel==='src/renderer/plugins.ts'){if(s.split("'Chat On Steroids Plugins'").length!==3)fail('PLUGIN_BRAND_FALLBACK_DRIFT');s=s.replaceAll("'Chat On Steroids Plugins'","'Commander V2 Plugins'");}
  else if(rel.endsWith('cos-browser.html'))s=once(s,'<title>Chat On Steroids browser</title>','<title>Commander V2 browser</title>');
  else if(rel.endsWith('.html'))s=once(s,'<title>Chat On Steroids</title>','<title>Commander V2</title>');
  else s=once(s,"|| 'Chat On Steroids'","|| 'Commander V2'");
  if(s===raw.toString())fail('NO_EFFECT_'+rel);return Buffer.from(s);
 }
 const icon=rel.endsWith('.ico')?'icon.ico':'icon.png';
 const value=file(path.join(root,'.commander-v2-brand-assets',icon));
 if(sha(value)!==iconHashes[icon])fail('ICON_SOURCE_UNPINNED');return value;
}
export function command(action,root){
 const p=preflight(root),recovery=path.join(p,'.commander-v2-brand-backup');
 if(action==='verify'){
  dir(recovery);const m=JSON.parse(file(path.join(recovery,'MANIFEST.json')));
  if(m.name!==name||m.appId!==appId||m.status!=='QA_NOT_INSTALLED'||Object.keys(m.files).length!==Object.keys(pins).length)fail('RECOVERY_MANIFEST_INVALID');
  for(const [f,d] of Object.entries(m.files))if(!Object.hasOwn(pins,f)||sha(file(path.join(p,...f.split('/'))))!==d)fail('READBACK_MISMATCH_'+f);
  const y=file(path.join(p,'electron-builder.yml')).toString();
  if(!y.includes('appId: '+appId)||!y.includes('productName: Commander V2')||!y.includes('packageName: commander-v2'))fail('BRANDING_NOT_COMPLETE');
  return {gate:'COMMANDER_V2_BRAND_QA_PASS',name,appId,files:Object.keys(m.files).length,platform:process.platform,installerInstalled:false,profilesMigrated:false};
 }
 if(action!=='stage'||fs.existsSync(recovery))fail('ACTION_OR_DUPLICATE');
 const edits=new Map();
 for(const [f,v] of Object.entries(pins)){
  const before=file(path.join(p,...f.split('/'))),wanted=Array.isArray(v)?v[process.platform==='linux'?0:1]:v;
  if(sha(before)!==wanted)fail('PIN_DRIFT_'+f);
  edits.set(f,{before,after:patch(f,before,p)});
 }
 fs.mkdirSync(recovery,{mode:0o700});const touched=[];
 try{
  const manifest={name,appId,status:'QA_NOT_INSTALLED',files:{}};
  for(const [f,v] of edits){
   const backup=path.join(recovery,...f.split('/'));fs.mkdirSync(path.dirname(backup),{recursive:true,mode:0o700});
   fs.writeFileSync(backup,v.before,{flag:'wx',mode:0o600});manifest.files[f]=sha(v.after);
  }
  fs.writeFileSync(path.join(recovery,'MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  for(const [f,v] of edits){
   const dst=path.join(p,...f.split('/')),tmp=dst+'.brand-qa-'+process.pid;
   if(sha(file(dst))!==sha(v.before)||fs.existsSync(tmp))fail('CONCURRENT_WRITE');
   try{fs.writeFileSync(tmp,v.after,{flag:'wx',mode:0o600});fs.renameSync(tmp,dst);touched.push(f)}
   finally{if(fs.existsSync(tmp))fs.rmSync(tmp,{force:true})}
  }
  return {...command('verify',p),mode:'QA_STAGED_WITH_RECOVERY'};
 }catch(err){
  for(const f of touched.reverse()){
   const v=edits.get(f),dst=path.join(p,...f.split('/'));
   if(sha(file(dst))===sha(v.after))fs.writeFileSync(dst,v.before);
  }
  throw err;
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(command(process.argv[2],process.argv[3])));}
 catch(e){console.error(String(e.message||e));process.exitCode=2;}
}
