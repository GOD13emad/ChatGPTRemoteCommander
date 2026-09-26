import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function sortDeep(value){
  if(Array.isArray(value))return value.map(sortDeep);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,sortDeep(value[k])]));
  return value;
}
export function canonicalToolSchema(tools){
  if(!Array.isArray(tools))throw new Error('SCHEMA_TOOLS_INVALID');
  return tools.map(t=>({name:String(t?.name??''),inputSchema:sortDeep(t?.inputSchema??{})})).sort((a,b)=>a.name.localeCompare(b.name));
}
export function hashToolSchema(tools){
  return createHash('sha256').update(JSON.stringify(canonicalToolSchema(tools))).digest('hex');
}
async function fetchJson(url,options){
  const r=await fetch(url,{...options,signal:AbortSignal.timeout(5000)});
  if(!r.ok)throw new Error('SCHEMA_HTTP_'+r.status);
  return r.json();
}
export async function fetchToolSchemaHash(url){
  const body=await fetchJson(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
  if(!Array.isArray(body?.result?.tools))throw new Error('SCHEMA_TOOLS_LIST_INVALID');
  return hashToolSchema(body.result.tools);
}
export async function evaluateSchemaContinuity({oldUrl,candidateUrl,routerUrl}){
  const [oldHash,candidateHash]=await Promise.all([fetchToolSchemaHash(oldUrl),fetchToolSchemaHash(candidateUrl)]);
  if(oldHash===candidateHash)return {ok:true,changed:false,oldHash,candidateHash,decision:'UNCHANGED_SCHEMA'};
  let status;
  try{status=await fetchJson(routerUrl,{method:'GET'});}catch(error){
    return {ok:false,changed:true,oldHash,candidateHash,decision:'ROUTER_CONTINUITY_UNAVAILABLE',error:error.message};
  }
  const c=status?.schemaContinuity;
  if(!c||typeof c!=='object')return {ok:false,changed:true,oldHash,candidateHash,decision:'ROUTER_CONTINUITY_UNSUPPORTED'};
  if(c.legacyMcpSeen===true)return {ok:false,changed:true,oldHash,candidateHash,decision:'LEGACY_HOST_SEEN'};
  if(Number(c.toolsListSubscribers||0)<1)return {ok:false,changed:true,oldHash,candidateHash,decision:'TOOLS_LIST_REFRESH_UNNEGOTIATED'};
  return {ok:true,changed:true,oldHash,candidateHash,decision:'NEGOTIATED_REFRESH'};
}
function parse(argv){
  const o={};
  for(let i=0;i<argv.length;i+=2){const k=argv[i],v=argv[i+1];if(!v)throw new Error('SCHEMA_GATE_ARGUMENT');if(k==='--old-url')o.oldUrl=v;else if(k==='--candidate-url')o.candidateUrl=v;else if(k==='--router-url')o.routerUrl=v;else throw new Error('SCHEMA_GATE_ARGUMENT');}
  if(!o.oldUrl||!o.candidateUrl||!o.routerUrl)throw new Error('SCHEMA_GATE_ARGUMENT');
  return o;
}
const invoked=process.argv[1]?pathToFileURL(path.resolve(process.argv[1])).href:'';
if(invoked===import.meta.url){
  try{
    const result=await evaluateSchemaContinuity(parse(process.argv.slice(2)));
    console.log(JSON.stringify(result));
    if(!result.ok)process.exitCode=3;
  }catch(error){console.error(error.message);process.exitCode=2;}
}
