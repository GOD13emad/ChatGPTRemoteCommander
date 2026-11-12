import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createV2CandidatePrivateTunnelHttpsGateway} from '../src/v2-private-tunnel-https-gateway.mjs';
import {createV2PlatformSessionProofAuthority} from '../src/v2-platform-session-proof.mjs';
import {createV101G1PrivateTunnelRuntime,createV101G1PrivatePairRuntime} from '../src/v101-g1-loopback-runtime.mjs';
import './v2-private-pair-mcp-http-ingress.test.mjs';

const RESOURCE='https://commander.example.invalid/mcp-v2';
const ISSUER='https://idp.example.invalid';
const QA_TOKEN=['synthetic','tunnel','qa','token','1234'].join('-');
function openssl(args,cwd){
  const result=spawnSync('openssl',args,{
    cwd,encoding:'utf8',timeout:9000,windowsHide:true
  });
  if(result.error||result.status!==0)throw Error(
    'FIXTURE_OPENSSL_ERROR '+(result.error?.code??result.status));
}
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v012-tunnel-mtls-'));
  const cfg=process.platform==='win32'?'NUL':'/dev/null';
  try{
    const req=(name,ca)=>openssl([
      'req','-x509','-newkey','rsa:2048','-nodes','-sha256',
      '-config',cfg,'-days','1','-keyout',name+'.key','-out',name+'.crt',
      '-subj','/CN='+name,...(ca?['-addext','basicConstraints=critical,CA:TRUE',
      '-addext','keyUsage=critical,keyCertSign,cRLSign']:[])
    ],dir);
    req('ca',true);req('server',false);
    function client(name){
      openssl(['req','-newkey','rsa:2048','-nodes','-sha256',
        '-config',cfg,'-keyout',name+'.key','-out',name+'.csr',
        '-subj','/CN='+name],dir);
      const ext=path.join(dir,name+'.ext');
      fs.writeFileSync(ext,'basicConstraints=critical,CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=clientAuth\n');
      openssl(['x509','-req','-in',name+'.csr','-CA','ca.crt',
        '-CAkey','ca.key','-CAcreateserial','-out',name+'.crt',
        '-days','1','-sha256','-extfile',name+'.ext'],dir);
    }
    client('tunnel');client('unrecognized');
    const file=name=>fs.readFileSync(path.join(dir,name),'utf8');
    const tunnelCert=file('tunnel.crt');
    const tunnelDer=requireDer(tunnelCert);
    return {
      ca:file('ca.crt'),serverCert:file('server.crt'),serverKey:file('server.key'),
      clientCert:tunnelCert,clientKey:file('tunnel.key'),
      alienCert:file('unrecognized.crt'),alienKey:file('unrecognized.key'),
      clientSha:createHash('sha256').update(tunnelDer).digest('hex'),
      dispose(){fs.rmSync(dir,{recursive:true,force:true});}
    };
  }catch(e){fs.rmSync(dir,{recursive:true,force:true});throw e;}
}
function requireDer(pem){
  return Buffer.from(pem.match(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/)[1].replace(/\s+/g,''),'base64');
}
const tdata=now=>({
  source:'native-tunnel-attestor',provider:'openai-secure-mcp-tunnel',
  profileId:'emad',tunnelIdHash:'a'.repeat(64),ownerSidHash:'b'.repeat(64),
  authenticated:true,controlPlanePollOk:true,healthzStatus:200,readyzStatus:200,
  lastPollAtMs:now-100,expiresAtMs:now+60000
});
function createGateway(f,identity){
  const authority=createV2PlatformSessionProofAuthority();
  const seen=[];
  const now=Date.now();
  const gateway=createV2CandidatePrivateTunnelHttpsGateway({
    resource:RESOURCE,authorizationServers:[ISSUER],
    certificatePem:f.serverCert,privateKeyPem:f.serverKey,clientCaPem:f.ca,
    expectedClientLeafDerSha256:f.clientSha,
    profileId:'emad',resolveTransportIdentity:async()=>identity??tdata(now),
    platformSessionProofAuthority:authority,now:()=>now,
    dispatcherFactory:async value=>{
      seen.push(value);
      return {protectedResource:gateway.protectedResource,
        async handleRpc(){return {jsonrpc:'2.0',id:1,result:{ok:true}};}};
    }
  });
  return {gateway,authority,seen};
}
async function request(port,cert,key){
  return new Promise(resolve=>{
    const body=Buffer.from(JSON.stringify({
      jsonrpc:'2.0',id:1,method:'tools/call',
      params:{name:'v2_workflow_step',arguments:{},_meta:{'openai/session':'chat-1'}}
    }));
    const req=https.request({
      host:'127.0.0.1',port,path:'/mcp-v2',method:'POST',
      rejectUnauthorized:false,
      ...(cert?{cert,key}:{})
    },res=>{
      let data='';res.on('data',c=>data+=c);
      res.on('end',()=>resolve({status:res.statusCode,body:data}));
    });
    req.on('error',e=>resolve({code:e.code??'TLS_DENIED'}));
    req.setTimeout(2500,()=>req.destroy());
    req.setHeader('content-type','application/json');
    req.setHeader('authorization','Bearer '+QA_TOKEN);
    req.end(body);
  });
}
test('tunnel HTTPS endpoint is unbound, client-cert-only and rejects unknown client',async t=>{
  let f;
  try{f=fixture();}catch{return t.skip('OpenSSL fixture generator unavailable');}
  let server;
  try{
    const x=createGateway(f);
    server=x.gateway.createUnboundTlsServer();
    assert.equal(server.listening,false);
    assert.equal(server.requestCert,true);
    assert.equal(server.rejectUnauthorized,true);
    await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).once('error',reject));
    const port=server.address().port;
    const none=await request(port,null,null);
    assert.equal(none.status,undefined);
    assert.ok(none.code,'No client certificate must not complete TLS');
    const alien=await request(port,f.alienCert,f.alienKey);
    assert.equal(alien.status,403,'Other CA-signed clients are not the pinned tunnel process');
    const ok=await request(port,f.clientCert,f.clientKey);
    assert.equal(ok.status,200);
    assert.equal(x.seen.length,1);
    assert.deepEqual({...x.authority.inspect(x.seen[0].platformSessionProof)},{
      peerType:'openai-tunnel-client-mtls',sessionSource:'openai/session',
      sessionHandle:'chat-1',
      tokenSha256:createHash('sha256').update(QA_TOKEN).digest('hex')
    });
  }finally{
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    f.dispose();
  }
});
test('stale tunnel control-plane identity rejects authenticated TLS requests',async t=>{
  let f;try{f=fixture();}catch{return t.skip('OpenSSL fixture generator unavailable');}
  let server;
  try{
    const now=Date.now();const x=createGateway(f,{...tdata(now),controlPlanePollOk:false});
    server=x.gateway.createUnboundTlsServer();
    await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).once('error',reject));
    const reply=await request(server.address().port,f.clientCert,f.clientKey);
    assert.equal(reply.status,403);
    assert.equal(x.seen.length,0);
  }finally{
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    f.dispose();
  }
});
test('tunnel gateway refuses missing CA, unmatched key and missing trusted process callback',async t=>{
  let f;try{f=fixture();}catch{return t.skip('OpenSSL fixture generator unavailable');}
  try{
    const options={
      resource:RESOURCE,authorizationServers:[ISSUER],
      certificatePem:f.serverCert,privateKeyPem:f.serverKey,
      clientCaPem:f.ca,expectedClientLeafDerSha256:f.clientSha,
      profileId:'emad',resolveTransportIdentity:async()=>tdata(Date.now()),
      dispatcherFactory:async()=>({})
    };
    for(const patch of [
      {clientCaPem:''},{privateKeyPem:f.alienKey},
      {resolveTransportIdentity:undefined},{expectedClientLeafDerSha256:'bad'}
    ])assert.throws(()=>createV2CandidatePrivateTunnelHttpsGateway({...options,...patch}));
  }finally{f.dispose();}
});

test('full owner-scoped tunnel Runtime stays closed until explicit start and cannot grant Full Access',async t=>{
  let f;try{f=fixture();}catch{return t.skip('OpenSSL fixture generator unavailable');}
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v012-owner-stack-'));
  let runtime;
  const attempts={oauth:0,owner:0,dispatch:0};
  try{
    const now=Date.now();
    const hostOptions={
      directory,resource:RESOURCE,authorizationServers:[ISSUER],
      certificatePem:f.serverCert,privateKeyPem:f.serverKey,clientCaPem:f.ca,
      expectedClientLeafDerSha256:f.clientSha,
      resolveTransportIdentity:async()=>tdata(now),
      hostId:'host-1',profileId:'emad',issuer:ISSUER,audience:RESOURCE,
      verifyAccessToken:async()=>{attempts.oauth++;throw Error('QA_NO_OAUTH');},
      resolvePrincipal:async()=>{attempts.owner++;return 'owner-1';},
      resolveOwnerRoute:async()=>{attempts.owner++;throw Error('NO_REAL_OWNER_PROOF');},
      authorizeExactInvocation:async()=>{attempts.dispatch++;return false;},
      createTrustedDispatcher:async()=>({
        protectedResource:{
          metadataUrl:new URL('/.well-known/oauth-protected-resource/mcp-v2',RESOURCE).href
        },
        handleRpc:async()=>({jsonrpc:'2.0',id:1,result:{isError:true}})
      })
    };
    runtime=createV101G1PrivateTunnelRuntime({port:0,hostOptions});
    assert.equal(runtime.status.phase,'CONSTRUCTED');
    assert.equal(runtime.status.port,null);
    assert.equal(runtime.status.protectedTransport,'private-tunnel-client-mtls');
    assert.equal(runtime.status.fullAccessActive,false);
    assert.equal(runtime.status.authenticatedCurrentChatAccepted,false);
    const live=await runtime.start();
    assert.equal(live.phase,'LISTENING');
    const bad=await request(live.port,f.alienCert,f.alienKey);
    assert.equal(bad.status,403);
    const acceptedClient=await request(live.port,f.clientCert,f.clientKey);
    assert.equal(acceptedClient.status,200);
    assert.equal(JSON.parse(acceptedClient.body).result?.isError,true);
    assert.equal(attempts.dispatch,0);
    await runtime.close();
    assert.equal(runtime.status.phase,'CLOSED');
    assert.equal(runtime.status.releaseAccepted,false);
  }finally{
    await runtime?.close();
    f.dispose();
    fs.rmSync(directory,{recursive:true,force:true});
  }
});

async function privatePairRequest(port,cert,key,message,extraHeaders={}){
  return new Promise(resolve=>{
    const bytes=Buffer.from(JSON.stringify(message));
    const req=https.request({
      host:'127.0.0.1',port,path:'/mcp',method:'POST',
      rejectUnauthorized:false,...(cert?{cert,key}:{})
    },res=>{
      let data='';res.on('data',c=>data+=c);
      res.on('end',()=>resolve({status:res.statusCode,
        body:data?JSON.parse(data):null}));
    });
    req.setHeader('content-type','application/json');
    for(const [field,value] of Object.entries(extraHeaders))req.setHeader(field,value);
    req.on('error',error=>resolve({code:error.code??'TLS_DENIED'}));
    req.setTimeout(2500,()=>req.destroy());
    req.end(bytes);
  });
}
test('PRIVATE pair HTTPS authenticates a pinned tunnel without OAuth and still requires native owner action',async t=>{
  let f;try{f=fixture();}catch{return t.skip('OpenSSL fixture generator unavailable');}
  const now=Date.now();
  let server;const actions={bind:0,work:0};
  try{
    const gateway=createV2CandidatePrivateTunnelHttpsGateway({
      certificatePem:f.serverCert,privateKeyPem:f.serverKey,
      clientCaPem:f.ca,expectedClientLeafDerSha256:f.clientSha,
      profileId:'emad',resolveTransportIdentity:async()=>tdata(now),now:()=>now,
      privateOwnerPair:{
        expectedTunnelIdHash:'a'.repeat(64),expectedOwnerSidHash:'b'.repeat(64),
        resolveCurrentOwnerSidHash:async()=> 'b'.repeat(64),
        ownerStack:{requestOwnerBinding:async()=>{actions.bind++;},
          nativeSessionBindings:{resolveNativeRoute:async session=>{
            assert.equal(session,'chat-1');
            return {hostId:'host-1',profileId:'emad',principalId:'owner-1',
              conversationId:'chat-1',operationId:'step-2',
              target:{kind:'workflow-root',id:'root-1'}};
          }}},
        operationGate:{execute:async()=>{actions.work++;return {ok:true};}},
        trustedToolCatalog:[{name:'read_text',description:'Read an owner-approved file',
          inputSchema:{type:'object',required:['path'],properties:{path:{type:'string'}}}}],
        validateToolInput:async(name,args)=>name==='read_text'&&args?.path==='README.md',
        resolveTrustedToolRoute:async({sessionHandle,nativeRoute,tool})=>{
          assert.equal(sessionHandle,'chat-1');assert.equal(tool,'read_text');
          return {...nativeRoute,operationId:'exact-read-1'};
        }
      }
    });
    assert.equal(gateway.requiredTransport,'owner-pinned-private-tunnel-mtls');
    assert.equal(gateway.protectedResource,null,'PRIVATE has no OAuth issuer');
    server=gateway.createUnboundTlsServer();
    assert.equal(server.listening,false);
    assert.equal(server.requestCert,true);
    assert.equal(server.rejectUnauthorized,true);
    await new Promise((resolve,reject)=>
      server.listen(0,'127.0.0.1',resolve).once('error',reject));
    const port=server.address().port;
    const listMessage={jsonrpc:'2.0',id:1,method:'tools/list',params:{}};
    const noCert=await privatePairRequest(port,null,null,listMessage);
    assert.equal(noCert.status,undefined);
    assert.ok(noCert.code);
    const other=await privatePairRequest(port,f.alienCert,f.alienKey,listMessage);
    assert.equal(other.status,403);
    const known=await privatePairRequest(port,f.clientCert,f.clientKey,listMessage);
    assert.equal(known.status,200);
    assert.deepEqual(known.body.result.tools.map(x=>x.name),
      ['v2_private_owner_bind','v2_workflow_step','read_text']);
    assert.equal(actions.bind,0);
    assert.equal(actions.work,0);
    const discovery={
      jsonrpc:'2.0',id:'discover',method:'server/discover',
      params:{_meta:{
        'io.modelcontextprotocol/protocolVersion':'2026-07-28',
        'io.modelcontextprotocol/clientInfo':{name:'qa',version:'1.0.0'},
        'io.modelcontextprotocol/clientCapabilities':{}
      }}
    };
    const modern=await privatePairRequest(port,f.clientCert,f.clientKey,discovery,{
      'MCP-Protocol-Version':'2026-07-28','Mcp-Method':'server/discover'
    });
    assert.equal(modern.status,200);
    assert.equal(modern.body.result.resultType,'complete');
    assert.ok(modern.body.result.supportedVersions.includes('2026-07-28'));
    assert.equal(actions.bind,0);
    assert.equal(actions.work,0);
    const binding=await privatePairRequest(port,f.clientCert,f.clientKey,{
      jsonrpc:'2.0',id:2,method:'tools/call',
      params:{name:'v2_private_owner_bind',arguments:{},
        _meta:{'openai/session':'chat-1'}}
    });
    assert.equal(binding.status,200);
    assert.equal(actions.bind,1);
    assert.equal(actions.work,0);
    const work=await privatePairRequest(port,f.clientCert,f.clientKey,{
      jsonrpc:'2.0',id:3,method:'tools/call',
      params:{name:'v2_workflow_step',arguments:{
        route:{hostId:'host-1',profileId:'emad',principalId:'owner-1',
          conversationId:'chat-1',operationId:'step-1',
          target:{kind:'workflow-root',id:'root-1'}},
        tool:'read_text',arguments:{path:'README.md'}
      },_meta:{'openai/session':'chat-1'}}
    });
    assert.equal(work.status,200);
    assert.equal(actions.work,1);
    const direct=await privatePairRequest(port,f.clientCert,f.clientKey,{
      jsonrpc:'2.0',id:4,method:'tools/call',
      params:{name:'read_text',arguments:{path:'README.md'},
        _meta:{'openai/session':'chat-1'}}
    });
    assert.equal(direct.status,200);
    assert.equal(direct.body.result.isError,false);
    assert.equal(actions.work,2);
  }finally{
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    f.dispose();
  }
});

test('PRIVATE tunnel mTLS rejects mismatched native owner or unusable pair bootstrap',async t=>{
  let f;try{f=fixture();}catch{return t.skip('OpenSSL fixture generator unavailable');}
  let server;
  try{
    const now=Date.now();
    const options={
      certificatePem:f.serverCert,privateKeyPem:f.serverKey,
      clientCaPem:f.ca,expectedClientLeafDerSha256:f.clientSha,
      profileId:'emad',resolveTransportIdentity:async()=>tdata(now),
      now:()=>now,
      privateOwnerPair:{
        expectedTunnelIdHash:'a'.repeat(64),expectedOwnerSidHash:'b'.repeat(64),
        resolveCurrentOwnerSidHash:async()=> 'f'.repeat(64),
        ownerStack:{requestOwnerBinding:async()=>{throw Error('not authorized');}},
        operationGate:{execute:async()=>{throw Error('not authorized');}}
      }
    };
    assert.throws(()=>createV2CandidatePrivateTunnelHttpsGateway({
      ...options,dispatcherFactory:async()=>({})
    }),{code:'V2_TUNNEL_PRIVATE_PAIR_MODE_CONFLICT'});
    server=createV2CandidatePrivateTunnelHttpsGateway(options)
      .createUnboundTlsServer();
    await new Promise((resolve,reject)=>
      server.listen(0,'127.0.0.1',resolve).once('error',reject));
    const reply=await privatePairRequest(server.address().port,
      f.clientCert,f.clientKey,{jsonrpc:'2.0',id:1,method:'tools/list'});
    assert.equal(reply.status,403);
  }finally{
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    f.dispose();
  }
});

test('PRIVATE pair runtime opens only on explicit owner start and retains NO_PROMOTE status',async t=>{
  let f;try{f=fixture();}catch{return t.skip('OpenSSL fixture unavailable');}
  let runtime,closed=0;
  const now=Date.now();
  try{
    const hostOptions={
      certificatePem:f.serverCert,privateKeyPem:f.serverKey,clientCaPem:f.ca,
      expectedClientLeafDerSha256:f.clientSha,profileId:'emad',
      resolveTransportIdentity:async()=>tdata(now),now:()=>now,
      privateOwnerPair:{
        expectedTunnelIdHash:'a'.repeat(64),expectedOwnerSidHash:'b'.repeat(64),
        resolveCurrentOwnerSidHash:async()=> 'b'.repeat(64),
        ownerStack:{requestOwnerBinding:async()=>{},close:()=>{closed++;}},
        operationGate:{execute:async()=>{throw Error('no owner grants');}}
      }
    };
    runtime=createV101G1PrivatePairRuntime({port:0,hostOptions});
    assert.equal(runtime.status.phase,'CONSTRUCTED');
    assert.equal(runtime.status.port,null);
    assert.equal(runtime.status.fullAccessActive,false);
    assert.equal(runtime.status.releaseAccepted,false);
    const live=await runtime.start();
    assert.equal(live.phase,'LISTENING');
    assert.equal(live.protectedTransport,'owner-pinned-private-tunnel-mtls');
    const noCertificate=await privatePairRequest(live.port,null,null,
      {jsonrpc:'2.0',id:1,method:'tools/list'});
    assert.ok(noCertificate.code);
    const known=await privatePairRequest(live.port,f.clientCert,f.clientKey,
      {jsonrpc:'2.0',id:1,method:'tools/list'});
    assert.equal(known.status,200);
    assert.equal(runtime.status.fullAccessActive,false);
    await runtime.close();
    assert.equal(runtime.status.phase,'CLOSED');
    assert.equal(closed,1);
  }finally{
    await runtime?.close();
    f.dispose();
  }
});
