// Private per-(account,host) MCP source candidate. Does NOT bind a port.
// On a protected TLS/mTLS host the exact pair is independently attested.
// No Authorization bearer, public OAuth issuer, per-service tunnel or legacy
// privileged HTTP fallback. Never grants OS rights: Native J01 and exact signed
// worker action grants remain mandatory at every protected tools/call.
const SESSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEADER_TYPES=new Set(['content-type','authorization','mcp-protocol-version']);
const fail=code=>{throw Object.assign(new Error(code),{code});};
function json(res,status,data){
  let bytes;
  try{bytes=Buffer.from(JSON.stringify(data));}
  catch{bytes=Buffer.from('{"error":"candidate_unavailable"}');status=503;}
  if(bytes.length>65536){
    bytes=Buffer.from('{"error":"result_too_large"}');
    status=503;
  }
  res.writeHead(status,{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','content-length':bytes.length});
  res.end(bytes);
}
function rpc(id,result){return {jsonrpc:'2.0',id,result};}
function error(id){return rpc(id,{isError:true,content:[
  {type:'text',text:'Native owner and exact-action authorization required.'}
]});}
function header(req,name){
  let found=null;
  const raw=req.rawHeaders;
  if(!Array.isArray(raw)||raw.length%2!==0)fail('PRIVATE_MCP_HEADERS_INVALID');
  for(let i=0;i<raw.length;i+=2){
    const field=raw[i],value=raw[i+1];
    if(typeof field!=='string'||typeof value!=='string')
      fail('PRIVATE_MCP_HEADERS_INVALID');
    const key=field.toLowerCase();
    if(key===name){
      if(found!==null)fail('PRIVATE_MCP_DUPLICATE_HEADER');
      found=value;
    }
  }
  return found;
}
async function payload(req,limit){
  const type=header(req,'content-type');
  if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(type??''))
    fail('PRIVATE_MCP_CONTENT_TYPE');
  if(header(req,'authorization')!==null)
    fail('PRIVATE_MCP_AUTH_BEARER_NOT_ACCEPTED');
  const length=header(req,'content-length');
  if(length!==null&&(!/^\d{1,10}$/.test(length)||Number(length)>limit))
    fail('PRIVATE_MCP_BODY_BOUNDS');
  let lengthSeen=0;
  const chunks=[];
  for await(const chunk of req){
    lengthSeen+=chunk.length;
    if(lengthSeen>limit)fail('PRIVATE_MCP_BODY_BOUNDS');
    chunks.push(chunk);
  }
  if(lengthSeen<2)fail('PRIVATE_MCP_JSON_REQUIRED');
  let parsed;
  try{parsed=JSON.parse(Buffer.concat(chunks,lengthSeen).toString('utf8'));}
  catch{fail('PRIVATE_MCP_JSON_REQUIRED');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)
    ||parsed.jsonrpc!=='2.0'||typeof parsed.method!=='string')
    fail('PRIVATE_MCP_RPC_INVALID');
  return parsed;
}

const TOOLS=Object.freeze([
  Object.freeze({
    name:'v2_private_owner_bind',
    description:'Request native OS-owner approval for this exact private conversation; grants no tool privileges.',
    inputSchema:{type:'object',additionalProperties:false,properties:{}}
  }),
  Object.freeze({
    name:'v2_workflow_step',
    description:'Execute one owner-authorized, revocable workflow action on this exact host and private pair.',
    inputSchema:{type:'object',additionalProperties:false,
      required:['route','tool','arguments'],
      properties:{
        route:{type:'object'},tool:{type:'string'},arguments:{type:'object'}
      }}
  })
]);

export function createV2PrivatePairMcpIngress({
  attestTransport,ownerStack,operationGate,maxBodyBytes=65536
}={}){
  if(typeof attestTransport!=='function'
    ||typeof ownerStack?.requestOwnerBinding!=='function'
    ||typeof operationGate?.execute!=='function'
    ||!Number.isSafeInteger(maxBodyBytes)||maxBodyBytes<1024
    ||maxBodyBytes>262144)
    fail('V2_PRIVATE_MCP_TRUSTED_BOOTSTRAP_REQUIRED');
  async function handle(req,res){
    try{
      // There is intentionally no createUnboundServer, plaintext fallback,
      // proxy scheme or OAuth route in this source candidate.
      if(!req?.socket||req.socket.encrypted!==true
        ||req.socket.authorized!==true){
        json(res,403,{error:'trusted_transport_required'});return;
      }
      if(req.url!=='/mcp'){
        json(res,404,{error:'not_found'});return;
      }
      if(req.method!=='POST'){
        json(res,405,{error:'method_not_allowed'});return;
      }
      const attested=await attestTransport(req);
      if(attested?.authenticated!==true
        ||attested.peerType!=='owner-pinned-private-tunnel-mtls'
        ||attested.sessionSource!=='native-owner-private-pair'){
        json(res,403,{error:'trusted_transport_required'});return;
      }
      const message=await payload(req,maxBodyBytes);
      const id=typeof message.id==='string'
        ||Number.isSafeInteger(message.id)?message.id:null;
      if(message.method==='initialize'){
        json(res,200,rpc(id,{
          protocolVersion:'2025-11-25',
          capabilities:{tools:{listChanged:false}},
          serverInfo:{name:'commander-v012-private-candidate',version:'0.12.0'}
        }));return;
      }
      if(message.method==='notifications/initialized'){
        res.writeHead(202,{'cache-control':'no-store'});res.end();return;
      }
      if(message.method==='tools/list'){
        json(res,200,rpc(id,{tools:TOOLS}));return;
      }
      if(message.method!=='tools/call'
        ||!message.params||typeof message.params!=='object'
        ||Array.isArray(message.params)
        ||!['v2_private_owner_bind','v2_workflow_step'].includes(message.params.name)){
        json(res,200,error(id));return;
      }
      const name=message.params.name;
      const session=message.params._meta?.['openai/session'];
      if(typeof session!=='string'||!SESSION.test(session)
        ||session==='.'||session==='..'||session.startsWith('mcp-')){
        json(res,403,{error:'private_session_required'});return;
      }
      if(name==='v2_private_owner_bind'){
        // Explicit native owner action, never automatic on tools/list.
        // A successful binding still does not grant tools or OS privileges.
        if(message.params.arguments===null
          ||typeof message.params.arguments!=='object'
          ||Array.isArray(message.params.arguments)
          ||Object.keys(message.params.arguments).length!==0){
          json(res,200,error(id));return;
        }
        await ownerStack.requestOwnerBinding({request:req,sessionHandle:session});
        json(res,200,rpc(id,{isError:false,content:[
          {type:'text',text:'Native owner session approved. Exact tool grants are still required.'}
        ]}));return;
      }
      const action=message.params.arguments;
      if(!action||typeof action!=='object'||Array.isArray(action)
        ||Object.keys(action).length!==3
        ||!Object.hasOwn(action,'route')||!Object.hasOwn(action,'tool')
        ||!Object.hasOwn(action,'arguments')
        ||action.route?.conversationId!==session){
        json(res,200,error(id));return;
      }
      const result=await operationGate.execute({
        request:req,route:action.route,tool:action.tool,
        arguments:action.arguments
      });
      json(res,200,rpc(id,{isError:false,content:[
        {type:'text',text:JSON.stringify(result)}
      ]}));
    }catch{
      // No stack traces, access keys, raw arguments, native dialogs or
      // Windows owner paths are reflected to remote callers.
      json(res,503,{error:'private_owner_admission_unavailable'});
    }
  }
  return Object.freeze({
    requiredTransport:'owner-pinned-private-tunnel-mtls',
    handle,allowedTools:TOOLS.map(t=>t.name)
  });
}
