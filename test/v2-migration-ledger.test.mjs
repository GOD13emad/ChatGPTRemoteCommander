import test from 'node:test';
import assert from 'node:assert/strict';
import {captureV2MigrationManifest,verifyV2MigrationPreservation} from '../src/v2-migration-ledger.mjs';
const H='a'.repeat(64);
function sample(){
 return {schema:1,hostId:'emad-win',platform:'win32',osPrincipalId:'sid-owner-a',
   sourceBuild:'0.11.0-dev.18',observedAtMs:1000,profiles:[
    {profileId:'owner',ownerOsPrincipalId:'sid-owner-a',desktopSeatId:'session-1',
     accountRef:'managedref:chat-account-one',workspaceRef:'managedref:workspace-one',
     browserProfileRef:'ownerref:browserprofile-owner',
     tunnels:[
      {enrollmentId:'tunnel-1',credentialRef:'wincred:owner-tunnel-one',
       endpointRef:'managedref:listener-47831',supervisorRef:'managedref:supervisor-a',autostart:true},
      {enrollmentId:'tunnel-2',credentialRef:'wincred:owner-tunnel-two',
       endpointRef:'managedref:listener-47836',supervisorRef:'managedref:supervisor-b',autostart:false}
     ],
     projects:[{projectId:'project-1',rootRef:'ownerref:project-root-one',
      brainRef:'ownerref:project-brain',workflowSchema:2,
      receipts:[{receiptId:'receipt-1',sha256:H},{receiptId:'receipt-2',sha256:'b'.repeat(64)}]}]},
    {profileId:'secondary',ownerOsPrincipalId:'sid-owner-b',desktopSeatId:'session-2',
     accountRef:'managedref:chat-account-two',workspaceRef:'managedref:workspace-two',
     browserProfileRef:'ownerref:browserprofile-secondary',
     tunnels:[{enrollmentId:'tunnel-3',credentialRef:'wincred:secondary-tunnel',
       endpointRef:'managedref:listener-47834',supervisorRef:'managedref:supervisor-c',autostart:true}],
     projects:[]}
   ]};
}
const clone=x=>structuredClone(x);
const compare=(before,after)=>verifyV2MigrationPreservation({
 baseline:before,proposed:after,baselineDigest:captureV2MigrationManifest(before).digest
});
test('nonsecret snapshot creates stable identity and complete preservation counts',()=>{
 const x=sample();
 const a=captureV2MigrationManifest(x);
 const y=clone(x);y.profiles.reverse();y.profiles[1].tunnels.reverse();
 const b=captureV2MigrationManifest(y);
 assert.equal(a.digest,b.digest);
 assert.deepEqual(a.counts,{profiles:2,tunnels:3,projects:1,receipts:2});
 const result=compare(x,y);
 assert.equal(result.preservationReady,true);
 assert.equal(result.cutoverAccepted,false);
 assert.equal(result.credentialUsability,'NOT_TESTED');
 assert.equal(result.differences.length,0);
});
test('new V2 profile/tunnel is allowed but cannot hide a removed old enrollment',()=>{
 const original=sample(),proposed=clone(original);
 proposed.observedAtMs=2000;
 proposed.profiles[0].tunnels.push({enrollmentId:'tunnel-4',credentialRef:'wincred:new-credential',
  endpointRef:'managedref:new-endpoint',supervisorRef:'managedref:new-supervisor',autostart:false});
 assert.equal(compare(original,proposed).preservationReady,true);
 proposed.profiles[0].tunnels.splice(0,1);
 const broken=compare(original,proposed);
 assert.equal(broken.preservationReady,false);
 assert.deepEqual(broken.differences,[{kind:'tunnel',parent:'owner',id:'tunnel-1',status:'MISSING'}]);
});
test('credential and supervisor reference changes cannot be silently called lossless',()=>{
 for(const [key,value] of [['credentialRef','wincred:new-ref'],
  ['supervisorRef','managedref:new-supervisor'],['endpointRef','managedref:another-route'],
  ['autostart',false]]){
  const before=sample(),after=clone(before);
  after.profiles[0].tunnels[0][key]=value;
  const res=compare(before,after);
  assert.equal(res.preservationReady,false,key);
  assert.equal(res.differences[0].kind,'tunnel');
  assert.equal(res.differences[0].status,'CHANGED');
 }
});
test('SID, account, browser profile, project root and receipt digest must survive exactly',()=>{
 const edits=[
  x=>x.osPrincipalId='sid-different',
  x=>x.profiles[0].ownerOsPrincipalId='sid-different',
  x=>x.profiles[0].accountRef='managedref:new-account',
  x=>x.profiles[1].browserProfileRef='ownerref:other-profile',
  x=>x.profiles[0].projects[0].rootRef='ownerref:other-root',
  x=>x.profiles[0].projects[0].receipts[0].sha256='c'.repeat(64)
 ];
 for(let i=0;i<edits.length;i++){
  const a=sample(),b=clone(a);edits[i](b);
  if(i===0)assert.throws(()=>compare(a,b),{code:'V2_MIGRATION_HOST_REBOUND'});
  else assert.equal(compare(a,b).preservationReady,false,'mutation '+i);
 }
});
test('untrusted snapshot cannot supply secret text, raw filesystem credentials or extra keys',()=>{
 const cases=[
  x=>x.profiles[0].tunnels[0].token='secret-bearer',
  x=>x.profiles[0].tunnels[0].credentialRef='password-value',
  x=>x.profiles[0].tunnels[0].credentialRef='ownerref:../../secret',
  x=>x.profiles[0].projects[0].receipts[0].sha256='not-digest',
  x=>x.profiles[0].tunnels[0].autostart='true',
  x=>x.profiles[0].projects[0].rootRef='C:\\Users\\Profile\\secret.key',
  x=>x.profiles[0].accountRef={ref:'managedref:account',token:'secret'},
  x=>x.profiles[0].projects[0].workflowSchema=0,
  x=>x.profiles[0].tunnels.push(clone(x.profiles[0].tunnels[0])),
  x=>x.profiles.push(clone(x.profiles[0]))
 ];
 for(const [i,mutate] of cases.entries()){
  const data=sample();mutate(data);
  assert.throws(()=>captureV2MigrationManifest(data),e=>e.code?.startsWith('V2_MIGRATION_'),String(i));
 }
});
test('baseline digest mismatch and time rollback reject potentially stale migration',()=>{
 const a=sample(),b=clone(a);
 assert.throws(()=>verifyV2MigrationPreservation({
  baseline:a,proposed:b,baselineDigest:'0'.repeat(64)
 }),{code:'V2_MIGRATION_BASELINE_MISMATCH'});
 b.observedAtMs=999;
 assert.throws(()=>compare(a,b),{code:'V2_MIGRATION_STALE_CANDIDATE'});
});
test('missing profile, project or receipt is identified without reading secrets',()=>{
 for(const [remove,expectedKind] of [
  [x=>x.profiles.pop(),'profile'],
  [x=>x.profiles[0].projects.pop(),'project'],
  [x=>x.profiles[0].projects[0].receipts.pop(),'receipt']
 ]){
  const before=sample(),after=clone(before);remove(after);
  const result=compare(before,after);
  assert.equal(result.preservationReady,false);
  assert.equal(result.differences[0].kind,expectedKind);
  assert.equal(JSON.stringify(result).includes('wincred:'),false);
 }
});
