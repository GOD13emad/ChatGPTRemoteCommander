import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateV2InstallIdentity} from '../src/v2-install-identity-gate.mjs';
const HEAD='a'.repeat(64),OLD='b'.repeat(64);
const core={id:'core-one',role:'core',version:'0.11.0-dev.18',sha256:HEAD,
 sourceCommit:HEAD,installationId:'one-install',supervisorId:'supervisor-one',
 active:true,ownerAttested:true,scope:'current-owner'};
const app={...core,id:'legacy-payload',role:'updater',version:'0.10.26',sha256:OLD,sourceCommit:OLD};
const input=components=>({hostId:'emad-pc',platform:'windows',
 components,expectedSource:{commit:HEAD,version:'0.11.0-dev.18'}});
test('older bootstrap payload and one unified runtime are not inherently duplicate installations',()=>{
 const result=evaluateV2InstallIdentity(input([core,app]));
 assert.equal(result.identityConsistent,true);
 assert.equal(result.readyForCandidateCutover,false);
 assert.equal(result.attestationStatus,'INDEPENDENT_NATIVE_PROOF_REQUIRED');
 assert.deepEqual(result.findings,[]);
 assert.equal(result.cleanupAuthorized,false);
});
test('second active core in same scope is a blocker, even if source matches',()=>{
 const result=evaluateV2InstallIdentity(input([core,{...core,id:'core-two'}]));
 assert.equal(result.readyForCandidateCutover,false);
 assert.ok(result.findings.some(x=>x.code==='MULTIPLE_ACTIVE_CORE_PROCESSES_UNRESOLVED'));
});
test('different active installation identity is a blocker, regardless of compatible package version',()=>{
 const result=evaluateV2InstallIdentity(input([core,{...app,id:'owner-gui',role:'owner-gui',installationId:'second-install'}]));
 assert.ok(result.findings.some(x=>x.code==='MULTIPLE_ACTIVE_INSTALLATION_IDENTITIES'));
 assert.equal(result.readyForCandidateCutover,false);
});
test('unattested owner and unknown candidate source cannot be promoted',()=>{
 const result=evaluateV2InstallIdentity(input([{...core,ownerAttested:false,sourceCommit:OLD}]));
 assert.equal(result.readyForCandidateCutover,false);
 assert.ok(result.findings.some(x=>x.code==='UNATTESTED_OWNER'));
 assert.ok(result.findings.some(x=>x.code==='CORE_SOURCE_NOT_CANDIDATE'));
});
test('missing source commit is not a verified V2 candidate',()=>{
 const result=evaluateV2InstallIdentity(input([{...core,sourceCommit:null}]));
 assert.equal(result.readyForCandidateCutover,false);
});
test('reject fabricated roles, extra fields, duplicate IDs, invalid hashes and untrusted platform',()=>{
 const edits=[x=>x[0].role='superadmin',x=>x[0].sha256='invalid',
   x=>x[0].token='secret',x=>x.push({...x[0]}),
   x=>x[0].installationId='../../bad'];
 for(const mutate of edits){
  const list=[{...core}];mutate(list);
  assert.throws(()=>evaluateV2InstallIdentity(input(list)),e=>e.code?.startsWith('V2_INSTALL_'));
 }
 assert.throws(()=>evaluateV2InstallIdentity({...input([core]),platform:'unknown'}));
});
test('stable inventory digest across component order but not source identities',()=>{
 const a=evaluateV2InstallIdentity(input([core,app]));
 const b=evaluateV2InstallIdentity(input([app,core]));
 assert.equal(a.inventoryDigest,b.inventoryDigest);
 const c=evaluateV2InstallIdentity(input([{...core,sourceCommit:OLD},app]));
 assert.notEqual(a.inventoryDigest,c.inventoryDigest);
});

test('invented owner-attested and matching hashes never promote a source-only inventory',()=>{
 const result=evaluateV2InstallIdentity(input([{...core,ownerAttested:true,sourceCommit:HEAD}]));
 assert.equal(result.candidateMatched,true);
 assert.equal(result.identityConsistent,true);
 assert.equal(result.readyForCandidateCutover,false);
 assert.equal(result.cleanupAuthorized,false);
});
