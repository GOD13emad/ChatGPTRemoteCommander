#!/usr/bin/env node
// Pinned owner-local Agent Extension installer/upgrader. Never modifies active V1 processes or MCP catalog.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateAgentExtensionManifest} from '../src/agent-extensions.mjs';
const CURRENT={agent:'d94c646466037e29ddf3eafc2ecb683c882e529ec55d8012b21b092fe80cd1e4',
 skill:'247bac3be54f1835682e213ea82dd1f80da4669f901150e229bdc7ae1d4ab51f'};
const OLD={agent:'3b0b3f522dd6ce04f505bad1e1f971d9b1420e45e57196c1c55edc24b4fe7593',
 skill:'74918cd9768e39d3c451351cbd7a76bfb0e53d91abc13172a29ca0afdc8b2a10'};
const NAME='commander-capability-gaps';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fail(s){throw Error('COMMANDER_GAP_EXTENSION_'+s);}
function noLinkAncestors(p){
 let cur=path.parse(p).root;
 for(const segment of path.resolve(p).slice(cur.length).split(path.sep).filter(Boolean)){
  cur=path.join(cur,segment);
  if(fs.existsSync(cur)&&fs.lstatSync(cur).isSymbolicLink())fail('SYMLINK_PATH_DENIED');
 }
}
function regular(file,expected){
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||sha(fs.readFileSync(file))!==expected)fail('SOURCE_HASH_CHANGED');
 return fs.readFileSync(file);
}
function checkDir(p){
 const st=fs.lstatSync(p);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o022)!==0)fail('UNSAFE_EXTENSION_ROOT');
}
function checkInstalled(dir){
 const st=fs.lstatSync(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid())fail('EXISTING_EXTENSION_CONFLICT');
 if(fs.readdirSync(dir).sort().join(',')!=='SKILL.md,agent.json')fail('EXISTING_EXTENSION_CONFLICT');
 const files=['agent.json','SKILL.md'].map(name=>{
  const p=path.join(dir,name),s=fs.lstatSync(p);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)fail('EXISTING_EXTENSION_CONFLICT');
  return sha(fs.readFileSync(p));
 });
 if(files[0]===CURRENT.agent&&files[1]===CURRENT.skill)return 'current';
 if(files[0]===OLD.agent&&files[1]===OLD.skill)return 'old';
 fail('EXISTING_EXTENSION_CONFLICT');
}
function writeStage(parent,manifest,skill){
 const tmp=fs.mkdtempSync(path.join(parent,'.capgap-stage-'));
 try{
  fs.chmodSync(tmp,0o700);
  fs.writeFileSync(path.join(tmp,'agent.json'),manifest,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(tmp,'SKILL.md'),skill,{flag:'wx',mode:0o600});
  const r=validateAgentExtensionManifest(JSON.parse(fs.readFileSync(path.join(tmp,'agent.json'),'utf8')),tmp);
  if(!r.valid||checkInstalled(tmp)!=='current')fail('STAGED_MANIFEST_INVALID');
  return tmp;
 }catch(e){fs.rmSync(tmp,{recursive:true,force:true});throw e;}
}
export function installCapabilityGapExtension({action='status'}={}){
 if(!['status','install','upgrade'].includes(action))fail('INVALID_ACTION');
 if(process.platform!=='linux')fail('LINUX_USER_LOCAL_ONLY');
 const parent=path.join(os.homedir(),'.agents');
 const root=path.join(parent,'extensions');
 const dest=path.join(root,NAME);
 const src=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','extensions',NAME);
 noLinkAncestors(src);noLinkAncestors(root);checkDir(parent);checkDir(root);
 const manifest=regular(path.join(src,'agent.json'),CURRENT.agent);
 const skill=regular(path.join(src,'SKILL.md'),CURRENT.skill);
 const validation=validateAgentExtensionManifest(JSON.parse(manifest.toString('utf8')),src);
 if(!validation.valid)fail('SOURCE_MANIFEST_INVALID');
 const existing=fs.existsSync(dest)?checkInstalled(dest):null;
 if(existing==='current')return {status:'EXACT_EXTENSION_ALREADY_INSTALLED',changed:false,extensionId:NAME,
  manifestSHA256:CURRENT.agent,skillSHA256:CURRENT.skill,mcpMethodsInstalled:false};
 if(existing==='old'&&action==='status')return {status:'UPGRADE_AVAILABLE',changed:false,
  from:'0.1.0',to:'0.2.0',mcpMethodsInstalled:false};
 if(!existing&&action==='status')return {status:'NOT_INSTALLED',changed:false,mcpMethodsInstalled:false};
 if(existing==='old'&&action!=='upgrade')fail('EXPLICIT_UPGRADE_REQUIRED');
 if(!existing&&action!=='install')fail('EXISTING_EXTENSION_REQUIRED');
 const stage=writeStage(parent,manifest,skill);
 let consumed=false;
 try{
  if(!existing){
   if(fs.existsSync(dest))fail('DESTINATION_RACE');
   fs.renameSync(stage,dest);consumed=true;
  }else{
   const backupRoot=path.join(parent,'capgap-recovery');
   noLinkAncestors(backupRoot);
   if(!fs.existsSync(backupRoot))fs.mkdirSync(backupRoot,{mode:0o700});
   checkDir(backupRoot);
   const backup=path.join(backupRoot,NAME+'-v0.1.0');
   if(fs.existsSync(backup))fail('ROLLBACK_SLOT_OCCUPIED');
   if(checkInstalled(dest)!=='old')fail('CONCURRENT_DESTINATION_CHANGE');
   fs.renameSync(dest,backup);
   try{fs.renameSync(stage,dest);consumed=true;}
   catch(error){
    if(!fs.existsSync(dest)&&fs.existsSync(backup))fs.renameSync(backup,dest);
    throw error;
   }
  }
  if(checkInstalled(dest)!=='current')fail('READBACK_MISMATCH');
  return {status:existing?'DECLARATIVE_EXTENSION_UPGRADED':'DECLARATIVE_EXTENSION_INSTALLED',
    changed:true,extensionId:NAME,manifestSHA256:CURRENT.agent,skillSHA256:CURRENT.skill,
    ownerProfileScope:'user-local-discovery-only',mcpMethodsInstalled:false};
 }finally{if(!consumed&&fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const action={'--status':'status','--install':'install','--upgrade':'upgrade'}[process.argv[2]];
  if(!action)fail('COMMAND_REQUIRED');
  console.log(JSON.stringify(installCapabilityGapExtension({action})));
 }catch(e){console.error(String(e?.message||e));process.exitCode=2;}
}
