import test from 'node:test';
import assert from 'node:assert/strict';
import {isVerifiedSyntheticPrivatePem} from '../tools/security-audit-history.mjs';

const commit='d890bd978b07aa738ceeef97bd6af2782538bac1';
const file='test/v2-mcp-http-ingress.test.mjs';
const marker='-----BEGIN ' + 'PRIVATE KEY-----';
const known="  privateKeyPem:'"+marker+'\\\\nfixture';
const matchAt=known.indexOf(marker);
const good={commit,file};

test('only exact historical synthetic PEM placeholder is ignored',()=>{
  assert.equal(isVerifiedSyntheticPrivatePem('Private key block',marker,known,matchAt,good),true);
  assert.equal(isVerifiedSyntheticPrivatePem('Private key block',marker,known,matchAt,{commit:'0'.repeat(40),file}),false);
  assert.equal(isVerifiedSyntheticPrivatePem('Private key block',marker,known,matchAt,{commit,file:'src/live-config.mjs'}),false);
  assert.equal(isVerifiedSyntheticPrivatePem('Bearer token literal',marker,known,matchAt,good),false);
  assert.equal(isVerifiedSyntheticPrivatePem('Private key block','-----BEGIN ' + 'RSA PRIVATE KEY-----',known,matchAt,good),false);
  assert.equal(isVerifiedSyntheticPrivatePem('Private key block',marker,known.replace('fixture','realkey'),matchAt,good),false);
  assert.equal(isVerifiedSyntheticPrivatePem('Private key block',marker,known.replace('privateKeyPem:', 'tlsConfig:'),matchAt,good),false);
  assert.equal(isVerifiedSyntheticPrivatePem('Private key block',marker,known,0,good),false);
  assert.equal(isVerifiedSyntheticPrivatePem('Private key block',marker,known,999999,good),false);
});
test('a real PEM body and unrelated match beside a fixture cannot be exempted',()=>{
  const real="privateKeyPem:'"+marker+'\\nAAAAABBBBBCCCCCDDDDDEEEEE\\n-----END PRIVATE KEY-----';
  assert.equal(isVerifiedSyntheticPrivatePem('Private key block',marker,real,real.indexOf(marker),good),false);
  const adjacent=known+'; another="'+marker+'"';
  assert.equal(isVerifiedSyntheticPrivatePem('Private key block',marker,adjacent,adjacent.lastIndexOf(marker),good),false);
});
