#!/usr/bin/env node
// R205: read-only, fail-closed retirement authorization for versioned Core folders.
// A normal update MUST NOT delete anything without a separate, evidence-bound
// post-acceptance approval. This helper itself never deletes or changes files.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const NAME=/^v([0-9]+\.[0-9]+\.[0-9]+)-([0-9a-f]{12})$/;
const HEAD=/^[0-9a-f]{40}$/;
const ORIGIN='https://github.com/god13emad/chatgptremotecommander.git';
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const within=(p,root)=>same(p,root)||same(p.slice(0,root.length+1),root+path.sep);
const git=(where,...args)=>execFileSync('git',['-C',where,...args],{encoding:'utf8',timeout:12000,stdio:['ignore','pipe','pipe']}).trim();
const parse=(filename)=>JSON.parse(fs.readFileSync(filename,'utf8'));
function hasLinks(root){
  const dirs=[root];let count=0;
  while(dirs.length){
    const dir=dirs.pop();
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      count++;if(count>60000)throw new Error('UNBOUNDED_TREE');
      const full=path.join(dir,entry.name);
      if(entry.isSymbolicLink()||fs.lstatSync(full).isSymbolicLink())return true;
      if(entry.isDirectory())dirs.push(full);
    }
  }
  return false;
}
function ownedProcessReferences(candidate){
  if(process.platform!=='linux'||!Number.isInteger(process.getuid?.()))return [];
  const found=[];
  for(const name of fs.readdirSync('/proc')){
    if(!/^[0-9]+$/.test(name)||Number(name)===process.pid)continue;
    const dir='/proc/'+name;
    try{
      if(fs.statSync(dir).uid!==process.getuid())continue;
      const cwd=fs.realpathSync(dir+'/cwd');
      const cmd=fs.readFileSync(dir+'/cmdline').toString('utf8');
      if(within(cwd,candidate)||cmd.split('\0').some(s=>s&&within(path.resolve(s),candidate)))found.push(Number(name));
    }catch(error){
      if(error.code==='ENOENT'||error.code==='ESRCH'||error.code==='EACCES'||error.code==='EPERM')continue;
      throw error;
    }
  }
  return found;
}

export function inspectRetirement({stateRoot,releaseRoot,candidate,installDir,now=new Date()}){
  const reason=[];
  const defer=code=>{reason.push(code);return {status:'DEFER',reason:[...new Set(reason)],candidateName:path.basename(candidate??'')}} ;
  if(![stateRoot,releaseRoot,candidate,installDir].every(x=>typeof x==='string'&&path.isAbsolute(x)))return defer('ABSOLUTE_PATHS_REQUIRED');
  const name=path.basename(candidate);
  const m=NAME.exec(name);
  if(!m)return defer('UNKNOWN_FOLDER_NAME');
  let st,rr,target,install;
  try{
    st=fs.realpathSync(stateRoot);rr=fs.realpathSync(releaseRoot);target=fs.realpathSync(candidate);install=fs.realpathSync(installDir);
    if(!same(rr,fs.realpathSync(path.join(st,'releases'))))return defer('RELEASE_ROOT_NOT_AUTHORIZED');
    if(!same(path.dirname(target),rr)||!same(path.resolve(candidate),target))return defer('PATH_OUTSIDE_EXACT_RELEASE_ROOT');
    if(!fs.lstatSync(candidate).isDirectory()||fs.lstatSync(candidate).isSymbolicLink())return defer('CANDIDATE_NOT_PLAIN_DIRECTORY');
    if(hasLinks(candidate))return defer('LINK_OR_UNBOUNDED_RELEASE_CONTENT');
  }catch{return defer('UNVERIFIED_DIRECTORY_OR_LINK');}
  let candidateHead,activeHead;
  try{
    candidateHead=git(target,'rev-parse','HEAD').toLowerCase();
    activeHead=git(install,'rev-parse','HEAD').toLowerCase();
    if(!HEAD.test(candidateHead)||!HEAD.test(activeHead)||candidateHead.slice(0,12)!==m[2])return defer('RELEASE_COMMIT_NAME_MISMATCH');
    if(candidateHead===activeHead)return defer('CANDIDATE_EQUALS_ACTIVE_HEAD');
    const origin=git(target,'remote','get-url','origin').toLowerCase().replace(/\/$/,'');
    if(origin!==ORIGIN&&origin!==ORIGIN.replace(/\.git$/,''))return defer('UNKNOWN_GIT_ORIGIN');
    if(git(target,'status','--porcelain=v1','--untracked-files=all'))return defer('RELEASE_TREE_HAS_LOCAL_DATA_OR_CHANGES');
    // Git status hides ignored files; user/runtime data must not be invisible to a deletion gate.
    if(git(target,'ls-files','--others','--ignored','--exclude-standard'))return defer('RELEASE_HAS_IGNORED_OR_RUNTIME_DATA');
    const pkg=parse(path.join(target,'package.json'));
    if(pkg?.version!==m[1])return defer('PACKAGE_VERSION_MISMATCH');
  }catch{return defer('GIT_IDENTITY_OR_WORKTREE_UNVERIFIED');}
  try{
    const routeDir=path.join(st,'routing');
    const routes=fs.readdirSync(routeDir).filter(n=>n.endsWith('.json')&&!n.endsWith('.runtime.json'));
    if(routes.length===0)return defer('NO_VERIFIED_ACTIVE_ROUTES');
    const refers=p=>typeof p==='string'&&p.length>0&&within(path.resolve(p),target);
    for(const filename of routes){
      const f=path.join(routeDir,filename);
      if(!fs.lstatSync(f).isFile()||fs.lstatSync(f).isSymbolicLink())return defer('UNVERIFIED_ROUTE_FILE');
      const route=parse(f);
      if(route?.schema!==1||!route.active||typeof route.active.projectDir!=='string')return defer('INVALID_ACTIVE_ROUTE_STATE');
      if(refers(route.active.projectDir)||refers(route.previous?.projectDir))return defer('REFERENCED_BY_CURRENT_OR_PREVIOUS_ROUTE');
    }
    const retained=path.join(st,'retained-backends.json');
    if(fs.existsSync(retained)){
      if(fs.lstatSync(retained).isSymbolicLink())return defer('UNVERIFIED_RETAINED_BACKEND_FILE');
      const doc=parse(retained);
      if(!Array.isArray(doc?.items))return defer('INVALID_RETAINED_BACKEND_RECORD');
      if(doc.items.some(item=>refers(item?.projectDir)))return defer('REFERENCED_BY_RETAINED_BACKEND');
    }
  }catch{return defer('ROUTE_OR_RETAINED_EVIDENCE_UNVERIFIED');}
  try{
    const refs=ownedProcessReferences(target);
    if(refs.length)return defer('CURRENT_USER_PROCESS_OWNS_RELEASE');
  }catch{return defer('PROCESS_OWNERSHIP_UNVERIFIED');}
  const approve=path.join(st,'maintenance','release-retirement',name+'.json');
  try{
    if(!fs.existsSync(approve))return defer('POST_ACCEPTANCE_APPROVAL_MISSING');
    if(!fs.lstatSync(approve).isFile()||fs.lstatSync(approve).isSymbolicLink())return defer('RETIREMENT_APPROVAL_NOT_PLAIN_FILE');
    const a=parse(approve);
    if(a?.schema!==1||a.kind!=='CORE_RETIREMENT_ACCEPTED'
      ||a.candidateHead!==candidateHead||a.activeHead!==activeHead||a.candidateName!==name
      ||a.ownerUser!==os.userInfo().username
      ||a.rollbackVerified!==true||a.browserLoginPreserved!==true||a.soakAccepted!==true
      ||a.explicitRetirementAccepted!==true)return defer('APPROVAL_CONTRACT_OR_COMMIT_MISMATCH');
    const approved=Date.parse(a.acceptedUtc),expires=Date.parse(a.expiresUtc),clock=+new Date(now);
    if(!Number.isFinite(approved)||!Number.isFinite(expires)||!Number.isFinite(clock)
      ||approved>clock||expires<clock||expires-approved>7*86400000)return defer('STALE_OR_INVALID_APPROVAL_WINDOW');
  }catch{return defer('RETIREMENT_APPROVAL_UNVERIFIED');}
  return {status:'ALLOW',reason:[],candidateName:name,candidateHead,activeHead,retiredAfterAcceptance:true};
}

function args(argv){
  const got={};for(let i=0;i<argv.length;i+=2){
    if(!['--state-root','--release-root','--candidate','--install-dir'].includes(argv[i])||!argv[i+1])throw new Error('INVALID_ARGUMENT');
    got[argv[i].slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=argv[i+1];
  }
  return got;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  let result;
  try{result=inspectRetirement(args(process.argv.slice(2)));}
  catch{result={status:'DEFER',reason:['R205_GUARD_INTERNAL_ERROR']};}
  console.log(JSON.stringify(result));
  process.exit(result.status==='ALLOW'?0:3);
}
