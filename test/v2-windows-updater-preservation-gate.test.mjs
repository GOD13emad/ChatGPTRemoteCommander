import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {censusV2EnrollmentScope} from '../tools/v2-enrollment-census.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const upgrader=path.join(repo,'auto-update-windows.ps1');

async function fixture(fn){
 const root=await mkdtemp(path.join(os.tmpdir(),'rc-v2-win-updater-'));
 const p=path.join(root,'profiles'), c=path.join(root,'credentials');
 await mkdir(p); await mkdir(c);
 try{await fn(p,c);}finally{await rm(root,{recursive:true,force:true});}
}
test('Windows updater blocks missing DPAPI after candidate NoPromote and before any route switch',async()=>{
 const s=await readFile(upgrader,'utf8');
 const noPromoteExit=s.lastIndexOf('AUTO_UPDATE_CANDIDATE_PASS');
 const guard=s.lastIndexOf('AUTO_UPDATE_PROFILE_CREDENTIAL_PRESERVATION_BLOCK');
 const routerStep=s.lastIndexOf('$routerBootstrapDeferred=@()');
 const switchStep=s.lastIndexOf('Switch-Route $t $c');
 assert.ok(noPromoteExit>0 && guard>noPromoteExit && guard<routerStep);
 assert.ok(switchStep>guard);
 assert.ok(s.includes("tools\\v2-enrollment-census.mjs"));
 assert.ok(s.includes('--profile-dir $ProfileDir --credential-dir $credentialDir | Out-Null'));
 assert.match(s,/AUTO_UPDATE_PROFILE_CREDENTIAL_GUARD_UNAVAILABLE/);
});
test('missing Windows protected key blocks preflight even if original tunnel is live',async()=>{
 await fixture(async(p,c)=>{
  await writeFile(path.join(p,'running.yaml'),'never-read');
  await writeFile(path.join(p,'needs-recovery.yaml'),'never-read');
  await writeFile(path.join(c,'running.dpapi'),'opaque-key');
  const v=await censusV2EnrollmentScope({profileDir:p,credentialDir:c,platform:'win32'});
  assert.equal(v.credentialMatches.missing,1);
  assert.equal(v.structuralStatus,'BLOCKED_RECONCILIATION');
  assert.equal(v.safeForAutomaticMigration,false);
  const publicValue=JSON.stringify(v);
  for(const item of ['running.yaml','needs-recovery.yaml','opaque-key',p,c])assert.ok(!publicValue.includes(item));
 });
});
test('both CurrentUser and LocalMachine references are kept distinct and not collapsed',async()=>{
 await fixture(async(p,c)=>{
  await writeFile(path.join(p,'owner.yaml'),'config-not-inspected');
  await writeFile(path.join(c,'owner.dpapi'),'protected');
  await writeFile(path.join(c,'owner.machine.dpapi'),'protected');
  const v=await censusV2EnrollmentScope({profileDir:p,credentialDir:c,platform:'win32'});
  assert.equal(v.structuralStatus,'STRUCTURAL_MATCH');
  assert.equal(v.credentialMatches.currentUser,1);
  assert.equal(v.credentialMatches.localMachine,1);
  assert.equal(v.credentialMatches.bothWindowsScopes,1);
  assert.equal(v.credentialUsability,'UNVERIFIED');
  assert.equal(v.safeForAutomaticMigration,false);
 });
});

test('Windows V1-native upgrade reuses owner tunnel profiles, credentials, active configs and canonical routes',async()=>{
 const s=await readFile(upgrader,'utf8');
 assert.ok(s.includes("$ProfileDir=Join-Path $env:APPDATA 'tunnel-client'"));
 assert.ok(s.includes("$credentialDir=Join-Path $StateRoot 'credentials'"));
 assert.ok(s.includes("function Get-PrimaryConfig"));
 assert.ok(s.includes("$r.active.configPath"));
 assert.ok(s.includes("function Get-Targets"));
 assert.ok(s.includes("Get-ChildItem -LiteralPath $InstanceRoot -Directory"));
 assert.ok(s.includes("ExistingConfig=[IO.Path]::GetFullPath($cfg)"));
 assert.ok(s.includes("'--existing',$t.ExistingConfig"));
 assert.ok(s.includes("function Verify-Tunnels"));
 assert.ok(s.includes("foreach($f in Get-ChildItem -LiteralPath $ProfileDir -Filter '*.yaml'"));
 assert.ok(s.includes("function Switch-Route"));
 assert.ok(s.includes("function Verify-Canonical"));
 assert.ok(s.includes("tools\\router-switch.mjs"));
 // Standard V1 upgrade must not create a new OpenAI tunnel or regenerate its key.
 assert.ok(!/tunnels create|tunnel create|CONTROL_PLANE_API_KEY\s*=|RuntimeApiKey\s*=/.test(s));
});

test('Windows V1-native upgrade enumerates and preserves every enabled named profile and its own canonical route',async()=>{
 const s=await readFile(upgrader,'utf8');
 assert.ok(s.includes("function Get-Targets"));
 assert.ok(s.includes("Profile='default';CanonicalPort=47831"));
 assert.ok(s.includes("foreach($profileDir in Get-ChildItem -LiteralPath $InstanceRoot -Directory"));
 assert.ok(s.includes("Join-Path $profileDir.FullName 'instance.json'"));
 assert.ok(s.includes("$record.enabled-ne $true"));
 assert.ok(s.includes("CanonicalPort=[int]$record.mcpPort"));
 assert.ok(s.includes("RoutePath=$route"));
 assert.ok(s.includes("TARGET_PROFILE_NOT_FOUND"));
 assert.ok(s.includes("$targets=Get-Targets"));
 assert.ok(s.includes("foreach($t in $targets)"));
 assert.ok(s.includes("Switch-Route $t $c"));
 assert.ok(s.includes("Verify-Canonical $c.Target $c"));
 // Each named owner route keeps its own port, route file and active config;
 // it is not collapsed into the default profile during upgrade.
 assert.ok(s.includes("Get-RoutePath $profile"));
 assert.ok(s.includes("$cfg=Merge-OwnerPolicyConfig ([string]$rr.active.configPath) $canonical $profile"));
});
