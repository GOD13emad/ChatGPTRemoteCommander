// Owner-local V2 Coordinator TCP forward. Tailscale WireGuard protects the
// host-to-host link; the existing V2 RPC client/server still enforce independent
// per-owner bearer+caller binding. No tunnel, credential, or user is created here.
import net from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const exec=promisify(execFile);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const validPort=p=>Number.isSafeInteger(p)&&p>1023&&p<=65535;
const validDns=x=>typeof x==='string'&&/^[A-Za-z0-9-]{2,64}(?:\.[A-Za-z0-9-]{1,64}){2,9}\.$/.test(x);
function tailscaleIP(ip){
 if(typeof ip!=='string')return false;
 const parts=ip.split('.');
 if(parts.length!==4||parts.some(x=>!/^(0|[1-9]\d{0,2})$/.test(x)||+x>255))return false;
 return +parts[0]===100&&+parts[1]>=64&&+parts[1]<=127;
}
export function peerFromTailscaleStatus(json,expectedDNS){
 if(!validDns(expectedDNS))fail('V2_RELAY_PINNED_PEER_REQUIRED');
 let status;
 try{status=JSON.parse(json);}catch{fail('V2_RELAY_TAILSCALE_STATUS_INVALID');}
 if(status?.BackendState!=='Running'||!status?.Peer||typeof status.Peer!=='object')
  fail('V2_RELAY_TAILSCALE_OFFLINE');
 const matches=Object.values(status.Peer).filter(x=>x?.DNSName===expectedDNS);
 if(matches.length!==1||matches[0].Online!==true)fail('V2_RELAY_PEER_NOT_VERIFIED');
 const ips=(matches[0].TailscaleIPs||[]).filter(tailscaleIP);
 if(ips.length!==1)fail('V2_RELAY_PEER_IP_INVALID');
 return ips[0];
}
export async function resolvePeerViaTailscale(expectedDNS){
 let output;
 try{
  const result=await exec('tailscale',['status','--json'],{
   timeout:4000,maxBuffer:1024*1024,windowsHide:true});
  output=result.stdout;
 }catch{fail('V2_RELAY_TAILSCALE_STATUS_UNAVAILABLE');}
 return peerFromTailscaleStatus(output,expectedDNS);
}
export function createV2TailnetLoopbackRelay({
  expectedDNS,localPort=48789,remotePort=48787,lookup=resolvePeerViaTailscale
}={}){
 if(!validDns(expectedDNS)||!validPort(localPort)||!validPort(remotePort)||
  typeof lookup!=='function')fail('V2_RELAY_BOOTSTRAP_INVALID');
 const live=new Set();
 let server,ready=false;
 async function listen(){
  if(ready)fail('V2_RELAY_ALREADY_RUNNING');
  // Fail closed before binding localhost if the pinned tailnet peer is absent.
  const ip=await lookup(expectedDNS);
  if(!tailscaleIP(ip))fail('V2_RELAY_PEER_IP_INVALID');
  server=net.createServer({allowHalfOpen:false},from=>{
   live.add(from);
   const to=net.createConnection({host:ip,port:remotePort});
   live.add(to);
   from.setTimeout(12000);to.setTimeout(12000);
   from.on('timeout',()=>from.destroy());
   to.on('timeout',()=>to.destroy());
   from.on('error',()=>to.destroy());
   to.on('error',()=>from.destroy());
   from.on('close',()=>{live.delete(from);to.destroy();});
   to.on('close',()=>{live.delete(to);from.destroy();});
   from.pipe(to);to.pipe(from);
  });
  server.maxConnections=32;
  try{
   await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(localPort,'127.0.0.1',()=>{
     server.off('error',reject);resolve();
    });
   });
   if(server.address()?.address!=='127.0.0.1')fail('V2_RELAY_NOT_LOOPBACK');
   ready=true;
   return Object.freeze({host:'127.0.0.1',port:server.address().port});
  }catch(err){server.close();throw err;}
 }
 async function close(){
  if(!server?.listening)return;
  for(const socket of live)socket.destroy();
  await new Promise(resolve=>server.close(resolve));
  ready=false;
 }
 return Object.freeze({listen,close,get listening(){return ready;}});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const argv=process.argv.slice(2);
 if(argv.length!==3||argv[0]!=='--peer-dns'||!validPort(Number(argv[2]))){
  process.stderr.write('V2_RELAY_ARGS_REQUIRED\n');process.exitCode=2;
 }else{
  try{
   const r=createV2TailnetLoopbackRelay({expectedDNS:argv[1],localPort:Number(argv[2])});
   const addr=await r.listen();
   process.stdout.write('V2_OWNER_LOCAL_TAILNET_RELAY_READY '+addr.host+':'+addr.port+'\n');
   let exiting=false;
   for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{
    if(exiting)return;exiting=true;await r.close();process.exitCode=0;
   });
  }catch(e){process.stderr.write((e.code||'V2_RELAY_FAILED')+'\n');process.exitCode=2;}
 }
}
