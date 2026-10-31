import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createV2DirectMtlsTransportAttestor} from '../src/v2-direct-mtls-attestor.mjs';
const nowMs=Date.parse('2026-10-29T10:00:00Z');
const intermediate=Buffer.from('fixture-openai-connectors-intermediate-certificate');
const intermediateHash=createHash('sha256').update(intermediate).digest('hex');
const certificate=()=>({
 raw:Buffer.from('fixture-leaf-chatgpt'),
 issuerCertificate:{raw:intermediate},
 subjectaltname:'DNS:mtls.prod.connectors.openai.com',
 ext_key_usage:['1.3.6.1.5.5.7.3.2'],
 valid_from:'Oct 20 00:00:00 2026 GMT',
 valid_to:'Nov 20 00:00:00 2026 GMT'
});
const request=(change={},socketChange={})=>({
 headers:{'x-chat-id':'forged','x-mtls-verified':'true'},
 socket:{
  encrypted:true,authorized:true,getPeerCertificate:()=>({...certificate(),...change}),
  ...socketChange
 }
});
const make=(override={})=>createV2DirectMtlsTransportAttestor({
 intermediateDerSha256:intermediateHash,
 resolveTrustedSession:async()=> 'trusted-platform-session',
 now:()=>nowMs,...override
});
test('direct mTLS refuses missing intermediate pin or owner session resolver',()=>{
 assert.throws(()=>createV2DirectMtlsTransportAttestor({
   intermediateDerSha256:'unknown',
   resolveTrustedSession:async()=> 'trusted'
 }),{code:'V2_MTLS_OPERATOR_CONFIGURATION_REQUIRED'});
 assert.throws(()=>createV2DirectMtlsTransportAttestor({
   intermediateDerSha256:intermediateHash
 }),{code:'V2_MTLS_OPERATOR_CONFIGURATION_REQUIRED'});
});
test('direct mTLS attests exact SAN + intermediate + client-auth EKU and trusted owner session',async()=>{
 let reads=0;
 const attest=make({resolveTrustedSession:async(proof)=>{
  reads++;assert.equal(proof.peerType,'openai-chatgpt-mtls');
  assert.equal(proof.validatedIntermediateSha256,intermediateHash);
  return 'verified-chat-a';
 }});
 const result=await attest(request());
 assert.equal(result.authenticated,true);
 assert.equal(result.sessionHandle,'verified-chat-a');
 assert.equal(reads,1);
 assert.equal(Object.isFrozen(result),true);
});
test('ordinary HTTP, TLS without authorized client, or forged headers cannot authenticate',async()=>{
 const attest=make({resolveTrustedSession:async()=>{throw Error('should not be touched');}});
 assert.deepEqual(await attest({headers:{'x-mtls-verified':'true'}}),{authenticated:false});
 assert.deepEqual(await attest(request({}, {authorized:false})),{authenticated:false});
 assert.deepEqual(await attest(request({}, {encrypted:false})),{authenticated:false});
 assert.deepEqual(await attest(request({}, {getPeerCertificate:undefined})),{authenticated:false});
});
test('wrong client SAN and extra-name substring tricks are denied',async()=>{
 const attest=make({resolveTrustedSession:async()=>{throw Error('should not be touched');}});
 for(const san of [
  'DNS:unrelated.example.com',
  'DNS:prefix.mtls.prod.connectors.openai.com',
  'DNS:mtls.prod.connectors.openai.com.attacker.test',
  'URI:mtls.prod.connectors.openai.com',
  undefined
 ]){
  assert.equal((await attest(request({subjectaltname:san}))).authenticated,false);
 }
});
test('wrong intermediate CA and self-issued leaf are refused',async()=>{
 const attest=make({resolveTrustedSession:async()=>{throw Error('should not be touched');}});
 const maliciousIntermediate=Buffer.from('attacker-controlled-root');
 assert.equal((await attest(request({
  issuerCertificate:{raw:maliciousIntermediate}
 }))).authenticated,false);
 assert.equal((await attest(request({
  issuerCertificate:{raw:Buffer.from('fixture-leaf-chatgpt')}
 }))).authenticated,false);
});
test('missing clientAuth EKU rejects otherwise valid cert',async()=>{
 const attest=make({resolveTrustedSession:async()=>{throw Error('should not be touched');}});
 for(const eku of [[],undefined,['1.3.6.1.5.5.7.3.1']]){
  assert.equal((await attest(request({ext_key_usage:eku}))).authenticated,false);
 }
});
test('certificate expiry and future validity windows fail closed',async()=>{
 const attest=make({resolveTrustedSession:async()=>{throw Error('should not be touched');}});
 const expired=await attest(request({valid_to:'Oct 28 00:00:00 2026 GMT'}));
 assert.equal(expired.authenticated,false);
 const future=await attest(request({valid_from:'Nov 30 00:00:00 2026 GMT'}));
 assert.equal(future.authenticated,false);
});
test('owner resolver cannot be skipped; missing authenticated native session rejects',async()=>{
 const attest=make({resolveTrustedSession:async()=>null});
 assert.equal((await attest(request())).authenticated,false);
});

// platform-metadata mode

test('verified direct ChatGPT mTLS permits documented session metadata mode only',async()=>{
 const verifier=createV2DirectMtlsTransportAttestor({
  intermediateDerSha256:intermediateHash,sessionSource:'openai/session',now:()=>nowMs
 });
 const result=await verifier(request());
 assert.deepEqual(result,{authenticated:true,peerType:'openai-chatgpt-mtls',
   sessionSource:'openai/session'});
 assert.equal((await verifier(request({}, {authorized:false}))).authenticated,false);
 assert.equal((await verifier(request({subjectaltname:'DNS:attacker.example'}))).authenticated,false);
});
test('non-explicit platform session mode fails closed',()=>{
 assert.throws(()=>createV2DirectMtlsTransportAttestor({
  intermediateDerSha256:intermediateHash,sessionSource:'request-header',now:()=>nowMs
 }),{code:'V2_MTLS_OPERATOR_CONFIGURATION_REQUIRED'});
});
