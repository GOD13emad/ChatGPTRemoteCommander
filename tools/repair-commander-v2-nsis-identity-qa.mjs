#!/usr/bin/env node
// Guarded, single-use repair for Windows shortcut/uninstaller/ACL labels of QA Commander V2 only.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex'),bad=k=>{throw Error('COMMANDER_V2_NSIS_ID_QA_'+k)};
const YAML={linux:'4fe769085de49247ae62ad8c8cc83b9b97a697aea689bb07ba481cf7289e5a62',win32:'70b7de6ca385091c1493b7ae0cb84bf308b188d8b88eda8acb0c8dfa516833c4'};
const ACL='c61c5fc9c9f1ea85851173f127fb58641b3c86cc0ebe5eb72368efd2110a72a9';
function read(f){const s=fs.lstatSync(f);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)bad('NONREGULAR_FILE');return fs.readFileSync(f)}
function twice(s,a,b){if(s.split(a).length!==2)bad('ANCHOR_CHANGED');return s.replace(a,b)}
export function repair(root){
 if(typeof root!=='string'||!path.isAbsolute(root)||!Object.hasOwn(YAML,process.platform))bad('OS');
 const p=path.resolve(root),expected=process.platform==='linux'?'cos2150-unified-rebuild-20261104':'official-cos-tag2150-sparse-20261104';
 if(path.basename(p)!==expected||read(path.join(p,'.commander-v2-isolated-qa')).toString()!=='V2_COS_DISPOSABLE_SOURCE_QA_ONLY\n')bad('NOT_APPROVED_QA');
 const y=path.join(p,'electron-builder.yml'),acl=path.join(p,'scripts','windows-installer-acl.nsh');
 const mf=path.join(p,'.commander-v2-brand-backup','MANIFEST.json');
 const backup=path.join(p,'.commander-v2-brand-backup','scripts','windows-installer-acl.nsh');
 const before=read(y),beforeAcl=read(acl),beforeMf=read(mf),state=JSON.parse(beforeMf);
 if(sha(before)!==YAML[process.platform]||sha(beforeAcl)!==ACL||state.files?.['electron-builder.yml']!==sha(before)||
    Object.hasOwn(state.files,'scripts/windows-installer-acl.nsh')||
    state.name!=='Commander V2'||state.appId!=='io.github.god13emad.commanderv2')bad('SOURCE_CHANGED');
 if(fs.existsSync(backup))bad('BACKUP_EXISTS');
 let s=before.toString('utf8'),a=beforeAcl.toString('utf8');
 s=twice(s,'  shortcutName: Chat On Steroids','  shortcutName: Commander V2');
 s=twice(s,'  uninstallDisplayName: Chat On Steroids','  uninstallDisplayName: Commander V2');
 const occurrences=a.split('Chat On Steroids').length-1;
 if(occurrences!==4)bad('INSTALLER_ACL_LABEL_COUNT');
 a=a.replaceAll('Chat On Steroids','Commander V2');
 const next=Buffer.from(s),nextAcl=Buffer.from(a);
 state.files['electron-builder.yml']=sha(next);
 state.files['scripts/windows-installer-acl.nsh']=sha(nextAcl);
 state.nsisIdentityCorrected=true;
 const stateNext=Buffer.from(JSON.stringify(state,null,2)+'\n');
 fs.mkdirSync(path.dirname(backup),{recursive:true,mode:0o700});
 fs.writeFileSync(backup,beforeAcl,{flag:'wx',mode:0o600});
 try{
  if(sha(read(y))!==sha(before)||sha(read(acl))!==ACL||sha(read(mf))!==sha(beforeMf))bad('CONCURRENT_WRITER');
  fs.writeFileSync(y,next);fs.writeFileSync(acl,nextAcl);fs.writeFileSync(mf,stateNext);
  if(sha(read(y))!==sha(next)||sha(read(acl))!==sha(nextAcl)||sha(read(mf))!==sha(stateNext))bad('READBACK');
 }catch(e){
  if(sha(read(y))===sha(next))fs.writeFileSync(y,before);
  if(sha(read(acl))===sha(nextAcl))fs.writeFileSync(acl,beforeAcl);
  if(sha(read(mf))===sha(stateNext))fs.writeFileSync(mf,beforeMf);
  throw e;
 }
 return {gate:'COMMANDER_V2_NSIS_LABELS_SOURCE_QA_PASS',platform:process.platform,shortcut:'Commander V2',uninstallDisplayName:'Commander V2',
  windowsAclMessage:'Commander V2',installerBuilt:false,installed:false,yamlSha:sha(next),aclSha:sha(nextAcl)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(repair(process.argv[2])))}catch(e){console.error(String(e.message||e));process.exitCode=2;}
}
