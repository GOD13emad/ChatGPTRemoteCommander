import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const script=path.join(root,'packaging/unified/owner-systemd-creds-profile-recovery.sh');
const names=Object.freeze(['ca.crt','client.crt','client.key','server.crt','server.key']);
function run(args,env={}){
  return spawnSync('bash',[script,...args],{
    encoding:'utf8',windowsHide:true,timeout:12000,maxBuffer:8000,
    env:{...process.env,...env}
  });
}
function makeFixture(){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-linux-creds-'));
  const config=path.join(home,'.config');
  const profileDir=path.join(config,'tunnel-client');
  const certDir=path.join(config,'chatgpt-remote-commander','private-pair','default');
  for(const dir of [profileDir,certDir,path.join(home,'.local','state','chatgpt-remote-commander')]){
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
  }
  for(const dir of [
    config,profileDir,path.join(config,'chatgpt-remote-commander'),
    path.join(config,'chatgpt-remote-commander','private-pair'),certDir,
    path.join(home,'.local'),path.join(home,'.local','state'),
    path.join(home,'.local','state','chatgpt-remote-commander')
  ])fs.chmodSync(dir,0o700);
  const yaml=path.join(profileDir,'Emad.yaml');
  const marker='NONPRODUCTION_FIXTURE_REDACTED_VALUE_ONLY';
  const source='config_version: 1\ncontrol_plane:\n  api_key: '+marker+'\n';
  fs.writeFileSync(yaml,source,{mode:0o600});
  for(const name of names)
    fs.writeFileSync(path.join(certDir,name),'NONPRODUCTION_TEST_CERT_'+name+'\n',{mode:0o600});
  return {home,yaml,source,marker,recovery:path.join(home,
    '.local/state/chatgpt-remote-commander/owner-recovery/rc012-native-pair-systemd-creds')};
}

test('Linux native owner credential recovery stages idempotently, verifies isolated restore and rejects tampering',{
 skip:process.platform!=='linux',timeout:30000
},t=>{
  const syntax=spawnSync('bash',['-n',script],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr);
  const available=spawnSync('systemd-creds',['--version'],{encoding:'utf8',timeout:3000});
  if(available.status!==0)return t.skip('systemd-creds binary unavailable');
  const f=makeFixture();
  try{
    const input={HOME:f.home};
    const stage=run(['Stage'],input);
    if(stage.status!==0&&/RC012_USER_CREDS/.test(stage.stderr||'')
       &&!/SIZE_LIMIT|FILE_UNSAFE|OWNER_FILE_UNSAFE|OWNER_DIRECTORY_UNSAFE/.test(stage.stderr||'')) {
      return t.skip('user/host systemd credential key unavailable on this runner');
    }
    assert.equal(stage.status,0,(stage.stderr||'').slice(-500));
    assert.match(stage.stdout,/RC012_LINUX_OWNER_CREDS_STAGE_PASS_files_6/);
    assert.ok(!stage.stdout.includes(f.marker));
    const ciphertext=fs.readFileSync(path.join(f.recovery,'owner-pair.cred'));
    assert.ok(!ciphertext.includes(Buffer.from(f.marker)));
    assert.ok(!fs.readFileSync(path.join(f.recovery,'receipt'),'utf8').includes(f.marker));
    const verify=run(['Verify'],input);
    assert.equal(verify.status,0,verify.stderr);
    const restoration=run(['TestRestore'],input);
    assert.equal(restoration.status,0,restoration.stderr);
    assert.match(restoration.stdout,/RC012_LINUX_OWNER_CREDS_DRY_RESTORE_PASS_files_6/);
    assert.equal(fs.readdirSync(path.dirname(f.recovery)).filter(x=>x.startsWith('.dry-restore-')).length,0);
    const repeat=run(['Stage'],input);
    assert.equal(repeat.status,0,repeat.stderr);
    assert.match(repeat.stdout,/RC012_LINUX_OWNER_CREDS_REUSED_files_6/);
    assert.equal(fs.readFileSync(f.yaml,'utf8'),f.source);
    fs.appendFileSync(f.yaml,'# source changed\n');
    const stale=run(['Stage'],input);
    assert.notEqual(stale.status,0);
    assert.match(stale.stderr,/RC012_USER_CREDS_EXISTING_BASELINE_CHANGED/);
    fs.writeFileSync(f.yaml,f.source);
    ciphertext[0]^=0x02;
    fs.writeFileSync(path.join(f.recovery,'owner-pair.cred'),ciphertext);
    const tampered=run(['Verify'],input);
    assert.notEqual(tampered.status,0);
    assert.match(tampered.stderr,/RC012_USER_CREDS_CIPHERTEXT_TAMPERED/);
  }finally{
    fs.rmSync(f.home,{force:true,recursive:true});
  }
});
