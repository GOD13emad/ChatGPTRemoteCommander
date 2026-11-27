import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
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
