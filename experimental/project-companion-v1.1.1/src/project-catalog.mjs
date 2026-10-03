import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {types} from 'node:util';

export const HASH=/^[a-f0-9]{64}$/;
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
export const fail=(code)=>{throw Object.assign(new Error(code),{code});};
export const hash=(bytes)=>createHash('sha256').update(bytes).digest('hex');
export function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export const hashData=value=>hash(canonical(value));
// Same duplicate-decoded-key algorithm as the accepted strict-status-json
// reader, with revision-local bounds and no external runtime dependency.
export function parseStrictJson(value,maxBytes=1048576){
  let text;try{text=typeof value==='string'?value:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(value);}catch{fail('CATALOG_JSON');}
  if(!text.isWellFormed()||Buffer.byteLength(text)>maxBytes)fail('CATALOG_JSON_BOUND');
  const stack=[];let tokens=0;
  for(let i=0;i<text.length;i++){
    const c=text[i];if(/[ \r\n\t]/.test(c))continue;if(++tokens>100000)fail('CATALOG_JSON_BOUND');
    if(c==='{'||c==='['){stack.push({object:c==='{',members:new Set()});if(stack.length>32)fail('CATALOG_JSON_BOUND');}
    else if(c==='}'||c===']'){if(!stack.length)fail('CATALOG_JSON');stack.pop();}
    else if(c==='"'){const begin=i;let ended=false;for(i++;i<text.length;i++){if(text[i]==='\\'){i++;continue;}if(text[i]==='"'){ended=true;break;}}if(!ended)fail('CATALOG_JSON');let next=i+1;while(/[ \r\n\t]/.test(text[next]??'!'))next++;if(text[next]===':'&&stack.at(-1)?.object){let name;try{name=JSON.parse(text.slice(begin,i+1));}catch{fail('CATALOG_JSON');}if(!name.isWellFormed()||stack.at(-1).members.has(name))fail('CATALOG_JSON_DUPLICATE');stack.at(-1).members.add(name);}}
  }
  if(stack.length)fail('CATALOG_JSON');try{return JSON.parse(text);}catch{fail('CATALOG_JSON');}
}
export function data(value,{maxBytes=1048576,maxNodes=30000,maxDepth=16}={}){
  let nodes=0;const active=new Set();
  function copy(item,depth){
    if(++nodes>maxNodes||depth>maxDepth||types.isProxy(item))fail('CATALOG_DATA_BOUND');
    if(item===null||typeof item==='boolean')return item;
    if(typeof item==='string'){if(!item.isWellFormed())fail('CATALOG_UTF8');return item;}
    if(typeof item==='number'&&Number.isFinite(item))return item;
    if(!item||typeof item!=='object'||active.has(item))fail('CATALOG_DATA_TYPE');
    active.add(item);const props=Object.getOwnPropertyDescriptors(item);let result;
    if(Array.isArray(item)){
      if(Object.getPrototypeOf(item)!==Array.prototype||Reflect.ownKeys(props).length!==item.length+1)fail('CATALOG_ARRAY');
      result=Array.from({length:item.length},(_,n)=>{if(!Object.hasOwn(props,n)||!Object.hasOwn(props[n],'value')||!props[n].enumerable)fail('CATALOG_ARRAY');return copy(props[n].value,depth+1);});
    }else{
      if(![Object.prototype,null].includes(Object.getPrototypeOf(item)))fail('CATALOG_OBJECT');
      result={};for(const key of Reflect.ownKeys(props)){
        if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key)||!Object.hasOwn(props[key],'value')||!props[key].enumerable)fail('CATALOG_OBJECT');
        result[key]=copy(props[key].value,depth+1);
      }
    }
    active.delete(item);return result;
  }
  const result=copy(value,0);if(Buffer.byteLength(canonical(result))>maxBytes)fail('CATALOG_DATA_BOUND');return result;
}
export function exact(value,keys,code='CATALOG_FIELDS'){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))fail(code);
}
export function integer(value,min,max,code='CATALOG_INTEGER'){if(!Number.isSafeInteger(value)||value<min||value>max)fail(code);return value;}
export function relative(value){
  if(typeof value!=='string'||!value||value.length>512||path.win32.isAbsolute(value)||path.posix.isAbsolute(value)||/[\x00-\x1f\x7f<>:"|?*]/.test(value))fail('CATALOG_RELATIVE_PATH');
  const parts=value.split(/[\\/]/);if(parts.some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))fail('CATALOG_RELATIVE_PATH');
  return parts.join('/');
}
function localAbsolute(value){
  if(typeof value!=='string'||!path.isAbsolute(value)||/^(?:\\\\|\/\/)/.test(value)||/[\x00-\x1f\x7f]/.test(value)||process.platform==='win32'&&(value.slice(2).includes(':')||/[<>"|?*]/.test(value)))fail('CATALOG_ABSOLUTE_PATH');
  const resolved=path.resolve(value);if(resolved!==value)fail('CATALOG_CANONICAL_PATH');return resolved;
}
const key=value=>process.platform==='win32'?value.toLowerCase():value;
const UINT64_MAX=18446744073709551615n;
// Identity schema for 1.1.1: original BigInt stats -> canonical unsigned decimal.
// A Number already lost its low bits cannot be repaired by String(number).
export function unsignedFileId(value){
  if(typeof value!=='string'||! /^(?:0|[1-9][0-9]{0,19})$/.test(value)||BigInt(value)>UINT64_MAX)fail('CATALOG_FILE_ID_DECIMAL_UINT64');return value;
}
export function identityFromStat(stat){
  if(typeof stat?.dev!=='bigint'||typeof stat?.ino!=='bigint'||stat.dev<0n||stat.ino<0n||stat.dev>UINT64_MAX||stat.ino>UINT64_MAX)fail('CATALOG_FILE_ID_BIGINT_REQUIRED');
  return {dev:unsignedFileId(stat.dev.toString(10)),ino:unsignedFileId(stat.ino.toString(10))};
}
export function validateIdentity(identity){
  exact(identity,['path','dev','ino'],'CATALOG_FILE_IDENTITY_FIELDS');localAbsolute(identity.path);
  if(typeof identity.dev==='number'||typeof identity.ino==='number')fail('CATALOG_LEGACY_NUMERIC_IDENTITY');
  unsignedFileId(identity.dev);unsignedFileId(identity.ino);return identity;
}
export function sameStatIdentity(a,b){const first=identityFromStat(a),second=identityFromStat(b);return first.dev===second.dev&&first.ino===second.ino;}
export function inspectDirectory(value){
  const resolved=localAbsolute(value);let cursor=path.parse(resolved).root;
  for(const part of resolved.slice(cursor.length).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,part);const s=fs.lstatSync(cursor,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink())fail('CATALOG_DIRECTORY_ALIAS');identityFromStat(s);
  }
  if(key(fs.realpathSync.native(resolved))!==key(resolved))fail('CATALOG_DIRECTORY_ALIAS');
  const s=fs.lstatSync(resolved,{bigint:true});return {path:resolved,...identityFromStat(s)};
}
export function sameIdentity(a,b){validateIdentity(a);validateIdentity(b);return key(a.path)===key(b.path)&&a.dev===b.dev&&a.ino===b.ino;}
export function ownedPath(root,value){
  const r=relative(value),target=path.join(root,...r.split('/'));
  const rel=path.relative(root,target);if(!rel||rel.startsWith('..'+path.sep)||rel==='..'||path.isAbsolute(rel))fail('CATALOG_SCOPE');
  inspectDirectory(path.dirname(target));return target;
}
export function readPinned(file,{sha256,bytes,maxBytes=268435456}={}){
  integer(maxBytes,0,Number.MAX_SAFE_INTEGER,'CATALOG_FILE_BOUND');if(bytes!==undefined)integer(bytes,0,Number.MAX_SAFE_INTEGER,'CATALOG_FILE_BOUND');
  localAbsolute(file);inspectDirectory(path.dirname(file));const before=fs.lstatSync(file,{bigint:true});identityFromStat(before);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size>BigInt(maxBytes)||bytes!==undefined&&before.size!==BigInt(bytes))fail('CATALOG_FILE_ALIAS_OR_BOUND');
  const fd=fs.openSync(file,'r');try{
    const opened=fs.fstatSync(fd,{bigint:true});if(!opened.isFile()||!sameStatIdentity(opened,before)||opened.nlink!==1n||opened.size!==before.size)fail('CATALOG_FILE_CHANGED');
    // The size becomes a Number only after a safe finite bound; identity never does.
    const size=Number(opened.size),digest=createHash('sha256'),chunks=[],buffer=Buffer.alloc(Math.min(1048576,Math.max(1,size)));let count=0;
    while(count<size){const n=fs.readSync(fd,buffer,0,Math.min(buffer.length,size-count),count);if(!n)fail('CATALOG_FILE_CHANGED');digest.update(buffer.subarray(0,n));if(size<=1048576)chunks.push(Buffer.from(buffer.subarray(0,n)));count+=n;}
    const after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});
    if(!sameStatIdentity(after,opened)||after.nlink!==1n||after.size!==opened.size||after.mtimeNs!==opened.mtimeNs||after.ctimeNs!==opened.ctimeNs||!sameStatIdentity(named,opened)||named.nlink!==1n)fail('CATALOG_FILE_CHANGED');
    const actual=digest.digest('hex');if(sha256!==undefined&&actual!==sha256)fail('CATALOG_SHA_MISMATCH');
    return {path:file,bytes:count,sha256:actual,data:size<=1048576?Buffer.concat(chunks):null};
  }finally{fs.closeSync(fd);}
}
function pin(value,absolute=false){
  exact(value,['path','sha256','bytes']);if(!HASH.test(value.sha256))fail('CATALOG_SHA');integer(value.bytes,0,268435456);if(absolute)localAbsolute(value.path);else relative(value.path);return value;
}
export function admitGrant(input){
  const grant=data(input);exact(grant,['schema','projectId','owner','authorizationSha256','root','inputs','sourcePins','catalog','budgets','acceptance']);
  if(grant.schema!==1||grant.owner!=='saeed'||!ID.test(grant.projectId)||!HASH.test(grant.authorizationSha256))fail('CATALOG_AUTHORITY');localAbsolute(grant.root);
  for(const [name,absolute]of[['inputs',false],['sourcePins',true]]){
    if(!Array.isArray(grant[name])||grant[name].length>64)fail('CATALOG_PIN_LIMIT');grant[name].forEach(p=>pin(p,absolute));
    if(new Set(grant[name].map(p=>key(p.path))).size!==grant[name].length)fail('CATALOG_DUPLICATE_PIN');
  }
  exact(grant.budgets,['maxModelCalls','maxActions','wallTimeMs','maxOutputBytes']);integer(grant.budgets.maxModelCalls,1,64);integer(grant.budgets.maxActions,1,64);integer(grant.budgets.wallTimeMs,1000,7200000);integer(grant.budgets.maxOutputBytes,64,1048576);
  if(!Array.isArray(grant.catalog)||grant.catalog.length<1||grant.catalog.length>64)fail('CATALOG_ACTION_LIMIT');
  const ids=new Set(),outputs=new Set(),inputMap=new Map(grant.inputs.map(p=>[relative(p.path),p]));
  for(const action of grant.catalog){
    if(!ID.test(action.id)||ids.has(action.id))fail('CATALOG_ACTION_ID');ids.add(action.id);
    if(action.kind==='write_text'){
      exact(action,['id','kind','path','content','sha256','bytes']);const relativePath=relative(action.path);
      if(typeof action.content!=='string'||Buffer.byteLength(action.content)>65536||!HASH.test(action.sha256)||action.sha256!==hash(action.content)||action.bytes!==Buffer.byteLength(action.content))fail('CATALOG_CONTENT_PIN');
      if(outputs.has(key(relativePath))||inputMap.has(relativePath))fail('CATALOG_OUTPUT_CONFLICT');outputs.add(key(relativePath));
    }else if(['read_text','search_files'].includes(action.kind)){
      exact(action,action.kind==='read_text'?['id','kind','path','sha256','bytes']:['id','kind','path','sha256','bytes','query','maxMatches']);pin({path:action.path,sha256:action.sha256,bytes:action.bytes});
      const registered=inputMap.get(relative(action.path));if(!registered||registered.sha256!==action.sha256||registered.bytes!==action.bytes||action.bytes>1048576)fail('CATALOG_UNREGISTERED_INPUT');
      if(action.kind==='search_files'&&(typeof action.query!=='string'||!action.query||action.query.length>512||!Number.isSafeInteger(action.maxMatches)||action.maxMatches<1||action.maxMatches>100))fail('CATALOG_SEARCH_BOUND');
    }else if(action.kind==='run_project_command'){
      exact(action,['id','kind','program','executableSha256','args','cwd','sourcePins','timeoutMs','maxOutputBytes','memoryMb']);localAbsolute(action.program);
      if(!HASH.test(action.executableSha256)||action.cwd!==grant.root||!Array.isArray(action.args)||action.args.length>100||action.args.some(a=>typeof a!=='string'||a.includes('\0')||a.length>8192)||!Array.isArray(action.sourcePins)||action.sourcePins.length<1||action.sourcePins.length>64)fail('CATALOG_COMMAND_POLICY');
      for(const source of action.sourcePins){pin(source,true);if(!grant.sourcePins.some(p=>canonical(p)===canonical(source)))fail('CATALOG_COMMAND_SOURCE_NOT_REGISTERED');}
      integer(action.timeoutMs,100,180000);integer(action.maxOutputBytes,64,grant.budgets.maxOutputBytes);integer(action.memoryMb,64,1024);
    }else fail('CATALOG_TOOL_FORBIDDEN');
  }
  if(!Array.isArray(grant.acceptance)||!grant.acceptance.length||grant.acceptance.length>32)fail('CATALOG_ACCEPTANCE_REQUIRED');
  const checks=new Set();for(const check of grant.acceptance){exact(check,['type','path','sha256','bytes']);if(check.type!=='file_sha256')fail('CATALOG_ACCEPTANCE_TYPE');pin({path:check.path,sha256:check.sha256,bytes:check.bytes});const normalized=relative(check.path);if(checks.has(key(normalized)))fail('CATALOG_DUPLICATE_ACCEPTANCE');checks.add(key(normalized));if(!outputs.has(key(normalized)))fail('CATALOG_ACCEPTANCE_NOT_OWNED_OUTPUT');}
  function freeze(item){if(item&&typeof item==='object'){Object.values(item).forEach(freeze);Object.freeze(item);}return item;}return freeze(grant);
}
