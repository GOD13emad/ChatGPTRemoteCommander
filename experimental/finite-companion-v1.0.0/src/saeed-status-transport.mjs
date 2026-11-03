// Vendored from admitted service-admission R3; current default is core 0.10.6.
// Narrow read-only transport. No tool name, shell, path, retry, or chat URL input.
import http from 'node:http';
import {createHash} from 'node:crypto';
import {parseStatusJson} from './strict-status-json.mjs';

const HASH=/^[a-f0-9]{64}$/;
const fail=code=>Object.assign(new Error(code),{code});
export function createSaeedStatusTransport({port,expectedConfigSha256,expectedVersion='0.10.6',timeoutMs=5000,maxBytes=524288}) {
  if(!Number.isSafeInteger(port)||port<1024||port>65535||typeof expectedConfigSha256!=='string'||!HASH.test(expectedConfigSha256)
    ||typeof expectedVersion!=='string'||!/^\d+\.\d+\.\d+$/.test(expectedVersion)
    ||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000
    ||!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>1048576)throw fail('SAEED_TRANSPORT_OPTIONS');
  let busy=false,call=0;
  return async function readStatus({signal}={}) {
    if(busy)throw fail('SAEED_TRANSPORT_BUSY');
    if(signal!==undefined&&!(signal instanceof AbortSignal))throw fail('SAEED_TRANSPORT_SIGNAL');
    if(signal?.aborted)throw fail('SAEED_TRANSPORT_ABORTED');
    busy=true;
    const started=Date.now(),id=++call;
    let requestClosed=null,closed=false,primary=null,receipt=null;const secondary=[];
    try {
      const raw=await new Promise((resolve,reject)=>{
        let finished=false,request,timer,total=0;const chunks=[];
        const cleanup=()=>{clearTimeout(timer);try{signal?.removeEventListener('abort',abort);}catch(error){secondary.push({phase:'ABORT_LISTENER_REMOVE',code:error.code??'CLEANUP_FAILURE'});}};
        const stop=(error,value)=>{if(finished)return;finished=true;cleanup();
          const first=error??(secondary.length?fail('SAEED_TRANSPORT_CLEANUP'):null);
          // Settle regardless of cleanup failure; destroy only this owned request.
          if(first)reject(first);else resolve(value);request?.destroy();};
        const abort=()=>stop(fail('SAEED_TRANSPORT_ABORTED'));
        const body=Buffer.from(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name:'system_status',arguments:{}}}));
        request=http.request({hostname:'127.0.0.1',port,path:'/mcp',method:'POST',agent:false,
          headers:{'content-type':'application/json','content-length':body.length,'connection':'close'}},response=>{
          // Install failure listeners before every early response destruction path.
          response.on('error',error=>stop(error));
          response.on('aborted',()=>stop(fail('SAEED_TRANSPORT_RESPONSE_ABORTED')));
          if(response.statusCode!==200){stop(fail('SAEED_TRANSPORT_HTTP_'+response.statusCode));return;}
          const declared=response.headers['content-length'];
          if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes)){
            stop(fail('SAEED_TRANSPORT_SIZE'));return;
          }
          response.on('data',chunk=>{total+=chunk.length;if(total>maxBytes)stop(fail('SAEED_TRANSPORT_SIZE'));else chunks.push(chunk);});
          response.on('end',()=>stop(null,Buffer.concat(chunks)));
        });
        requestClosed=new Promise(resolve=>request.once('close',()=>{closed=true;resolve();}));
        request.on('error',error=>stop(error));
        timer=setTimeout(()=>stop(fail('SAEED_TRANSPORT_TIMEOUT')),timeoutMs);
        try{signal?.addEventListener('abort',abort,{once:true});}catch(error){stop(error);return;}
        if(signal?.aborted){abort();return;}
        request.end(body);
      });
      const envelope=parseStatusJson(raw);
      if(envelope?.jsonrpc!=='2.0'||envelope.id!==id||envelope.error||envelope.result?.isError===true)throw fail('SAEED_TRANSPORT_RPC');
      const result=envelope.result;let status=result?.structuredContent;
      if(!status){
        const blocks=result?.content;
        if(!Array.isArray(blocks)||blocks.length!==1||blocks[0]?.type!=='text')throw fail('SAEED_TRANSPORT_STATUS_SHAPE');
        try{status=parseStatusJson(blocks[0].text);}catch{throw fail('SAEED_TRANSPORT_STATUS_SHAPE');}
      }
      if(status?.name!=='chatgpt-remote-commander'||status.deviceName!=='saeid'||status.platform!=='win32'
        ||status.version!==expectedVersion||status.instance?.profile!=='default'||status.instance?.isolated!==false
        ||status.configSha256!==expectedConfigSha256)throw fail('SAEED_TRANSPORT_IDENTITY_DRIFT');
      receipt={schema:1,transport:'READ_ONLY_LOOPBACK_EXISTING_ROUTER',requestStartedAtEpochMs:started,
        receivedAtEpochMs:Date.now(),sourcePort:port,responseSha256:createHash('sha256').update(raw).digest('hex'),
        status,proofScope:'REAL_HOST_RESPONSE_NOT_BROWSER_OR_AUTONOMOUS_EXECUTION',automaticRetry:false};
    }catch(error){primary=error;}finally{
      if(requestClosed&&!closed){let timer;try{await Promise.race([requestClosed,new Promise(resolve=>{timer=setTimeout(resolve,500);})]);}finally{clearTimeout(timer);}}
      if(requestClosed&&!closed){secondary.push({phase:'REQUEST_CLOSE',code:'SAEED_TRANSPORT_CLOSE_UNCONFIRMED'});primary??=fail('SAEED_TRANSPORT_CLOSE_UNCONFIRMED');}
      // Unresolved physical close keeps the transport permanently busy.
      if(!requestClosed||closed)busy=false;
    }
    if(primary){const kept=Object.assign(new Error(primary.message),{code:primary.code??'SAEED_TRANSPORT_UNEXPECTED',secondaryRecords:Object.freeze(secondary),requestClosed:closed});throw kept;}
    return Object.freeze({...receipt,requestClosed:closed});
  };
}
