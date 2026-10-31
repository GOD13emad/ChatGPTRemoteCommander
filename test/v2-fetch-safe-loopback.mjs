// Test-only loopback server binding. Never used by V2 production runtime.
// Windows can configure its dynamic TCP ports inside the WHATWG Fetch blocked
// range; listen(0) then returns sequential unsuitable ports even after retries.
// Pick a cryptographically random high-range port and retry ONLY real collisions.
import {randomInt} from 'node:crypto';
const LOW=20000,HIGH=60000;
export function isFetchSafeLoopbackPort(port){
 return Number.isInteger(port)&&port>=LOW&&port<HIGH;
}
export async function listenOnFetchSafePort(server,{maxAttempts=48}={}){
 if(!server||typeof server.listen!=='function'||typeof server.close!=='function'||
    server.listening||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>128)
  throw Object.assign(new Error('V2_TEST_LOOPBACK_SERVER_INVALID'),{code:'V2_TEST_LOOPBACK_SERVER_INVALID'});
 for(let attempt=0;attempt<maxAttempts;attempt++){
  const candidate=randomInt(LOW,HIGH);
  try{
   await new Promise((resolve,reject)=>{
    const failed=e=>{server.off('error',failed);reject(e);};
    server.once('error',failed);
    server.listen(candidate,'127.0.0.1',()=>{server.off('error',failed);resolve();});
   });
   return candidate;
  }catch(e){
   if(e?.code!=='EADDRINUSE'&&e?.code!=='EACCES')throw e;
  }
 }
 throw Object.assign(new Error('V2_TEST_NO_AVAILABLE_LOOPBACK_PORT'),{code:'V2_TEST_NO_AVAILABLE_LOOPBACK_PORT'});
}
