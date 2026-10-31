// Native owner-only exact-operation dispatcher for the V2-to-V1 pilot.
// Unlike noauth MCP it is NEVER imported into or invoked from the web server.
// A persisted non-retriable attempt precedes RPC; ambiguous outcomes stay
// UNCERTAIN and may NOT be blindly retried.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createV2V1ToolBridge} from './v2-v1-tool-bridge.mjs';

const error=code=>Object.assign(new Error(code),{code});
function exclusive(file,data){
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|
   fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(data)+'\n');fs.fsyncSync(fd)}
 finally{fs.closeSync(fd)}
 const dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
 try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}
}
export function createV2NativeOwnerExecutor({root,now=Date.now,loadCatalog,invokeTool,
  requireOwnerConfirmation}={}){
 if(typeof invokeTool!=='function'||typeof requireOwnerConfirmation!=='function')
  throw error('V2_OWNER_EXECUTOR_TRUSTED_CALLBACKS_REQUIRED');
 if(typeof process.getuid!=='function'||process.getuid()===0)
  throw error('V2_OWNER_EXECUTOR_USER_REQUIRED');
 const queue=createV2V1ToolBridge({root,now,loadCatalog});
 const base=root??path.join(os.homedir(),'.local','state','CommanderV2','v1-tool-review');
 const dir=path.join(base,'final');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const st=fs.lstatSync(dir);
 if(st.uid!==process.getuid()||!st.isDirectory()||st.isSymbolicLink()||
   (st.mode&0o077)!==0)throw error('V2_OWNER_FINAL_UNTRUSTED');
 return Object.freeze({
  async approve(id){
   const r=queue.inspect(id);
   if(r.expired||r.status!=='PENDING')throw error('V2_OWNER_NOT_PENDING');
   const list=await queue.catalog();
   if(!list.includes(r.tool))throw error('V2_OWNER_TOOL_REMOVED');
   const approved=await requireOwnerConfirmation(Object.freeze({
     requestId:id,tool:r.tool,arguments:structuredClone(r.arguments),
     createdAtMs:r.createdAtMs
   }));
   if(approved!==true)throw error('V2_OWNER_DENIED');
   // Repeat exact source and catalog check AFTER owner approval.
   const current=queue.inspect(id);
   if(current.expired||current.status!=='PENDING'||current.digest!==r.digest)
     throw error('V2_OWNER_REQUEST_CHANGED');
   if(!(await queue.catalog()).includes(current.tool))throw error('V2_OWNER_TOOL_REMOVED');
   const begin=queue.receiptPath(id);
   // Exists -> previous attempt is uncertain/completed, do not dispatch again.
   exclusive(begin,{schema:1,requestId:id,status:'DISPATCHING_UNCERTAIN',tool:r.tool});
   let outcome;
   try {
     const result=await invokeTool(r.tool,structuredClone(r.arguments));
     // Do not store tool return values; could contain secrets or private files.
     outcome={schema:1,requestId:id,
       status:result?.isError===true?'V1_TOOL_REPORTED_ERROR':'V1_CALL_RETURNED',
       resultReturned:true};
   } catch {
     outcome={schema:1,requestId:id,status:'DISPATCH_OUTCOME_UNCERTAIN',resultReturned:false};
   }
   try{exclusive(path.join(dir,id+'.json'),outcome)}
   catch{throw error('V2_OWNER_FINAL_RECORD_UNCERTAIN')}
   return Object.freeze({requestId:id,status:outcome.status,
     note:'Result is not exposed to anonymous MCP and may require separate native verification.'});
  },
  status(id){
   const r=queue.inspect(id),final=path.join(dir,id+'.json');
   let status=r.status;
   if(fs.existsSync(final)){
     const fd=fs.openSync(final,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
     try{
       const st=fs.fstatSync(fd);
       if(st.uid!==process.getuid()||!st.isFile()||st.nlink!==1||
         (st.mode&0o077)!==0||st.size>2048)throw error('V2_OWNER_FINAL_UNTRUSTED');
       const j=JSON.parse(fs.readFileSync(fd,'utf8'));
       if(j.requestId!==id||j.schema!==1)throw error('V2_OWNER_FINAL_UNTRUSTED');
       status=j.status;
     }finally{fs.closeSync(fd)}
   }
   return Object.freeze({requestId:id,status,tool:r.tool,expired:r.expired});
  }
 });
}
