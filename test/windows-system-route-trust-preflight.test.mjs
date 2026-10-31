import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('..',import.meta.url));
const script=path.join(root,'tools','windows-system-route-trust-preflight.ps1');
const source=readFileSync(script,'utf8');

test('route admission preflight is read-only and never grants migration or release',()=>{
  assert.match(source,/migrationReady=\$false/);
  assert.match(source,/releaseAuthorized=\$false/);
  assert.match(source,/dependencyClosureVerified=\$false/);
  assert.match(source,/UNTRUSTED_WRITE_ACE/);
  assert.match(source,/S-1-5-18/);
  assert.match(source,/S-1-5-32-544/);
  assert.doesNotMatch(source,/\.StartsWith\('S-1-5-80-/,'No wildcard or prefix service SID trust');
  assert.match(source,/MACHINE_ROUTE_MISSING/);
  assert.match(source,/ROUTE_NOT_PINNED_TO_TRUSTED_SOURCE/);
  assert.doesNotMatch(source,/\b(?:Register-ScheduledTask|Set-ScheduledTask|Set-Acl|icacls\.exe|Start-ScheduledTask|Stop-Process|Move-Item|Copy-Item|Remove-Item)\b/i);
});
test('machine-route admission fails closed on missing, malformed and non-trusted source', {
  skip:process.platform!=='win32'?'Windows only':false
},()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'rc-machine-route-'));
  const routing=path.join(dir,'routing');
  const route=path.join(routing,'default.json');
  mkdirSync(routing);
  const run=()=>{
    const r=spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-File',script,
      '-MachineRoot',dir,'-CandidateRoot',root],{encoding:'utf8',timeout:12000,windowsHide:true});
    assert.equal(r.status,0,r.stderr||r.stdout);
    const x=JSON.parse(r.stdout.trim());
    assert.equal(x.readOnly,true);
    assert.equal(x.releaseAuthorized,false);
    assert.equal(x.migrationReady,false);
    assert.equal(x.dependencyClosureVerified,false);
    for(const name of ['admissionHelper','preflightTool']){
      const item=x.required.find(y=>y.name===name);
      assert.ok(item,'must inspect trust of '+name);
      assert.equal(typeof item.trust.safe,'boolean');
    }
    return x;
  };
  try {
    const missing=run();
    assert.equal(missing.route.exists,false);
    assert.ok(missing.failures.includes('MACHINE_ROUTE_MISSING'));
    writeFileSync(route,'{not-json','utf8');
    const malformed=run();
    assert.ok(malformed.failures.includes('MALFORMED_MACHINE_ROUTE'));
    const foreign={schema:1,profile:'default',generation:1,active:{
      port:47831,version:'0.11.0-dev.18',commit:'fixture',
      projectDir:dir,configPath:path.join(dir,'primary','config.json'),
      configSha256:'a'.repeat(64)
    }};
    writeFileSync(route,JSON.stringify(foreign),'utf8');
    const before=statSync(route).mtimeMs;
    const redirected=run();
    assert.equal(redirected.route.boundToTrustedSource,false);
    assert.ok(redirected.failures.includes('ROUTE_NOT_PINNED_TO_TRUSTED_SOURCE'));
    assert.equal(statSync(route).mtimeMs,before,'preflight must not mutate route');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
