// Commander V2 MMZ owner-reviewed V1-parity bridge.
// The remote/noauth side may enumerate PUBLIC TOOL NAMES and QUEUE an exact
// request only. Effect execution is restricted to separate native owner CLI.
// No call to V1 from a remote MCP tool is provided by this module.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';

const RX=/^[a-z][a-z0-9_]{0,79}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_B=8192, MAX_FILES=64, MAX_LIVE=8, TTL=600000;
const fail=c=>{throw Object.assign(new Error(c),{code:c});};
const hash=s=>createHash('sha256').update(s).digest('hex');
const isRecord=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
function validateValue(v,d=0){
 if(d>12)fail('V2_BRIDGE_ARGUMENTS_DEPTH');
 if(v===null||typeof v==='boolean')return;
 if(typeof v==='string'){
  if(v.length>4096||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(v))
   fail('V2_BRIDGE_ARGUMENTS_TEXT');
  return;
 }
 if(typeof v==='number'){if(!Number.isFinite(v))fail('V2_BRIDGE_ARGUMENTS_NUMBER');return;}
 if(Array.isArray(v)){
  if(v.length>100)fail('V2_BRIDGE_ARGUMENTS_LIST');
  v.forEach(x=>validateValue(x,d+1));return;
 }
 if(!isRecord(v)||Object.keys(v).length>100)fail('V2_BRIDGE_ARGUMENTS_INVALID');
 for(const [k,val] of Object.entries(v)){
  if(!/^[A-Za-z_$][A-Za-z0-9_$-]{0,100}$/.test(k)||
     ['__proto__','constructor','prototype'].includes(k))fail('V2_BRIDGE_ARGUMENTS_KEYS');
  validateValue(val,d+1);
 }
}
function ensure(dir){
 const parts=[];let cur=path.parse(dir).root;
 for(const part of dir.slice(cur.length).split(path.sep).filter(Boolean)){
  cur=path.join(cur,part);parts.push(cur);
 }
 for(const p of parts){
  if(fs.existsSync(p)){
   const st=fs.lstatSync(p);
   if(st.isSymbolicLink()||!st.isDirectory())fail('V2_BRIDGE_UNTRUSTED_PATH');
  }else fs.mkdirSync(p,{mode:0o700});
 }
 for(const p of [dir]){
  const st=fs.lstatSync(p);
  if(st.uid!==process.getuid()||(st.mode&0o077)!==0)fail('V2_BRIDGE_UNTRUSTED_OWNER');
 }
}
function read(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try {
  const st=fs.fstatSync(fd);
  if(st.uid!==process.getuid()||st.nlink!==1||!st.isFile()||st.size>MAX_B+512||
     (st.mode&0o077)!==0)fail('V2_BRIDGE_UNTRUSTED_FILE');
  return JSON.parse(fs.readFileSync(fd,'utf8'));
 }finally{fs.closeSync(fd)}
}
function write(file,obj){
 const data=JSON.stringify(obj)+'\n';
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|
   fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,data);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
 const dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
 try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}
}
export const V2_V1_BRIDGE_TOOLS=Object.freeze([
 Object.freeze({
  name:'v2_v1_tool_catalog',title:'V2 V1 Capability Catalog',
  description:'Read V1 available tool names and counts, without invoking any tool or accessing user data.',
  inputSchema:{type:'object',properties:{},additionalProperties:false},
  annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
  securitySchemes:[{type:'noauth'}]
 }),
 Object.freeze({
  name:'v2_request_owner_tool',title:'V2 Request V1-Equivalent Tool With Owner Review',
  description:'Queue a named V1-equivalent tool and exact arguments for independent local owner approval. Does NOT execute, grant access, or return private data.',
  inputSchema:{type:'object',properties:{
   tool:{type:'string',minLength:1,maxLength:80},
   arguments:{type:'object',additionalProperties:true}
  },required:['tool','arguments'],additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
  securitySchemes:[{type:'noauth'}]
 })
]);
export function createV2V1ToolBridge({
 root=path.join(os.homedir(),'.local','state','CommanderV2','v1-tool-review'),
 now=Date.now,loadCatalog
}={}){
 if(typeof process.getuid!=='function'||process.getuid()===0||typeof now!=='function'||
    typeof loadCatalog!=='function')fail('V2_BRIDGE_OWNER_RUNTIME_REQUIRED');
 if(!path.isAbsolute(root))fail('V2_BRIDGE_ROOT_ABSOLUTE_REQUIRED');
 ensure(root);
 for(const sub of ['requests','receipts'])ensure(path.join(root,sub));
 const reqDir=path.join(root,'requests'), recDir=path.join(root,'receipts');
 function paths(id){
  if(!UUID.test(id))fail('V2_BRIDGE_REQUEST_ID_INVALID');
  return {request:path.join(reqDir,id+'.json'),receipt:path.join(recDir,id+'.json')};
 }
 function scan(){
  const files=fs.readdirSync(reqDir);
  if(files.length>MAX_FILES||files.some(x=>!x.endsWith('.json')||!UUID.test(x.slice(0,-5))))
    fail('V2_BRIDGE_QUEUE_UNTRUSTED');
  return files;
 }
 function inspect(id){
  const p=paths(id),r=read(p.request),payload=JSON.stringify([r.id,r.tool,r.arguments,r.createdAtMs]);
  if(r.schema!==1||r.id!==id||!RX.test(r.tool)||!isRecord(r.arguments)||
     !Number.isSafeInteger(r.createdAtMs)||r.digest!==hash(payload))fail('V2_BRIDGE_REQUEST_CHANGED');
  validateValue(r.arguments);
  const receipt=fs.existsSync(p.receipt)?read(p.receipt):null;
  return Object.freeze({...r,status:receipt?.status??'PENDING',
   expired:now()<r.createdAtMs||now()-r.createdAtMs>=TTL});
 }
 async function catalog(){
  const list=await loadCatalog();
  if(!Array.isArray(list)||list.length<1||list.length>256||
     list.some(t=>typeof t!=='string'||!RX.test(t))||
     new Set(list).size!==list.length)fail('V2_BRIDGE_CATALOG_UNAVAILABLE');
  return list;
 }
 async function request({tool,arguments:args}={}){
  if(!RX.test(tool??'')||!isRecord(args))fail('V2_BRIDGE_ARGUMENTS_INVALID');
  validateValue(args);
  const list=await catalog();
  if(!list.includes(tool))fail('V2_BRIDGE_TOOL_UNAVAILABLE');
  const files=scan(),time=now();
  if(!Number.isSafeInteger(time))fail('V2_BRIDGE_CLOCK_INVALID');
  const live=files.filter(f=>{const r=inspect(f.slice(0,-5));return r.status==='PENDING'&&!r.expired;});
  if(files.length>=MAX_FILES||live.length>=MAX_LIVE)fail('V2_BRIDGE_QUEUE_FULL');
  const id=randomUUID();
  const rec={schema:1,id,tool,arguments:structuredClone(args),createdAtMs:time};
  rec.digest=hash(JSON.stringify([id,tool,rec.arguments,time]));
  if(Buffer.byteLength(JSON.stringify(rec))>MAX_B)fail('V2_BRIDGE_ARGUMENTS_TOO_LARGE');
  write(paths(id).request,rec);
  return Object.freeze({requestId:id,status:'WAITING_FOR_NATIVE_OWNER_REVIEW',
   expiresAtMs:time+TTL,executed:false});
 }
 return Object.freeze({catalog,request,inspect,
   list:()=>scan().map(x=>inspect(x.slice(0,-5))),
   // Native-only receipt write is intentionally not exposed on this interface.
   receiptPath:id=>paths(id).receipt});
}
