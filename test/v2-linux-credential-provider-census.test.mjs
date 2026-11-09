import test from 'node:test';
import assert from 'node:assert/strict';
import {assessV2LinuxCredentialBindings} from '../tools/v2-linux-credential-provider-census.mjs';
const provider={profile:'secondary',active:true,ownerService:true,serviceActive:true,
 hasEnvironmentFile:true,hasLoadCredential:true};
const fixture=processes=>({profileNames:['owner','secondary','third'],
 keyStems:['owner'],processes});
test('missing .key may have an active systemd binding but never credential usability proof',()=>{
 const r=assessV2LinuxCredentialBindings(fixture([provider]));
 assert.equal(r.matched,1);
 assert.equal(r.missing,2);
 assert.equal(r.missingWithLiveOwnerProcess,1);
 assert.equal(r.missingWithActiveSystemdProvider,1);
 assert.equal(r.missingWithoutProviderEvidence,1);
 assert.equal(r.credentialUsability,'NOT_TESTED');
 assert.equal(r.safeForAutomaticMigration,false);
 assert.equal(JSON.stringify(r).includes('secondary'),false);
});
test('unowned, disabled, or absent service cannot attest alternative provider',()=>{
 for(const changed of [{ownerService:false},{serviceActive:false},
  {hasEnvironmentFile:false,hasLoadCredential:false},{active:false}]){
  const r=assessV2LinuxCredentialBindings(fixture([{...provider,...changed}]));
  assert.equal(r.missingWithActiveSystemdProvider,0);
  assert.equal(r.safeForAutomaticMigration,false);
 }
});
test('multiple running processes for same profile count once without exposing names',()=>{
 const r=assessV2LinuxCredentialBindings(fixture([provider,provider]));
 assert.equal(r.missingWithLiveOwnerProcess,1);
 assert.equal(r.missingWithActiveSystemdProvider,1);
});
test('empty census is not falsely considered a completed migration',()=>{
 const r=assessV2LinuxCredentialBindings({profileNames:[],keyStems:[],processes:[]});
 assert.equal(r.missing,0);
 assert.equal(r.safeForAutomaticMigration,false);
});
test('reject invalid or duplicate profile IDs and process metadata',()=>{
 for(const p of [['../secret'],['x','x'],[null]]){
  assert.throws(()=>assessV2LinuxCredentialBindings({
   profileNames:p,keyStems:[],processes:[]}),{code:'V2_PROVIDER_CENSUS_INVALID_INPUT'});
 }
 assert.throws(()=>assessV2LinuxCredentialBindings(fixture([{
  ...provider,credentialValue:'secret',ownerService:'true'
 }])),{code:'V2_PROVIDER_CENSUS_INVALID_PROCESS'});
});
