import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createV2PrivatePairMcpIngress} from '../src/v2-private-pair-mcp-http-ingress.mjs';

const route=()=>({hostId:'pc1',profileId:'profileA',
  principalId:'accountA',conversationId:'chat1',operationId:'step1',
  target:{kind:'workflow-root',id:'project1'}});
const envelope=(method,params={},id=1)=>({jsonrpc:'2.0',id,method,params});
const tool=(name,argumentsValue)=>envelope('tools/call',{
  name,arguments:argumentsValue,_meta:{'openai/session':'chat1'}
});
function makeRequest(message,{tls=true,authorized=true,headers=[],url='/mcp',
  method='POST',raw=null}={}){
  const body=raw??JSON.stringify(message);
  const contents=Buffer.from(body);
  let delivered=false;
  const req=new Readable({read(){
    if(delivered)return;
    delivered=true;this.push(contents);this.push(null);
  }});
  req.socket={encrypted:tls,authorized};
  req.url=url;req.method=method;
  req.rawHeaders=['Content-Type','application/json',...headers];
  return req;
}
function response(){
  const r={status:null,headers:null,buffer:null};
  r.writeHead=(status,headers)=>{r.status=status;r.headers=headers;};
  r.end=data=>{r.buffer=data??'';};
  return r;
}
function fixture(){
  const state={attested:0,bound:0,operations:0};
  const ingress=createV2PrivatePairMcpIngress({
    attestTransport:async()=>{state.attested++;return {
      authenticated:true,peerType:'owner-pinned-private-tunnel-mtls',
      sessionSource:'native-owner-private-pair'
    };},
    ownerStack:{requestOwnerBinding:async({sessionHandle})=>{
      assert.equal(sessionHandle,'chat1');state.bound++;return {bindingId:'secret'};
    }},
    operationGate:{execute:async({route:r,tool,arguments:args})=>{
      state.operations++;
      assert.equal(r.conversationId,'chat1');
      assert.equal(tool,'run_shell');assert.equal(args.command,'echo safe');
      return {ok:true};
    }}
  });
  const send=async(msg,options={})=>{
    const res=response();
    await ingress.handle(makeRequest(msg,options),res);
    return {status:res.status,data:res.buffer?JSON.parse(String(res.buffer)):null,
      headers:res.headers};
  };
  return {state,ingress,send};
}

test('PRIVATE MCP exposes discovery only over independently trusted mTLS',async()=>{
  const f=fixture();
  const noTLS=await f.send(envelope('tools/list'),{tls:false});
  assert.equal(noTLS.status,403);
  assert.equal(f.state.attested,0);
  const badClient=await f.send(envelope('tools/list'),{authorized:false});
  assert.equal(badClient.status,403);
  const list=await f.send(envelope('tools/list'));
  assert.equal(list.status,200);
  assert.deepEqual(list.data.result.tools.map(t=>t.name),
    ['v2_private_owner_bind','v2_workflow_step']);
  assert.equal(f.state.bound,0);
  assert.equal(f.state.operations,0);
  assert.equal(list.headers['cache-control'],'no-store');
});

test('PRIVATE MCP only explicitly prompts J01 on owner_bind and does not leak the native token',async()=>{
  const f=fixture();
  const denied=await f.send(tool('v2_private_owner_bind',{extra:1}));
  assert.equal(denied.data.result.isError,true);
  assert.equal(f.state.bound,0);
  const accepted=await f.send(tool('v2_private_owner_bind',{}));
  assert.equal(accepted.status,200);
  assert.equal(accepted.data.result.isError,false);
  assert.equal(f.state.bound,1);
  assert.equal(f.state.operations,0);
  assert.doesNotMatch(JSON.stringify(accepted.data),/bindingId|secret/);
});

test('PRIVATE MCP workflow calls pass exact route and arguments only to native owner gate',async()=>{
  const f=fixture();
  const correct=await f.send(tool('v2_workflow_step',{
    route:route(),tool:'run_shell',arguments:{command:'echo safe'}
  }));
  assert.equal(correct.data.result.isError,false);
  assert.equal(f.state.operations,1);
  const otherChat=await f.send(tool('v2_workflow_step',{
    route:{...route(),conversationId:'chat2'},
    tool:'run_shell',arguments:{command:'echo safe'}
  }));
  assert.equal(otherChat.data.result.isError,true);
  assert.equal(f.state.operations,1);
  const missingSession=await f.send(envelope('tools/call',{
    name:'v2_workflow_step',arguments:{
      route:route(),tool:'run_shell',arguments:{command:'echo safe'}
    }
  }));
  assert.equal(missingSession.status,403);
  assert.equal(f.state.operations,1);
});

test('private gateway refuses Authorization bearer, duplicate header, plain HTTP and unknown tools',async()=>{
  const f=fixture();
  const request=tool('v2_workflow_step',{
    route:route(),tool:'run_shell',arguments:{command:'echo safe'}
  });
  for(const config of [
    {headers:['Authorization','Bearer forged']},
    {headers:['Content-Type','application/json']},
    {url:'/mcp?tool=run_shell'}, {tls:false}
  ]){
    const out=await f.send(request,config);
    assert.notEqual(out.status,200);
  }
  const unknown=await f.send(tool('power_shell',{}));
  assert.equal(unknown.data.result.isError,true);
  assert.equal(f.state.operations,0);
});

test('failed native grant or consent must not become a successful MCP result',async()=>{
  const ingress=createV2PrivatePairMcpIngress({
    attestTransport:async()=>({authenticated:true,
      peerType:'owner-pinned-private-tunnel-mtls',
      sessionSource:'native-owner-private-pair'}),
    ownerStack:{requestOwnerBinding:async()=>{throw Error('no native owner consent');}},
    operationGate:{execute:async()=>{throw Error('no signed current grant');}}
  });
  for(const msg of [
    tool('v2_private_owner_bind',{}),
    tool('v2_workflow_step',{
      route:route(),tool:'run_shell',arguments:{command:'echo safe'}
    })
  ]){
    const res=response();
    await ingress.handle(makeRequest(msg),res);
    assert.equal(res.status,503);
    assert.deepEqual(JSON.parse(String(res.buffer)),
      {error:'private_owner_admission_unavailable'});
  }
});

test('malformed bodies, oversized requests, unknown methods and missing TLS fail closed',async()=>{
  const f=fixture();
  const broken=await f.send(null,{raw:'{invalid'});
  assert.equal(broken.status,503);
  const large=await f.send(null,{raw:JSON.stringify({
    jsonrpc:'2.0',id:1,method:'tools/list',padding:'x'.repeat(67000)
  })});
  assert.equal(large.status,503);
  const unknown=await f.send(envelope('resources/list'));
  assert.equal(unknown.data.result.isError,true);
  assert.equal(f.state.operations,0);
  assert.throws(()=>createV2PrivatePairMcpIngress({}),
    {code:'V2_PRIVATE_MCP_TRUSTED_BOOTSTRAP_REQUIRED'});
});

test('one private Tunnel advertises multiple Core tools and resolves native route independently',async()=>{
  const log={canonical:0,validated:0,executed:0};
  const catalog=['read_text','gui_click','browser_navigate'].map(name=>({
    name,description:'Owner-scoped '+name,
    inputSchema:{type:'object',additionalProperties:false,properties:{
      path:{type:'string'},url:{type:'string'}
    }}
  }));
  const ingress=createV2PrivatePairMcpIngress({
    attestTransport:async()=>({
      authenticated:true,peerType:'owner-pinned-private-tunnel-mtls',
      sessionSource:'native-owner-private-pair'
    }),
    ownerStack:{
      requestOwnerBinding:async()=>{},
      nativeSessionBindings:{resolveNativeRoute:async session=>{
        log.canonical++;
        assert.equal(session,'chat1');
        return route();
      }}
    },
    operationGate:{execute:async command=>{
      log.executed++;
      assert.equal(command.route.operationId,'exact-read-1');
      assert.equal(command.route.conversationId,'chat1');
      assert.equal(command.tool,'read_text');
      assert.equal(command.arguments.path,'README.md');
      return {content:'ok'};
    }},
    trustedToolCatalog:catalog,
    validateToolInput:async(name,args)=>{
      log.validated++;
      return name==='read_text'&&args?.path==='README.md';
    },
    resolveTrustedToolRoute:async({sessionHandle,nativeRoute,tool})=>{
      assert.equal(sessionHandle,'chat1');
      assert.equal(tool,'read_text');
      return {...nativeRoute,operationId:'exact-read-1'};
    }
  });
  const send=async msg=>{
    const res=response();
    await ingress.handle(makeRequest(msg),res);
    return {status:res.status,data:JSON.parse(String(res.buffer))};
  };
  const listed=await send(envelope('tools/list'));
  assert.equal(listed.status,200);
  assert.deepEqual(listed.data.result.tools.map(t=>t.name),[
    'v2_private_owner_bind','v2_workflow_step',
    'read_text','gui_click','browser_navigate'
  ]);
  assert.equal(log.canonical,0);
  const invalid=await send(tool('read_text',{path:'/invalid'}));
  assert.equal(invalid.data.result.isError,true);
  assert.equal(log.executed,0);
  const accepted=await send(tool('read_text',{path:'README.md'}));
  assert.equal(accepted.data.result.isError,false);
  assert.equal(log.canonical,1);
  assert.equal(log.executed,1);
  assert.equal(log.validated,2);
});

test('a full Core catalog requires a trusted native route and input validator',()=>{
  const trustedToolCatalog=[{
    name:'read_text',description:'read one file',
    inputSchema:{type:'object',properties:{path:{type:'string'}}}
  }];
  const deps={
    attestTransport:async()=>({authenticated:true}),
    ownerStack:{requestOwnerBinding:async()=>{}},
    operationGate:{execute:async()=>({})},trustedToolCatalog
  };
  assert.throws(()=>createV2PrivatePairMcpIngress(deps),
    {code:'V2_PRIVATE_MCP_CANONICAL_ROUTE_REQUIRED'});
  deps.ownerStack.nativeSessionBindings={resolveNativeRoute:async()=>route()};
  assert.throws(()=>createV2PrivatePairMcpIngress(deps),
    {code:'V2_PRIVATE_MCP_INPUT_VALIDATOR_REQUIRED'});
  deps.validateToolInput=async()=>true;
  assert.throws(()=>createV2PrivatePairMcpIngress(deps),
    {code:'V2_PRIVATE_MCP_TRUSTED_OPERATION_ROUTE_REQUIRED'});
  deps.resolveTrustedToolRoute=async({nativeRoute})=>({...nativeRoute,operationId:'action-1'});
  for(const invalid of [
    [{...trustedToolCatalog[0],name:'v2_workflow_step'}],
    [trustedToolCatalog[0],trustedToolCatalog[0]],
    [{...trustedToolCatalog[0],name:'ReadText'}],
    [new Proxy(trustedToolCatalog[0],{})],
    [Object.defineProperty({...trustedToolCatalog[0]},'name',{
      enumerable:true,get(){throw Error('getter');}
    })]
  ])assert.throws(()=>createV2PrivatePairMcpIngress({
    ...deps,trustedToolCatalog:invalid
  }),{code:'V2_PRIVATE_MCP_CATALOG_INVALID'});
});

test('native resolver cannot redirect a private Core tool to a different chat',async()=>{
  let executed=0;
  const ingress=createV2PrivatePairMcpIngress({
    attestTransport:async()=>({authenticated:true,
      peerType:'owner-pinned-private-tunnel-mtls',
      sessionSource:'native-owner-private-pair'}),
    ownerStack:{
      requestOwnerBinding:async()=>{},
      nativeSessionBindings:{resolveNativeRoute:async()=>({
        ...route(),conversationId:'other-chat'
      })}
    },
    operationGate:{execute:async()=>{executed++;return {ok:true};}},
    trustedToolCatalog:[{
      name:'read_text',description:'owner read',
      inputSchema:{type:'object',properties:{path:{type:'string'}}}
    }],
    validateToolInput:async()=>true,
    resolveTrustedToolRoute:async({nativeRoute})=>({...nativeRoute,operationId:'action-1'})
  });
  const res=response();
  await ingress.handle(makeRequest(tool('read_text',{path:'README.md'})),res);
  assert.equal(res.status,403);
  assert.equal(JSON.parse(String(res.buffer)).error,'private_session_route_mismatch');
  assert.equal(executed,0);
});

test('large owner-approved Core catalog remains available on one PRIVATE Tunnel',async()=>{
  const catalog=Array.from({length:48},(_,i)=>({
    name:'core_tool_'+i,description:'owner scoped '+('x'.repeat(1600)),
    inputSchema:{type:'object',additionalProperties:false,properties:{}}
  }));
  const ingress=createV2PrivatePairMcpIngress({
    attestTransport:async()=>({authenticated:true,
      peerType:'owner-pinned-private-tunnel-mtls',
      sessionSource:'native-owner-private-pair'}),
    ownerStack:{requestOwnerBinding:async()=>{},
      nativeSessionBindings:{resolveNativeRoute:async()=>route()}},
    operationGate:{execute:async()=>({ok:true})},
    trustedToolCatalog:catalog,validateToolInput:async()=>false,
    resolveTrustedToolRoute:async({nativeRoute})=>({...nativeRoute,operationId:'action-1'})
  });
  const res=response();
  await ingress.handle(makeRequest(envelope('tools/list')),res);
  assert.equal(res.status,200);
  assert.ok(Number(res.headers['content-length'])>65536);
  assert.equal(JSON.parse(String(res.buffer)).result.tools.length,50);
});

test('direct operations require distinct owner-issued routes, not a reused J01 enrollment or JSON-RPC id',async()=>{
  const seen=[];
  const ingress=createV2PrivatePairMcpIngress({
    attestTransport:async()=>({authenticated:true,
      peerType:'owner-pinned-private-tunnel-mtls',sessionSource:'native-owner-private-pair'}),
    ownerStack:{requestOwnerBinding:async()=>{},
      nativeSessionBindings:{resolveNativeRoute:async()=>route()}},
    operationGate:{execute:async({route:r})=>{
      seen.push(r.operationId);return {done:r.operationId};
    }},
    trustedToolCatalog:[{name:'read_text',description:'owner read',
      inputSchema:{type:'object',properties:{requestId:{type:'string'}}}}],
    validateToolInput:async(_tool,args)=>args?.requestId==='action1'||args?.requestId==='action2',
    // Only a trusted owner worker can select the exact operation route.
    resolveTrustedToolRoute:async({nativeRoute,tool,arguments:args})=>{
      assert.equal(tool,'read_text');assert.equal(nativeRoute.operationId,'step1');
      return {...nativeRoute,operationId:args.requestId};
    }
  });
  for(const action of ['action1','action2']){
    const res=response();
    // Deliberately same JSON-RPC ID on both completed requests:
    // the current MCP specification does not promise lifetime uniqueness.
    await ingress.handle(makeRequest(tool('read_text',{requestId:action})),res);
    assert.equal(res.status,200);
    assert.equal(JSON.parse(String(res.buffer)).result.isError,false);
  }
  assert.deepEqual(seen,['action1','action2']);
});

test('trusted operation route cannot change native owner host, profile or chat',async()=>{
  for(const changed of [
    {hostId:'otherHost'},{profileId:'otherProfile'},
    {principalId:'otherPrincipal'},{conversationId:'otherChat'}
  ]){
    let effects=0;
    const ingress=createV2PrivatePairMcpIngress({
      attestTransport:async()=>({authenticated:true,
        peerType:'owner-pinned-private-tunnel-mtls',sessionSource:'native-owner-private-pair'}),
      ownerStack:{requestOwnerBinding:async()=>{},
        nativeSessionBindings:{resolveNativeRoute:async()=>route()}},
      operationGate:{execute:async()=>{effects++;return {ok:true};}},
      trustedToolCatalog:[{name:'read_text',description:'owner read',
        inputSchema:{type:'object',properties:{path:{type:'string'}}}}],
      validateToolInput:async()=>true,
      resolveTrustedToolRoute:async({nativeRoute})=>({...nativeRoute,
        operationId:'action1',...changed})
    });
    const res=response();
    await ingress.handle(makeRequest(tool('read_text',{path:'README.md'})),res);
    assert.equal(res.status,403);
    assert.equal(JSON.parse(String(res.buffer)).error,'private_operation_route_mismatch');
    assert.equal(effects,0);
  }
});
