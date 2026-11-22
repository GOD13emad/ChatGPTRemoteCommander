import test from 'node:test';
import assert from 'node:assert/strict';
import {compareReleaseVersions,approvedRelease,expectedArtifact,discoverApprovedUpdate,publicGitHubJson}
 from '../tools/universal-install/managed-updates.mjs';
const valid=(tag,extra={})=>({
 schema:'rc-suite-release-train-v1',train:'0.12',sourceVersion:tag.slice(1),
 releaseTag:tag,isStable:true,publishApproved:true,
 autoupdateApproved:true,installedPromotionApproved:true,
 channel:'stable',...extra
});
const r=tag=>({tag_name:tag,draft:false,prerelease:false,assets:[]});
test('stable semver strictly advances and never downgrades native dev.9',()=>{
 assert.equal(compareReleaseVersions('0.12.0','0.12.0-dev.9'),1);
 assert.equal(compareReleaseVersions('0.12.0-dev.10','0.12.0-dev.9'),1);
 assert.equal(compareReleaseVersions('0.12.0-dev.8','0.12.0-dev.9'),-1);
 assert.equal(compareReleaseVersions('0.13.0','0.12.0'),1);
 assert.equal(compareReleaseVersions('0.12.0','0.12.0'),0);
 assert.throws(()=>compareReleaseVersions('latest','0.12.0'),/VERSION_INVALID/);
});
test('unsigned/prerelease/draft and unapproved train never trigger an auto update',()=>{
 const releases=[r('v0.12.0'),{...r('v0.13.0'),draft:true},
   {...r('v0.14.0'),prerelease:true}];
 for(const unset of ['autoupdateApproved','publishApproved',
   'installedPromotionApproved','isStable']){
   const train=valid('v0.12.0',{[unset]:false});
   assert.equal(approvedRelease({current:'0.12.0-dev.9',releases,
     trainFor:()=>train}),null);
 }
 assert.equal(approvedRelease({current:'0.12.0-dev.9',releases,
   trainFor:()=>valid('v0.12.0',{releaseTag:'v0.12.1'})}),null);
 assert.equal(approvedRelease({current:'0.12.0',releases,
   trainFor:()=>valid('v0.12.0')}),null);
});
test('only a consistent independently approved stable release may advance',()=>{
 let queried=0;
 const selected=approvedRelease({current:'0.12.0-dev.9',
   releases:[r('v0.10.20'),r('v0.12.0')],
   trainFor:(tag,minor)=>{
     queried++;
     assert.equal(tag,'v0.12.0');
     assert.equal(minor,'0.12');
     return valid(tag);
   }});
 assert.equal(selected.tag,'v0.12.0');
 assert.equal(queried,1);
});

test('auto-stage enforces exact signed asset version and OS architecture',()=>{
  const released={tag_name:'v0.12.0',assets:[
    {name:'Remote-Commander-Unified-0.12.0-dev.10-Linux-amd64.deb',
      state:'uploaded',size:1000000,digest:'sha256:'+'a'.repeat(64)},
    {name:'Remote-Commander-Unified-0.12.0-Linux-amd64.deb',
      state:'uploaded',size:1000000,digest:'sha256:'+'b'.repeat(64)},
    {name:'Remote-Commander-Unified-0.11.0-Windows-x64.exe',
      state:'uploaded',size:1000000,digest:'sha256:'+'c'.repeat(64)}
  ]};
  assert.equal(expectedArtifact(released,'linux')?.name,
    'Remote-Commander-Unified-0.12.0-Linux-amd64.deb');
  assert.equal(expectedArtifact(released,'win32'),null,
    'Windows must never stage a package from another release');
  assert.equal(expectedArtifact(released,'linux','arm64'),null,
    'Unsupported CPU must fail closed');
  assert.equal(expectedArtifact({...released,assets:released.assets.slice(0,1)},'linux'),null,
    'A dev build must not count as a stable asset');
  assert.equal(expectedArtifact({...released,assets:[
    {...released.assets[1],state:'new'}
  ]},'linux'),null);
  assert.equal(expectedArtifact({...released,assets:[
    released.assets[1],released.assets[1]
  ]},'linux'),null,'duplicate assets must fail closed');
});

test('public GitHub discovery uses immutable source digest with no gh account',async()=>{
 const head='f'.repeat(40),calls=[];
 const result=await discoverApprovedUpdate({
   readInstalled:()=> '0.12.0-dev.9',
   api:async endpoint=>{
     calls.push(endpoint);
     if(endpoint==='releases?per_page=30')return [r('v0.12.0')];
     if(endpoint==='commits/v0.12.0')return {sha:head};
     if(endpoint==='contents/docs/release-train-0.12.json?ref='+head)
       return {type:'file',encoding:'base64',
         content:Buffer.from(JSON.stringify(valid('v0.12.0'))).toString('base64')};
     throw Error('Unexpected lookup '+endpoint);
   }
 });
 assert.equal(result.selected.sourceHead,head);
 assert.deepEqual(calls,['releases?per_page=30','commits/v0.12.0',
   'contents/docs/release-train-0.12.json?ref='+head]);
 assert.equal(result.selected.tag,'v0.12.0');
});
test('public updater never queries train from mutable tag or unsupported API',async()=>{
 const head='e'.repeat(40),seen=[];
 const discovered=await discoverApprovedUpdate({
   readInstalled:()=> '0.12.0-dev.9',
   api:async endpoint=>{
     seen.push(endpoint);
     if(endpoint==='releases?per_page=30')return [r('v0.12.0')];
     if(endpoint==='commits/v0.12.0')return {sha:head};
     if(endpoint==='contents/docs/release-train-0.12.json?ref='+head)return null;
     throw Error('Unexpected');
   }
 });
 assert.equal(discovered.selected,null);
 assert.equal(seen.length,3);
 await assert.rejects(()=>publicGitHubJson('https://attacker.invalid/path'),
   /PUBLIC_API_ROUTE_DENIED/);
 await assert.rejects(()=>publicGitHubJson('releases?per_page=30',{
   fetcher:async()=>({status:401})}),/PUBLIC_API_REJECTED/);
});
