// V2 owner-local no-OAuth proposal lane. MCP may enqueue one bounded proposal,
// but ONLY a separate same-UID interactive owner console may approve its effect.
// This is NOT ChatGPT-user attestation or consent for arbitrary host operations.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';

const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_AGE=10*60*1000, MAX_REQUESTS=32, MAX_LIVE=4;
const error=code=>Object.assign(new Error(code),{code});
const sha=data=>createHash('sha256').update(data).digest('hex');
const own=(f)=>{const s=fs.lstatSync(f);if(s.isSymbolicLink()||!s.isDirectory()||
  s.uid!==process.getuid()||(s.mode&0o077)!==0)throw error('V2_APPROVAL_ROOT_UNTRUSTED');};
function ensureDir(dir) {
  if(!path.isAbsolute(dir))throw error('V2_APPROVAL_ROOT_INVALID');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  own(dir);
}
function readRecord(file) {
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try {
    const s=fs.fstatSync(fd);
    if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid()||
        (s.mode&0o077)!==0||s.size>4096||s.size<20)throw error('V2_APPROVAL_RECORD_UNTRUSTED');
    return JSON.parse(fs.readFileSync(fd,'utf8'));
  }finally{fs.closeSync(fd);}
}
function writeExclusive(file,body) {
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,body,'utf8');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  const dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
  try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function validateText(title,text) {
  if(typeof title!=='string'||title.length<1||title.length>64||
     /[\p{C}]/u.test(title))throw error('V2_APPROVAL_TITLE_INVALID');
  if(typeof text!=='string'||text.length<1||text.length>512||
     /[\r\u0000-\u0009\u000b-\u001f\u007f\p{Cf}]/u.test(text))
     throw error('V2_APPROVAL_TEXT_INVALID');
}
export function createV2OwnerApprovalQueue({
 root=path.join(os.homedir(),'.local','state','CommanderV2','owner-approvals'),
 now=Date.now
}={}) {
 if(typeof now!=='function'||typeof process.getuid!=='function'||process.getuid()===0)
   throw error('V2_APPROVAL_OWNER_USER_REQUIRED');
 // The route is a dedicated V2 owner directory. No caller-provided paths.
 ensureDir(root);
 const pending=path.join(root,'pending'),receipts=path.join(root,'receipts'),
  notes=path.join(root,'notes');
 for(const dir of [pending,receipts,notes])ensureDir(dir);
 function paths(id) {
   if(!ID.test(id))throw error('V2_APPROVAL_ID_INVALID');
   return {request:path.join(pending,id+'.json'),receipt:path.join(receipts,id+'.json'),
     note:path.join(notes,id+'.json')};
 }
 function checkedRequest(id) {
   const p=paths(id);const r=readRecord(p.request);
   if(r.schema!==1||r.id!==id||r.action!=='create_note'||
      !Number.isSafeInteger(r.createdAtMs)||typeof r.title!=='string'||
      typeof r.text!=='string'||typeof r.sha256!=='string')throw error('V2_APPROVAL_RECORD_INVALID');
   validateText(r.title,r.text);
   if(sha(JSON.stringify([r.id,r.title,r.text,r.createdAtMs]))!==r.sha256)
     throw error('V2_APPROVAL_RECORD_CHANGED');
   return {p,r};
 }
 function allPending() {
   const files=fs.readdirSync(pending);
   if(files.length>MAX_REQUESTS)throw error('V2_APPROVAL_QUEUE_CAPACITY');
   if(files.some(f=>!ID.test(f.slice(0,-5))||!f.endsWith('.json')))
     throw error('V2_APPROVAL_QUEUE_UNTRUSTED');
   return files;
 }
 function proposeNote({title,text}={}) {
   validateText(title,text);
   const files=allPending(),time=now();
   if(!Number.isSafeInteger(time))throw error('V2_APPROVAL_CLOCK_INVALID');
   const live=files.filter(file=>{
     const id=file.slice(0,-5),{p,r}=checkedRequest(id);
     return !fs.existsSync(p.receipt)&&time>=r.createdAtMs&&time-r.createdAtMs<MAX_AGE;
   });
   if(files.length>=MAX_REQUESTS||live.length>=MAX_LIVE)
     throw error('V2_APPROVAL_QUEUE_FULL');
   const id=randomUUID(),createdAtMs=time;
   const record={schema:1,id,action:'create_note',title,text,createdAtMs,
     sha256:sha(JSON.stringify([id,title,text,createdAtMs]))};
   writeExclusive(paths(id).request,JSON.stringify(record)+'\n');
   return Object.freeze({requestId:id,status:'PENDING_OWNER_CONSOLE_APPROVAL',
     expiresAtMs:time+MAX_AGE, effectExecuted:false});
 }
 function inspect(id) {
   const {p,r}=checkedRequest(id);
   const receipt=fs.existsSync(p.receipt)?readRecord(p.receipt):null;
   return Object.freeze({...r,status:receipt?.status??'PENDING',
     expired:now()-r.createdAtMs>=MAX_AGE});
 }
 function approve(id) {
   const {p,r}=checkedRequest(id),time=now();
   if(fs.existsSync(p.receipt))return Object.freeze({requestId:id,status:readRecord(p.receipt).status,alreadyDone:true});
   if(!Number.isSafeInteger(time)||time<r.createdAtMs||time-r.createdAtMs>=MAX_AGE)
     throw error('V2_APPROVAL_EXPIRED');
   const note=JSON.stringify({schema:1,requestId:id,title:r.title,text:r.text,createdAtMs:r.createdAtMs})+'\n';
   if(fs.existsSync(p.note)) {
     // Reconcile only an exact previous effect; never overwrite or replay.
     const fd=fs.openSync(p.note,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
     let existing;
     try{existing=fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
     if(existing!==note)throw error('V2_APPROVAL_EFFECT_CONFLICT');
   }else writeExclusive(p.note,note);
   const receipt=JSON.stringify({schema:1,requestId:id,status:'APPROVED_AND_NOTE_CREATED',noteSha256:sha(note)})+'\n';
   try{writeExclusive(p.receipt,receipt);}catch(e){
     if(e.code!=='EEXIST'||fs.readFileSync(p.receipt,'utf8')!==receipt)throw e;
   }
   return Object.freeze({requestId:id,status:'APPROVED_AND_NOTE_CREATED',alreadyDone:false,noteSha256:sha(note)});
 }
 return Object.freeze({proposeNote,inspect,approve,
   list:()=>allPending().map(f=>inspect(f.slice(0,-5)))});
}
