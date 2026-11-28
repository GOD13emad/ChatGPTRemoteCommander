import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {createLinuxSignedBrokerTransport}
  from '../src/linux-native-tunnel-broker-client.mjs';
import {createLinuxNativeTunnelClaims,signLinuxNativeTunnelProof}
  from '../src/linux-native-tunnel-broker-proof.mjs';
import {resolveLinuxNativeOwnerWitnessPaths}
 from '../src/linux-native-owner-witness-paths.mjs';

const uid=process.getuid?.()??1000;
const home='/home/owner';
const profile='sample-pair';
const publicKeyPath=path.join(home,'.local/state/chatgpt-remote-commander',
  'private-pair-security-'+profile,'native-witness','public.pem');
const good=()=>({
  home,uid,profile,socketPath:'/run/user/'+uid+'/private-attestor/proof.sock',
  publicKeyPath
});

test('native signer accepts any enrolled profile using ONLY explicit canonical owner witness paths',
 {skip:process.platform!=='linux'},()=>{
  const a=resolveLinuxNativeOwnerWitnessPaths(good());
  assert.equal(a.socketPath,'/run/user/'+uid+'/private-attestor/proof.sock');
  assert.equal(a.publicKeyPath,publicKeyPath);
  assert.equal(Object.isFrozen(a),true);
  const b=resolveLinuxNativeOwnerWitnessPaths({
    ...good(),profile:'other-account',
    socketPath:'/run/user/'+uid+'/new-broker/proof.sock',
    publicKeyPath:publicKeyPath.replace('sample-pair','other-account')
  });
  assert.equal(b.socketPath,'/run/user/'+uid+'/new-broker/proof.sock');
});
test('native signer denies missing, cross-user, alias, or cross-profile Witness paths',
 {skip:process.platform!=='linux'},()=>{
  const cases=[
    {...good(),socketPath:undefined},
    {...good(),publicKeyPath:undefined},
    {...good(),socketPath:'/run/user/'+(uid+1)+'/private-attestor/proof.sock'},
    {...good(),socketPath:'/tmp/private-attestor/proof.sock'},
    {...good(),socketPath:'/run/user/'+uid+'/private-attestor/../proof.sock'},
    {...good(),socketPath:'/run/user/'+uid+'/private-attestor/nested/proof.sock'},
    {...good(),socketPath:'/run/user/'+uid+'/private-attestor/other.sock'},
    {...good(),socketPath:'/run/user/'+uid+'/private-attestor\n/proof.sock'},
    {...good(),publicKeyPath:'/tmp/untrusted.pem'},
    {...good(),publicKeyPath:publicKeyPath.replace('sample-pair','other-account')},
    {...good(),profile:'../other'},
    {...good(),profile:'..'}
  ];
  for(const entry of cases)
    assert.throws(()=>resolveLinuxNativeOwnerWitnessPaths(entry));
});


// A read-only, owner-private synthetic Witness: no native J01, production
// credential, installed Core or Worker enrollment is involved.
test('pinned native Witness serializes independent fresh challenges and fails closed',
 {skip:process.platform!=='linux'},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-witness-client-'));
  const hostId='qa-host',profileId='qa-profile';
  const ownerSidHash='b'.repeat(64),tunnelIdHash='c'.repeat(64);
  const leafSha='d'.repeat(64),executableSha='e'.repeat(64);
  const pair=generateKeyPairSync('ed25519');
  const privateKeyPem=pair.privateKey.export({format:'pem',type:'pkcs8'});
  const publicKeyPath=path.join(root,'public.pem');
  const pinFile=path.join(root,'pin.json');
  const socketPath=path.join(root,'proof.sock');
  fs.writeFileSync(publicKeyPath,
    pair.publicKey.export({format:'pem',type:'spki'}),{mode:0o600});
  fs.writeFileSync(pinFile,'{"test":"fixed-owner-pin"}',{mode:0o600});
  const pinSha256=createHash('sha256').update(fs.readFileSync(pinFile))
    .digest('hex');
  let busy=false,denied=false,collisions=0,successes=0;
  const server=http.createServer(async(req,res)=>{
    if(req.method!=='POST'||req.url!=='/attest'){
      res.writeHead(403);res.end();return;
    }
    if(busy){
      collisions++;res.writeHead(429);res.end();return;
    }
    busy=true;
    try{
      let data='';
      for await(const chunk of req)data+=chunk.toString('utf8');
      const {nonce,profile}=JSON.parse(data);
      await new Promise(resolve=>setTimeout(resolve,25));
      if(denied||profile!==profileId){
        res.writeHead(403);res.end();return;
      }
      const now=Date.now();
      const claims=createLinuxNativeTunnelClaims({
        nonce,hostId,profileId,ownerSidHash,tunnelIdHash,
        clientLeafDerSha256:leafSha,executableSha256:executableSha,
        pinSha256,pid:2345,lastPollAtMs:now-100,now
      });
      const proof=signLinuxNativeTunnelProof({claims,privateKeyPem,now});
      successes++;
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify(proof));
    }catch{
      res.writeHead(403);res.end();
    }finally{busy=false;}
  });
  t.after(async()=>{
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    fs.rmSync(root,{recursive:true,force:true});
  });
  await new Promise(resolve=>server.listen(socketPath,resolve));
  fs.chmodSync(socketPath,0o600);
  let owner=ownerSidHash;
  const client=await createLinuxSignedBrokerTransport({
    hostId,profileId,expectedOwnerSidHash:ownerSidHash,
    expectedClientLeafDerSha256:leafSha,
    expectedExecutableSha256:executableSha,
    pinFile,socketPath,publicKeyPath,
    resolveOwnerSidHash:async()=>owner
  });
  const current=await Promise.all(
    Array.from({length:3},()=>client.resolveTransportIdentity()));
  assert.equal(current.length,3);
  assert.equal(collisions,0,'native Broker must avoid 429 concurrent denial');
  assert.equal(successes,4,'bootstrap plus three fresh independently signed nonces');
  for(const item of current){
    assert.equal(item.authenticated,true);
    assert.equal(item.tunnelIdHash,tunnelIdHash);
  }
  denied=true;
  await assert.rejects(client.resolveTransportIdentity(),
    /RC012_NATIVE_WITNESS_DENIED/);
  denied=false;
  assert.equal((await client.resolveTransportIdentity()).authenticated,true,
    'failed evidence must not poison next fresh witness');
  owner='f'.repeat(64);
  await assert.rejects(client.resolveTransportIdentity(),
    /RC012_NATIVE_WITNESS_OWNER_CHANGED/);
  owner=ownerSidHash;
  fs.writeFileSync(pinFile,'{"test":"rotated"}');
  await assert.rejects(client.resolveTransportIdentity(),
    /RC012_NATIVE_WITNESS_PIN_CHANGED/);
});
