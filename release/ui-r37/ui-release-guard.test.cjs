'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {inspect,validate,load}=require('./ui-release-guard.cjs');
const source=path.join(__dirname,'ui-channel-r37.json');
const fresh=()=>structuredClone(load(source));
const DIGEST='a'.repeat(64);

test('actual candidate is fail-closed, with exact four targets and no promotion',()=>{
 const r=inspect(fresh());
 assert.equal(r.status,'BLOCKED');
 assert.equal(r.automaticPromotionEnabled,false);
 assert.equal(r.hostCount,4);
 assert.ok(r.blockedReasons.includes('HOST_OFFLINE:mmz-linux'));
 assert.ok(r.blockedReasons.includes('GATE_OPEN:controlLinuxPhysicalVisual'));
 assert.ok(r.blockedReasons.includes('TRUSTED_CODE_SIGNING_NOT_VERIFIED:browser-win'));
 assert.ok(r.blockedReasons.includes('OWNER_LOCAL_SANDBOX_PRIVILEGE_REQUIRED:emad-linux'));
 assert.equal(r.productionCoreMutationAllowed,false);
});
test('real manifest status reports BLOCKED while enforce returns dedicated nonzero',()=>{
 const args=[path.join(__dirname,'ui-release-guard.cjs')];
 const safe=spawnSync(process.execPath,[...args,'--status',source],{encoding:'utf8'});
 assert.equal(safe.status,0);
 assert.equal(JSON.parse(safe.stdout).status,'BLOCKED');
 const blocked=spawnSync(process.execPath,[...args,'--enforce',source],{encoding:'utf8'});
 assert.equal(blocked.status,78);
});
test('synthetic complete evidence grants STAGING ELIGIBILITY only, not install',()=>{
 const m=fresh();
 m.status='APPROVED';
 m.automaticPromotionEnabled=true;
 for(const k of Object.keys(m.releaseGates))m.releaseGates[k]=true;
 for(const h of m.hosts){
  h.reportedConnected=true;h.verifiedNativeVisual=true;
  h.canaryRollbackAccepted=true;h.validationReceiptSha256=DIGEST;
  if(h.platform==='linux')h.ownerLocalPrivilegeReady=true;
 }
 for(const p of m.packages){
  p.sha256=DIGEST;p.rollbackReceiptSha256=DIGEST;
  p.downloadUrl='https://github.com/'+(p.id.startsWith('browser')?
   'Usefull-Skills/chatgpt-cef-linux/releases/download/v0.8.2/asset.zip':
   'GOD13emad/ChatGPTRemoteCommander/releases/download/v0.10.20/asset.zip');
  if(p.platform==='windows'){p.signatureChainVerified=true;p.signatureEvidenceSha256=DIGEST;}
 }
 const r=inspect(m);
 assert.equal(r.status,'STAGE_ELIGIBLE_NOT_INSTALLED');
 assert.equal(r.blockedReasons.length,0);
 assert.match(r.nextAction,/signature\/hash checks/);
 assert.equal(r.productionCoreMutationAllowed,false);
});
test('approved flag alone cannot bypass open security or native gates',()=>{
 const m=fresh();m.status='APPROVED';m.automaticPromotionEnabled=true;
 const r=inspect(m);
 assert.equal(r.status,'BLOCKED');
 assert.ok(r.blockedReasons.some(v=>v.startsWith('PACKAGE_MISSING_')));
});
test('host identifier or platform mismatches reject entire manifest',()=>{
 const m=fresh();m.hosts[0].id='unknown-server';
 assert.throws(()=>validate(m),/HOST_IDENTITIES/);
 const q=fresh();q.hosts.find(h=>h.id==='mmz-linux').platform='windows';
 assert.throws(()=>validate(q),/HOST_PLATFORM/);
});
test('unsafe artifact origin, unhashed release and any sandbox bypass reject',()=>{
 const m=fresh();m.packages[0].downloadUrl='http://evil.invalid/asset';
 assert.throws(()=>validate(m),/PACKAGE_URL_AUTHORITY/);
 const n=fresh();n.packages[0].sha256='abc';
 assert.throws(()=>validate(n),/PACKAGE_SHA_FORMAT/);
 const p=fresh();p.security.userBrowserProfileMutationAllowed=true;
 assert.throws(()=>validate(p),/SECURITY_GUARDS/);
});
test('source commits and released Browser version must be exact',()=>{
 const m=fresh();m.components[0].candidateCommit='latest';
 assert.throws(()=>validate(m),/SOURCE_AUTHORITY/);
 const n=fresh();n.components[0].version='0.8.1';
 assert.throws(()=>validate(n),/BROWSER_VERSION/);
});
test('no output path, deletion, shell, network or update execution is exposed',()=>{
 const body=require('node:fs').readFileSync(path.join(__dirname,'ui-release-guard.cjs'),'utf8');
 assert.doesNotMatch(body,/execSync|spawnSync|execFile|Process\.Start|fetch\(|http\.request|https\.request|writeFile|unlink|rmSync|renameSync|systemctl|schtasks/);
});
