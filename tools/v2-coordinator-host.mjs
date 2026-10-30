// V2 candidate owner-local central coordinator server.
// No root, external listen address, anonymous access, auto-enrollment or
// unattended profile takeover. Configuration is an owner-private file.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {V2CentralCoordinator} from '../src/v2-central-coordinator.mjs';
import {normalizeV2Route} from '../src/v2-routing-contract.mjs';
import {createV2CoordinatorRpcServer,createV2RpcTokenLookup} from '../src/v2-coordinator-rpc.mjs';

function fail(code){throw Object.assign(new Error(code),{code});}
function loadConfig(file){
 if(typeof file!=='string'||!path.isAbsolute(file))
  fail('V2_HOST_ABSOLUTE_CONFIG_REQUIRED');
 const info=fs.lstatSync(file);
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||
    info.size<2||info.size>131072||
    info.uid!==process.getuid()||(info.mode&0o077)!==0)
  fail('V2_HOST_PRIVATE_CONFIG_REQUIRED');
 const root=path.dirname(fs.realpathSync.native(file));
 const parent=fs.lstatSync(root);
 if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==process.getuid()||
    (parent.mode&0o077)!==0)fail('V2_HOST_PRIVATE_CONFIG_PARENT_REQUIRED');
 let config;
 try{config=JSON.parse(fs.readFileSync(file,'utf8'));}
 catch{fail('V2_HOST_CONFIG_INVALID');}
 if(!config||typeof config!=='object'||Array.isArray(config)||
    Object.keys(config).sort().join(',')!=='directory,grants,port,resources,schema,tokens'||
    config.schema!==1||!Array.isArray(config.grants)||!Array.isArray(config.resources)||
    !Array.isArray(config.tokens)||config.grants.length<1||config.grants.length>1000||
    config.resources.length<1||config.resources.length>1000||
    !Number.isInteger(config.port)||config.port<0||config.port>65535)
  fail('V2_HOST_CONFIG_SHAPE');
 const inventory=new Map(),permissions=new Set();
 for(const item of config.resources){
  if(!item||typeof item!=='object'||Object.keys(item).sort().join(',')!=='globalId,hostId,target')
   fail('V2_HOST_RESOURCE_INVALID');
  // Validate against the existing route schema; never normalize a guessed ID.
  const r=normalizeV2Route({hostId:item.hostId,principalId:'inventory',profileId:'inventory',
   conversationId:'inventory',operationId:'inventory',target:item.target});
  if(typeof item.globalId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(item.globalId))
   fail('V2_HOST_RESOURCE_INVALID');
  const key=JSON.stringify([r.hostId,r.target.kind,r.target.id]);
  if(inventory.has(key))fail('V2_HOST_RESOURCE_DUPLICATE');
  inventory.set(key,item.globalId);
 }
 for(const item of config.grants){
  if(!item||typeof item!=='object')fail('V2_HOST_GRANT_INVALID');
  const r=normalizeV2Route(item);
  const resourceKey=JSON.stringify([r.hostId,r.target.kind,r.target.id]);
  if(!inventory.has(resourceKey))fail('V2_HOST_GRANT_UNMAPPED');
  permissions.add(JSON.stringify(r));
 }
 const lookupToken=createV2RpcTokenLookup(config.tokens);
 return Object.freeze({
  directory:config.directory,port:config.port,lookupToken,
  authorizeLease:async route=>permissions.has(JSON.stringify(normalizeV2Route(route))),
  resolveGlobalResource:async route=>inventory.get(JSON.stringify([
   route.hostId,route.target.kind,route.target.id]))??null
 });
}
export async function runV2CoordinatorHost(file,{onReady=()=>{}}={}){
 if(process.platform!=='linux'||process.getuid?.()===0)
  fail('V2_HOST_OWNER_LINUX_ONLY');
 const config=loadConfig(file);
 const coordinator=new V2CentralCoordinator({...config,requireGlobalResource:true});
 const server=createV2CoordinatorRpcServer({coordinator,lookupToken:config.lookupToken});
 let closed=false;
 async function close(){
  if(closed)return;
  closed=true;
  try{await server.close();}finally{coordinator.close();}
 }
 try{
  const addr=await server.listen(config.port);
  await onReady(addr);
  return {addr,close};
 }catch(error){await close();throw error;}
}
if(process.argv[1] && fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 if(process.argv.length!==3){process.stderr.write('V2_HOST_CONFIG_PATH_REQUIRED\n');process.exitCode=2;}
 else{
  try{
   const host=await runV2CoordinatorHost(process.argv[2],{
    onReady:({host,port})=>process.stdout.write(JSON.stringify({
     status:'V2_COORDINATOR_LOOPBACK_READY',host,port})+'\n')
   });
   let stopping=false;
   for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{
    if(stopping)return;stopping=true;
    await host.close();process.exitCode=0;
   });
  }catch(e){process.stderr.write((e.code||'V2_HOST_FAILED')+'\n');process.exitCode=2;}
 }
}
