// Fixed-action, user-local Linux Unix socket for the private Core's SAME
// native J01 grant registry. No key, route, target, tool or worker identifier
// is accepted from a socket peer. The registry requests real OS-owner consent
// for every mutation; no UAC/sudo bypass, automatic grant or MCP endpoint.
// Same-UID callers can request a prompt: this interface is NOT a substitute
// for isolating the Core/Worker OS execution environment.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ACTIONS=new Set(['inspect','approve_worker','approve_system_status_canary',
  'approve_worker_registration','register_signed_worker']);
const fail=code=>{throw Object.assign(new Error(code),{code});};
function checkSocketPath(socketPath){
  const uid=process.getuid?.(),runtime='/run/user/'+uid;
  if(process.platform!=='linux'||!Number.isSafeInteger(uid)||uid<1
    ||typeof socketPath!=='string'||!path.isAbsolute(socketPath)
    ||Buffer.byteLength(socketPath)>96||socketPath.includes('\0')
    ||path.resolve(socketPath)!==socketPath
    ||!socketPath.startsWith(runtime+'/'))
    fail('RC012_OWNER_ADMIN_SOCKET_PATH_INVALID');
  const dir=path.dirname(socketPath);
  let cursor=path.parse(dir).root;
  for(const name of dir.slice(cursor.length).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,name);
    const st=fs.lstatSync(cursor);
    if(!st.isDirectory()||st.isSymbolicLink())
      fail('RC012_OWNER_ADMIN_SOCKET_DIRECTORY_ALIAS');
  }
  for(const target of [runtime,dir]){
    const st=fs.lstatSync(target);
    if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==uid
      ||(st.mode&0o077)!==0||fs.realpathSync.native(target)!==target)
      fail('RC012_OWNER_ADMIN_SOCKET_DIRECTORY_NOT_PRIVATE');
  }
  if(fs.lstatSync(socketPath,{throwIfNoEntry:false}))
    fail('RC012_OWNER_ADMIN_SOCKET_ALREADY_EXISTS');
}
function parse(line){
  let x;
  if(Buffer.byteLength(line)<8||Buffer.byteLength(line)>512)
    fail('RC012_OWNER_ADMIN_REQUEST_INVALID');
  try{x=JSON.parse(line);}
  catch{fail('RC012_OWNER_ADMIN_REQUEST_INVALID');}
  if(!x||typeof x!=='object'||Array.isArray(x)
    ||Object.keys(x).length!==2
    ||x.schema!==1||typeof x.action!=='string'||!ACTIONS.has(x.action)
    ||JSON.stringify(x)!==line
    ||Object.keys(x)[0]!=='schema'||Object.keys(x)[1]!=='action')
    fail('RC012_OWNER_ADMIN_REQUEST_INVALID');
  return x.action;
}
export function createV012OwnerGrantAdminUnix({
  socketPath,administration
}={}){
  if(typeof administration?.inspect!=='function'
    ||typeof administration?.approveWorker!=='function'
    ||typeof administration?.approveReadOnlyCanary!=='function')
    fail('RC012_OWNER_ADMIN_METHODS_REQUIRED');
  let server=null,started=false,closed=false,inflight=false,inode=null;
  const peers=new Set();
  async function handle(socket){
    peers.add(socket);
    socket.once('close',()=>peers.delete(socket));
    if(closed){socket.destroy();return;}
    if(inflight){socket.end('{"ok":false,"code":"BUSY"}\n');return;}
    socket.setTimeout(5000,()=>socket.destroy());
    let data='';
    socket.on('data',async chunk=>{
      if(data===null)return;
      data+=chunk.toString('utf8');
      if(Buffer.byteLength(data)>512){data=null;socket.end('{"ok":false,"code":"INVALID"}\n');return;}
      if(!data.endsWith('\n'))return;
      const raw=data.slice(0,-1);
      data=null;socket.setTimeout(0);
      let action;
      try{action=parse(raw);}
      catch{socket.end('{"ok":false,"code":"INVALID"}\n');return;}
      if(closed){socket.end('{"ok":false,"code":"OWNER_DENIED"}\n');return;}
      if(inflight){socket.end('{"ok":false,"code":"BUSY"}\n');return;}
      inflight=true;
      try{
        const result=action==='inspect'
          ?await administration.inspect()
          :action==='approve_worker'
            ?await administration.approveWorker()
            :action==='approve_system_status_canary'
              ?await administration.approveReadOnlyCanary()
              :action==='approve_worker_registration'
                ?await administration.approveSignedRegistration?.()
                :await administration.registerSignedWorker?.();
        // Return only bounded non-secret outcome fields.
        const response=action==='inspect'
          ?{ok:true,nativeOwnerBound:result.nativeOwnerBound===true,
            workerActive:result.workerActive===true,
            exactBaseEnabled:result.exactBaseEnabled===true,
            exactWorkerToolEnabled:result.exactWorkerToolEnabled===true,
            readOnlyCanaryAllowed:result.readOnlyCanaryAllowed===true}
          :action==='register_signed_worker'
            ?{ok:true,registered:result?.registered===true}
            :{ok:true,approved:action==='approve_worker'
              ?Number.isSafeInteger(result?.revision)
              :action==='approve_worker_registration'
                ?result?.registrationAllowed===true
                :result?.canaryAllowed===true};
        if((action==='register_signed_worker'&&response.registered!==true)
          ||(action!=='inspect'&&action!=='register_signed_worker'&&response.approved!==true))
          fail('RC012_OWNER_ADMIN_ACTION_DENIED');
        socket.end(JSON.stringify(response)+'\n');
      }catch{socket.end('{"ok":false,"code":"OWNER_DENIED"}\n');}
      finally{inflight=false;}
    });
    socket.on('error',()=>{});
  }
  return Object.freeze({
    async start(){
      if(started||closed)fail('RC012_OWNER_ADMIN_SOCKET_ALREADY_STARTED');
      checkSocketPath(socketPath);
      server=net.createServer({allowHalfOpen:false},socket=>{void handle(socket);});
      server.maxConnections=2;
      try{
        await new Promise((resolve,reject)=>{
          server.once('error',reject);
          server.listen(socketPath,()=>{server.removeListener('error',reject);resolve();});
        });
        fs.chmodSync(socketPath,0o600);
        const st=fs.lstatSync(socketPath);
        if(!st.isSocket()||st.uid!==process.getuid()||(st.mode&0o077)!==0)
          fail('RC012_OWNER_ADMIN_SOCKET_UNTRUSTED');
        inode=st.ino;started=true;
      }catch(e){try{server.close();}catch{}throw e;}
      return Object.freeze({listening:true,localOnly:true,
        mutationRequiresNativeOwnerConsent:true});
    },
    async close(){
      if(closed)return;
      closed=true;
      const closing=server?.listening
        ?new Promise(resolve=>server.close(()=>resolve()))
        :Promise.resolve();
      for(const peer of peers)peer.destroy();
      await closing;
      const current=fs.lstatSync(socketPath,{throwIfNoEntry:false});
      if(current){
        if(current.ino!==inode||!current.isSocket()||current.uid!==process.getuid())
          fail('RC012_OWNER_ADMIN_SOCKET_PATH_CHANGED');
        fs.unlinkSync(socketPath);
      }
    }
  });
}
