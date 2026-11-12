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
import {createV101G1PrivateTunnelRuntime} from '../src/v101-g1-loopback-runtime.mjs';

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
