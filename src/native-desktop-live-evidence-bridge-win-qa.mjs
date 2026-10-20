// QA-only live-desktop observation adapter. No GUI input authorization or
// trusted chat identity. CurrentUserOnly pipe is a SAME-SID boundary only.
import net from 'node:net';
import {createHash,randomBytes} from 'node:crypto';
const HEX=/^[a-f0-9]{64}$/;
const PIPE=/^rc_qa_desk_[a-f0-9]{32}$/;
const DESKTOP=/^RcQaPersist_[a-f0-9]{32}$/;
const fail=code=>Object.assign(new Error(code),{code});
export function validateLiveDesktopObservationQA(reply,workspaceRef,slot,nonce){
 if(!HEX.test(workspaceRef??'')||!HEX.test(nonce??'')||!['A','B'].includes(slot))
   throw fail('LIVE_EVIDENCE_ARGUMENT_INVALID');
 const v=reply?.result;
 if(reply?.ok!==true||!Number.isSafeInteger(reply.hostSession)||
    reply.hostSession<=0||v?.workspace!==slot||
    !DESKTOP.test(v.desktop??'')||!Number.isSafeInteger(v.pid)||v.pid<=0||
    v.windowCount!==1||v.ownWindow!==true||v.effectMode!=='observation-only')
   throw fail('LIVE_EVIDENCE_UNTRUSTED');
 const sha256=createHash('sha256').update(JSON.stringify({
   nonce,workspaceRef,slot,session:reply.hostSession,desktop:v.desktop,pid:v.pid
 })).digest('hex');
 return Object.freeze({sha256,effectMode:'observation-only'});
}
export function requestLiveDesktopQA(pipe,command){
 if(process.platform!=='win32'||!PIPE.test(pipe??'')||
    !['observeA','observeB'].includes(command))
   throw fail('LIVE_QUERY_ARGUMENT_INVALID');
 return new Promise((resolve,reject)=>{
   const socket=net.createConnection('\\\\.\\pipe\\'+pipe);
   let done=false,buffer='';
   const finish=(err,val)=>{
     if(done)return;done=true;socket.destroy();
     if(err)reject(fail(err));else resolve(val);
   };
   socket.setTimeout(4000);
   socket.on('connect',()=>socket.write(command+'\n'));
   socket.on('data',chunk=>{
     buffer+=chunk.toString('utf8');
     if(buffer.length>4096)return finish('LIVE_QUERY_OVERSIZE');
     if(!buffer.includes('\n'))return;
     try{finish(null,JSON.parse(buffer.trim()))}
     catch{finish('LIVE_QUERY_INVALID')}
   });
   socket.on('timeout',()=>finish('LIVE_QUERY_TIMEOUT'));
   socket.on('error',()=>finish('LIVE_QUERY_UNAVAILABLE'));
   socket.on('end',()=>finish('LIVE_QUERY_TRUNCATED'));
 });
}
export function createLiveDesktopObserverQA({pipeName,workspaceRefs,request=requestLiveDesktopQA}={}){
 if(!PIPE.test(pipeName??'')||!Array.isArray(workspaceRefs)||
    workspaceRefs.length!==2||!workspaceRefs.every(x=>HEX.test(x??''))||
    workspaceRefs[0]===workspaceRefs[1]||typeof request!=='function')
   throw fail('LIVE_OBSERVER_ARGUMENT_INVALID');
 const nonce=randomBytes(32).toString('hex');
 return async({workspaceRef}={})=>{
   const index=workspaceRefs.indexOf(workspaceRef);
   if(index<0)throw fail('LIVE_WORKSPACE_NOT_ASSIGNED');
   const slot=index===0?'A':'B';
   return validateLiveDesktopObservationQA(
     await request(pipeName,'observe'+slot),workspaceRef,slot,nonce);
 };
}
