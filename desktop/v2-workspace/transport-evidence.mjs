// A bounded, anonymous loopback RPC transport census. HTTP 401 is evidence
// that a local listener denied anonymous access, never OAuth/owner authority.
import {hostname as systemHostname,platform as systemPlatform} from 'node:os';
const TARGETS=Object.freeze({
 'Emad-PC-Ultimate':Object.freeze({platform:'win32',port:48789,role:'LOCAL_RELAY'}),
 'aliemad-Labtop':Object.freeze({platform:'linux',port:48789,role:'LOCAL_RELAY'}),
 'mmz-LOQ-15IRX9':Object.freeze({platform:'linux',port:48787,role:'LOCAL_COORDINATOR'})
});
export async function readV2LocalTransport({
 hostname=systemHostname(),platform=systemPlatform(),fetchImpl=globalThis.fetch,
 timeoutMs=1400
}={}){
 const unknown=(state,role=null)=>Object.freeze({
  schema:1,state,role,endpoint:null,scope:'LOCAL_TRANSPORT_ONLY',
  ownerRpcAuthenticated:false,chatGPTOAuthVerified:false,workerEffectVerified:false
 });
 const t=TARGETS[hostname];
 if(!t||t.platform!==platform)return unknown('NOT_CONFIGURED');
 if(typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||
  timeoutMs<100||timeoutMs>3000)return unknown('UNVERIFIED',t.role);
 const endpoint='127.0.0.1:'+t.port;
 try{
  const response=await fetchImpl('http://'+endpoint+'/v2/lease/get-receipt',{
   method:'POST',redirect:'error',cache:'no-store',
   headers:{'content-type':'application/json'},
   body:'{}',signal:AbortSignal.timeout(timeoutMs)
  });
  // Do not consume or echo any server response body; the only expected
  // evidence is status 401 from a loopback-local unauthorized diagnostic.
  const state=response?.status===401?'ANONYMOUS_DENIED':
    'RESPONSE_NOT_VERIFIED';
  return Object.freeze({
   schema:1,state,role:t.role,endpoint,scope:'LOCAL_TRANSPORT_ONLY',
   ownerRpcAuthenticated:false,chatGPTOAuthVerified:false,workerEffectVerified:false
  });
 }catch{
  return Object.freeze({schema:1,state:'UNREACHABLE',
   role:t.role,endpoint,scope:'LOCAL_TRANSPORT_ONLY',
   ownerRpcAuthenticated:false,chatGPTOAuthVerified:false,workerEffectVerified:false});
 }
}
