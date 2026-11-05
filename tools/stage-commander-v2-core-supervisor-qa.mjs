#!/usr/bin/env node
// Apply a reversible, SHA-pinned opt-in QA Core lifetime adapter to one disposable CoS tree.
// Never modify an active CoS install, V1 service, OS profile or owner browser.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const bad=s=>{throw Error('COMMANDER_V2_QA_SUPERVISOR_'+s)};
const PIN={
 main:'a226790d4f5d5107f276eda09701a8c52c22c7b3489e15227da415a85239d529',
 center:'c2946f887b61d3cd96010b162d7a43dbe47268a285eaf51da43b55ae66aa5dad',
 controller:'11fb6479f4f81ccf053a0699e600d238b76da24825de1aecf5c82cfd72884cac'
};
function read(f){
 const st=fs.lstatSync(f);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)bad('FILE_ALIAS');
 return fs.readFileSync(f);
}
function unique(s,needle,replacement){
 if(s.split(needle).length!==2)bad('ANCHOR_UNEXPECTED');
 return s.replace(needle,replacement);
}
function noAliasPath(target){
 const abs=path.resolve(target);
 let current=path.parse(abs).root;
 for(const segment of abs.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,segment);
  if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())
   bad('SYMLINK_ANCESTOR_DENIED');
 }
}
function preflight(root){
 if(!path.isAbsolute(root)||!['linux','win32'].includes(process.platform))bad('NOT_NATIVE');
 const p=path.resolve(root);
 const expected=process.platform==='linux'?'cos2150-unified-rebuild-20261104':'official-cos-tag2150-sparse-20261104';
 for(const component of [p,path.join(p,'src','main'),path.join(p,'resources','commander-v1-core'),
  path.join(p,'.commander-v2-core-supervisor-qa-backup')])noAliasPath(component);
 if(path.basename(p)!==expected||
  read(path.join(p,'.commander-v2-isolated-qa')).toString()!=='V2_COS_DISPOSABLE_SOURCE_QA_ONLY\n')bad('NOT_ISOLATED_SOURCE');
 const manifest=path.join(p,'resources','commander-v1-core','MANIFEST.json');
 const m=sha(read(manifest));
 if(!['c6c64886301c427bae8b8934304eaf82ee6382fefc01aee8e013e0745c4f1306',
  'aff379a6ffccbf6e0837d2dcf01415283b0a44205ce4aece6b19cfe914a4c923',
  '45f141302e19728d7ee2eb4898c5fa35d1b99889ef6707760fd079dda7771842',
  'f91097d773bb754cba34900d8f44609555b1936a510e55af9ee933cd4f7d239a'].includes(m))
  bad('INTERNAL_CORE_NOT_PINNED');
 return p;
}
function mainText(s){
 s=unique(s,
 "import { createCommanderV2Center } from './commander-v2-center.js';",
 "import { createCommanderV2Center } from './commander-v2-center.js';\nimport { createEmbeddedCoreSupervisor } from './commander-v1-core-supervisor.js';");
 s=unique(s,
 "const commanderV2Center = createCommanderV2Center({resourcesPath:process.resourcesPath,BrowserWindowClass:BrowserWindow});",
 "const embeddedCoreSupervisor = createEmbeddedCoreSupervisor({\n"+
 "  resourcesPath:process.resourcesPath,executablePath:process.execPath,\n"+
 "  stateRoot:()=>path.join(app.getPath('userData'),'v1-core-isolated-qa'),\n"+
 "  qaAllowed:app.isPackaged && process.env.COMMANDER_V2_EMBEDDED_CORE_QA==='isolated' &&\n"+
 "    process.argv.includes('--commander-v2-core-qa'),\n"+
 "  onStatus:status=>logInfo('embedded V1 Core QA state: '+status.state)\n"+
 "});\n"+
 "const commanderV2Center = createCommanderV2Center({resourcesPath:process.resourcesPath,BrowserWindowClass:BrowserWindow,\n"+
 "  coreEndpoint:()=>embeddedCoreSupervisor.coreUrl()});");
 s=unique(s,
 "  await loadConfig();\n  markStartup('config');",
 "  await loadConfig();\n"+
 "  // Explicit QA-only opt-in: never auto-start a second V1 or take over an owner profile.\n"+
 "  void embeddedCoreSupervisor.start().catch(()=>logWarn('embedded V1 Core QA startup failed'));\n"+
 "  markStartup('config');");
 s=unique(s,
 "run: () => [unifiedExecManager.terminateAllProcesses(), workspaceTerminalsExited(), stopComputerHelper(), shutdownPetOverlay(), pluginManager.close(),",
 "run: () => [embeddedCoreSupervisor.stop(), unifiedExecManager.terminateAllProcesses(), workspaceTerminalsExited(), stopComputerHelper(), shutdownPetOverlay(), pluginManager.close(),");
 return s;
}
function centerText(s){
 s=unique(s,"  loadWorkspace?: (url: string) => Promise<{createWorkspace(options: {port: number}): Promise<V2CenterWorkspace>}>;",
 "  loadWorkspace?: (url: string) => Promise<{createWorkspace(options: {port: number;coreUrl?: string}): Promise<V2CenterWorkspace>}>;\n"+
 "  coreEndpoint?: () => string | null;");
 s=unique(s,"await import(/* @vite-ignore */ url) as {createWorkspace(options: {port: number}): Promise<V2CenterWorkspace>}",
 "await import(/* @vite-ignore */ url) as {createWorkspace(options: {port: number;coreUrl?: string}): Promise<V2CenterWorkspace>}");
 s=unique(s,"      const server=await mod.createWorkspace({port:0});",
 "      // Read-only status adapter uses existing tokenized R18 /api/status and the verified loopback URL only.\n"+
 "      const coreUrl=options.coreEndpoint?.();\n"+
 "      const server=await mod.createWorkspace({port:0,...(coreUrl?{coreUrl}:{})});");
 return s;
}
function plan(p){
 const main=path.join(p,'src','main','index.ts');
 const center=path.join(p,'src','main','commander-v2-center.ts');
 const controller=path.join(p,'src','main','commander-v1-core-supervisor.ts');
 if(fs.existsSync(controller))bad('CONTROLLER_ALREADY_EXISTS');
 const a=read(main),b=read(center);
 if(sha(a)!==PIN.main||sha(b)!==PIN.center)bad('HOST_SOURCE_SHA_CHANGED');
 const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'commander-v1-core-supervisor.qa.ts');
 const body=read(repo);
 if(sha(body)!==PIN.controller)bad('CONTROLLER_SOURCE_CHANGED');
 return [
 {target:main,original:a,next:Buffer.from(mainText(a.toString()))},
 {target:center,original:b,next:Buffer.from(centerText(b.toString()))},
 {target:controller,original:null,next:body}
 ];
}
export function run(action,root){
 const p=preflight(root),backup=path.join(p,'.commander-v2-core-supervisor-qa-backup');
 if(action==='verify'){
  const data=JSON.parse(read(path.join(backup,'MANIFEST.json')).toString());
  if(data.mode!=='EXPLICIT_ISOLATED_QA'||!Array.isArray(data.files)||data.files.length!==3)
   bad('QA_MANIFEST_INVALID');
  for(const row of data.files){
   if(!['src/main/index.ts','src/main/commander-v2-center.ts','src/main/commander-v1-core-supervisor.ts'].includes(row.file)||
    sha(read(path.join(p,row.file)))!==row.sha256)bad('QA_READBACK_FAILED');
  }
  return {gate:'COMMANDER_V2_EMBEDDED_CORE_SUPERVISOR_SOURCE_QA_PASS',files:3,
   autoEnabled:false,productionInstalled:false,activeV1Touched:false};
 }
 if(action==='refresh-auth-controller'){
  // Advance the same existing three-file QA controller record; do not create a second active source.
  const controller=path.join(p,'src','main','commander-v1-core-supervisor.ts');
  const manifestPath=path.join(backup,'MANIFEST.json');
  const authManifest=path.join(p,'resources','commander-v1-core','MANIFEST.json');
  const authSha=process.platform==='win32'
   ?'f91097d773bb754cba34900d8f44609555b1936a510e55af9ee933cd4f7d239a'
   :'45f141302e19728d7ee2eb4898c5fa35d1b99889ef6707760fd079dda7771842';
  if(sha(read(authManifest))!==authSha)bad('AUTH_GATED_CORE_NOT_STAGED');
  const original=read(controller),prior=read(manifestPath);
  if(sha(original)!=='a6293db54028a9bbe64caf0c10fe6e2b588bd375e2239a33c1bcd750ad5f828d'||
   sha(prior)!=='169d1cb357b9939f1e4b97cb99c41b43d7e1f7650e6df58edea47d53214e280b')
   bad('AUTH_CONTROLLER_BEFORE_CHANGED');
  const updated=read(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'commander-v1-core-supervisor.qa.ts'));
  if(sha(updated)!==PIN.controller)bad('AUTH_CONTROLLER_EXPECTED_SOURCE');
  const m=JSON.parse(prior.toString());
  const row=m.files?.find(x=>x.file==='src/main/commander-v1-core-supervisor.ts');
  if(row?.sha256!==sha(original))bad('AUTH_CONTROLLER_MANIFEST_ROW');
  row.sha256=sha(updated);
  const after=Buffer.from(JSON.stringify(m,null,2)+'\n');
  const restore=path.join(backup,'controller-before-mcp-auth.qa.ts');
  if(fs.existsSync(restore))bad('AUTH_CONTROLLER_BACKUP_EXISTS');
  fs.writeFileSync(restore,original,{flag:'wx',mode:0o600});
  try{
   if(sha(read(controller))!==sha(original)||sha(read(manifestPath))!==sha(prior))bad('CONCURRENT_AUTH_CONTROLLER');
   const temp=controller+'.mcpauth-qa-'+process.pid;
   try{fs.writeFileSync(temp,updated,{flag:'wx',mode:0o600});fs.renameSync(temp,controller)}
   finally{if(fs.existsSync(temp))fs.rmSync(temp)}
   fs.writeFileSync(manifestPath,after);
   return {...run('verify',p),status:'AUTH_CONTROLLER_STAGED_WITH_RECOVERY',manifestSha:sha(after)};
  }catch(e){
   if(sha(read(controller))===sha(updated))fs.writeFileSync(controller,original);
   if(sha(read(manifestPath))===sha(after))fs.writeFileSync(manifestPath,prior);
   throw e;
  }
 }
 if(action==='refresh-controller'){
  const component=path.join(p,'src','main','commander-v1-core-supervisor.ts');
  const manifestPath=path.join(backup,'MANIFEST.json');
  const original=read(component),oldManifest=read(manifestPath);
  if(sha(original)!=='bf612af8865e032b4dd09f5fbe83fbcd9232af874317abe787855042807c07a0'||
    sha(oldManifest)!=='ba07c80bfb4035472bebc8b408eac4ce3c1bd98653d7d410f1315da372dcc9fb'||
    sha(read(path.join(p,'src','main','index.ts')))!=='c3aaacd5c89b0f6faa586c481f65d08dbb8fc160dc992a7b20d1d64cee89f228')
    bad('CONTROLLER_PRECONDITION_CHANGED');
  const next=read(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'commander-v1-core-supervisor.qa.ts'));
  if(sha(next)!==PIN.controller)bad('CONTROLLER_UPGRADE_SOURCE_CHANGED');
  const data=JSON.parse(oldManifest);
  const row=data.files?.find(x=>x.file==='src/main/commander-v1-core-supervisor.ts');
  if(row?.sha256!==sha(original))bad('CONTROLLER_MANIFEST_HASH_CONFLICT');
  row.sha256=sha(next);
  const nextManifest=Buffer.from(JSON.stringify(data,null,2)+'\n');
  const recovery=path.join(backup,'supervisor-qa-prior-spawn-guard.ts');
  if(fs.existsSync(recovery))bad('CONTROLLER_RECOVERY_EXISTS');
  fs.writeFileSync(recovery,original,{flag:'wx',mode:0o600});
  try{
   if(sha(read(component))!==sha(original)||sha(read(manifestPath))!==sha(oldManifest))bad('CONCURRENT_QA_CHANGE');
   const temp=component+'.spawn-guard-'+process.pid;
   try{fs.writeFileSync(temp,next,{flag:'wx',mode:0o600});fs.renameSync(temp,component);}
   finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
   fs.writeFileSync(manifestPath,nextManifest);
   return {...run('verify',p),status:'QA_CONTROLLER_SPAWN_ERROR_GUARD_UPGRADED'};
  }catch(e){
   if(sha(read(component))===sha(next))fs.writeFileSync(component,original);
   if(sha(read(manifestPath))===sha(nextManifest))fs.writeFileSync(manifestPath,oldManifest);
   throw e;
  }
 }
 if(action!=='stage'||fs.existsSync(backup))bad('NOT_FRESH_QA_STAGE');
 const changes=plan(p);
 fs.mkdirSync(backup,{mode:0o700});
 const completed=[];
 try{
  const manifest={mode:'EXPLICIT_ISOLATED_QA',files:[]};
  for(const item of changes){
   const rel=path.relative(p,item.target).split(path.sep).join('/');
   if(item.original){
    const dest=path.join(backup,rel);
    fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});
    fs.writeFileSync(dest,item.original,{flag:'wx',mode:0o600});
   }
   manifest.files.push({file:rel,sha256:sha(item.next)});
  }
  fs.writeFileSync(path.join(backup,'MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  for(const item of changes){
   if(item.original&&sha(read(item.target))!==sha(item.original))bad('CONCURRENT_WRITER');
   if(!item.original&&fs.existsSync(item.target))bad('NEW_FILE_CONFLICT');
   const temp=item.target+'.supervisor-qa-'+process.pid;
   try{fs.writeFileSync(temp,item.next,{flag:'wx',mode:0o600});fs.renameSync(temp,item.target);}
   finally{if(fs.existsSync(temp))fs.rmSync(temp,{force:true})}
   completed.push(item);
  }
  return {...run('verify',p),status:'STAGED_WITH_RECOVERY'};
 }catch(e){
  for(const item of completed.reverse()){
   if(sha(read(item.target))===sha(item.next)){
    if(item.original)fs.writeFileSync(item.target,item.original);
    else fs.rmSync(item.target);
   }
  }
  throw e;
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(run(process.argv[2],process.argv[3])))}
 catch(e){console.error(String(e.message||e));process.exitCode=2;}
}
