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
function makeFixture(profileName='Emad'){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-linux-creds-'));
  const config=path.join(home,'.config');
  const profileDir=path.join(config,'tunnel-client');
  // Only the canonical pair and historical standalone Emad may use default.
  const certNamespace=['Emad','chatgpt-remote-commander'].includes(profileName)
    ?'default':profileName;
  const certDir=path.join(config,'chatgpt-remote-commander','private-pair',certNamespace);
  for(const dir of [profileDir,certDir,path.join(home,'.local','state','chatgpt-remote-commander')]){
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
  }
  for(const dir of [
    config,profileDir,path.join(config,'chatgpt-remote-commander'),
    path.join(config,'chatgpt-remote-commander','private-pair'),certDir,
    path.join(home,'.local'),path.join(home,'.local','state'),
    path.join(home,'.local','state','chatgpt-remote-commander')
  ])fs.chmodSync(dir,0o700);
  const yaml=path.join(profileDir,profileName+'.yaml');
  const marker='NONPRODUCTION_FIXTURE_REDACTED_VALUE_ONLY';
  const source='config_version: 1\ncontrol_plane:\n  api_key: '+marker+'\n';
  fs.writeFileSync(yaml,source,{mode:0o600});
  for(const name of names)
    fs.writeFileSync(path.join(certDir,name),'NONPRODUCTION_TEST_CERT_'+name+'\n',{mode:0o600});
  return {home,yaml,source,marker,recovery:path.join(home,
    '.local/state/chatgpt-remote-commander/owner-recovery/rc012-native-pair-systemd-creds'+(profileName==='Emad'?'':'-'+profileName))};
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

test('Linux different account fails closed without its own TLS pair, and sealed restore remains isolated', {
 skip:process.platform!=='linux',timeout:30000
},t=>{
 const available=spawnSync('systemd-creds',['--version'],{encoding:'utf8',timeout:3000});
 if(available.status!==0)return t.skip('systemd-creds unavailable');
 const f=makeFixture('mmz-emad-laptop');
 const base=path.join(f.home,'.config','chatgpt-remote-commander','private-pair');
 const independent=path.join(base,'mmz-emad-laptop');
 const defaultPair=path.join(base,'default');
 fs.mkdirSync(defaultPair,{mode:0o700});
 for(const name of names)fs.writeFileSync(path.join(defaultPair,name),
   'OTHER_ACCOUNT_DEFAULT_PAIR_DO_NOT_BACK_UP_'+name,{mode:0o600});
 try{
  const env={HOME:f.home};
  const stage=run(['Stage','--profile-name=mmz-emad-laptop'],env);
  if(stage.status!==0&&/RC012_USER_CREDS/.test(stage.stderr||'')
      &&!/SIZE_LIMIT|FILE_UNSAFE|OWNER_FILE_UNSAFE|OWNER_DIRECTORY_UNSAFE|PROFILE_PAIR_REQUIRED/.test(stage.stderr||''))
   return t.skip('user host credential key unavailable');
  assert.equal(stage.status,0,stage.stderr);
  assert.match(stage.stdout,/RC012_LINUX_OWNER_CREDS_STAGE_PASS_files_6/);
  for(const mode of ['Verify','TestRestore']){
   const check=run([mode,'--profile-name=mmz-emad-laptop'],env);
   assert.equal(check.status,0,check.stderr);
   assert.match(check.stdout,/PASS_files_6/);
  }
  const defaultFile=path.join(defaultPair,'client.key');
  fs.appendFileSync(defaultFile,'DEFAULT_UNRELATED_CHANGED');
  const reused=run(['Stage','--profile-name=mmz-emad-laptop'],env);
  assert.equal(reused.status,0,reused.stderr);
  assert.match(reused.stdout,/REUSED_files_6/);
  fs.appendFileSync(path.join(independent,'client.key'),'OWN_TLS_PAIR_CHANGED');
  const mismatch=run(['Stage','--profile-name=mmz-emad-laptop'],env);
  assert.notEqual(mismatch.status,0);
  assert.match(mismatch.stderr,/RC012_USER_CREDS_EXISTING_BASELINE_CHANGED/);
  assert.equal(fs.readFileSync(f.yaml,'utf8'),f.source);
 }finally{fs.rmSync(f.home,{recursive:true,force:true});}
});

test('Linux noncanonical profile cannot stage a backup of someone else\'s default TLS pair', {
 skip:process.platform!=='linux',timeout:10000
},()=>{
 const f=makeFixture('saeed-emad-laptop');
 const pair=path.join(f.home,'.config/chatgpt-remote-commander/private-pair');
 try{
  fs.renameSync(path.join(pair,'saeed-emad-laptop'),path.join(pair,'default'));
  const result=run(['Stage','--profile-name=saeed-emad-laptop'],{HOME:f.home});
  assert.equal(result.status,2,result.stderr);
  assert.match(result.stderr,/RC012_USER_CREDS_PROFILE_PAIR_REQUIRED/);
  assert.equal(fs.existsSync(f.recovery),false);
  assert.equal(fs.readFileSync(f.yaml,'utf8'),f.source);
 }finally{fs.rmSync(f.home,{recursive:true,force:true});}
});

test('Linux exact live-style Tunnel profile uses its own sealed capsule, never a different account', {
 skip:process.platform!=='linux',timeout:30000
}, t=>{
 const available=spawnSync('systemd-creds',['--version'],{encoding:'utf8',timeout:3000});
 if(available.status!==0)return t.skip('systemd-creds unavailable');
 const f=makeFixture('chatgpt-remote-commander');
 const other=path.join(f.home,'.config/tunnel-client','mmz-emad-laptop.yaml');
 fs.writeFileSync(other,'independent-nonproduction-fixture\\n',{mode:0o600});
 try{
  const env={HOME:f.home};
  const stage=run(['Stage','--profile-name=chatgpt-remote-commander'],env);
  if(stage.status!==0&&/RC012_USER_CREDS/.test(stage.stderr||'')
     &&!/SIZE_LIMIT|FILE_UNSAFE|OWNER_FILE_UNSAFE|OWNER_DIRECTORY_UNSAFE/.test(stage.stderr||''))
    return t.skip('user host systemd credential key unavailable');
  assert.equal(stage.status,0,stage.stderr);
  assert.match(stage.stdout,/RC012_LINUX_OWNER_CREDS_STAGE_PASS_files_6/);
  for(const mode of ['Verify','TestRestore']){
   const result=run([mode,'--profile-name=chatgpt-remote-commander'],env);
   assert.equal(result.status,0,result.stderr);
  }
  const repeat=run(['Stage','--profile-name=chatgpt-remote-commander'],env);
  assert.equal(repeat.status,0,repeat.stderr);
  assert.match(repeat.stdout,/RC012_LINUX_OWNER_CREDS_REUSED_files_6/);
  assert.equal(fs.readFileSync(other,'utf8'),'independent-nonproduction-fixture\\n');
  for(const bad of ['--profile-name=../mmz','--profile-name=','--profile-name=./x',
     '--profile-name=chatgpt/remote','--profile-name=..','--profile-name=💥']){
   const result=run(['Verify',bad],env);
   assert.equal(result.status,2,bad);
   assert.match(result.stderr,/RC012_LINUX_OWNER_CREDS_PROFILE_INVALID/);
  }
  assert.equal(fs.readFileSync(f.yaml,'utf8'),f.source);
  const wrong=run(['Verify','--profile-name=mmz-emad-laptop'],env);
  assert.notEqual(wrong.status,0,'different account cannot reuse owner pair capsule');
 }finally{fs.rmSync(f.home,{force:true,recursive:true});}
});
