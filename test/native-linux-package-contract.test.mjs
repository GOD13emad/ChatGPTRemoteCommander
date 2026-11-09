import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const builderPath=path.join(root,'tools/build-native-linux-package.sh');
const source=fs.readFileSync(builderPath,'utf8');
const match=source.match(/cat > "\$DEB\$PACKAGE_DIR\/native-config-preflight\.mjs" <<'PREFLIGHT'\n([\s\S]*?)\nPREFLIGHT/);

function runPreflight(config) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rc-native-installer-fixture-'));
  try {
    const file=path.join(tmp,'config.json');
    fs.writeFileSync(file,JSON.stringify(config));
    return spawnSync(process.execPath,['--input-type=module','-'],{
      input:match[1]+'\n',encoding:'utf8',timeout:3000,
      env:{...process.env,REMOTE_COMMANDER_CONFIG:file},cwd:tmp
    });
  } finally {
    fs.rmSync(tmp,{recursive:true,force:true});
  }
}

const valid=()=>({
  requireTrustedIngress:true,host:'127.0.0.1',port:47831,
  runtimeState:'/var/lib/chatgpt-remote-commander/mcp-runtime.json',
  auditLog:'/var/lib/chatgpt-remote-commander/audit.jsonl',
  durableDelivery:{directory:'/var/lib/chatgpt-remote-commander/delivery'},
  asyncOperations:{stateDir:'/var/lib/chatgpt-remote-commander/operations'}
});

test('one native Linux package is dpkg-owned and shares immutable code across profiles',()=>{
  assert.equal(spawnSync('bash',['-n',builderPath]).status,0);
  assert.match(source,/dpkg-deb --root-owner-group --build/);
  assert.match(source,/git -C "\$ROOT" archive --format=tar "\$HEAD"/);
  assert.match(source,/PACKAGE_DIR=\/usr\/lib\/chatgpt-remote-commander/);
  assert.match(source,/NATIVE_LINUX_PACKAGE_OUTPUT_ALREADY_EXISTS/);
  assert.match(source,/usr\/lib\/systemd\/user\/chatgpt-remote-commander@\.service/);
  assert.match(source,/usr\/lib\/systemd\/system\/chatgpt-remote-commander\.service/);
  assert.match(source,/Environment=COMMANDER_ONE_REQUIRE_TRUSTED_INGRESS=1/);
  assert.match(source,/DynamicUser=yes/);
  assert.match(source,/serviceAutoStart=false/);
  assert.doesNotMatch(source,/systemctl enable/);
  assert.doesNotMatch(source,/systemctl start/);
  assert.doesNotMatch(source,/PrivilegesRequired=lowest/);
  assert.ok(match,'native preflight must be installed in the package');
});

test('native instance preflight permits explicit bounded owner configuration',()=>{
  const result=runPreflight(valid());
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/NATIVE_PROFILE_CONFIG_PREFLIGHT_PASS/);
});

test('native instance preflight rejects missing trusted ingress and non-loopback endpoints',()=>{
  for(const patch of [
    {requireTrustedIngress:false},
    {requireTrustedIngress:undefined},
    {host:'0.0.0.0'},
    {port:80},
    {port:65536}
  ]){
    const result=runPreflight({...valid(),...patch});
    assert.notEqual(result.status,0,JSON.stringify(patch));
  }
});

test('native instance preflight refuses mutable state in managed code',()=>{
  for(const patch of [
    {runtimeState:'var/mcp-runtime.json'},
    {auditLog:'/usr/lib/chatgpt-remote-commander/var/audit.jsonl'},
    {durableDelivery:{directory:'delivery'}},
    {asyncOperations:{stateDir:'var/operations'}}
  ]){
    const result=runPreflight({...valid(),...patch});
    assert.notEqual(result.status,0,JSON.stringify(patch));
  }
});
