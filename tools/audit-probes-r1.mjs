// Non-destructive audit: only owned temporary fixtures. Does not mutate source/live data.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
const sourceRoot=path.resolve(process.argv[2] ?? '.', 'src');
const {writeText}=await import(pathToFileURL(path.join(sourceRoot,'tools-v0.3.mjs')).href);
const {writeAnyFile}=await import(pathToFileURL(path.join(sourceRoot,'power-tools-v0.3.mjs')).href);
const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-audit-r1-')));
const ctx={roots:[root],auditLog:path.join(root,'audit.jsonl'),config:{maxWriteBytes:524288,powerMode:{enabled:true,fullFilesystem:false,backupRoot:path.join(root,'backups')}}};
const result={};
try{
 for(const [name,fn] of [['standard_write',writeText],['power_write',writeAnyFile]]){
  const file=path.join(root,name+'.txt');let accepted=false,rejection=null;try{await fn(ctx,{path:file,content:'owned fixture',expectedSha256:'a'.repeat(64)});accepted=true;}catch(e){rejection=e.message;}
  result[name]={missingTargetWithExpectedHashAccepted:accepted,fileCreated:fs.existsSync(file),rejection};
 }
 const src=sourceRoot,fault=path.join(root,'fault-src');fs.cpSync(src,fault,{recursive:true});
 const file=path.join(fault,'power-tools-v0.3.mjs'),old=fs.readFileSync(file,'utf8');
 const anchor='await rm(sourceNow, { recursive: true, force: true });';
 if(old.split(anchor).length!==2)throw Error('FAULT_ANCHOR');
 fs.writeFileSync(file,old.replace(anchor,"await rm(path.join(sourceNow, 'unique.txt')); throw Object.assign(new Error('INJECTED_PARTIAL_DELETE'), { code: 'EACCES' });"));
 const source=path.join(root,'source'),destination=path.join(root,'destination');fs.mkdirSync(source);fs.mkdirSync(destination);
 fs.writeFileSync(path.join(source,'unique.txt'),'only full original');fs.writeFileSync(path.join(source,'remaining.txt'),'remaining');fs.writeFileSync(path.join(destination,'old.txt'),'old destination');
 const {movePath}=await import(pathToFileURL(file).href);
 let error=false,message=null;try{await movePath(ctx,{source,destination,overwrite:true});}catch(e){error=true;message=e.message;}
 result.moveFaultInjection={errorReturned:error,message,uniqueInSource:fs.existsSync(path.join(source,'unique.txt')),uniqueInDestination:fs.existsSync(path.join(destination,'unique.txt')),oldDestinationRestored:fs.existsSync(path.join(destination,'old.txt')),scope:'synthetic partial-delete fault in copied module, not production filesystem failure'};
 console.log(JSON.stringify(result,null,2));
}finally{fs.rmSync(root,{recursive:true,force:true});}
