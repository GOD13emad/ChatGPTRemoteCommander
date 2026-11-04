import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const original=path.join(repository,'tools','portable-capability-gap-cli.mjs');
const registry=path.join(repository,'src','capability-gap-registry.mjs');
const delivery=path.join(repository,'src','delivery-store.mjs');
function exec(cli,args){
 const p=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:7000});
 return {status:p.status,data:(()=>{try{return JSON.parse(p.stdout);}catch{return null;}})(),stderr:p.stderr};
}
test('portable gap CLI uses the exact installed V1 DeliveryStore and accepts only private owner-scoped evidence',()=>{
 assert.equal(sha(fs.readFileSync(delivery)),'a4b1dff7e8293136215b12ade45062dc0f3a034f677f92e4a656679b513c5c47',
  'V1 delivery source changed and portable profile scope must be reviewed before acceptance');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-portable-gap-'));
 try{
  const bin=path.join(root,'client'), project=path.join(root,'project'),store=path.join(root,'private');
  fs.mkdirSync(bin,{mode:0o700});fs.mkdirSync(project,{mode:0o700});
  fs.copyFileSync(original,path.join(bin,'portable-capability-gap-cli.mjs'));
  fs.copyFileSync(registry,path.join(bin,'capability-gap-registry.mjs'));
  const cli=path.join(bin,'portable-capability-gap-cli.mjs'),config=path.join(root,'config.json');
  const cfg={instance:{profile:'qa-owner'},deviceName:'QA-OWNER',durableDelivery:{directory:store,scope:'qa-owner-profile'},allowedRoots:[project]};
  fs.writeFileSync(config,JSON.stringify(cfg),{mode:0o600});
  const configHash=sha(fs.readFileSync(config));
  const base=['--config',config,'--delivery-module',delivery,'--expected-profile','qa-owner','--expected-config-sha',configHash];
  let r=exec(cli,['status',...base]);assert.equal(r.status,0,r.stderr);
  assert.equal(r.data.profile,'qa-owner');assert.equal(r.data.result.authorizationEffects,false);
  const payload={capabilityKey:'mcp.gap-intake.qa',projectKey:'commander-v2',category:'CONNECTOR',consentGate:'NONE',
    title:'Native V1 gap methods unavailable',requiredBehavior:'Expose four profile-scoped capability gap tools on installed V1.',
    observedLimitation:'QA tools list returned no capability_gap_ method.',errorCode:'CAPABILITY_GAP_MCP_UNAVAILABLE',
    candidateSolution:'Apply only the pinned native V1 updater with rollback and exact host approval.',
    acceptanceTest:'Read the four methods from the connected V1 tool catalog after upgrade.'};
  const input=path.join(root,'input.json');
  fs.writeFileSync(input,JSON.stringify(payload),{mode:0o600});
  r=exec(cli,['report',...base,'--input',input]);assert.equal(r.status,0,r.stderr);
  assert.equal(r.data.result.created,true);
  r=exec(cli,['report',...base,'--input',input]);assert.equal(r.status,0,r.stderr);
  assert.equal(r.data.result.changed,false);
  assert.equal(r.data.result.record.observationCount,1);
  r=exec(cli,['list',...base]);assert.equal(r.status,0,r.stderr);
  assert.equal(r.data.result.total,1);
  fs.writeFileSync(input,JSON.stringify({capabilityKey:payload.capabilityKey}),{mode:0o600});
  r=exec(cli,['get',...base,'--input',input]);assert.equal(r.status,0,r.stderr);
  assert.equal(r.data.result.observations.length,1);
  r=exec(cli,['status',...base]);assert.equal(r.status,0,r.stderr);
  assert.equal(r.data.result.states.OPEN,1);
  assert.equal(fs.existsSync(path.join(store,'capability-gaps.sqlite')),true);
  if(process.platform!=='win32')assert.equal(fs.statSync(path.join(store,'capability-gaps.sqlite')).mode&0o777,0o600);
  // Guard both independent claims, not only a guessed profile.
  let fail=exec(cli,['status','--config',config,'--delivery-module',delivery,
    '--expected-profile','another-owner','--expected-config-sha',configHash]);
  assert.equal(fail.status,2);assert.match(fail.stderr,/ACTIVE_PROFILE_MISMATCH/);
  fail=exec(cli,['status','--config',config,'--delivery-module',delivery,
    '--expected-profile','qa-owner','--expected-config-sha','0'.repeat(64)]);
  assert.equal(fail.status,2);assert.match(fail.stderr,/ACTIVE_CONFIG_HASH_MISMATCH/);
  fs.chmodSync(input,0o644);
  fail=exec(cli,['get',...base,'--input',input]);
  if(process.platform!=='win32'){assert.equal(fail.status,2);assert.match(fail.stderr,/PRIVATE_INPUT_PERMISSIONS_INVALID/);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
