import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildV2ComponentManifest} from '../tools/v2-component-manifest.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
test('current exact source has a complete, deterministic R1 plan for each supported OS',()=>{
 for(const platform of ['windows','linux']){
  const a=buildV2ComponentManifest({root,platform});
  const b=buildV2ComponentManifest({root,platform});
  assert.deepEqual(a,b);
  assert.equal(a.componentsComplete,true);
  assert.equal(a.releaseAdmitted,false);
  assert.equal(a.installedRuntimeAttested,false);
  assert.equal(a.changesApplied,false);
  assert.ok(a.components.every(x=>/^[a-f0-9]{64}$/.test(x.sha256)));
  assert.equal(a.installNow.includes('core'),true);
  assert.equal(a.pendingActivation.includes('work-plugin'),true);
  assert.equal(a.installNow.includes('work-plugin'),false);
  assert.equal(a.installNow.includes('browser'),false);
 }
});
test('source package version and owner runtime evidence cannot be conflated',()=>{
 const no=buildV2ComponentManifest({root,platform:'windows',installedEvidence:{
  liveVersion:'0.11.0-dev.18',exactBuildSha256:'b'.repeat(64),
  ownerSessionAttested:true,runtimeComponentsVerified:true}});
 assert.equal(no.releaseAdmitted,false);
 assert.equal(no.installedRuntimeAttested,false);
 assert.equal(no.sourceVersion,JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version);
});
test('missing critical source fails completeness rather than claiming installed product',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-r1-'));
 try{
  fs.copyFileSync(path.join(root,'package.json'),path.join(temp,'package.json'));
  const v=buildV2ComponentManifest({root:temp,platform:'linux'});
  assert.equal(v.componentsComplete,false);
  assert.ok(v.missing.includes('src/server-v0.3.mjs'));
  assert.equal(v.releaseAdmitted,false);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('invalid installed attestation and filesystem aliases fail closed',()=>{
 assert.throws(()=>buildV2ComponentManifest({root,platform:'macos'}),
  {code:'V2_R1_PLATFORM_INVALID'});
 assert.throws(()=>buildV2ComponentManifest({root,platform:'linux',installedEvidence:{
  liveVersion:'x',exactBuildSha256:'not-hash',ownerSessionAttested:true,runtimeComponentsVerified:true
 }}),{code:'V2_R1_INSTALLED_EVIDENCE_INVALID'});
});
