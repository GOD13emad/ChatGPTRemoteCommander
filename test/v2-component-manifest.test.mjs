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
  for(const file of ['src/v2-routing-contract.mjs',
    'src/v2-install-identity-gate.mjs','tools/v2-coordinator-host.mjs',
    'src/v2-mcp-oauth-contract.mjs','src/v2-native-window-bridge.mjs',
    'src/v2-authenticated-owner-gateway.mjs','src/v2-oauth-jwks.mjs',
    'src/v2-owner-session-reuse.mjs','tools/v2-idp-discovery-preflight.mjs']){
    assert.ok(a.components.some(c=>c.path===file&&c.sha256!==null),file);
  }
  assert.equal(a.installNow.includes('core'),true);
  assert.equal(a.pendingActivation.includes('work-plugin'),true);
  assert.equal(a.installNow.includes('work-plugin'),false);
  assert.equal(a.installNow.includes('browser'),false);
  const names=new Set(a.components.map(c=>c.path));
  // New V2 runtime modules cannot silently escape the source integrity manifest.
  for(const name of fs.readdirSync(path.join(root,'src')).filter(x=>/^v2-[a-z0-9-]+\.mjs$/.test(x))){
    const rel='src/'+name;
    assert.equal(names.has(rel),true,rel+' must be tracked by R1 manifest');
  }
  const win=['tools/v2-owner-seat-agent.mjs','tools/v2-owner-seat-install.ps1',
    'tools/v2-owner-seat-launch.ps1','tools/v2-owner-uia-chrome.mjs',
    'tools/v2-ci-watch.mjs'];
  for(const f of win)assert.equal(names.has(f),platform==='windows',f);
  assert.equal(names.has('tools/v2-linux-credential-provider-census.mjs'),
    platform==='linux');
  assert.equal(names.size,a.components.length,'manifest must not duplicate entries');
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

test('aliased source root and aliased package.json are never accepted as exact-source manifests',()=>{
 const rootTmp=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-r1-symlink-'));
 try{
  const alias=path.join(rootTmp,'alias');
  fs.symlinkSync(root,alias,'dir');
  assert.throws(()=>buildV2ComponentManifest({root:alias,platform:'linux'}),
    {code:'V2_R1_ROOT_ALIAS_FORBIDDEN'});
  const pkg=path.join(rootTmp,'package.json');
  fs.symlinkSync(path.join(root,'package.json'),pkg);
  assert.throws(()=>buildV2ComponentManifest({root:rootTmp,platform:'linux'}),
    {code:'V2_R1_PACKAGE_INVALID'});
 }finally{fs.rmSync(rootTmp,{recursive:true,force:true});}
});
test('invalid package source JSON blocks a manifest without throwing unstructured syntax',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-r1-package-'));
 try{
  fs.writeFileSync(path.join(temp,'package.json'),'{invalid');
  assert.throws(()=>buildV2ComponentManifest({root:temp,platform:'linux'}),
    {code:'V2_R1_PACKAGE_INVALID'});
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('absent or null package source metadata is rejected with structured denial',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-r1-meta-'));
 try{
  assert.throws(()=>buildV2ComponentManifest({root:dir,platform:'linux'}),
    {code:'V2_R1_PACKAGE_INVALID'});
  fs.writeFileSync(path.join(dir,'package.json'),'null');
  assert.throws(()=>buildV2ComponentManifest({root:dir,platform:'linux'}),
    {code:'V2_R1_VERSION_INVALID'});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
