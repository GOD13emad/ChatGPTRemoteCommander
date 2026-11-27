import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root = path.resolve(import.meta.dirname,'..');
const read = rel => fs.readFileSync(path.join(root,rel),'utf8');
test('unverified installed Linux tunnel and CUA payloads are refused before invocation', {skip:process.platform!=='linux'}, t=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rc-provenance-fixture-'));
  t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
  const arch=process.arch==='arm64'?'arm64':'amd64';
  const sentinel=path.join(tmp,'executed');
  const stub='#!/bin/sh\nprintf touched > "$RC_TEST_SENTINEL"\nexit 0\n';
  const tunnel=path.join(tmp,'tools','tunnel-client-v0.0.15-linux-'+arch);
  const cua=path.join(tmp,'chatgpt-remote-commander/adapters/cua-driver/v0.38.0');
  fs.mkdirSync(tunnel,{recursive:true}); fs.mkdirSync(cua,{recursive:true});
  for(const file of [path.join(tunnel,'tunnel-client'),path.join(tunnel,'cloudflared'),path.join(cua,'cua-driver')]) fs.writeFileSync(file,stub,{mode:0o700});
  const pin=JSON.parse(read('tools/cua-driver-pin.json'));
  fs.writeFileSync(path.join(cua,'.verified-archive-sha256'),pin.assets['linux-'+arch].sha256);
  const cases=[
    ['tools/install-tunnel-client-linux.sh',['--install-dir',tmp],'TUNNEL_CLIENT_EXISTING_PROVENANCE_INVALID'],
    ['tools/install-cua-driver-linux.sh',['--data-home',tmp],'CUA_DRIVER_EXISTING_PROVENANCE_INVALID']
  ];
  for(const [rel,args,code] of cases){
    const p=spawnSync('bash',[path.join(root,rel),...args,'--verify-only'],{encoding:'utf8',env:{...process.env,RC_TEST_SENTINEL:sentinel},timeout:10000});
    assert.equal(p.status,1,p.stdout+p.stderr);
    assert.match(p.stderr,new RegExp(code));
    assert.equal(fs.existsSync(sentinel),false,'unverified payload executed: '+rel);
  }
});
