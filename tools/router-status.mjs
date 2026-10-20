import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Router status is an internal updater control plane endpoint, not a generic URL client.
export function assertRouterStatusUrl(value){
  if(typeof value!=='string'||value.length>256||value.includes('\\'))throw new Error('ROUTER_STATUS_URL_DENIED');
  let url;
  try{url=new URL(value);}catch{throw new Error('ROUTER_STATUS_URL_DENIED');}
  const port=Number(url.port);
  if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)
    ||!Number.isSafeInteger(port)||port<1024||port>65535
    ||url.username||url.password||url.search||url.hash
    ||url.pathname!=='/router/status'||value!==url.href)throw new Error('ROUTER_STATUS_URL_DENIED');
  return url;
}

export function parseRouterStatusArgs(argv){
  const o={timeoutMs:3000,json:false};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--json'){o.json=true;continue;}
    const v=argv[++i];if(v===undefined)throw new Error('ROUTER_STATUS_ARGUMENT');
    if(a==='--url')o.url=v;
    else if(a==='--port')o.port=Number(v);
    else if(a==='--timeout-ms')o.timeoutMs=Number(v);
    else throw new Error('ROUTER_STATUS_ARGUMENT');
  }
  if(!o.url||!Number.isSafeInteger(o.port)||o.port<1||o.port>65535)throw new Error('ROUTER_STATUS_REQUIRED');
  if(!Number.isSafeInteger(o.timeoutMs)||o.timeoutMs<250||o.timeoutMs>30000)throw new Error('ROUTER_STATUS_TIMEOUT');
  return o;
}

export async function queryRouterStatus(argv){
  const o=parseRouterStatusArgs(argv);
  const url=assertRouterStatusUrl(o.url); // fail before any HTTP request
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(o.timeoutMs)});
  if(!response.ok)throw new Error('ROUTER_STATUS_HTTP_'+response.status);
  const s=await response.json();
  if(!s?.ok||!s?.router)throw new Error('ROUTER_STATUS_INVALID');
  const n=Number(s.inflightByPort?.[String(o.port)]??0);
  if(!Number.isSafeInteger(n)||n<0)throw new Error('ROUTER_STATUS_COUNT');
  const details=Array.isArray(s.inflightDetailsByPort?.[String(o.port)])?s.inflightDetailsByPort[String(o.port)]:[];
  const validDetails=details.filter(x=>x&&typeof x==='object'&&typeof x.cancellable==='boolean');
  const cancellableOnly=n>0&&validDetails.length===n&&validDetails.every(x=>x.cancellable===true);
  return {count:n,cancellableOnly,details:validDetails,json:o.json};
}

const invoked=process.argv[1]?pathToFileURL(path.resolve(process.argv[1])).href:'';
if(invoked===import.meta.url){
  const result=await queryRouterStatus(process.argv.slice(2));
  if(result.json)console.log(JSON.stringify({count:result.count,cancellableOnly:result.cancellableOnly,details:result.details}));
  else console.log(result.count);
}
