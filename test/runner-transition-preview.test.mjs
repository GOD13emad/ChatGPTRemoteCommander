import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import { grantSigningBytes } from '../tools/runner-owner-grant-signature.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const verify=path.join(base,'tools/runner-transition-preview.mjs');
const originalGuard=path.join(base,'tools/runner-policy-continuity.mjs');
const hash = d=>createHash('sha256').update(d).digest('hex');
const runner = {
  enabled:true,autoTick:false,maxPlannerCalls:2,maxActions:1,allowedTools:['read_text'],
  provider:{kind:'command',executable:'/bin/bash',args:['-lc','readonly-test-adapter']},
  team:{maxParallel:2,workers:[{id:'builder',role:'Builder'},{id:'reviewer',role:'Reviewer'}]}
};
const later = ms=>new Date(Date.now()+ms).toISOString().replace(/\.\d{3}Z$/,'Z');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-signed-preview-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const files=Object.fromEntries(['current','candidate','approval','pubkey','router'].map(k=>[k,path.join(root,k+'.json')]));
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const current={durableWorkflows:{runner:structuredClone(runner)},host:'127.0.0.1'};
 const candidate=structuredClone(current); candidate.durableWorkflows.runner.maxPlannerCalls=3;
 const commit='b5cc8bb16876831c829ba7597c27725d80184f5c';
 const generation=128;
 function write(k,content){fs.writeFileSync(files[k],typeof content==='string'?content:JSON.stringify(content),{mode:0o600});}
 function grant(changes=['maxPlannerCalls']){
  const payload={schema:1,intent:'owner-approved-runner-transition',profile:'default',
    activeConfigSha256:hash(fs.readFileSync(files.current)),
    candidateConfigSha256:hash(fs.readFileSync(files.candidate)),
    candidateRunnerSha256:hash(JSON.stringify(JSON.parse(fs.readFileSync(files.candidate)).durableWorkflows.runner)),
    allowedChangedFields:changes,issuedAtUtc:later(-60000),expiresAtUtc:later(240000),
    routerGeneration:generation,activeCommit:commit,approvalId:randomBytes(16).toString('hex')};
  const signature=sign(null,grantSigningBytes(payload),privateKey).toString('base64');
  return {payload,signature};
 }
 write('current',current); write('candidate',candidate);
 write('router',{generation,active:{commit,configPath:files.current,configSha256:hash(fs.readFileSync(files.current))}});
 fs.renameSync(files.router,path.join(root,'default.json'));files.router=path.join(root,'default.json');
 fs.writeFileSync(files.pubkey,publicKey.export({type:'spki',format:'pem'}),{mode:0o600});
 write('approval',grant());
 function run(argv=[files.current,files.candidate,files.approval,files.pubkey,files.router]){
  return spawnSync(process.execPath,[verify,...argv],{encoding:'utf8',timeout:4000});
 }
 return {root,files,current,candidate,write,grant,run,privateKey,generation,commit};
}
function blocked(result,code){
 assert.equal(result.status,3,result.stdout+' '+result.stderr);
 assert.match(result.stderr,new RegExp(code));
 assert.equal(result.stdout,'');
}
test('signed and exact 2-to-3 transition passes as PREVIEW_ONLY, without writing configs',t=>{
 const f=fixture(t);const before=fs.readFileSync(f.files.current),candidate=fs.readFileSync(f.files.candidate);
 const r=f.run();
 assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'OWNER_TRANSITION_PREVIEW_VALIDATED_ONLY\n');
 assert.deepEqual(fs.readFileSync(f.files.current),before);assert.deepEqual(fs.readFileSync(f.files.candidate),candidate);
});
test('owner may explicitly authorize exactly changed provider args in addition to budget',t=>{
 const f=fixture(t);const c=structuredClone(f.candidate);
 c.durableWorkflows.runner.provider.args=['-lc','different-authorized-adapter'];
 f.write('candidate',c);f.write('approval',f.grant(['maxPlannerCalls','provider.args']));
 assert.equal(f.run().status,0);
});
test('existing production continuity guard stays fail closed even for a signed preview',t=>{
 const f=fixture(t);
 const result=spawnSync(process.execPath,[originalGuard,f.files.current,f.files.candidate],{encoding:'utf8',timeout:4000});
 blocked(result,'RUNNER_POLICY_CHANGED');
});
test('wrong signing public key never passes',t=>{
 const f=fixture(t);const other=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
 f.write('pubkey',other);blocked(f.run(),'BAD_APPROVAL_SIGNATURE');
});
test('edited signature never passes',t=>{
 const f=fixture(t);const a=f.grant();a.signature='A'.repeat(86)+'==';f.write('approval',a);
 blocked(f.run(),'BAD_APPROVAL_SIGNATURE');
});
test('modified active configuration invalidates prior signed approval',t=>{
 const f=fixture(t);f.write('current',{...f.current,port:5555});
 blocked(f.run(),'ROUTER_STATE_MISMATCH');
});
test('modified candidate command invalidates signed approval',t=>{
 const f=fixture(t);const c=structuredClone(f.candidate);c.durableWorkflows.runner.provider.args=['-lc','unapproved-command'];
 f.write('candidate',c);f.write('approval',f.grant(['maxPlannerCalls','provider.args']));
 c.durableWorkflows.runner.provider.args=['-lc','second-unapproved-command'];f.write('candidate',c);
 blocked(f.run(),'APPROVAL_HASH_MISMATCH');
});
test('unrelated candidate configuration drift invalidates signed approval',t=>{
 const f=fixture(t);const c=structuredClone(f.candidate);c.host='0.0.0.0';
 f.write('candidate',c);blocked(f.run(),'APPROVAL_HASH_MISMATCH');
});

test('any expanded filesystem tools beyond two allowed fields are rejected',t=>{
 const f=fixture(t);const c=structuredClone(f.candidate);c.durableWorkflows.runner.allowedTools=['read_text','run_shell'];
 f.write('candidate',c);f.write('approval',f.grant());
 blocked(f.run(),'UNBOUNDED_POLICY_CHANGE');
});
test('changing executable, team workers, enablement or autotick is rejected',t=>{
 const f=fixture(t);
 for(const edit of [
   r=>{r.provider.executable='/tmp/evil';},
   r=>{r.team.workers.push({id:'extra'});},
   r=>{r.enabled=false;},
   r=>{r.autoTick=true;}
 ]){
  const c=structuredClone(f.candidate);edit(c.durableWorkflows.runner);f.write('candidate',c);
  blocked(f.run(),'UNBOUNDED_POLICY_CHANGE|UNSUPPORTED_TRANSITION');
 }
});
test('budget 4 or no team is rejected',t=>{
 const f=fixture(t);
 const c=structuredClone(f.candidate);c.durableWorkflows.runner.maxPlannerCalls=4;
 f.write('candidate',c);blocked(f.run(),'UNSUPPORTED_TRANSITION');
 c.durableWorkflows.runner.maxPlannerCalls=3;c.durableWorkflows.runner.team.workers=[];
 f.write('candidate',c);blocked(f.run(),'UNBOUNDED_POLICY_CHANGE|UNSUPPORTED_TRANSITION');
});
test('expired or invalidly long approvals never pass',t=>{
 const f=fixture(t);
 for(const [issuedAtUtc,expiresAtUtc] of [[later(-180000),later(-60000)],[later(-1000),later(3600000)],[later(600000),later(660000)]]){
  const a=f.grant();a.payload.issuedAtUtc=issuedAtUtc;a.payload.expiresAtUtc=expiresAtUtc;
  a.signature=sign(null,grantSigningBytes(a.payload),f.privateKey).toString('base64');
  f.write('approval',a);blocked(f.run(),'APPROVAL_EXPIRED_OR_NOT_YET_VALID');
 }
});
test('wrong declared scope and extra approval keys are rejected',t=>{
 const f=fixture(t);
 for(const transform of [a=>{a.payload.allowedChangedFields=['maxPlannerCalls','provider.args'];},a=>{a.payload.profile='some-other-profile';},a=>{a.payload.unexpected=1;} ]){
  const a=f.grant();transform(a);
  a.signature=sign(null,grantSigningBytes(a.payload),f.privateKey).toString('base64');
  f.write('approval',a);blocked(f.run(),'INVALID_APPROVAL');
 }
});
test('approval file must be owner-private',t=>{
 const f=fixture(t);if(process.platform==='win32')return t.skip('POSIX file modes');
 fs.chmodSync(f.files.approval,0o644);blocked(f.run(),'UNTRUSTED_APPROVAL_FILE');
});
test('candidate symlinks and hardlinks are rejected',t=>{
 const f=fixture(t);fs.unlinkSync(f.files.candidate);
 try {fs.symlinkSync(f.files.current,f.files.candidate);}catch(e){return t.skip('symlink unavailable: '+e.code)}
 blocked(f.run(),'INVALID_FILE');
 fs.unlinkSync(f.files.candidate);
 try {fs.linkSync(f.files.current,f.files.candidate);}catch(e){return t.skip('hardlink unavailable: '+e.code)}
 blocked(f.run(),'INVALID_FILE');
});
test('changed router generation invalidates a previously signed approval',t=>{
 const f=fixture(t);const router=JSON.parse(fs.readFileSync(f.files.router));router.generation++;
 f.write('router',router);blocked(f.run(),'ROUTER_STATE_MISMATCH');
});
test('changed active release commit invalidates previously signed approval',t=>{
 const f=fixture(t);const router=JSON.parse(fs.readFileSync(f.files.router));
 router.active.commit='a'.repeat(40);f.write('router',router);
 blocked(f.run(),'ROUTER_STATE_MISMATCH');
});
test('signer must include exact current router generation and source commit',t=>{
 const f=fixture(t);const grant=f.grant();grant.payload.routerGeneration=f.generation+1;
 grant.signature=sign(null,grantSigningBytes(grant.payload),f.privateKey).toString('base64');
 f.write('approval',grant);blocked(f.run(),'ROUTER_STATE_MISMATCH');
});
test('router with a different selected active config path is rejected',t=>{
 const f=fixture(t);const router=JSON.parse(fs.readFileSync(f.files.router));
 router.active.configPath=path.join(f.root,'other-config.json');f.write('router',router);
 blocked(f.run(),'ROUTER_STATE_MISMATCH');
});
test('router aliases are rejected',t=>{
 const f=fixture(t);const orig=f.files.router;const aliased=path.join(f.root,'default.alias.json');
 fs.renameSync(orig,aliased);try{fs.symlinkSync(aliased,orig)}catch(e){return t.skip('symlink unsupported: '+e.code)}
 blocked(f.run(),'INVALID_FILE');
});
test('owner preview signing is domain-separated and deterministic across payload property order',t=>{
 const f=fixture(t);const a=f.grant();
 const original=grantSigningBytes(a.payload);
 const reversed=Object.fromEntries(Object.entries(a.payload).reverse());
 assert.deepEqual(grantSigningBytes(reversed),original);
 a.payload=reversed;a.signature=sign(null,grantSigningBytes(reversed),f.privateKey).toString('base64');
 f.write('approval',a);assert.equal(f.run().status,0);
});
test('an old raw JSON payload signature is rejected by versioned preview verifier',t=>{
 const f=fixture(t);const a=f.grant();a.signature=sign(null,Buffer.from(JSON.stringify(a.payload)),f.privateKey).toString('base64');
 f.write('approval',a);blocked(f.run(),'BAD_APPROVAL_SIGNATURE');
});
test('approval IDs must be lowercase 128-bit hex identifiers',t=>{
 const f=fixture(t);for(const invalid of ['','0'.repeat(31),'F'.repeat(32),'z'.repeat(32)]){
  const a=f.grant();a.payload.approvalId=invalid;a.signature=sign(null,grantSigningBytes(a.payload),f.privateKey).toString('base64');
  f.write('approval',a);blocked(f.run(),'INVALID_APPROVAL');
 }
});
test('repeated synthetic grant stays preview-only; replay consumption is not claimed',t=>{
 const f=fixture(t);assert.equal(f.run().status,0);assert.equal(f.run().status,0);
});
test('malformed and unsigned grants cannot pass',t=>{
 const f=fixture(t);
 f.write('approval',JSON.stringify({payload:f.grant().payload}));
 blocked(f.run(),'INVALID_APPROVAL');
 f.write('approval','{}');blocked(f.run(),'INVALID_APPROVAL');
});
