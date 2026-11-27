#!/usr/bin/env node
// Owner-local fixed-scope V0.12 administration client. Mutations require the
// server's genuine native owner consent. No secrets or caller-provided identity,
// arbitrary tool, path, expiry, privilege or grant bits are accepted.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const MODES=Object.freeze({
  '--inspect':'inspect',
  '--approve-worker':'approve_worker',
  '--approve-system-status':'approve_system_status_canary',
  '--approve-registration':'approve_worker_registration',
  '--register-signed-worker':'register_signed_worker'
});
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
function parseArgs(argv){
  if(argv.length!==3||!Object.hasOwn(MODES,argv[0])
    ||argv[1]!=='--profile'||typeof argv[2]!=='string'
    ||!ID.test(argv[2])||argv[2]==='.'||argv[2]==='..')
    fail('RC012_OWNER_ADMIN_CLI_ARGS_INVALID');
  return Object.freeze({action:MODES[argv[0]],profile:argv[2]});
}
function secureSocket(profile){
  const uid=process.getuid?.();
  if(process.platform!=='linux'||!Number.isSafeInteger(uid)||uid<1)
    fail('RC012_OWNER_ADMIN_CLI_PLATFORM_UNAVAILABLE');
  const root='/run/user/'+uid,dir=path.join(root,'rc012-owner-admin-'+profile);
  const socketPath=path.join(dir,'admin.sock');
  if(Buffer.byteLength(socketPath)>96)fail('RC012_OWNER_ADMIN_CLI_SOCKET_TOO_LONG');
  for(const name of [root,dir]){
    const st=fs.lstatSync(name);
    if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==uid
      ||(st.mode&0o077)!==0||fs.realpathSync.native(name)!==name)
      fail('RC012_OWNER_ADMIN_CLI_DIRECTORY_UNTRUSTED');
  }
  const st=fs.lstatSync(socketPath);
  if(!st.isSocket()||st.isSymbolicLink()||st.uid!==uid||(st.mode&0o077)!==0)
    fail('RC012_OWNER_ADMIN_CLI_SOCKET_UNTRUSTED');
  return socketPath;
}
export async function runCli(argv){
  const {action,profile}=parseArgs(argv),socketPath=secureSocket(profile);
  const line=JSON.stringify({schema:1,action})+'\n';
  const received=await new Promise((resolve,reject)=>{
    const socket=net.createConnection(socketPath);
    let response='';
    let done=false;
    socket.setTimeout(action==='inspect'?5000:140000,()=>{
      socket.destroy();reject(Error('RC012_OWNER_ADMIN_CLI_TIMEOUT'));
    });
    socket.once('connect',()=>socket.end(line));
    socket.on('data',chunk=>{
      response+=chunk.toString('utf8');
      if(Buffer.byteLength(response)>1024){
        socket.destroy();reject(Error('RC012_OWNER_ADMIN_CLI_RESPONSE_TOO_LARGE'));
      }
    });
    socket.once('error',reject);
    socket.once('close',()=>{
      if(!done){done=true;resolve(response);}
    });
  });
  let result;
  try{result=JSON.parse(received);}
  catch{fail('RC012_OWNER_ADMIN_CLI_RESPONSE_INVALID');}
  if(!result||typeof result!=='object'||Array.isArray(result)
    ||typeof result.ok!=='boolean'||received!==JSON.stringify(result)+'\n')
    fail('RC012_OWNER_ADMIN_CLI_RESPONSE_INVALID');
  if(result.ok!==true)fail('RC012_OWNER_ADMIN_CLI_NATIVE_OWNER_DENIED');
  if(action==='inspect'){
    const fields=['ok','nativeOwnerBound','workerActive','exactBaseEnabled',
      'exactWorkerToolEnabled','readOnlyCanaryAllowed'];
    if(Object.keys(result).length!==fields.length
      ||fields.some(k=>!Object.hasOwn(result,k))
      ||fields.slice(1).some(k=>typeof result[k]!=='boolean'))
      fail('RC012_OWNER_ADMIN_CLI_RESPONSE_INVALID');
  }else if(Object.keys(result).length!==2
    ||(action==='register_signed_worker'
      ?result.registered!==true
      :result.approved!==true))
    fail('RC012_OWNER_ADMIN_CLI_RESPONSE_INVALID');
  return Object.freeze({...result,profile,action});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runCli(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r)))
    .catch(e=>{console.error(e?.code??'RC012_OWNER_ADMIN_CLI_DENIED');process.exitCode=2;});
}
