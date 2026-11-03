// Signed? NO. Internal V2 QA-only deterministic close-race overlay for embedded R18.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const oldManifest='482d922e31f2a6caf71b9c7829fab58affe473c59237b432884d5c186db7631b';
const oldServer='65ced3f54f65e1d12a87387368be318068efd7f9f5b8321b8bfe94a092fb7f2c';
const newServer='95ea301d60763875e246a47566d06e856bb4d0a64763d2c7612845093705fb6b';
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=msg=>{throw Error('V2_COS_EMBEDDED_SHUTDOWN_'+msg);};
export function applyCloseRaceGuard(bundle,source) {
 if(typeof bundle!=='string'||!path.isAbsolute(bundle)||typeof source!=='string'||!path.isAbsolute(source))fail('PATHS_INVALID');
 const dest=path.resolve(bundle),fixed=path.resolve(source);
 for(const p of [dest, path.dirname(fixed)]){
  if(!fs.existsSync(p)||fs.lstatSync(p).isSymbolicLink()||!fs.lstatSync(p).isDirectory())fail('ROOT_INVALID');
 }
 const manifestFile=path.join(dest,'MANIFEST.json'),serverFile=path.join(dest,'server.mjs');
 for(const p of [manifestFile,serverFile,fixed]){
  if(!fs.existsSync(p)||fs.lstatSync(p).isSymbolicLink()||!fs.lstatSync(p).isFile())fail('INPUT_INVALID');
 }
 const originalManifest=fs.readFileSync(manifestFile),originalServer=fs.readFileSync(serverFile),fixedServer=fs.readFileSync(fixed);
 if(digest(fixedServer)!==newServer)fail('PATCHED_SOURCE_HASH_NOT_PINNED');
 let parsed=JSON.parse(originalManifest.toString('utf8'));
 if(digest(originalServer)===newServer && parsed.qaOverlay==='V2_ELECTRON_CLOSE_RACE_GUARD'){
  const entry=parsed.files.find(f=>f.path==='server.mjs');
  if(entry?.sha256!==newServer||parsed.files.length!==21)fail('ALREADY_PATCHED_MANIFEST_CONFLICT');
  return {status:'ALREADY_SHUTDOWN_GUARDED',manifestSHA256:digest(originalManifest),serverSHA256:newServer};
 }
 if(digest(originalManifest)!==oldManifest||digest(originalServer)!==oldServer)fail('UNEXPECTED_BUNDLE_BASELINE');
 if(parsed.mode!=='LOCAL_GUI_PREVIEW_NO_PROMOTION'||parsed.schema!==1||parsed.files.length!==21)fail('MODE_OR_SCHEMA_INVALID');
 for(const entry of parsed.files){
  const fp=path.join(dest,entry.path);
  if(!/^[a-zA-Z0-9][\w.-]+$/.test(entry.path)||!fs.existsSync(fp)||fs.lstatSync(fp).isSymbolicLink())fail('MANIFEST_FILE_MISSING');
  const bytes=fs.readFileSync(fp);
  if(bytes.length!==entry.bytes||digest(bytes)!==entry.sha256)fail('MANIFEST_PRECONDITION_CHANGED');
 }
 const serverEntry=parsed.files.find(f=>f.path==='server.mjs');
 if(!serverEntry)fail('SERVER_MANIFEST_MISSING');
 serverEntry.sha256=newServer;
 serverEntry.bytes=fixedServer.length;
 parsed.qaOverlay='V2_ELECTRON_CLOSE_RACE_GUARD';
 const newManifest=Buffer.from(JSON.stringify(parsed,null,2)+'\n');
 const tempServer=serverFile+'.qa-stage-'+process.pid,tempManifest=manifestFile+'.qa-stage-'+process.pid;
 if(fs.existsSync(tempServer)||fs.existsSync(tempManifest))fail('TEMP_EXISTS');
 let serverChanged=false,manifestChanged=false;
 try{
  fs.writeFileSync(tempServer,fixedServer,{flag:'wx'});
  fs.writeFileSync(tempManifest,newManifest,{flag:'wx'});
  if(digest(fs.readFileSync(manifestFile))!==oldManifest||digest(fs.readFileSync(serverFile))!==oldServer)fail('CONCURRENT_SOURCE_CHANGED');
  fs.renameSync(tempServer,serverFile);serverChanged=true;
  fs.renameSync(tempManifest,manifestFile);manifestChanged=true;
  return {status:'EMBEDDED_R18_CLOSE_RACE_GUARDED_QA',manifestSHA256:digest(newManifest),serverSHA256:newServer,files:21};
 }catch(e){
  if(manifestChanged)fs.writeFileSync(manifestFile,originalManifest);
  if(serverChanged)fs.writeFileSync(serverFile,originalServer);
  throw e;
 }finally{
  for(const p of [tempServer,tempManifest])try{fs.rmSync(p,{force:true});}catch{}
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(JSON.stringify(applyCloseRaceGuard(process.argv[2],process.argv[3]))+'\n');}
 catch(e){process.stderr.write(String(e?.message||e)+'\n');process.exitCode=2;}
}
