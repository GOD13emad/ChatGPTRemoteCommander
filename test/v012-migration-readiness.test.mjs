import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');

test('M3 receipt requires exact running config digest before writing and on replay',t=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v012-m3-sha-'));
  t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
  const home=path.join(tmp,'home');
  const local=path.join(tmp,'local');
  const stage=process.platform==='win32'
    ?path.join(local,'ChatGPTRemoteCommander','migration-stage')
    :path.join(home,'.local','state','chatgpt-remote-commander','migration-stage');
  const candidate=path.join(tmp,'candidate');
  const script=path.join(candidate,'tools','v012-migration-readiness.mjs');
  const baseline=path.join(stage,'migration-recovery-baseline.json');
  const sourceFile=path.join(tmp,'source-config.json');
  const targetFile=path.join(stage,'target-profiles','Saeid','config.json');
  for(const dir of [path.dirname(script),path.join(candidate,'docs'),path.dirname(targetFile)]){
    fs.mkdirSync(dir,{recursive:true});
  }

  const port=47831;
  fs.writeFileSync(sourceFile,JSON.stringify({host:'127.0.0.1',port,instance:{profile:'default'}}));
  fs.writeFileSync(targetFile,JSON.stringify({
    host:'127.0.0.1',port:48935,instance:{profile:'Saeid',isolated:true},
    capabilityProfile:{id:'Saeid',tier:'FULL_POWER'}
  }));
  const sourceSha=sha(fs.readFileSync(sourceFile));
  const targetSha=sha(fs.readFileSync(targetFile));
  const mapId='V012-FLEET-ACCOUNT-MAPPING-20261110';
  fs.writeFileSync(path.join(candidate,'docs','release-train-0.12.json'),JSON.stringify({
    migration:{ownerConfirmed:true,id:mapId,hosts:[{
      host:'FixtureHost',profiles:[{legacyProfile:'default',account:'Saeid',sourcePort:port}]
    }]}
  }));
  fs.writeFileSync(path.join(stage,'target-profiles','migration-canonical-receipt.json'),JSON.stringify({
    host:'FixtureHost',mapId,profileCutover:false,oldServiceStopped:false,
    credentialsExported:false,profiles:[{
      legacy:'default',account:'Saeid',ingressPort:port,stagedOnly:true,
      sourceConfigPath:sourceFile,sourceSha256:sourceSha,
      targetConfigPath:targetFile,targetSha256:targetSha,
      configuredTierPreserved:'FULL_POWER',backendPort:48935
    }]
  }));
  // Mock only the in-memory local health response. No network, user, service,
  // system credentials, or running real instance is ever modified by this test.
  const mock=`globalThis.fetch=async url=>{
    if(String(url)!=='http://127.0.0.1:47831/health')throw Error('UNEXPECTED_NETWORK_REQUEST');
    return {ok:true,json:async()=>({
      ok:true,version:'0.11.0-dev.23',instance:{profile:'default'},
      configSha256:process.env.RC_M3_FIXTURE_LIVE_SHA
    })};
  };
`;
  fs.writeFileSync(script,mock+fs.readFileSync(path.join(project,'tools','v012-migration-readiness.mjs'),'utf8'));

  const run=liveSha=>spawnSync(process.execPath,[script,'FixtureHost'],{
    encoding:'utf8',timeout:10000,
    env:{...process.env,HOME:home,LOCALAPPDATA:local,RC_M3_FIXTURE_LIVE_SHA:liveSha}
  });

  for(const badSha of ['0'.repeat(64),'missing-digest']){
    const negative=run(badSha);
    assert.equal(negative.status,1,'mismatched or absent runtime digest must be rejected');
    assert.match(negative.stderr,/LIVE_SOURCE_CONFIG_HASH_MISMATCH/);
    assert.equal(fs.existsSync(baseline),false,'negative path must not write an acceptance receipt');
  }
  const positive=run(sourceSha);
  assert.equal(positive.status,0,positive.stderr);
  assert.equal(fs.existsSync(baseline),true);
  const before=sha(fs.readFileSync(baseline));
  const saved=JSON.parse(fs.readFileSync(baseline,'utf8'));
  assert.equal(saved.profileCutover,false);
  assert.equal(saved.liveAccountAuthenticationVerified,false);
  assert.equal(saved.recoveryPlanVerified,false);
  assert.equal(saved.profiles[0].sourceConfigSha256,sourceSha);
  const replay=run(sourceSha);
  assert.equal(replay.status,0,replay.stderr);
  assert.equal(sha(fs.readFileSync(baseline)),before,'positive replay must not overwrite baseline');
});
