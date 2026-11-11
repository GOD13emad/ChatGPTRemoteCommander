import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createV2PrivateTunnelMtlsAttestor} from '../src/v2-private-tunnel-mtls-attestor.mjs';

const NOW=1794390000000;
const certBytes=Buffer.from('test-local-tunnel-certificate-opaque-bytes');
const sha=createHash('sha256').update(certBytes).digest('hex');
const profileId='emad';
const tunnel=()=>({
  source:'native-tunnel-attestor',provider:'openai-secure-mcp-tunnel',
  profileId,tunnelIdHash:'b'.repeat(64),ownerSidHash:'c'.repeat(64),
  authenticated:true,controlPlanePollOk:true,
  healthzStatus:200,readyzStatus:200,
  lastPollAtMs:NOW-100,expiresAtMs:NOW+60000
});
function socket(override={}){
  return {
    encrypted:true,authorized:true,
    getPeerCertificate:()=>({
      raw:certBytes,ca:false,ext_key_usage:['1.3.6.1.5.5.7.3.2'],
      valid_from:'Nov  1 00:00:00 2026 GMT',
      valid_to:'Dec  1 00:00:00 2026 GMT',
      ...override
    })
  };
}
const config=(overrides={})=>({
  profileId,expectedClientLeafDerSha256:sha,
  resolveTransportIdentity:async()=>tunnel(),now:()=>NOW,...overrides
});

test('tunnel mTLS authenticates only exact pinned local client and fresh native process',async()=>{
  const attest=createV2PrivateTunnelMtlsAttestor(config());
  assert.deepEqual(await attest({socket:socket()}),{
    authenticated:true,peerType:'openai-tunnel-client-mtls',
    sessionSource:'openai/session'
  });
  assert.equal(Object.keys(await attest({socket:socket()})).includes('ownerSidHash'),false);
});

test('untrusted local TLS, changed leaf and missing or stale tunnel status deny without grants',async t=>{
  for(const [name,options] of [
    ['no socket',{socket:null}],['not encrypted',{socket:{...socket(),encrypted:false}}],
    ['not authorized',{socket:{...socket(),authorized:false}}],
    ['changed leaf',{socket:socket({raw:Buffer.from('changed')})}],
    ['CA masquerading as leaf',{socket:socket({ca:true})}],
    ['non-client EKU',{socket:socket({ext_key_usage:[]})}],
    ['expired leaf',{socket:socket({valid_to:'Nov  2 00:00:00 2026 GMT'})}],
    ['not yet valid',{socket:socket({valid_from:'Dec  1 00:00:00 2026 GMT'})}]
  ])await t.test(name,async()=>{
    let native=0;
    const attestor=createV2PrivateTunnelMtlsAttestor(config({
      resolveTransportIdentity:async()=>{native++;return tunnel();}
    }));
    assert.deepEqual(await attestor({socket:options.socket}),{authenticated:false});
    assert.equal(native,0,'rejected client never triggers native tunnel lookup');
  });
  for(const [name,patch] of [
    ['wrong profile',{profileId:'other'}],['not authenticated',{authenticated:false}],
    ['not polling',{controlPlanePollOk:false}],['not ready',{readyzStatus:503}],
    ['expired',{expiresAtMs:NOW}],['missing identity',{ownerSidHash:null}],
    ['future last poll',{lastPollAtMs:NOW+10000}],
    ['stale last poll',{lastPollAtMs:NOW-300000}],['wrong provider',{provider:'fake'}]
  ])await t.test(name,async()=>{
    const attestor=createV2PrivateTunnelMtlsAttestor(config({
      resolveTransportIdentity:async()=>({...tunnel(),...patch})
    }));
    assert.deepEqual(await attestor({socket:socket()}),{authenticated:false});
  });
});

test('missing pinned certificate or native identity provider fails startup closed',()=>{
  for(const patch of [
    {expectedClientLeafDerSha256:undefined},
    {expectedClientLeafDerSha256:'x'.repeat(64)},
    {profileId:''},{resolveTransportIdentity:undefined},
    {now:null}
  ])assert.throws(()=>createV2PrivateTunnelMtlsAttestor(config(patch)),
    {code:'V2_TUNNEL_MTLS_TRUSTED_BOOTSTRAP_REQUIRED'});
});
