#!/usr/bin/env node
// R205 — read-only installed-version and protected-data inventory.
// Does NOT read browser cookies, Local State, passwords, profiles or personal files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const versionDir=/^v[0-9]+\.[0-9]+\.[0-9]+(?:[-.][A-Za-z0-9._-]+)?$/;
const browserRuntime=/^runtime-v[0-9]+\.[0-9]+\.[0-9]+(?:[-.][A-Za-z0-9._-]+)?$/;
function stat(p) {try{return fs.lstatSync(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function isDir(p){const x=stat(p);return !!x&&x.isDirectory()&&!x.isSymbolicLink();}
function shallow(p){
 if(!isDir(p))return [];
 return fs.readdirSync(p,{withFileTypes:true}).slice(0,500).map(x=>({name:x.name,dir:x.isDirectory(),link:x.isSymbolicLink()})).sort((a,b)=>a.name.localeCompare(b.name));
}
function inside(parent,child){
 const a=path.resolve(parent),b=path.resolve(child);
 const rel=path.relative(a,b);
 return !!rel&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);
}
function same(a,b) {return !!a&&!!b&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();}
function readKnownJson(p){
 const st=stat(p);
 if(!st||!st.isFile()||st.isSymbolicLink()||st.size>1024*1024)return null;
 try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}
}
function currentPointer(root){
 const current=path.join(root,'current'),st=stat(current);
 if(!st)return {status:'MISSING',target:null};
 if(!st.isSymbolicLink())return {status:'UNKNOWN_NOT_LINK',target:null};
 try{
  const resolved=fs.realpathSync(current);
  if(!inside(root,resolved))return {status:'OUTSIDE_INSTALL_ROOT_PROTECTED',target:resolved};
  return {status:'LINK_IN_ROOT',target:resolved};
 }catch{return {status:'BROKEN_LINK_PROTECTED',target:null};}
}
function appRoot(root,kind) {
 const pointer=currentPointer(root);
 const entries=shallow(root).filter(x=>versionDir.test(x.name)||x.name.startsWith('current.'));
 const versions=[];
 for(const x of entries){
  const full=path.join(root,x.name);
  const targetKind=x.name.startsWith('current.')?'TRANSACTION_ALIAS':'VERSION';
  let classification='PROTECT_UNKNOWN';
  const metadata=targetKind==='VERSION'?readKnownJson(path.join(full,'product-install.json')):null;
  if(targetKind==='TRANSACTION_ALIAS')classification='PROTECT_ROLLBACK_OR_UNCERTAIN_TRANSACTION';
  else if(x.link||!x.dir)classification='PROTECT_REPARSE_OR_NON_DIRECTORY';
  else if(same(full,pointer.target))classification='ACTIVE_KEEP';
  else if(metadata&&metadata.product&&typeof metadata.version==='string')classification='REVIEW_RETIRED_BINARY_ONLY_NO_DELETE';
  else classification='PROTECT_NO_TRUSTED_INSTALL_MANIFEST';
  versions.push({name:x.name,classification,managedManifest:!!metadata,link:x.link});
 }
 return {kind,installationRoot:root,current:pointer,versionEntries:versions,activeCount:versions.filter(x=>x.classification==='ACTIVE_KEEP').length,
  note:'Never remove existing versions from this audit. Retire only after owner acceptance/rollback/handle checks.'};
}
function routingRefs(dir){
 const refs=[];
 for(const f of shallow(dir).filter(x=>!x.link&&!x.dir&&x.name.endsWith('.json')&&!x.name.endsWith('.runtime.json'))){
  const j=readKnownJson(path.join(dir,f.name));
  if(!j){refs.push({route:f.name,integrity:'UNREADABLE_PROTECT'});continue;}
  const list=[];
  for(const key of ['active','previous']){
   const item=j[key];
   if(item&&typeof item==='object'&&typeof item.projectDir==='string')list.push({slot:key,projectRoot:item.projectDir});
  }
  refs.push({route:f.name,integrity:'READABLE',slots:list});
 }
 return refs;
}
function releaseRoot(root,routes) {
 const claimed=new Set(routes.flatMap(r=>(r.slots||[]).map(x=>path.resolve(x.projectRoot).toLowerCase())));
 const entries=[];
 for(const x of shallow(root).filter(x=>x.name.startsWith('v'))){
  const full=path.join(root,x.name);
  const metadata=readKnownJson(path.join(full,'package.json'));
  const selected=claimed.has(path.resolve(full).toLowerCase());
  const cls=x.link||!x.dir?'PROTECT_REPARSE_OR_UNKNOWN':selected?'ACTIVE_OR_PREVIOUS_ROUTED_KEEP':
    metadata&&versionDir.test(x.name)?'REVIEW_IMMUTABLE_RELEASE_UNREFERENCED_NO_DELETE':'PROTECT_UNVERIFIED_RELEASE';
  entries.push({name:x.name,classification:cls,packageVersion:typeof metadata?.version==='string'?metadata.version:null});
 }
 return {root,routeCount:routes.length,entries};
}
function protectedData(p,reason){return {path:p,exists:!!stat(p),classification:'PROTECTED_USER_DATA_NEVER_AUTO_DELETE',reason};}
function readLauncherHints(launcher){
 const st=stat(launcher);
 if(!st||!st.isFile()||st.size>20000||st.isSymbolicLink())return {status:'UNKNOWN_LAUNCHER'};
 const s=fs.readFileSync(launcher,'utf8');
 const runtime=s.match(/^RUNTIME=(?:["']?)(\/[^\n"']+)(?:["']?)$/m)?.[1]||null;
 const sandbox=s.match(/^EXPECTED_SANDBOX_REAL=(?:["']?)(\/[^\n"']+)(?:["']?)$/m)?.[1]||null;
 return {status:runtime?'SOURCE_HINTS_REQUIRES_LIVE_VERIFICATION':'UNKNOWN_LAUNCHER',runtime,sandbox};
}
function browserLinux(root,launcher){
 const hints=readLauncherHints(launcher),entries=[];
 for(const x of shallow(root).filter(x=>browserRuntime.test(x.name)||x.name.startsWith('.stage-')||x.name.startsWith('profile-'))){
  const f=path.join(root,x.name);
  let cls;
  if(x.name.startsWith('profile-'))cls='PROTECTED_USER_DATA_NEVER_AUTO_DELETE';
  else if(x.link||!x.dir)cls='PROTECT_REPARSE_OR_UNKNOWN';
  else if(hints.runtime&&same(f,hints.runtime))cls='ACTIVE_RUNTIME_KEEP';
  else if(hints.sandbox&&inside(f,hints.sandbox))cls='ACTIVE_SANDBOX_DEPENDENCY_KEEP';
  else cls='REVIEW_UNREFERENCED_RUNTIME_OR_STAGE_NO_DELETE';
  entries.push({name:x.name,classification:cls});
 }
 return {root,launcher,hints,entries};
}
export function auditInstalledLayout({platform=process.platform,home=os.homedir(),localAppData,roamingAppData}={}){
 if(!['win32','linux'].includes(platform))throw new Error('R205_UNSUPPORTED_PLATFORM');
 if(!path.isAbsolute(home))throw new Error('R205_HOME_MUST_BE_ABSOLUTE');
 const report={schema:1,revision:'R205',platform,policy:'READ_ONLY_NEVER_DELETE',personalBrowserFilesRead:0,
   deletionAuthorized:false,oneActiveVersionInvariant:'CURRENT_POINTER_REQUIRED',recordedAt:new Date().toISOString(),protectedData:[]};
 if(platform==='win32'){
  const local=localAppData||path.join(home,'AppData','Local');
  const roaming=roamingAppData||path.join(home,'AppData','Roaming');
  const commander=path.join(local,'ChatGPTRemoteCommander');
  const programs=path.join(local,'Programs');
  const routes=routingRefs(path.join(commander,'routing'));
  report.core={root:commander,releases:releaseRoot(path.join(commander,'releases'),routes),routing:routes};
  report.products=[
    appRoot(path.join(programs,'Remote Commander'),'CONTROL_CENTER'),
    appRoot(path.join(programs,'Remote Commander Browser'),'BROWSER_STABLE'),
    appRoot(path.join(programs,'Remote Commander Browser Development'),'BROWSER_DEVELOPMENT')
  ];
  report.protectedData.push(protectedData(path.join(local,'chatgpt-cef-v2'),'CEF authenticated Chromium profile'));
  report.protectedData.push(protectedData(path.join(commander,'credentials'),'Commander credentials'));
  report.protectedData.push(protectedData(path.join(commander,'browser-profiles'),'Companion profiles'));
  report.profileDirectoriesEnumerated=false;
  report.publicShortcuts=shallow(path.join(roaming,'Microsoft','Windows','Start Menu','Programs','Remote Commander'))
    .filter(x=>/\.lnk$/i.test(x.name)).map(x=>x.name);
 }else{
  const share=path.join(home,'.local','share'),state=path.join(home,'.local','state','chatgpt-remote-commander');
  const routes=routingRefs(path.join(state,'routing'));
  report.core={root:path.join(share,'ChatGPTRemoteCommander'),stateRoot:state,
    releases:releaseRoot(path.join(state,'releases'),routes),routing:routes};
  report.products=[{kind:'CONTROL_CENTER',root:path.join(share,'remote-commander-control-center'),present:isDir(path.join(share,'remote-commander-control-center')),classification:'ACTIVE_OR_UNKNOWN_NO_AUTODELETE'}];
  report.browser=browserLinux(path.join(share,'chatgpt-cef-v2'),path.join(home,'.local','bin','chatgpt-cef-v2'));
  report.protectedData.push(protectedData(path.join(home,'.config','chatgpt-cef-v2'),'CEF authenticated Chromium profile'));
  report.protectedData.push(protectedData(path.join(share,'chatgpt-cef-v2','profile-r112-private'),'CEF experimental private profile'));
  report.protectedData.push(protectedData(path.join(home,'.config','chatgpt-remote-commander'),'Commander policy/credentials'));
 }
 report.retirementGate={mayDeleteNow:false,required:['exact installed file manifest+hash','no live executable/route/link or sandbox reference','owner verified Browser login retained','accepted rollback and recovery window','explicit narrow removal plan and exact-path receipt']};
 return report;
}
if(process.argv[1]&&path.resolve(process.argv[1]).toLowerCase()===path.resolve(fileURLToPath(import.meta.url)).toLowerCase()){
 const opts={};
 const args=process.argv.slice(2);
 for(let i=0;i<args.length;i+=2){
  const k=args[i],v=args[i+1];if(!v||!['--home','--platform','--local','--roaming'].includes(k))throw new Error('R205_UNKNOWN_CLI_ARGUMENT');
  if(k==='--home')opts.home=v;
  if(k==='--platform')opts.platform=v;
  if(k==='--local')opts.localAppData=v;
  if(k==='--roaming')opts.roamingAppData=v;
 }
 console.log(JSON.stringify(auditInstalledLayout(opts),null,2));
}
