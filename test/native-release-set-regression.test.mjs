import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {approvedRelease,discoverApprovedUpdate,expectedArtifact} from '../tools/universal-install/managed-updates.mjs';
const m=JSON.parse(fs.readFileSync(new URL('../docs/release-train-0.12.json',import.meta.url)));
const tag='v0.12.1', head='f'.repeat(40);
const train={...m,sourceVersion:'0.12.1',releaseTag:tag,channel:'stable',status:'RELEASE_APPROVED',
 isStable:true,publishApproved:true,autoupdateApproved:true,installedPromotionApproved:true,
 components:m.components.map(x=>({...x,verified:true})),
 acceptance:Object.fromEntries(Object.keys(m.acceptance).map(k=>[k,true])),
 fleetCoverage:{...m.fleetCoverage,acceptedHostIds:[...m.fleetCoverage.expectedHostIds],mappingVerified:true,bootLoginAndRollbackVerified:true},
 distribution:{...m.distribution,noPublicStableAccepted:false}};
const asset=(suffix,digest='a')=>({name:'Remote-Commander-Unified-0.12.1-'+suffix,
 state:'uploaded',size:1500,digest:'sha256:'+digest.repeat(64)});
const win=asset('Windows-x64.exe','a'),linux=asset('Linux-amd64.deb','b');
const release={tag_name:tag,draft:false,prerelease:false,assets:[win,linux]};
const select=(r,current='0.12.0')=>approvedRelease({current,releases:[r],trainFor:()=>train});
test('both exact native packages must be present before selection',()=>{
 assert.equal(select(release)?.tag,tag);
 assert.equal(expectedArtifact(release,'linux'),linux);
 for(const assets of [[linux],[win],[win,linux,asset('legacy.zip')],[win,linux,linux],
  [win,{...linux,state:'new'}],[win,{...linux,digest:null}],[win,{...linux,size:999}],
  [win,{...linux,size:1536*1024*1024+1}],[win,{...linux,name:'Remote-Commander-Unified-0.12.0-Linux-amd64.deb'}]]){
  const r={...release,assets};
  assert.equal(select(r),null);
  assert.equal(expectedArtifact(r,'win32'),null);
 }
});
test('legacy native installations do not enter the 0.12 update discovery channel',async()=>{
 for(const current of ['0.11.0-dev.27','0.10.23','0.13.0','0.12.01','latest']){
  assert.equal(select(release,current),null);
  const x=await discoverApprovedUpdate({readInstalled:()=>current,api:async()=>{throw Error('unexpected network lookup')}});
  assert.equal(x.selected,null);
  assert.equal(x.migrationRequired,true);
 }
});
test('incomplete public release is rejected before resolving tag or train',async()=>{
 const x=await discoverApprovedUpdate({readInstalled:()=> '0.12.0',api:async endpoint=>{
  assert.equal(endpoint,'releases?per_page=30');
  return [{...release,assets:[linux]}];
 }});
 assert.equal(x.selected,null);
});
