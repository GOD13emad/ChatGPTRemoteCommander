import test from 'node:test';
import assert from 'node:assert/strict';
import {createV012LinuxOwnerPinnedTransport}
  from '../src/v012-linux-owner-pinned-transport-bootstrap.mjs';

const valid=()=>({
  hostId:'emad-laptop',profileId:'mmz-emad-laptop',
  expectedExecutablePath:'/usr/bin/false',
  expectedExecutableSha256:'a'.repeat(64),healthPort:47835,
  expectedOwnerSidHash:'b'.repeat(64),
  expectedTunnelIdHash:'c'.repeat(64)
});

test('owner-pinned native transport rejects missing and malformed enrollment before any IO',async()=>{
  const invalid=[
    null,{}, {...valid(),profileId:'../saeed'},
    {...valid(),profileId:'..'},
    {...valid(),profileId:'saeed/emad'},
    {...valid(),hostId:'../host'},
    {...valid(),healthPort:0},
    {...valid(),healthPort:65536},
    {...valid(),healthPort:47835.5},
    {...valid(),expectedExecutablePath:'relative/tunnel-client'},
    {...valid(),expectedExecutablePath:'/usr/bin/false\0replacement'},
    {...valid(),expectedExecutableSha256:'a'.repeat(63)},
    {...valid(),expectedTunnelIdHash:'A'.repeat(64)},
    {...valid(),expectedOwnerSidHash:'bad'},
    {...valid(),unknownField:true},
    Object.assign(Object.create(null),{hostId:'only'}),
    new Proxy(valid(),{}),
    Object.defineProperty({...valid()},'hostId',{get(){throw Error('GETTER_INVOKED');},enumerable:true})
  ];
  for(const bad of invalid){
    await assert.rejects(createV012LinuxOwnerPinnedTransport(bad),
      {code:process.platform==='linux'
        ?'RC012_NATIVE_PAIR_CONFIG_INVALID'
        :'RC012_NATIVE_PAIR_LINUX_REQUIRED'});
  }
});
test('owner hash is mandatory and never inferred from a caller label',async()=>{
  if(process.platform!=='linux')return;
  // The all-b fixed fingerprint cannot match the real Linux native owner.
  await assert.rejects(createV012LinuxOwnerPinnedTransport(valid()),
    {code:'RC012_NATIVE_PAIR_OWNER_MISMATCH'});
});
