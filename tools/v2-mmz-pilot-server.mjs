// Commander V2 / MMZ: owner-local diagnostic MCP plus bounded owner-review proposals.
// No delegation, shell, GUI, arbitrary filesystem or workflow execution;
// proposal enqueue is NOT owner consent or ChatGPT principal attestation.
import https from 'node:https';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createHash, X509Certificate} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {READ_ONLY_TOOLS,executeReadOnlyTool} from './v2-readonly-tools.mjs';
import {createV2OwnerApprovalQueue} from './src/v2-owner-approval-queue.mjs';
import {OWNER_PROPOSAL_TOOL,createV2OwnerProposalHandler} from './src/v2-owner-proposal-tool.mjs';
import {V2_V1_BRIDGE_TOOLS,createV2V1ToolBridge} from './src/v2-v1-tool-bridge.mjs';
import {V2_V1_READINESS_TOOL,createV2V1SafeObserver} from './src/v2-v1-safe-observer.mjs';
import {createV2SecureTunnelServerTlsOptions,
        createV2SecureTunnelClientMtlsAttestor} from './v2-secure-tunnel-mtls.mjs';

const CONFIG = join(homedir(),'.config','CommanderV2','secure-tunnel','pki');
const ID='commander-v2-mmz-readonly';
const PORT=55591;
const MAX_BODY=32768;
const PATH='/mcp-v2';
const versions=new Set(['2025-03-26','2025-06-18','2025-11-25','2026-07-28']);
function cert(file){return readFileSync(join(CONFIG,file),'utf8');}
function tlsSettings(){
  const ca=cert('ca.pem'), serverCertificatePem=cert('server-cert.pem'),serverPrivateKeyPem=cert('server-key.pem');
  const clientCertificatePem=cert('client-cert.pem');
  const digest=pem=>createHash('sha256').update(new X509Certificate(pem).raw).digest('hex');
  const clientCaDerSha256=digest(ca),clientCertificateSha256=digest(clientCertificatePem);
  const options=createV2SecureTunnelServerTlsOptions({
    serverCertificatePem,serverPrivateKeyPem,clientCaPem:ca,clientCaDerSha256,expectedServerDns:'localhost'
  });
  const attest=createV2SecureTunnelClientMtlsAttestor({
    clientCaDerSha256,clientCertificateSha256,expectedClientDns:'commander-v2-tunnel-client'
  });
  return {options,attest};
}
function send(res,code,data){
  const bytes=Buffer.from(JSON.stringify(data));
  res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','content-length':bytes.length});
  res.end(bytes);
}
function rpcError(id,code,message){return {jsonrpc:'2.0',id,error:{code,message}};}
async function localV1ToolCatalog(){
 const controller=new AbortController();
 const cancel=setTimeout(()=>controller.abort(),3000);
 try{
  const response=await fetch('http://127.0.0.1:47831/mcp',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'}),
   signal:controller.signal
  });
  if(response.status!==200)throw Error('V1_NOT_READY');
  const data=await response.json();
  const items=data?.result?.tools;
  if(!Array.isArray(items)||items.length>256||items.length<1)
   throw Error('V1_CATALOG_INVALID');
  return items.map(x=>x?.name);
 }finally{clearTimeout(cancel)}
}

async function localV1ReadOnly(tool){
 if(!['gui_status','browser_status','workflow_health','power_status'].includes(tool))
  throw Error('V2_OBSERVER_TOOL_DENIED');
 const controller=new AbortController(),cancel=setTimeout(()=>controller.abort(),3000);
 try{
  const response=await fetch('http://127.0.0.1:47831/mcp',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',
     params:{name:tool,arguments:{}}}),signal:controller.signal
  });
  if(response.status!==200)throw Error('V2_OBSERVER_TRANSPORT_FAILED');
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>262144)throw Error('V2_OBSERVER_RESPONSE_TOO_LARGE');
  const j=await response.json();
  if(j.error||j.result?.isError===true)throw Error('V2_OBSERVER_V1_DENIED');
  const content=j.result?.structuredContent;
  if(!content||typeof content!=='object')throw Error('V2_OBSERVER_RESPONSE_INVALID');
  return content;
 }finally{clearTimeout(cancel)}
}
function reply(id,result){return {jsonrpc:'2.0',id,result};}
async function handleMessage(msg,ownerProposalHandler,bridge,observeV1){
  const id=msg.id??null;
  if(msg.jsonrpc!=='2.0'||typeof msg.method!=='string')return rpcError(id,-32600,'Invalid Request');
  if(msg.method==='initialize'){
    const requested=msg.params?.protocolVersion;
    return reply(id,{protocolVersion:versions.has(requested)?requested:'2025-11-25',
      capabilities:{tools:{listChanged:false}},
      serverInfo:{name:ID,version:'0.3.0'},
      instructions:'Diagnostics are read-only. Note proposals only enqueue; they require separate local owner review and do not grant system control or attest a ChatGPT principal.'});
  }
  if(msg.method==='ping')return reply(id,{});
  if(msg.method==='tools/list')return reply(id,{tools:[...READ_ONLY_TOOLS,OWNER_PROPOSAL_TOOL,...V2_V1_BRIDGE_TOOLS,V2_V1_READINESS_TOOL]});
  if(msg.method==='tools/call'){
    const name=msg.params?.name;
    if(name===OWNER_PROPOSAL_TOOL.name)return reply(id,ownerProposalHandler({name,args:msg.params?.arguments}));
    if(name==='v2_v1_tool_catalog'){
      const a=msg.params?.arguments;
      if(a!==undefined&&(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).length))
       return rpcError(id,-32602,'No arguments accepted');
      try{
       const names=await bridge.catalog();
       return reply(id,{content:[{type:'text',text:'V1 tool names only; no execution.'}],
        structuredContent:{toolCount:names.length,toolNames:names,
         bridgeStatus:'OWNER_REVIEW_REQUIRED',fullControl:false}});
      }catch{return reply(id,{isError:true,content:[{type:'text',text:'V1 catalog unavailable'}]})}
    }
    if(name==='v2_v1_live_readiness'){
      try{
       const result=await observeV1(msg.params?.arguments);
       return reply(id,{isError:false,
         content:[{type:'text',text:'Redacted V1 runtime readiness (no private data).'}],
         structuredContent:result});
      }catch{return reply(id,{isError:true,content:[{type:'text',text:'V2_V1_READINESS_UNAVAILABLE'}]})}
    }
    if(name==='v2_v1_request_status'){
      const args=msg.params?.arguments;
      if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length!==1||
         typeof args.requestId!=='string')
       return rpcError(id,-32602,'Invalid status request');
      try{
       const result=bridge.progress(args.requestId);
       return reply(id,{isError:false,content:[{type:'text',text:'Request status only; no private operation output.'}],
         structuredContent:result});
      }catch{return reply(id,{isError:true,content:[{type:'text',text:'V2_BRIDGE_STATUS_UNAVAILABLE'}]})}
    }
    if(name==='v2_request_owner_tool'){
      const a=msg.params?.arguments;
      if(!a||typeof a!=='object'||Array.isArray(a)||
         Object.keys(a).length!==2||!Object.hasOwn(a,'tool')||!Object.hasOwn(a,'arguments'))
        return rpcError(id,-32602,'Invalid action shape');
      try{
       const queued=await bridge.request(a);
       return reply(id,{content:[{type:'text',text:'V1-equivalent request queued, not executed. Native owner review required.'}],
         structuredContent:queued});
      }catch{return reply(id,{isError:true,content:[{type:'text',text:'V2_BRIDGE_REQUEST_DENIED'}]})}
    }

    if(!READ_ONLY_TOOLS.some(t=>t.name===name))return rpcError(id,-32602,'Unknown tool');
    const args=msg.params?.arguments;
    if(args!==undefined && (args===null || typeof args!=='object' ||
      Array.isArray(args) || Object.keys(args).length!==0))
      return rpcError(id,-32602,'No arguments accepted');
    const result=await executeReadOnlyTool(name);
    if(result===null)return rpcError(id,-32602,'Unknown tool');
    return reply(id,{content:[{type:'text',text:JSON.stringify(result)}],isError:false});
  }
  return rpcError(id,-32601,'Method not found');
}
export async function start({port=PORT,approvalRoot,bridgeRoot}={}){
 if(!Number.isSafeInteger(port)||port<1024||port>65535)throw new Error('PORT_INVALID');
 const {options,attest}=tlsSettings();
 const ownerQueue=createV2OwnerApprovalQueue(approvalRoot===undefined?{}:{root:approvalRoot});
 const ownerProposalHandler=createV2OwnerProposalHandler({queue:ownerQueue});
 const bridge=createV2V1ToolBridge({...(bridgeRoot?{root:bridgeRoot}:{}),loadCatalog:localV1ToolCatalog});
 const observeV1=createV2V1SafeObserver({invokeReadOnly:localV1ReadOnly});
 const server=https.createServer(options,async(req,res)=>{
  res.setHeader('x-content-type-options','nosniff');
  try{
   const approved=await attest(req);
   if(approved.authenticated!==true){send(res,403,{error:'invalid_client_certificate'});return;}
   if(typeof req.url!=='string'||req.url!==PATH){send(res,404,{error:'not_found'});return;}
   const host=req.headers.host;
   if(host!=='localhost:'+port&&host!=='127.0.0.1:'+port){send(res,403,{error:'untrusted_host'});return;}
   if(req.headers.origin!==undefined||req.headers['sec-fetch-site']==='cross-site'){
    send(res,403,{error:'untrusted_origin'});return;
   }
   if(req.method==='GET'||req.method==='HEAD'){
    res.writeHead(405,{'allow':'POST','cache-control':'no-store'});res.end();return;
   }
   if(req.method!=='POST'){send(res,405,{error:'method_not_allowed'});return;}
   if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']||'')){
    send(res,415,{error:'content_type_required'});return;
   }
   if(Number(req.headers['content-length'])>MAX_BODY){send(res,413,{error:'body_too_large'});return;}
   let size=0,chunks=[];
   for await(const b of req){size+=b.length;if(size>MAX_BODY)throw new Error('BODY_TOO_LARGE');chunks.push(b);}
   if(!size){send(res,400,{error:'empty_body'});return;}
   let parsed;
   try{parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
   catch{send(res,400,rpcError(null,-32700,'Parse error'));return;}
   if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)){
    send(res,400,rpcError(null,-32600,'Invalid Request'));return;
   }
   if(parsed.jsonrpc==='2.0'&&parsed.method==='notifications/initialized'&&parsed.id===undefined){
    res.writeHead(202,{'cache-control':'no-store'});res.end();return;
   }
   send(res,200,await handleMessage(parsed,ownerProposalHandler,bridge,observeV1));
  }catch{if(!res.headersSent)send(res,400,{error:'bad_request'});else res.end();}
 });
 server.maxConnections=24;
 await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',()=>{server.off('error',no);yes();});});
 return server;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const server=await start();
 process.stdout.write('V2_READONLY_MCP_LISTENING_127.0.0.1:55591\n');
 let exiting=false;
 for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{
  if(exiting)return;exiting=true;
  server.closeAllConnections();server.close(()=>{process.exitCode=0;});
 });
}
