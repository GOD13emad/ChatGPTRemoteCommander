import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {X509Certificate} from 'node:crypto';
import {loadV2OpenAiClientCaBundle,createV2OpenAiClientTlsOptions,
  V2_OPENAI_CONNECTORS_CA_PIN} from '../src/v2-openai-mtls-trust.mjs';

const rootPem=readFileSync(new URL('../assets/trust/openai/root-ca.pem',import.meta.url));
const interPem=readFileSync(new URL('../assets/trust/openai/connectors-mtls-intermediate-ca.pem',import.meta.url));
const now=Date.parse('2026-10-29T12:00:00Z');
test('official published root and intermediate form a valid signed CA chain',()=>{
 const v=loadV2OpenAiClientCaBundle({now});
 assert.equal(v.ca.length,2);
 const root=new X509Certificate(v.ca[0]),inter=new X509Certificate(v.ca[1]);
 assert.equal(root.ca,true);assert.equal(inter.ca,true);
 assert.equal(root.verify(root.publicKey),true);
 assert.equal(inter.checkIssued(root),true);
 assert.equal(inter.verify(root.publicKey),true);
 assert.equal(v.intermediateDerSha256,V2_OPENAI_CONNECTORS_CA_PIN);
 assert.equal(v.expectedClientDns,'mtls.prod.connectors.openai.com');
 assert.equal(v.sources.every(s=>s.startsWith('https://developers.openai.com/')),true);
});
test('unreviewed public CA files and swapped root/intermediate are rejected',()=>{
 assert.throws(()=>loadV2OpenAiClientCaBundle({rootPem:interPem,intermediatePem:rootPem,now}),
   {code:'V2_OPENAI_CA_BUNDLE_UNTRUSTED'});
 const modified=Buffer.from(interPem);modified[20]^=1;
 assert.throws(()=>loadV2OpenAiClientCaBundle({rootPem,intermediatePem:modified,now}),
   {code:'V2_OPENAI_CA_BUNDLE_UNTRUSTED'});
});
test('expired, early, unsafe clock values cannot activate trust',()=>{
 for(const time of [Date.parse('2038-01-01'),Date.parse('2025-01-01')]){
  assert.throws(()=>loadV2OpenAiClientCaBundle({now:time}),
    {code:'V2_OPENAI_CA_BUNDLE_UNTRUSTED'});
 }
 assert.throws(()=>loadV2OpenAiClientCaBundle({now:Number.POSITIVE_INFINITY}),
   {code:'V2_OPENAI_CA_CLOCK_INVALID'});
});
test('TLS server cannot be started without its own protected server identity',()=>{
 for(const config of [
  {},{certificatePem:'anything',privateKeyPem:'anything'},
  {certificatePem:'-----BEGIN CERTIFICATE-----',privateKeyPem:''}
 ]){
  assert.throws(()=>createV2OpenAiClientTlsOptions({...config,now}),
   {code:'V2_HTTPS_SERVER_IDENTITY_REQUIRED'});
 }
});
test('TLS options require OpenAI CA roots, certificate request and native validation',()=>{
 const v=createV2OpenAiClientTlsOptions({
  certificatePem:'-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----',
  privateKeyPem:['-----BEGIN ', 'PRIVATE KEY-----\nfixture\n-----END ', 'PRIVATE KEY-----'].join(''),now
 });
 assert.equal(v.requestCert,true);
 assert.equal(v.rejectUnauthorized,true);
 assert.equal(v.minVersion,'TLSv1.2');
 assert.equal(v.ca.length,2);
});

test('public mTLS trust anchors retain exact LF bytes on Windows and Linux checkout',()=>{
 const attributes=readFileSync(new URL('../.gitattributes',import.meta.url),'utf8');
 for(const name of ['root-ca.pem','connectors-mtls-intermediate-ca.pem']){
  assert.equal(attributes.split(/\r?\n/).includes('assets/trust/openai/'+name+' text eol=lf'),true);
 }
 for(const pem of [rootPem,interPem])assert.equal(pem.includes(Buffer.from('\r\n')),false);
});
