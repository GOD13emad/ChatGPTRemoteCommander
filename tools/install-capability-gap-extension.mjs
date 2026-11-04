#!/usr/bin/env node
// User-local declarative extension only; does not modify an installed Commander runtime.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateAgentExtensionManifest} from '../src/agent-extensions.mjs';
const MANIFEST_SHA='3b0b3f522dd6ce04f505bad1e1f971d9b1420e45e57196c1c55edc24b4fe7593';
const SKILL_SHA='74918cd9768e39d3c451351cbd7a76bfb0e53d91abc13172a29ca0afdc8b2a10';
const NAME='commander-capability-gaps';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=s=>{throw Error('COMMANDER_GAP_EXTENSION_'+s)};
function noLinkAncestors(p){
 let cur=path.parse(p).root;
 for(const segment of path.resolve(p).slice(cur.length).split(path.sep).filter(Boolean)){
  cur=path.join(cur,segment);
  if(fs.existsSync(cur)&&fs.lstatSync(cur).isSymbolicLink())fail('SYMLINK_PATH_DENIED');
 }
}
function checkedFile(p,expected){
 const st=fs.lstatSync(p);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||sha(fs.readFileSync(p))!==expected)fail('SOURCE_HASH_CHANGED');
 return fs.readFileSync(p);
}
function assertDestination(dest){
 const st=fs.lstatSync(dest);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o002)!==0)fail('UNSAFE_EXTENSION_ROOT');
}
export function installCapabilityGapExtension({action='status'}={}){
 if(!['status','install'].includes(action))fail('INVALID_ACTION');
 if(process.platform!=='linux')fail('LINUX_USER_LOCAL_ONLY');
 const root=path.join(os.homedir(),'.agents','extensions');
 const dest=path.join(root,NAME);
 const src=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','extensions',NAME);
 noLinkAncestors(root);noLinkAncestors(src);
 assertDestination(root);
 const manifest=checkedFile(path.join(src,'agent.json'),MANIFEST_SHA);
 const skill=checkedFile(path.join(src,'SKILL.md'),SKILL_SHA);
 const validation=validateAgentExtensionManifest(JSON.parse(manifest.toString('utf8')),src);
 if(!validation.valid)fail('SOURCE_MANIFEST_INVALID');
 if(fs.existsSync(dest)){
  const st=fs.lstatSync(dest);
  if(!st.isDirectory()||st.isSymbolicLink())fail('DESTINATION_TYPE_CONFLICT');
  const files=fs.readdirSync(dest).sort();
  if(files.join(',')!=='SKILL.md,agent.json')fail('EXISTING_EXTENSION_CONFLICT');
  if(sha(fs.readFileSync(path.join(dest,'agent.json')))!==MANIFEST_SHA||
     sha(fs.readFileSync(path.join(dest,'SKILL.md')))!==SKILL_SHA)fail('EXISTING_EXTENSION_CONFLICT');
  return {status:'EXACT_EXTENSION_ALREADY_INSTALLED',changed:false,extensionId:NAME,manifestSHA256:MANIFEST_SHA,skillSHA256:SKILL_SHA,ownerProfileScope:'user-local-discovery-only',mcpMethodsInstalled:false};
 }
 if(action==='status')return {status:'NOT_INSTALLED',changed:false,extensionId:NAME,ownerProfileScope:'user-local-discovery-only',mcpMethodsInstalled:false};
 const temp=fs.mkdtempSync(path.join(root,'.capgap-stage-'));
 let renamed=false;
 try{
  fs.chmodSync(temp,0o700);
  fs.writeFileSync(path.join(temp,'agent.json'),manifest,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(temp,'SKILL.md'),skill,{flag:'wx',mode:0o600});
  const v=validateAgentExtensionManifest(JSON.parse(fs.readFileSync(path.join(temp,'agent.json'),'utf8')),temp);
  if(!v.valid)fail('STAGED_MANIFEST_INVALID');
  if(fs.existsSync(dest))fail('DESTINATION_RACE');
  fs.renameSync(temp,dest);renamed=true;
  if(sha(fs.readFileSync(path.join(dest,'agent.json')))!==MANIFEST_SHA||
     sha(fs.readFileSync(path.join(dest,'SKILL.md')))!==SKILL_SHA)fail('READBACK_MISMATCH');
  return {status:'DECLARATIVE_EXTENSION_INSTALLED',changed:true,extensionId:NAME,manifestSHA256:MANIFEST_SHA,skillSHA256:SKILL_SHA,ownerProfileScope:'user-local-discovery-only',mcpMethodsInstalled:false};
 }finally{
  if(!renamed&&fs.existsSync(temp))fs.rmSync(temp,{recursive:true,force:true});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const action=process.argv[2]==='--install'?'install':process.argv[2]==='--status'?'status':null;
  if(!action)fail('COMMAND_REQUIRED');
  console.log(JSON.stringify(installCapabilityGapExtension({action})));
 }catch(e){console.error(String(e?.message||e));process.exitCode=2;}
}
