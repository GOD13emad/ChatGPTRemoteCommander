// Exact, fail-closed exception for a synthetic test fixture found in Git history.
// Do not generalize to another commit, file, PEM type, or any usable private key.
const fixtureCommit='d890bd978b07aa738ceeef97bd6af2782538bac1';
const fixtureFile='test/v2-mcp-http-ingress.test.mjs';
const fixtureMarker='-----BEGIN ' + 'PRIVATE KEY-----';
const prefix="privateKeyPem:'";
const suffix='\\nfixture';

export function isVerifiedSyntheticPrivatePem(type, matched, sample, offset, origin) {
  if (type!=='Private key block' || matched!==fixtureMarker ||
      origin?.commit!==fixtureCommit || origin?.file!==fixtureFile ||
      typeof sample!=='string' || !Number.isSafeInteger(offset) ||
      offset<prefix.length || offset+matched.length+suffix.length>sample.length) return false;
  return sample.slice(offset-prefix.length,offset+matched.length+suffix.length)===
    prefix+fixtureMarker+suffix;
}
