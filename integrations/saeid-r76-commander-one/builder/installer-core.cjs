'use strict';
/* One managed user-local Commander installation. No network or native elevation.
 * A Windows SEA embeds source.tar.gz + bundle.json. Linux .run supplies the same
 * assets to this identical installer through its bundled Node runtime.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const {pathToFileURL}=require('node:url');
const moduleApi=require('node:module');
const net=require('node:net');
const sea=require('node:sea');
const SEA=sea.isSea();
const PRODUCT='ChatGPTRemoteCommander';
const HOME=fs.realpathSync(os.homedir());
const BUNDLE_FILE='bundle.json';
const MARKER='product.json';
function fail(code){const e=new Error(code);e.code=code;throw e;}
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function options(){
 const out={action:null,target:null,asset:null,manifest:null,node:null,profile:'default',mode:'standard'};
 const argv=process.argv.slice(2);
 for(let i=0;i<argv.length;i++){
  const a=argv[i];
  if(['--verify-package','--install','--upgrade','--rollback','--uninstall','--restore','--status','--run','--start','--stop','--runtime-status','--runtime-reconcile','--add-profile','--dashboard','--dashboard-probe','--autostart-status','--autostart-enable','--autostart-disable','--headless-status','--headless-enable','--headless-disable','--help'].includes(a)){
   if(out.action)fail('INSTALLER_MULTIPLE_ACTIONS');out.action=a.slice(2);continue;
  }
  const val=argv[++i];if(!val)fail('INSTALLER_ARGUMENT_VALUE_MISSING');
  if(a==='--target')out.target=val;
  else if(a==='--asset')out.asset=val;
  else if(a==='--manifest')out.manifest=val;
  else if(a==='--node')out.node=val;
  else if(a==='--profile')out.profile=val;
  else if(a==='--mode')out.mode=val;
  else fail('INSTALLER_ARGUMENT_INVALID');
 }
 if(!/^[A-Za-z][A-Za-z0-9._-]{0,39}$/.test(out.profile))fail('INSTALLER_PROFILE_INVALID');
 if(!['standard','full'].includes(out.mode))fail('INSTALLER_MODE_INVALID');
 if(!out.action)out.action='install';
 out.target=path.resolve(out.target??(process.platform==='win32'
  ?path.join(process.env.LOCALAPPDATA??path.join(HOME,'AppData','Local'),PRODUCT)
  :path.join(HOME,'.local','share',PRODUCT)));
 if(!out.target.startsWith(HOME+path.sep))fail('INSTALLER_TARGET_OUTSIDE_OWNER_HOME');
 const bits=out.target.slice(path.parse(out.target).root.length).split(path.sep).filter(Boolean);
 let cursor=path.parse(out.target).root;
 for(const bit of bits){cursor=path.join(cursor,bit);
  if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())fail('INSTALLER_TARGET_ALIAS_REJECTED');
 }
 return out;
}
function readPayload(opt){
 let archive,manifest;
 if(SEA){archive=Buffer.from(sea.getAsset('source.tar.gz'));
  manifest=JSON.parse(sea.getAsset('bundle.json','utf8'));}
 else {
  if(!opt.asset||!opt.manifest)fail('INSTALLER_PAYLOAD_NOT_PROVIDED');
  archive=fs.readFileSync(opt.asset);manifest=JSON.parse(fs.readFileSync(opt.manifest,'utf8'));
 }
 if(manifest.nativeUi!==undefined&&manifest.nativeUi!==null){
  const ui=manifest.nativeUi;
  if(ui.managedProfiles!==undefined&&typeof ui.managedProfiles!=='boolean')
   fail('INSTALLER_MANAGED_UI_FLAG_INVALID');
  if(!['winforms-readonly','gtk4-readonly-system-python'].includes(ui.kind)||
    typeof ui.entry!=='string'||!/^app\/desktop\/[A-Za-z0-9._/-]+$/.test(ui.entry)||
    ui.entry.split('/').includes('..')||!/^[a-f0-9]{64}$/.test(ui.sha256))
    fail('INSTALLER_NATIVE_UI_MANIFEST_INVALID');
 }
 if(manifest.schema!==1||manifest.product!==PRODUCT||
    !/^[a-f0-9]{64}$/.test(manifest.installerCoreSha256||'')||
    !Array.isArray(manifest.files)||manifest.files.length<80||
    !/^[0-9a-f]{64}$/.test(manifest.sourceSha256)||sha(archive)!==manifest.sourceSha256)
   fail('INSTALLER_PAYLOAD_CHECKSUM_INVALID');
 const seen=new Set();
 for(const entry of manifest.files){
  if(!entry||typeof entry.path!=='string'||
   !/^app\/[A-Za-z0-9._/-]+$/.test(entry.path)||
   entry.path.includes('//')||entry.path.split('/').includes('..')||
   !/^[0-9a-f]{64}$/.test(entry.sha256)||
   !Number.isSafeInteger(entry.bytes)||entry.bytes<0||seen.has(entry.path))
   fail('INSTALLER_MANIFEST_ENTRY_INVALID');
  seen.add(entry.path);
 }
 if(manifest.nativeUi){
  const file=manifest.files.find(e=>e.path===manifest.nativeUi.entry);
  if(!file||file.sha256!==manifest.nativeUi.sha256)fail('INSTALLER_NATIVE_UI_MISSING_FROM_MANIFEST');
 }
 return {archive,manifest};
}
function verifyExtracted(root,manifest){
 const expected=new Map(manifest.files.map(e=>[e.path,e]));
 const actual=[];
 function visit(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){
  const abs=path.join(dir,d.name);
  if(d.isSymbolicLink()||(!d.isDirectory()&&!d.isFile()))fail('INSTALLER_EXTRACT_ALIAS_REJECTED');
  if(d.isDirectory())visit(abs);
  else actual.push(path.relative(root,abs).split(path.sep).join('/'));
 }}
 visit(path.join(root,'app'));
 if(actual.length!==expected.size)fail('INSTALLER_EXTRACT_FILECOUNT_MISMATCH');
 for(const file of actual){
  const entry=expected.get(file);if(!entry)fail('INSTALLER_UNEXPECTED_EXTRACT_FILE');
  const bytes=fs.readFileSync(path.join(root,...file.split('/')));
  if(bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)fail('INSTALLER_EXTRACT_SHA_MISMATCH');
 }
}
function unpack(archive,root){
 const f=path.join(root,'source.tar.gz');fs.writeFileSync(f,archive,{mode:0o600});
 const proc=cp.spawnSync('tar',['-xzf','source.tar.gz'],{cwd:root,encoding:'utf8',timeout:25000,
  maxBuffer:1024*1024,windowsHide:true});
 fs.unlinkSync(f);
 if(proc.error||proc.status!==0)fail('INSTALLER_ARCHIVE_EXTRACT_FAILED');
}
async function chooseAvailablePort(root){
 const reserved=new Set([47831,47832,47833,47834,47835,47836,47837]);
 const dir=path.join(root,'state','profiles');
 if(fs.existsSync(dir))for(const name of fs.readdirSync(dir)){
  if(!/^[A-Za-z][A-Za-z0-9._-]{0,39}\.json$/.test(name))continue;
  try{const j=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
   if(Number.isInteger(j.port))reserved.add(j.port);}
  catch{fail('INSTALLER_PROFILE_CONFIG_UNREADABLE');}
 }
 for(let i=0;i<16;i++){
  const port=await new Promise((resolve,reject)=>{
   const server=net.createServer();
   server.once('error',reject);
   server.listen(0,'127.0.0.1',()=>{
    const value=server.address().port;server.close(err=>err?reject(err):resolve(value));});
  });
  if(!reserved.has(port))return port;
 }
 fail('INSTALLER_NO_AVAILABLE_PORT');
}
async function applyNewProfileMode(root,finalRoot,profile,mode,config){
 // Invoke the installed dev23 capability engine through the same real
 // on-disk loader used by the SEA runtime. No duplicate grant policy.
 const loader=path.join(root,'module-loader.cjs');
 const capability=await moduleApi.createRequire(loader)(loader)(
   path.join(root,'app','src','capability-profile.mjs'));
 const wantsPower=mode==='full';
 const updated=capability.migrateCapabilityConfig({
   defaultConfig:config,existingConfig:null,profileId:profile,
   requestPower:wantsPower,requestStandard:!wantsPower,
   requestGui:wantsPower,
   workflowDirectory:wantsPower?path.join(finalRoot,'state','workflows-'+profile):null
 });
 const next=updated.config;
 // Same owner-local lease directory for every profile in this installation,
 // outside each WorkflowStore's private memory path.
 if(wantsPower){
  if(next.durableWorkflows?.enabled!==true)fail('INSTALLER_WORKFLOW_PROFILE_MISSING');
  next.durableWorkflows.rootLeaseDirectory=path.join(finalRoot,'state','workflow-root-leases');
 }
 // Full Power enables GUI tool capabilities, but a fresh installer must not
 // silently create a standing physical-desktop takeover grant. A current,
 // owner-authorized GUI lease remains a distinct OS/session acceptance step.
 next.powerMode.guiControl.ownerAuthorizedTakeover=false;
 next.powerMode.guiControl.workflowTakeoverAllowed=false;
 next.capabilityProfile=capability.normalizeCapabilityProfile(
   next.capabilityProfile,next,{id:profile});
 const applied=next.capabilityProfile;
 if(applied.tier!==(wantsPower?'FULL_POWER':'STANDARD')||
    applied.explicitlyAuthorized!==true||
    (wantsPower&&applied.grantedCapabilities.length!==capability.CAPABILITIES.length)||
    (!wantsPower&&applied.grantedCapabilities.some(x=>
      x==='shell.execute'||x.startsWith('gui.')||x.startsWith('browser.'))))
   fail('INSTALLER_MODE_MIGRATION_INCOMPLETE');
 return next;
}
function freshConfig(root,profile,port,mode='standard'){
 const state=path.join(root,'state');
 const profiles=path.join(state,'profiles');
 fs.mkdirSync(profiles,{recursive:true,mode:0o700});
 const file=path.join(profiles,profile+'.json');
 if(fs.existsSync(file))fail('INSTALLER_PROFILE_EXISTS');
 const cfg={
  host:'127.0.0.1',port,allowedRoots:[path.join(root,'app')],
  allowedPrograms:[],runtimeState:path.join(state,'runtime-'+profile+'.json'),
  auditLog:path.join(state,'audit-'+profile+'.jsonl'),
  instance:{profile,isolated:profile!=='default'},
  powerMode:{enabled:mode==='full',fullFilesystem:mode==='full',
   guiControl:{enabled:false},
   browserControl:{enabled:false,requireExplicitOwnedMode:true,
    profileRoot:path.join(state,'browser-'+profile)}},
  asyncOperations:{enabled:false},
  durableWorkflows:{enabled:false},
  durableDelivery:{directory:path.join(state,'delivery-'+profile),scope:'installer-'+profile}
 };
 fs.writeFileSync(file,JSON.stringify(cfg,null,2)+'\n',{flag:'wx',mode:0o600});
 return file;
}
function loadInstalled(root){
 const marker=path.join(root,MARKER);
 if(!fs.existsSync(marker))fail('INSTALLER_MANAGED_INSTALL_NOT_FOUND');
 const product=JSON.parse(fs.readFileSync(marker,'utf8'));
 if(product.product!==PRODUCT||product.schema!==1)fail('INSTALLER_UNRECOGNIZED_MARKER');
 return product;
}
function verifyInstalled(root){
 const installed=loadInstalled(root);
 if(!fs.existsSync(path.join(root,'app','src','server-v0.3.mjs')))
  fail('INSTALLER_SERVER_NOT_PRESENT');
 const profiles=fs.readdirSync(path.join(root,'state','profiles'))
  .filter(x=>/^[A-Za-z][A-Za-z0-9._-]{0,39}\.json$/.test(x)).map(x=>x.slice(0,-5));
 return {ok:true,managedRoot:root,product:installed.product,build:installed.build,mode:installed.mode,
  profiles,oneManagedInstall:true,autorun:false,guiIntegrated:false,
  nativeUiBundled:!!installed.nativeUi,nativeUiKind:installed.nativeUi?.kind??null,
  uiReadOnly:!!installed.nativeUi&&!installed.nativeUi.managedProfiles,
  managedProfileActions:installed.nativeUi?.managedProfiles===true,
  monitoringReadOnly:!!installed.nativeUi};
}
async function install(opt){
 headlessGuard(opt.target,'default');
 const {archive,manifest}=readPayload(opt);
 if(fs.existsSync(opt.target)){
  if(fs.existsSync(path.join(opt.target,MARKER))){
   const found=loadInstalled(opt.target);
   if(found.build===manifest.build){
    // A build label is NOT sufficient identity: concurrent developer
    // previews can share the label while packaging different binaries.
    if(found.sourceSha256!==manifest.sourceSha256||
       found.installerCoreSha256!==manifest.installerCoreSha256||
       JSON.stringify(found.nativeUi??null)!==JSON.stringify(manifest.nativeUi??null))
      fail('INSTALLER_SAME_BUILD_DIFFERENT_PAYLOAD_REQUIRES_UPGRADE');
    if(found.mode!==opt.mode)fail('INSTALLER_MODE_CHANGE_REQUIRES_RECONFIGURE');
    return {...verifyInstalled(opt.target),idempotent:true,installed:false};
   }
   fail('INSTALLER_MIGRATION_REQUIRED_EXISTING_MANAGED_INSTALL');
  }
  fail('INSTALLER_EXISTING_UNMANAGED_INSTALL_REQUIRES_MIGRATION');
 }
 const parent=path.dirname(opt.target);fs.mkdirSync(parent,{recursive:true});
 const temp=opt.target+'.stage-'+process.pid;
 if(fs.existsSync(temp))fail('INSTALLER_STAGE_EXISTS_RECONCILE');
 fs.mkdirSync(temp,{recursive:false,mode:0o700});
 let published=false;
 try{
  unpack(archive,temp);verifyExtracted(temp,manifest);
  const appDir=path.join(temp,'app');
  if(!fs.existsSync(path.join(appDir,'src','server-v0.3.mjs')))
   fail('INSTALLER_SERVER_NOT_PRESENT');
  if(SEA){fs.copyFileSync(process.execPath,path.join(temp,'Commander.exe'));}
  else {
   if(process.platform!=='linux'||!opt.node)fail('INSTALLER_LINUX_RUNTIME_MISSING');
   fs.mkdirSync(path.join(temp,'bin'),{recursive:true});
   const source=fs.realpathSync(opt.node);
   fs.copyFileSync(source,path.join(temp,'bin','node'));
   fs.chmodSync(path.join(temp,'bin','node'),0o700);
   fs.copyFileSync(__filename,path.join(temp,'Commander.cjs'));
  }
  fs.writeFileSync(path.join(temp,'module-loader.cjs'),
   'module.exports = async function(file){return import(require("node:url").pathToFileURL(file).href);};\n',
   {flag:'wx',mode:0o600});
  freshConfig(temp,'default',await chooseAvailablePort(temp),opt.mode);
  const marker={schema:1,product:PRODUCT,build:manifest.build,mode:opt.mode,
   releaseBaseline:manifest.releaseBaseline,
   sourceSha256:manifest.sourceSha256,
   installerCoreSha256:manifest.installerCoreSha256,
   nativeUi:manifest.nativeUi??null,
   installedBy:'Commander One Installer candidate',
   verifiedFileCount:manifest.files.length,
   requiresExplicitMigration:true,os:process.platform,
   headlessLifecycleRevision:process.platform==='linux'?1:null};
  fs.writeFileSync(path.join(temp,MARKER),JSON.stringify(marker,null,2)+'\n',{flag:'wx',mode:0o600});
  // Config path strings are absolute: rewrite the temporary root in text
  // before publishing, leaving all file contents/manifests unchanged.
  const cfg=path.join(temp,'state','profiles','default.json');
  // Rewrite parsed JSON strings, not escaped on-disk JSON bytes (Windows
  // paths use \\ escaping). All generated roots must point at the final tree.
  const rewrite=(value)=>{
   if(typeof value==='string')
    return value===temp?opt.target:
     value.startsWith(temp+path.sep)?opt.target+value.slice(temp.length):value;
   if(Array.isArray(value))return value.map(rewrite);
   if(value&&typeof value==='object')
    return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,rewrite(v)]));
   return value;
  };
  let finalCfg=rewrite(JSON.parse(fs.readFileSync(cfg,'utf8')));
  if(finalCfg.allowedRoots?.some(x=>x.includes('.stage-'))||
     !finalCfg.allowedRoots?.includes(path.join(opt.target,'app')))
    fail('INSTALLER_CONFIG_PATH_REWRITE_FAILED');
  // Apply the canonical profile policy after temporary path rewrite so
  // every persisted directory references the final owner-managed install.
  finalCfg=await applyNewProfileMode(temp,opt.target,'default',opt.mode,finalCfg);
  fs.writeFileSync(cfg,JSON.stringify(finalCfg,null,2)+'\n',{mode:0o600});
  if(fs.existsSync(opt.target))fail('INSTALLER_TARGET_RACE');
  fs.renameSync(temp,opt.target);published=true;
  return {...verifyInstalled(opt.target),installed:true,idempotent:false};
 }finally{if(!published&&fs.existsSync(temp))fs.rmSync(temp,{recursive:true,force:true});}
}
function verifiedManagedTree(root){
 const marker=loadInstalled(root);
 if(!fs.statSync(root).isDirectory()||fs.lstatSync(root).isSymbolicLink())
  fail('INSTALLER_ROOT_ALIAS_UNSAFE');
 const allowed=new Set(['app','state','product.json','module-loader.cjs',
  'Commander.exe','Commander.cjs','bin']);
 for(const name of fs.readdirSync(root)){
  if(!allowed.has(name))fail('INSTALLER_UNMANAGED_ROOT_CONTENTS');
  if(fs.lstatSync(path.join(root,name)).isSymbolicLink())
   fail('INSTALLER_ROOT_CHILD_ALIAS_UNSAFE');
 }
 const profiles=path.join(root,'state','profiles');
 if(!fs.existsSync(profiles)||fs.lstatSync(profiles).isSymbolicLink())
  fail('INSTALLER_PROFILE_STORE_UNSAFE');
 const names=fs.readdirSync(profiles).filter(n=>n.endsWith('.json'));
 if(!names.length)fail('INSTALLER_NO_CONFIGURED_PROFILES');
 for(const name of names){
  if(!/^[A-Za-z][A-Za-z0-9._-]{0,39}\.json$/.test(name))
   fail('INSTALLER_PROFILE_NAME_UNSAFE');
  const file=path.join(profiles,name);
  if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())
   fail('INSTALLER_PROFILE_ALIAS_UNSAFE');
 }
 return {marker,names};
}
function inspectTreeAliases(root){
 const todo=[root];
 while(todo.length){
  const dir=todo.pop();
  for(const child of fs.readdirSync(dir)){
   const f=path.join(dir,child),stat=fs.lstatSync(f);
   if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))
    fail('INSTALLER_MIGRATION_ALIAS_OR_SPECIAL_FILE');
   if(stat.isDirectory())todo.push(f);
  }
 }
}

/* Explicit, owner-local autostart for this managed preview only.
 * Windows: hashed HKCU Run value -> hidden WScript launcher.
 * Linux: hashed XDG autostart entry. Never enables implicitly on install.
 */
function autostartSpec(root,profile,enableRequest=false){
 loadInstalled(root);
 profileIdentity(root,profile);
 if(/[\r\n]/.test(root)||root.includes(String.fromCharCode(96)))
  fail('INSTALLER_AUTOSTART_PATH_UNSAFE');
 const id=sha(Buffer.from((process.platform==='win32'?root.toLowerCase():root)+'\n'+profile)).slice(0,20);
 if(process.platform==='win32'){
  // A percent/quote path cannot enable a WScript launcher, but it must
  // still be possible to inspect or disable a matching owner-local entry
  // so safe upgrade/rollback never suppresses an unknown Autostart state.
  if(enableRequest&&/[%"]/.test(root))fail('INSTALLER_AUTOSTART_WINDOWS_PATH_UNSUPPORTED');
  const script=path.join(root,'state','autostart',profile+'.vbs');
  const runner=path.join(root,'Commander.exe');
  if(!fs.existsSync(runner))fail('INSTALLER_AUTOSTART_COMMANDER_MISSING');
  const command='"'+runner+'" --start --target "'+root+'" --profile '+profile;
  const content='Set s = CreateObject("WScript.Shell")\r\ns.Run "'+
    command.replaceAll('"','""')+'", 0, False\r\n';
  const launch='"'+path.join(process.env.SystemRoot||'C:\\Windows','System32','wscript.exe')+
    '" //B //Nologo "'+script+'"';
  return {os:'windows',name:'CommanderOne-'+id,file:script,content,launch,
   registry:'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'};
 }
 if(process.platform==='linux'){
  const dir=path.join(HOME,'.config','autostart');
  const escapeExec=s=>'"'+s.replace(/([\\$"])/g,'\\$1').replace(/%/g,'%%')+'"';
  const file=path.join(dir,'commander-one-'+id+'.desktop');
  const content='[Desktop Entry]\nType=Application\nName=Commander One '+profile+
    '\nExec='+escapeExec(path.join(root,'bin','node'))+' '+
    escapeExec(path.join(root,'Commander.cjs'))+' --start --target '+
    escapeExec(root)+' --profile '+profile+
    '\nTerminal=false\nHidden=false\nX-GNOME-Autostart-enabled=true\n';
  if(!fs.existsSync(path.join(root,'bin','node'))||
     !fs.existsSync(path.join(root,'Commander.cjs')))
    fail('INSTALLER_AUTOSTART_COMMANDER_MISSING');
  return {os:'linux',file,content};
 }
 fail('INSTALLER_AUTOSTART_OS_UNSUPPORTED');
}
function autostartFileState(spec){
 const parent=path.dirname(spec.file);
 if(fs.existsSync(parent)&&fs.lstatSync(parent).isSymbolicLink())
  fail('INSTALLER_AUTOSTART_DIRECTORY_ALIAS_UNSAFE');
 if(!fs.existsSync(spec.file))return false;
 if(fs.lstatSync(spec.file).isSymbolicLink()||!fs.lstatSync(spec.file).isFile()||
    fs.readFileSync(spec.file,'utf8')!==spec.content)
  fail('INSTALLER_AUTOSTART_FILE_OWNERSHIP_MISMATCH');
 return true;
}
function autostartRegistry(spec){
 const result=cp.spawnSync('reg.exe',['query',spec.registry,'/v',spec.name],
  {encoding:'utf8',windowsHide:true,timeout:4000,maxBuffer:65536});
 if(result.error)fail('INSTALLER_AUTOSTART_REGISTRY_UNAVAILABLE');
 if(result.status===1)return null;
 if(result.status!==0)fail('INSTALLER_AUTOSTART_REGISTRY_QUERY_FAILED');
 const row=result.stdout.split(/\r?\n/).find(line=>line.includes(spec.name)&&/\sREG_(?:SZ|EXPAND_SZ)\s/.test(line));
 const match=row&&/\s+REG_(?:SZ|EXPAND_SZ)\s+/.exec(row);
 if(!match)fail('INSTALLER_AUTOSTART_REGISTRY_PARSE_FAILED');
 return row.slice(match.index+match[0].length).trim();
}
function autostartState(root,profile){
 const spec=autostartSpec(root,profile);
 const exists=autostartFileState(spec);
 if(spec.os==='linux')
  return {ok:true,profile,autostartEnabled:exists,reconcileRequired:false,scope:'owner-local'};
 const entry=autostartRegistry(spec);
 if(entry!==null&&entry!==spec.launch)
  fail('INSTALLER_AUTOSTART_REGISTRY_OWNERSHIP_MISMATCH');
 if(entry!==null&&!exists)fail('INSTALLER_AUTOSTART_SCRIPT_MISSING');
 return {ok:true,profile,autostartEnabled:entry!==null,
  reconcileRequired:entry===null&&exists,scope:'owner-local'};
}
function autostartCommand(root,profile,action){
 const spec=autostartSpec(root,profile,action==='autostart-enable');
 const state=autostartState(root,profile);
 if(action==='autostart-status')return state;
 if(action==='autostart-enable'){
  headlessGuard(root,profile);
  if(state.autostartEnabled)return {...state,idempotent:true};
  if(state.reconcileRequired)fail('INSTALLER_AUTOSTART_ORPHAN_RECONCILE_FIRST');
  const dir=path.dirname(spec.file);
  if(fs.existsSync(dir)&&fs.lstatSync(dir).isSymbolicLink())
   fail('INSTALLER_AUTOSTART_DIRECTORY_ALIAS_UNSAFE');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  fs.writeFileSync(spec.file,spec.content,{flag:'wx',mode:0o600});
  if(spec.os==='windows'){
   const result=cp.spawnSync('reg.exe',['add',spec.registry,'/v',spec.name,
    '/t','REG_SZ','/d',spec.launch,'/f'],
    {encoding:'utf8',windowsHide:true,timeout:4000,maxBuffer:65536});
   if(result.status!==0||result.error){
    if(autostartFileState(spec))fs.unlinkSync(spec.file);
    fail('INSTALLER_AUTOSTART_REGISTRY_CREATE_FAILED');
   }
  }
  const verified=autostartState(root,profile);
  if(!verified.autostartEnabled)fail('INSTALLER_AUTOSTART_ENABLE_UNVERIFIED');
  return {...verified,changed:true,bootLaunchNotTested:true};
 }
 if(action==='autostart-disable'){
  if(spec.os==='windows'&&state.autostartEnabled){
   const result=cp.spawnSync('reg.exe',['delete',spec.registry,'/v',spec.name,'/f'],
    {encoding:'utf8',windowsHide:true,timeout:4000,maxBuffer:65536});
   if(result.status!==0||result.error||autostartRegistry(spec)!==null)
    fail('INSTALLER_AUTOSTART_REGISTRY_REMOVE_UNVERIFIED');
  }
  if(autostartFileState(spec))fs.unlinkSync(spec.file);
  const verified=autostartState(root,profile);
  if(verified.autostartEnabled||verified.reconcileRequired)
   fail('INSTALLER_AUTOSTART_DISABLE_UNVERIFIED');
  return {...verified,changed:state.autostartEnabled||state.reconcileRequired};
 }
 fail('INSTALLER_AUTOSTART_ACTION_INVALID');
}


// V1-08 headless systemd user-service lifecycle, owner-local only.
// No native elevation, implicit service registration, or anonymous elevated ingress.
function headlessName(root,profile){
 return 'commander-v1-'+sha(Buffer.from(root+'\n'+profile)).slice(0,20)+'.service';
}
function headlessQuote(value){
 if(/[\x00-\x1f\x7f]/.test(value))fail('INSTALLER_HEADLESS_UNIT_PATH_CONTROL_CHAR');
 return '"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')
  .replaceAll('%','%%').replaceAll('$','$$')+'"';
}
function headlessLocations(root,profile){
 if(process.platform!=='linux')fail('INSTALLER_HEADLESS_LINUX_ONLY');
 const dir=path.join(HOME,'.config','systemd','user');
 let at=HOME;
 for(const bit of ['.config','systemd','user']){
  at=path.join(at,bit);
  if(fs.existsSync(at)){
   const st=fs.lstatSync(at);
   if(st.isSymbolicLink()||!st.isDirectory())fail('INSTALLER_HEADLESS_UNIT_DIR_UNSAFE');
  }
 }
 const name=headlessName(root,profile),unit=path.join(dir,name);
 const sentinel=path.join(root,'state','controls',profile+'.json');
 return {dir,name,unit,sentinel};
}
function headlessUnitText(root,profile){
 const node=path.join(root,'bin','node'),app=path.join(root,'Commander.cjs');
 for(const file of [node,app]){
  if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink()||
      !fs.statSync(file).isFile())fail('INSTALLER_HEADLESS_RUNTIME_MISSING');
 }
 return '[Unit]\nDescription=Commander V1 owner headless '+profile+'\n'+
  'StartLimitIntervalSec=60\nStartLimitBurst=3\n\n'+
  '[Service]\nType=simple\n'+
  'ExecStart='+headlessQuote(node)+' '+headlessQuote(app)+
    ' --run --target '+headlessQuote(root)+' --profile '+profile+'\n'+
  'Restart=on-failure\nRestartSec=5s\nNoNewPrivileges=yes\n'+
  'UMask=0077\nStandardOutput=journal\nStandardError=journal\n\n'+
  '[Install]\nWantedBy=default.target\n';
}
function headlessSystemctl(args,allowNonzero=false){
 const r=cp.spawnSync('systemctl',['--user',...args],{
  encoding:'utf8',windowsHide:true,timeout:6500,maxBuffer:32768});
 if(r.error||(!allowNonzero&&r.status!==0))
  fail('INSTALLER_HEADLESS_SYSTEMCTL_FAILED_'+args[0].toUpperCase().replace(/[^A-Z]/g,'_'));
 return r;
}
function headlessManager(name){
 const args=['show',name,'-p','LoadState','-p','ActiveState','-p','UnitFileState','-p','MainPID'];
 const r=headlessSystemctl(args,true);
 const m=Object.fromEntries((r.stdout||'').split(/\r?\n/)
  .filter(x=>x.includes('=')).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
 if(!['loaded','not-found','masked','error'].includes(m.LoadState||'') ||
   !['active','inactive','failed','activating','deactivating','reloading'].includes(m.ActiveState||''))
  fail('INSTALLER_HEADLESS_SYSTEMD_STATE_UNAVAILABLE');
 return m;
}
function headlessFileState(file,expected){
 let st;
 try{st=fs.lstatSync(file);}catch(e){if(e?.code==='ENOENT')return false;throw e;}
 if(!st.isFile()||st.isSymbolicLink()||!expected||fs.readFileSync(file,'utf8')!==expected)
  fail('INSTALLER_HEADLESS_OWNERSHIP_MISMATCH');
 return true;
}
function headlessSentinelText(root,profile,name){
 return JSON.stringify({kind:'CommanderV1HeadlessServiceLease',schema:1,
  root,profile,unit:name})+'\n';
}
function headlessStatus(root,profile){
 const marker=loadInstalled(root);
 if(marker.headlessLifecycleRevision!==1)fail('INSTALLER_HEADLESS_INTEGRATION_NOT_SUPPORTED');
 profileIdentity(root,profile);
 const spec=headlessLocations(root,profile);
 const content=headlessUnitText(root,profile);
 const exists=headlessFileState(spec.unit,content);
 const lease=headlessFileState(spec.sentinel,
  headlessSentinelText(root,profile,spec.name));
 const m=headlessManager(spec.name);
 const active=m.ActiveState==='active',enabled=m.UnitFileState==='enabled';
 if(exists!==lease || (!exists && (active||enabled||m.LoadState==='loaded')) ||
   (exists && m.LoadState==='masked'))fail('INSTALLER_HEADLESS_RECONCILE_REQUIRED');
 return {ok:true,profile,unit:spec.name,unitWritten:exists,
   serviceActive:active,serviceEnabled:enabled,source:'systemd-user',
   lingerRequired:true,bootLoginTested:false,unitFileSha256:sha(Buffer.from(content))};
}
function headlessGuard(root,profile){
 if(process.platform!=='linux')return;
 const spec=headlessLocations(root,profile);
 // Reconcile a unit file even before a managed marker exists (fresh install).
 // A dangling alias or unknown file fails closed.
 let found=false;
 try{fs.lstatSync(spec.unit);found=true;}
 catch(e){if(e?.code!=='ENOENT')throw e;}
 if(found)fail('INSTALLER_HEADLESS_UNIT_RECONCILE_FIRST');
 let lease=false;
 try{fs.lstatSync(spec.sentinel);lease=true;}
 catch(e){if(e?.code!=='ENOENT')throw e;}
 if(lease && fs.readFileSync(spec.sentinel,'utf8')===
     headlessSentinelText(root,profile,spec.name))
  fail('INSTALLER_HEADLESS_LEASE_RECONCILE_FIRST');
 // An enabled/loaded orphaned unit can survive a deleted file.
 const marker=path.join(root,MARKER);
 if(fs.existsSync(marker)){
  const data=JSON.parse(fs.readFileSync(marker,'utf8'));
  if(data.headlessLifecycleRevision===1){
   const m=headlessManager(spec.name);
   if(m.LoadState!=='not-found'||m.ActiveState!=='inactive'||
      (m.UnitFileState&&m.UnitFileState!=='disabled'&&m.UnitFileState!==''))
    fail('INSTALLER_HEADLESS_SYSTEMD_RECONCILE_FIRST');
  }
 }
}
function headlessLegacyAutostartGuard(root,profile){
 const id=sha(Buffer.from(root+'\n'+profile)).slice(0,20);
 const p=path.join(HOME,'.config','autostart','commander-one-'+id+'.desktop');
 try{fs.lstatSync(p);fail('INSTALLER_HEADLESS_LEGACY_AUTOSTART_CONFLICT');}
 catch(e){if(e?.code!=='ENOENT')throw e;}
}
function headlessLinger(){
 const x=cp.spawnSync('loginctl',['show-user',String(process.getuid()),'-p','Linger','--value'],
  {encoding:'utf8',timeout:4000,maxBuffer:1024});
 if(x.error||x.status!==0)fail('INSTALLER_HEADLESS_LINGER_STATE_UNKNOWN');
 return x.stdout.trim()==='yes';
}
async function headlessCommand(opt){
 if(process.platform!=='linux')fail('INSTALLER_HEADLESS_LINUX_ONLY');
 if(process.getuid()===0)fail('INSTALLER_HEADLESS_ROOT_FORBIDDEN');
 const status=headlessStatus(opt.target,opt.profile);
 if(opt.action==='headless-status')
  return {...status,lingerEnabled:headlessLinger(),changed:false};
 const spec=headlessLocations(opt.target,opt.profile);
 if(opt.action==='headless-enable'){
  const product=loadInstalled(opt.target);
  const {cfg}=profileIdentity(opt.target,opt.profile);
  if(product.mode!=='standard'||cfg.capabilityProfile?.tier!=='STANDARD')
   fail('INSTALLER_HEADLESS_FULL_POWER_TRUST_BOUNDARY_NOT_ACCEPTED');
  if(!headlessLinger())fail('INSTALLER_HEADLESS_LINGER_REQUIRED');
  headlessLegacyAutostartGuard(opt.target,opt.profile);
  if(status.unitWritten){
   if(status.serviceActive&&status.serviceEnabled){
    const health=await httpHealth(cfg.port);
    if(!health?.ok||health.instance?.profile!==opt.profile||
       health.configSha256!==sha(fs.readFileSync(path.join(opt.target,
        'state','profiles',opt.profile+'.json'))))
     fail('INSTALLER_HEADLESS_ACTIVE_HEALTH_UNVERIFIED');
    return {...status,changed:false,idempotent:true,lingerEnabled:true};
   }
   fail('INSTALLER_HEADLESS_PREEXISTING_UNIT_RECONCILE_FIRST');
  }
  // Reject a live independently started Backend and preserve other profiles.
  const available=await new Promise(resolve=>{
   const s=net.createServer();s.once('error',()=>resolve(false));
   s.listen(cfg.port,'127.0.0.1',()=>s.close(()=>resolve(true)));
  });
  if(!available)fail('INSTALLER_HEADLESS_PORT_OCCUPIED');
  fs.mkdirSync(path.dirname(spec.sentinel),{recursive:true,mode:0o700});
  fs.mkdirSync(spec.dir,{recursive:true,mode:0o700});
  const content=headlessUnitText(opt.target,opt.profile),
   lease=headlessSentinelText(opt.target,opt.profile,spec.name);
  let madeLease=false,madeUnit=false;
  try{
   fs.writeFileSync(spec.sentinel,lease,{flag:'wx',mode:0o600});madeLease=true;
   fs.writeFileSync(spec.unit,content,{flag:'wx',mode:0o600});madeUnit=true;
   headlessSystemctl(['daemon-reload']);
   headlessSystemctl(['enable','--now',spec.name]);
   for(let i=0;i<65;i++){
    await delay(140);
    const m=headlessManager(spec.name);
    if(m.LoadState==='loaded'&&m.ActiveState==='active'&&m.UnitFileState==='enabled'){
     const health=await httpHealth(cfg.port);
     if(health?.ok&&health.instance?.profile===opt.profile&&
        health.configSha256===sha(fs.readFileSync(path.join(opt.target,'state','profiles',opt.profile+'.json'))))
      return {...headlessStatus(opt.target,opt.profile),changed:true,verifiedHealth:true,
        lingerEnabled:true};
    }
   }
   fail('INSTALLER_HEADLESS_SERVICE_HEALTH_UNVERIFIED');
  }catch(error){
   // A failed systemctl attempt may have caused an effect: inspect/stop only our
   // uniquely named service, never a broad process/PID. Preserve uncertain files.
   if(madeUnit){
    try{
     headlessSystemctl(['disable','--now',spec.name],true);
     const m=headlessManager(spec.name);
     if(m.ActiveState==='inactive'&&m.UnitFileState!=='enabled'&&
        headlessFileState(spec.unit,content)){
      fs.unlinkSync(spec.unit);
      if(madeLease&&headlessFileState(spec.sentinel,lease))fs.unlinkSync(spec.sentinel);
      headlessSystemctl(['daemon-reload']);
     }
    }catch{}
   }else if(madeLease){
    if(headlessFileState(spec.sentinel,lease))fs.unlinkSync(spec.sentinel);
   }
   throw error;
  }
 }
 if(opt.action==='headless-disable'){
  if(!status.unitWritten){
   if(status.serviceActive||status.serviceEnabled)
    fail('INSTALLER_HEADLESS_ORPHAN_RECONCILE_FIRST');
   return {...status,changed:false,idempotent:true};
  }
  headlessSystemctl(['disable','--now',spec.name]);
  let ready=false;
  for(let i=0;i<35;i++){
   const m=headlessManager(spec.name);
   if(m.ActiveState==='inactive'&&m.UnitFileState!=='enabled'){ready=true;break;}
   await delay(120);
  }
  if(!ready)fail('INSTALLER_HEADLESS_DISABLE_RECONCILE_REQUIRED');
  const content=headlessUnitText(opt.target,opt.profile);
  const lease=headlessSentinelText(opt.target,opt.profile,spec.name);
  if(!headlessFileState(spec.unit,content)||
     !headlessFileState(spec.sentinel,lease))fail('INSTALLER_HEADLESS_UNEXPECTED_REMOVAL');
  fs.unlinkSync(spec.unit);fs.unlinkSync(spec.sentinel);
  headlessSystemctl(['daemon-reload']);
  return {...headlessStatus(opt.target,opt.profile),changed:true};
 }
 fail('INSTALLER_HEADLESS_ACTION_INVALID');
}

async function requireQuietOwnerInstall(root){
 const {marker,names}=verifiedManagedTree(root);
 for(const name of names)headlessGuard(root,name.slice(0,-5));
 for(const name of names){
  const state=autostartState(root,name.slice(0,-5));
  if(state.autostartEnabled||state.reconcileRequired)
   fail('INSTALLER_AUTOSTART_DISABLE_BEFORE_MIGRATION');
 }
 const controls=path.join(root,'state','controls');
 if(fs.existsSync(controls)&&fs.readdirSync(controls).length)
  fail('INSTALLER_ACTIVE_OR_STALE_CONTROL_RECONCILE_FIRST');
 for(const name of names){
  const cfg=JSON.parse(fs.readFileSync(path.join(root,'state','profiles',name),'utf8'));
  if(cfg.instance?.profile!==name.slice(0,-5)||cfg.host!=='127.0.0.1'||
    !Number.isInteger(cfg.port)||cfg.port<1024||cfg.port>65535)
   fail('INSTALLER_EXISTING_PROFILE_INVALID');
  const available=await new Promise(resolve=>{
   const socket=net.createServer();
   socket.once('error',()=>resolve(false));
   socket.listen(cfg.port,'127.0.0.1',()=>socket.close(()=>resolve(true)));
  });
  // Refuse ANY occupied port, regardless of what service owns it.
  if(!available)fail('INSTALLER_BACKEND_PORT_IN_USE_RECONCILE_FIRST');
 }
 return {marker,names};
}
function artifactSlotId(marker){
 // Source bytes can remain unchanged across UI/core-only releases. An
 // existing rollback slot must never be overwritten or mistaken for another
 // build that happens to share sourceSha256.
 if(!/^[a-f0-9]{64}$/.test(marker?.sourceSha256||''))
  fail('INSTALLER_VERSION_SOURCE_IDENTITY_INVALID');
 if(marker.installerCoreSha256!=null&&
    !/^[a-f0-9]{64}$/.test(marker.installerCoreSha256))
  fail('INSTALLER_VERSION_CORE_IDENTITY_INVALID');
 const native=marker.nativeUi??null;
 if(native!==null&&
   (!/^[a-f0-9]{64}$/.test(native.sha256||'')||
    !['winforms-readonly','gtk4-readonly-system-python'].includes(native.kind)))
  fail('INSTALLER_VERSION_UI_IDENTITY_INVALID');
 return sha(JSON.stringify([marker.sourceSha256,
   marker.installerCoreSha256??null,native])).slice(0,16);
}
async function managedUpgrade(opt){
 const old=await requireQuietOwnerInstall(opt.target);
 const {archive,manifest}=readPayload(opt);
 if(old.marker.mode!==opt.mode)fail('INSTALLER_UPGRADE_MODE_CHANGE_REQUIRES_RECONFIGURE');
 if(old.marker.sourceSha256===manifest.sourceSha256&&
   old.marker.installerCoreSha256===manifest.installerCoreSha256&&
   JSON.stringify(old.marker.nativeUi??null)===JSON.stringify(manifest.nativeUi??null))
  return {...verifyInstalled(opt.target),upgrade:false,idempotent:true};
 if(typeof old.marker.sourceSha256!=='string'||
    !/^[a-f0-9]{64}$/.test(old.marker.sourceSha256))
  fail('INSTALLER_OLD_VERSION_IDENTITY_INVALID');
 const backup=opt.target+'.rollback-'+artifactSlotId(old.marker);
 const stage=opt.target+'.upgrade-stage-'+process.pid;
 if(fs.existsSync(backup)||fs.existsSync(stage))
  fail('INSTALLER_EXISTING_UPGRADE_BACKUP_OR_STAGE_RECONCILE');
 inspectTreeAliases(path.join(opt.target,'state'));
 let staged=false,renamed=false,published=false;
 try{
  await install({...opt,target:stage});
  staged=true;
  const newState=path.join(stage,'state'),oldState=path.join(opt.target,'state');
  fs.rmSync(newState,{recursive:true,force:true});
  fs.cpSync(oldState,newState,{recursive:true,force:false,errorOnExist:true,
   preserveTimestamps:true});
  const newMarker=path.join(stage,MARKER);
  const info=JSON.parse(fs.readFileSync(newMarker,'utf8'));
  info.upgradedFromSource=old.marker.sourceSha256;
  info.upgradedFromArtifactId=artifactSlotId(old.marker);
  info.rollbackPath=backup;
  info.retainedProfiles=old.names.length;
  fs.writeFileSync(newMarker,JSON.stringify(info,null,2)+'\n',{mode:0o600});
  const newNames=fs.readdirSync(path.join(stage,'state','profiles')).filter(x=>x.endsWith('.json'));
  if(newNames.length!==old.names.length||
      newNames.some(x=>!old.names.includes(x)))
   fail('INSTALLER_UPGRADE_PROFILES_CHANGED');
  // Recheck no new running owned backend after staging but before cutover.
  await requireQuietOwnerInstall(opt.target);
  fs.renameSync(opt.target,backup);renamed=true;
  try{
   fs.renameSync(stage,opt.target);published=true;
  }catch(error){
   try{fs.renameSync(backup,opt.target);renamed=false;}
   catch{fail('INSTALLER_UPGRADE_ROLLBACK_MANUAL_RECOVERY_REQUIRED');}
   throw error;
  }
  return {...verifyInstalled(opt.target),upgraded:true,
   retainedProfiles:old.names.length,rollbackAvailable:true};
 }finally{
  if(!published&&staged&&fs.existsSync(stage)){
   // Only an owned staged fresh install is removable.
   const m=path.join(stage,MARKER);
   if(fs.existsSync(m)&&JSON.parse(fs.readFileSync(m,'utf8')).product===PRODUCT)
    fs.rmSync(stage,{recursive:true,force:true});
  }
 }
}
async function managedRollback(opt){
 const current=await requireQuietOwnerInstall(opt.target);
 const rollback=current.marker.rollbackPath;
 if(typeof rollback!=='string'||!rollback.startsWith(opt.target+'.rollback-')||
    path.dirname(rollback)!==path.dirname(opt.target)||
    !fs.existsSync(rollback))fail('INSTALLER_NO_KNOWN_ROLLBACK');
 const old=await requireQuietOwnerInstall(rollback);
 if(old.marker.sourceSha256!==current.marker.upgradedFromSource ||
    (current.marker.upgradedFromArtifactId!=null&&
     current.marker.upgradedFromArtifactId!==artifactSlotId(old.marker)))
  fail('INSTALLER_ROLLBACK_CONTENT_IDENTITY_MISMATCH');
 const failed=opt.target+'.failed-'+artifactSlotId(current.marker);
 if(fs.existsSync(failed))fail('INSTALLER_FAILED_SLOT_ALREADY_EXISTS');
 let moved=false;
 fs.renameSync(opt.target,failed);moved=true;
 try{fs.renameSync(rollback,opt.target);}
 catch(error){
  try{fs.renameSync(failed,opt.target);moved=false;}
  catch{fail('INSTALLER_ROLLBACK_MANUAL_RECOVERY_REQUIRED');}
  throw error;
 }
 return {...verifyInstalled(opt.target),rolledBack:true,
  previousCandidateRetained:true,noDestructiveRemoval:true};
}

function retiredSlot(target,marker){
 if(!/^[a-f0-9]{64}$/.test(marker.sourceSha256||''))
  fail('INSTALLER_RETIRE_SOURCE_IDENTITY_INVALID');
 return target+'.retired-'+marker.sourceSha256.slice(0,12);
}
async function retireManagedInstall(opt){
 const current=await requireQuietOwnerInstall(opt.target);
 inspectTreeAliases(path.join(opt.target,'state'));
 const retired=retiredSlot(opt.target,current.marker);
 if(fs.existsSync(retired))fail('INSTALLER_RETIRED_SLOT_EXISTS_RECONCILE_FIRST');
 // No deletes, changes to user profile configuration, service stopping or
 // OS-wide app registration. Rename on the same filesystem preserves bytes.
 fs.renameSync(opt.target,retired);
 return {ok:true,uninstalledFromActiveRoot:true,
  preservedForOwnerRestore:true,retiredPath:retired,
  originalTarget:opt.target,profilesPreserved:current.names.length,
  sourceSha256:current.marker.sourceSha256,destructiveRemoval:false};
}
async function restoreRetiredInstall(opt){
 if(fs.existsSync(opt.target))fail('INSTALLER_RESTORE_TARGET_ALREADY_OCCUPIED');
 const parent=path.dirname(opt.target),prefix=path.basename(opt.target)+'.retired-';
 const slots=fs.readdirSync(parent).filter(n=>n.startsWith(prefix));
 if(slots.length!==1)fail('INSTALLER_RESTORE_RETIRED_SLOT_AMBIGUOUS');
 const retired=path.join(parent,slots[0]);
 if(fs.lstatSync(retired).isSymbolicLink())fail('INSTALLER_RESTORE_SLOT_ALIAS_REJECTED');
 const previous=await requireQuietOwnerInstall(retired);
 for(const name of previous.names)headlessGuard(opt.target,name.slice(0,-5));
 if(retired!==retiredSlot(opt.target,previous.marker))
  fail('INSTALLER_RESTORE_SOURCE_IDENTITY_MISMATCH');
 inspectTreeAliases(path.join(retired,'state'));
 // Root occupation is checked immediately before the rename.
 if(fs.existsSync(opt.target))fail('INSTALLER_RESTORE_TARGET_ALREADY_OCCUPIED');
 fs.renameSync(retired,opt.target);
 return {...verifyInstalled(opt.target),restored:true,
  exactPreviousBytesPreserved:true,oldSlotRemovedByRename:true,
  destructiveRemoval:false};
}
function inspectNativeDashboard(root){
 const marker=loadInstalled(root),ui=marker.nativeUi;
 if(!ui)fail('INSTALLER_NATIVE_DASHBOARD_NOT_BUNDLED');
 if(!/^app\/desktop\/[A-Za-z0-9._/-]+$/.test(ui.entry)||
  ui.entry.split('/').includes('..'))fail('INSTALLER_NATIVE_DASHBOARD_PATH_INVALID');
 const file=path.join(root,...ui.entry.split('/'));
 if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink()||
   !fs.lstatSync(file).isFile()||sha(fs.readFileSync(file))!==ui.sha256)
  fail('INSTALLER_NATIVE_DASHBOARD_TAMPERED');
 if((process.platform==='win32')!==(ui.kind==='winforms-readonly'))
  fail('INSTALLER_NATIVE_DASHBOARD_OS_MISMATCH');
 let dependencyReady=true;
 if(process.platform==='linux'){
  const check=cp.spawnSync('python3',['-c',
   'import gi;gi.require_version("Gtk","4.0");gi.require_version("Adw","1");from gi.repository import Gtk,Adw'],
   {timeout:4500,encoding:'utf8',windowsHide:true});
  dependencyReady=!check.error&&check.status===0;
 }
 return {ok:true,kind:ui.kind,readOnly:!ui.managedProfiles,
  managedProfileActions:ui.managedProfiles===true,
  dependencyReady,monitoringScope:'owner-local-existing-commander',file};
}
function nativeDashboard(opt,probeOnly){
 const ui=inspectNativeDashboard(opt.target);
 if(probeOnly)return {ok:true,nativeUiBundled:true,kind:ui.kind,
  uiReadOnly:ui.readOnly,managedProfileActions:ui.managedProfileActions,
  dependencyReady:ui.dependencyReady,monitoringScope:ui.monitoringScope,
  launcherVerified:true,launched:false};
 if(!ui.dependencyReady)fail('INSTALLER_NATIVE_DASHBOARD_DEPENDENCY_MISSING');
 const argv=process.platform==='win32'
  ?{cmd:ui.file,args:[]}
  :{cmd:'python3',args:['-B',ui.file]};
 const child=cp.spawn(argv.cmd,argv.args,{
  cwd:path.dirname(ui.file),stdio:'ignore',detached:true,windowsHide:false,
  env:{...process.env,COMMANDER_ONE_MANAGED_ROOT:opt.target}});
 child.once('error',()=>{});child.unref();
 return {ok:true,nativeUiBundled:true,kind:ui.kind,uiReadOnly:ui.readOnly,
  managedProfileActions:ui.managedProfileActions,
  monitoringScope:ui.monitoringScope,launcherVerified:true,spawnRequested:true,
  processId:child.pid??null,liveUiVisibleUnverified:true};
}
const delay=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
function ownerRuntimePaths(root,profile){
 const dir=path.join(root,'state','controls');
 if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true,mode:0o700});
 if(fs.lstatSync(dir).isSymbolicLink())fail('INSTALLER_CONTROL_DIR_ALIAS');
 return {dir,file:path.join(dir,profile+'.json')};
}
function profileIdentity(root,profile){
 const file=path.join(root,'state','profiles',profile+'.json');
 if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink())
  fail('INSTALLER_PROFILE_NOT_FOUND');
 const raw=fs.readFileSync(file);
 const cfg=JSON.parse(raw);
 if(cfg.instance?.profile!==profile||cfg.host!=='127.0.0.1'||
    !Number.isInteger(cfg.port)||cfg.port<1024||cfg.port>65535)
  fail('INSTALLER_PROFILE_CONFIG_INVALID');
 return {cfg,hash:sha(raw)};
}
async function httpHealth(port){
 try{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),1200);
  try{
   const response=await fetch('http://127.0.0.1:'+port+'/health',{signal:controller.signal});
   if(!response.ok)return null;
   const txt=await response.text();
   return txt.length<16384?JSON.parse(txt):null;
  }finally{clearTimeout(timer);}
 }catch{return null;}
}
function controlRequest(port,token,message){
 return new Promise((resolve,reject)=>{
  let done=false;let data='';
  const sock=net.createConnection({host:'127.0.0.1',port});
  const settle=(err,response)=>{if(done)return;done=true;sock.destroy();
   if(err)reject(err);else resolve(response);};
  sock.setTimeout(2300,()=>settle(new Error('CONTROL_TIMEOUT')));
  sock.once('connect',()=>sock.write(JSON.stringify({token,action:message})+'\n'));
  sock.on('data',part=>{
   data+=part.toString('utf8');
   if(data.length>4096)return settle(new Error('CONTROL_TOO_LARGE'));
   if(data.includes('\n')){
    try{settle(null,JSON.parse(data.slice(0,data.indexOf('\n'))));}
    catch{settle(new Error('CONTROL_INVALID_REPLY'));}
   }
  });
  sock.once('error',settle);
  sock.once('end',()=>settle(new Error('CONTROL_UNEXPECTED_END')));
 });
}
async function runtimeRecord(root,profile){
 const {file}=ownerRuntimePaths(root,profile);
 if(!fs.existsSync(file))return null;
 if(fs.lstatSync(file).isSymbolicLink())fail('INSTALLER_CONTROL_ALIAS');
 const raw=fs.readFileSync(file);
 if(raw.length>4096)fail('INSTALLER_CONTROL_OVERSIZED');
 const r=JSON.parse(raw);
 if(r.schema!==1||r.profile!==profile||r.root!==root||
    !/^[a-f0-9]{64}$/.test(r.token||'')||
    !Number.isInteger(r.controlPort)||r.controlPort<1024||
    !Number.isInteger(r.pid)||r.pid<1)
  fail('INSTALLER_CONTROL_RECORD_INVALID');
 return {file,record:r};
}
function installedRuntimeCommand(root,profile){
 if(process.platform==='win32')return {
  cmd:path.join(root,'Commander.exe'),
  args:['--run','--target',root,'--profile',profile]};
 return {cmd:path.join(root,'bin','node'),
  args:[path.join(root,'Commander.cjs'),'--run','--target',root,'--profile',profile]};
}
// Recover only a dead, owner-managed runtime control without stopping any process.
// The original control is exclusively copied to a private recovery slot.
async function runtimeReconcile(opt){
 loadInstalled(opt.target);
 const {cfg,hash}=profileIdentity(opt.target,opt.profile);
 const {dir,file}=ownerRuntimePaths(opt.target,opt.profile);
 const lock=path.join(dir,opt.profile+'.reconcile.lock');
 let fd;
 try{fd=fs.openSync(lock,'wx',0o600);}
 catch{fail('INSTALLER_RUNTIME_RECONCILE_BUSY');}
 try{
  const live=await runtimeRecord(opt.target,opt.profile);
  if(!live)return {ok:true,profile:opt.profile,reconciled:false,notRunning:true};
  const record=live.record;
  if(record.configSha256!==hash)fail('INSTALLER_CONTROL_CONFIG_CHANGED');
  // Never treat inaccessible, live or reused PIDs as dead.
  try{process.kill(record.pid,0);fail('INSTALLER_RUNTIME_RECONCILE_PID_PRESENT');}
  catch(error){if(error?.code!=='ESRCH')throw error;}
  const portFree=async port=>new Promise(resolve=>{
   const tester=net.createServer();
   tester.once('error',()=>resolve(false));
   tester.listen(port,'127.0.0.1',()=>tester.close(()=>resolve(true)));
  });
  if(!await portFree(record.controlPort))
   fail('INSTALLER_RUNTIME_RECONCILE_CONTROL_PORT_BUSY');
  if(!await portFree(cfg.port))
   fail('INSTALLER_RUNTIME_RECONCILE_BACKEND_PORT_BUSY');
  const raw=fs.readFileSync(file);
  if(sha(raw)!==sha(Buffer.from(JSON.stringify(record))))
   fail('INSTALLER_RUNTIME_RECONCILE_RECORD_CHANGED');
  const recovery=path.join(opt.target,'state','recovery');
  if(fs.existsSync(recovery)){
   if(!fs.lstatSync(recovery).isDirectory()||fs.lstatSync(recovery).isSymbolicLink())
    fail('INSTALLER_RUNTIME_RECONCILE_RECOVERY_ALIAS');
  }else fs.mkdirSync(recovery,{mode:0o700});
  const target=path.join(recovery,'control-'+opt.profile+'-stale-'+sha(raw).slice(0,16)+'.json');
  if(fs.existsSync(target))fail('INSTALLER_RUNTIME_RECONCILE_BACKUP_EXISTS');
  fs.copyFileSync(file,target,fs.constants.COPYFILE_EXCL);
  fs.chmodSync(target,0o600);
  if(sha(fs.readFileSync(target))!==sha(raw)||sha(fs.readFileSync(file))!==sha(raw))
   fail('INSTALLER_RUNTIME_RECONCILE_COPY_UNVERIFIED');
  fs.unlinkSync(file);
  return {ok:true,profile:opt.profile,reconciled:true,
    quarantined:true,notRunning:true,restartRequired:true};
 }finally{
  fs.closeSync(fd);
  try{fs.unlinkSync(lock);}catch{}
 }
}
// A Stop acknowledgement is only a request receipt. Observe cessation without
// signalling any process again, removing a record, or taking over a busy port.
// Signal 0 is a read-only liveness check. Inaccessible or remaining/reused PIDs
// fail closed; only ESRCH is accepted as absence of the authenticated PID.
function stopPidAbsent(pid){
 try{process.kill(pid,0);return false;}
 catch(error){
  if(error?.code==='ESRCH')return true;
  throw error;
 }
}
function stopEndpointClosed(port,observe=()=>{}){
 return new Promise(resolve=>{
  let done=false;
  const socket=net.createConnection({host:'127.0.0.1',port});
  const settle=(value,code)=>{if(done)return;done=true;observe(code);socket.destroy();resolve(value);};
  socket.setTimeout(180,()=>settle(false,'TIMEOUT'));
  socket.once('connect',()=>settle(false,'CONNECTED'));
  socket.once('error',error=>settle(error?.code==='ECONNREFUSED',error?.code??'UNKNOWN'));
 });
}
function stopRecordAbsent(live){
 const expected=Buffer.from(JSON.stringify(live.record));
 try{
  const stat=fs.lstatSync(live.file);
  if(stat.isSymbolicLink()||!stat.isFile())fail('INSTALLER_STOP_CESSATION_UNPROVEN');
  if(!fs.readFileSync(live.file).equals(expected))fail('INSTALLER_STOP_CESSATION_UNPROVEN');
  return false;
 }catch(error){
  if(error?.code==='ENOENT')return true;
  throw error;
 }
}
async function awaitOwnedStopCessation(live,backendPort,timeoutMs=5000){
 const started=process.hrtime.bigint();
 const deadline=started+BigInt(timeoutMs)*1000000n;
 const diagnostic={phase:'WAIT',pidCode:'UNOBSERVED',recordCode:'UNOBSERVED',controlCode:'UNOBSERVED',backendCode:'UNOBSERVED',samples:0,accessUncertainSamples:0};
 const unproven=(phase,code)=>{
  diagnostic.phase=phase;
  const error=new Error('INSTALLER_STOP_CESSATION_UNPROVEN');
  error.code='INSTALLER_STOP_CESSATION_UNPROVEN';
  error.stopDiagnostic={...diagnostic,reason:code,elapsedMs:Number(process.hrtime.bigint()-started)/1000000};throw error;
 };
 const absentPid=()=>{
  try{const absent=stopPidAbsent(live.record.pid);diagnostic.pidCode=absent?'ESRCH':'PRESENT';return absent;}
  catch(error){
   diagnostic.pidCode=error?.code??'UNKNOWN';
   if(['EPERM','EACCES'].includes(error?.code)){diagnostic.accessUncertainSamples++;return false;}
   return unproven('PID',diagnostic.pidCode);
  }
 };
 const absentRecord=()=>{
  try{const absent=stopRecordAbsent(live);diagnostic.recordCode=absent?'ENOENT':'PRESENT';return absent;}
  catch(error){
   diagnostic.recordCode=error?.code??'UNKNOWN';
   if(['EPERM','EACCES'].includes(error?.code)){diagnostic.accessUncertainSamples++;return false;}
   return unproven('RECORD',diagnostic.recordCode);
  }
 };
 do{
  diagnostic.samples++;
  const absent=absentPid(),recordAbsent=absentRecord();
  if(absent&&recordAbsent){
   const closed=await Promise.all([
    stopEndpointClosed(live.record.controlPort,code=>{diagnostic.controlCode=code;}),
    stopEndpointClosed(backendPort,code=>{diagnostic.backendCode=code;})]);
   if(closed.every(Boolean)&&absentPid()&&absentRecord())return;
  }
  if(process.hrtime.bigint()>=deadline)break;
  await delay(25);
 }while(process.hrtime.bigint()<deadline);
 unproven('DEADLINE','NO_POSITIVE_CESSATION_WITNESS');
}
async function manageRuntime(opt){
 loadInstalled(opt.target);
 const {cfg,hash}=profileIdentity(opt.target,opt.profile);
 const {file}=ownerRuntimePaths(opt.target,opt.profile);
 if(opt.action==='start'){
  headlessGuard(opt.target,opt.profile);
  if(fs.existsSync(path.join(opt.target,'state','controls',opt.profile+'.reconcile.lock')))
   fail('INSTALLER_RUNTIME_RECONCILE_BUSY');
  if(fs.existsSync(file))fail('INSTALLER_EXISTING_CONTROL_RECORD_RECONCILE_FIRST');
  const available=await new Promise(resolve=>{
   const tester=net.createServer();
   tester.once('error',()=>resolve(false));
   tester.listen(cfg.port,'127.0.0.1',()=>tester.close(()=>resolve(true)));
  });
  if(!available)fail('INSTALLER_PORT_OCCUPIED_NO_TAKEOVER');
  const token=crypto.randomBytes(32).toString('hex');
  const cmd=installedRuntimeCommand(opt.target,opt.profile);
  const child=cp.spawn(cmd.cmd,cmd.args,{cwd:opt.target,
   env:{...process.env,COMMANDER_ONE_CONTROL_TOKEN:token},
   detached:true,windowsHide:true,stdio:'ignore'});
  child.once('error',()=>{});
  child.unref();
  for(let attempt=0;attempt<85;attempt++){
   await delay(120);
   if(fs.existsSync(file)){
    const identity=await runtimeRecord(opt.target,opt.profile);
    if(identity?.record.token===token){
     let ack=null;
     try{ack=await controlRequest(identity.record.controlPort,token,'ping');}catch{}
     const health=await httpHealth(cfg.port);
     if(ack?.ok&&ack.pid===identity.record.pid&&
        health?.ok===true&&health?.configSha256===hash&&
        health?.instance?.profile===opt.profile){
       return {ok:true,started:true,profile:opt.profile,backendPort:cfg.port,
        controlPid:identity.record.pid,verifiedHealth:true,configSha256:hash};
     }
    }
   }
  }
  // Stop only a process proven to possess *this launch's* random token.
  // Never kill an unrelated process just because a PID or port was reused.
  if(fs.existsSync(file)){
   try{
    const identity=await runtimeRecord(opt.target,opt.profile);
    if(identity.record.token===token)
     await controlRequest(identity.record.controlPort,token,'stop');
   }catch{}
  }
  fail('INSTALLER_BACKEND_START_UNVERIFIED');
 }
 const live=await runtimeRecord(opt.target,opt.profile);
 if(!live){
  if(opt.action==='stop')return {ok:true,stopped:false,notRunning:true};
  return {ok:true,profile:opt.profile,running:false,verified:false};
 }
 if(live.record.configSha256!==hash)fail('INSTALLER_CONTROL_CONFIG_CHANGED');
 let pong;
 try{pong=await controlRequest(live.record.controlPort,live.record.token,'ping');}
 catch{fail('INSTALLER_CONTROL_UNRESPONSIVE_RECONCILE_FIRST');}
 if(!pong?.ok||pong.pid!==live.record.pid||pong.profile!==opt.profile)
  fail('INSTALLER_CONTROL_IDENTITY_MISMATCH');
 const h=await httpHealth(cfg.port);
 if(!h?.ok||h.configSha256!==hash||h.instance?.profile!==opt.profile)
  fail('INSTALLER_BACKEND_IDENTITY_MISMATCH');
 if(opt.action==='runtime-status')
  return {ok:true,profile:opt.profile,running:true,verified:true,
   backendPort:cfg.port,pid:live.record.pid};
 const stopped=await controlRequest(live.record.controlPort,live.record.token,'stop');
 if(!stopped?.ok)fail('INSTALLER_CONTROL_STOP_REFUSED');
 if(stopped.pid!==live.record.pid||stopped.profile!==opt.profile)
  fail('INSTALLER_STOP_CESSATION_UNPROVEN');
 await awaitOwnedStopCessation(live,cfg.port);
 return {ok:true,stopped:true,profile:opt.profile,verifiedIdentity:true};
}
async function controlForRun(root,profile,configSha256,token){
 if(!/^[a-f0-9]{64}$/.test(token||''))return;
 const {file}=ownerRuntimePaths(root,profile);
 const srv=net.createServer(socket=>{
  let input='';
  socket.on('data',data=>{
   input+=data.toString('utf8');
   if(input.length>2048){socket.destroy();return;}
   if(!input.includes('\n'))return;
   let req;try{req=JSON.parse(input.slice(0,input.indexOf('\n')));}
   catch{socket.destroy();return;}
   if(typeof req.token!=='string'||req.token.length!==token.length||
      !crypto.timingSafeEqual(Buffer.from(req.token),Buffer.from(token))){
    socket.end(JSON.stringify({ok:false})+'\n');return;
   }
   const response={ok:true,pid:process.pid,profile};
   if(req.action==='ping')socket.end(JSON.stringify(response)+'\n');
   else if(req.action==='stop'){
    socket.end(JSON.stringify(response)+'\n',()=>setTimeout(()=>process.exit(0),60));
   }else socket.end(JSON.stringify({ok:false})+'\n');
  });
 });
 await new Promise((resolve,reject)=>{srv.once('error',reject);
  srv.listen(0,'127.0.0.1',resolve);});
 const record={schema:1,root,profile,pid:process.pid,
  controlPort:srv.address().port,token,configSha256};
 const serialized=JSON.stringify(record);
 fs.writeFileSync(file,serialized,{flag:'wx',mode:0o600});
 process.on('exit',()=>{
  try{if(fs.readFileSync(file,'utf8')===serialized)fs.unlinkSync(file);}catch{}
 });
}
async function runInstalled(opt){
 const product=loadInstalled(opt.target);
 const file=path.join(opt.target,'state','profiles',opt.profile+'.json');
 if(!fs.existsSync(file))fail('INSTALLER_PROFILE_NOT_FOUND');
 const identity=profileIdentity(opt.target,opt.profile);
 await controlForRun(opt.target,opt.profile,identity.hash,process.env.COMMANDER_ONE_CONTROL_TOKEN);
 process.env.REMOTE_COMMANDER_CONFIG=file;
 process.env.REMOTE_COMMANDER_CAPABILITY_GAP_DIR=path.join(opt.target,'state','capability-gaps');
 process.chdir(path.join(opt.target,'app'));
 const entry=path.join(opt.target,'app','src','server-v0.3.mjs');
 // SEA injected imports load builtins only. createRequire() enters a real
 // on-disk CommonJS loader, where dynamic ESM import resolves local modules.
 const loader=path.join(opt.target,'module-loader.cjs');
 const diskRequire=moduleApi.createRequire(loader);
 await diskRequire(loader)(entry);
}
async function main(){
 const o=options();
 if(o.action==='help'){console.log('Commander One preview: --verify-package | --install [--mode standard|full] | --upgrade | --rollback | --uninstall | --restore | --status | --add-profile [--profile NAME] | --run [--profile NAME] | --start | --runtime-status | --runtime-reconcile | --stop | --autostart-status | --autostart-enable | --autostart-disable | --dashboard-probe | --dashboard. Existing installations are NEVER replaced.');return;}
 if(o.action==='run'){await runInstalled(o);return;}
 if(o.action.startsWith('headless-')){
  console.log(JSON.stringify(await headlessCommand(o)));return;
 }
 if(o.action.startsWith('autostart-')){
  console.log(JSON.stringify(autostartCommand(o.target,o.profile,o.action)));return;
 }
 if(o.action==='runtime-reconcile'){
  console.log(JSON.stringify(await runtimeReconcile(o)));return;
 }
 if(o.action==='start'||o.action==='stop'||o.action==='runtime-status'){
  console.log(JSON.stringify(await manageRuntime(o)));return;
 }
 if(o.action==='dashboard'||o.action==='dashboard-probe'){
  console.log(JSON.stringify(nativeDashboard(o,o.action==='dashboard-probe')));return;
 }
 let result;
 if(o.action==='verify-package'){const v=readPayload(o);result={ok:true,files:v.manifest.files.length,
  archiveSha256:v.manifest.sourceSha256,build:v.manifest.build,platform:process.platform,
  nativeUi:v.manifest.nativeUi??null,installed:false};}
 else if(o.action==='install')result=await install(o);
 else if(o.action==='upgrade')result=await managedUpgrade(o);
 else if(o.action==='rollback')result=await managedRollback(o);
 else if(o.action==='uninstall')result=await retireManagedInstall(o);
 else if(o.action==='restore')result=await restoreRetiredInstall(o);
 else if(o.action==='status')result=verifyInstalled(o.target);
 else if(o.action==='add-profile'){
  const product=loadInstalled(o.target);
  const number=fs.readdirSync(path.join(o.target,'state','profiles')).length;
  if(number>50)fail('INSTALLER_PROFILE_LIMIT');
  const created=freshConfig(o.target,o.profile,await chooseAvailablePort(o.target),product.mode);
  try {
   const raw=JSON.parse(fs.readFileSync(created,'utf8'));
   const migrated=await applyNewProfileMode(o.target,o.target,o.profile,product.mode,raw);
   fs.writeFileSync(created,JSON.stringify(migrated,null,2)+'\n',{mode:0o600});
  }catch(error){
   // This file was exclusively created by our wx call; never leave an
   // incomplete owner profile behind on a failed migration.
   fs.unlinkSync(created);
   throw error;
  }
  result={...verifyInstalled(o.target),added:o.profile};
 }else fail('INSTALLER_UNKNOWN_ACTION');
 console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(JSON.stringify({ok:false,errorCode:e.code??e.message??'INSTALLER_FAILED',...(e.stopDiagnostic?{stopDiagnostic:e.stopDiagnostic}:{})}));
 if(process.argv.includes('--run'))process.exit(2);
 process.exitCode=2;});
