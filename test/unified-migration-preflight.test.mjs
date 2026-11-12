import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessMigration,inspectLocalPlatform,readLinuxOwnerTunnelBinding,inspectLinuxNativeCorePayload,parseMainTunnelBinding,classifyObservedRouterStatus,classifyWindowsUninstallRegistryResponse} from '../packaging/unified/migration-preflight.mjs';
import {planOwnerPrivateTunnelCutover} from '../tools/plan-owner-private-tunnel-cutover.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const modulePath=path.join(repo,'packaging/unified/migration-preflight.mjs');

test('read-only Linux inventory preserves Native Tunnel and old live service blockers',()=>{
 const r=assessMigration({platform:'linux',inventoryReliable:true,
    nativePackageInstalled:true,allNativePayloadPathsAvailable:true,
    units:[{kind:'core',active:true,enabled:true,knownExecutable:false},
      {kind:'tunnel',active:true,enabled:true,knownExecutable:true,nativeTunnelCompatible:true}]
 });
 assert.equal(r.decision,'NO_PROMOTE');assert.equal(r.readOnly,true);
 assert.equal(r.activeCoreUnits,1);assert.equal(r.activeTunnelUnits,1);
 assert.equal(r.enabledCoreUnits,1);assert.equal(r.enabledTunnelUnits,1);
 assert.ok(r.blocked.includes('ACTIVE_SERVICE_EXECUTABLE_UNMAPPED'));
 assert.ok(r.blocked.includes('ENABLED_AUTOSTART_EXECUTABLE_UNMAPPED'));
 assert.ok(r.blocked.includes('ACTIVE_SERVICE_ROLLBACK_NOT_TESTED'));
 assert.ok(r.blocked.includes('G1_CURRENT_SESSION_UNVERIFIED'));
 assert.ok(r.blocked.includes('PROFILE_BACKUP_NOT_VERIFIED'));
 assert.ok(r.blocked.includes('UPDATE_ROLLBACK_PROVENANCE_UNVERIFIED'));
 assert.equal(JSON.stringify(r).includes('apikey'),false);
});
test('Linux preflight inventories the one exact owner-private Tunnel without disclosing its API key',{
 skip:process.platform!=='linux'
},()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-linux-owner-profile-'));
 const folder=path.join(home,'.config','tunnel-client');
 const profile=path.join(folder,'Emad.yaml');
 const key='TEST_ONLY_DO_NOT_LOG_SECRET_TOKEN';
 const yaml=[
  'config_version: 1','control_plane:','  api_key: '+key,
  'mcp:','  server_urls:','    - channel: main',
  '      url: "http://127.0.0.1:47831/mcp"'
 ].join('\n');
 try{
  fs.mkdirSync(folder,{recursive:true,mode:0o700});
  fs.chmodSync(folder,0o700);
  fs.writeFileSync(profile,yaml,{mode:0o600});
  const read=()=>readLinuxOwnerTunnelBinding({home,ownerUid:process.getuid()});
  const good=read();
  assert.deepEqual(good,{profilePresent:true,valid:true,port:47831,tls:false});
  assert.doesNotMatch(JSON.stringify(good),/DO_NOT_LOG|Emad|api_key/);
  const report=assessMigration({platform:'linux',connectionMode:'private-tunnel',
   inventoryReliable:true,nativePackageInstalled:true,
   allNativePayloadPathsAvailable:true,units:[],tunnelProfilePresent:true,
   tunnelProfileValid:good.valid,tunnelTargetPort:good.port,
   tunnelTargetTls:good.tls,tunnelTargetVersion:'0.11.0-dev.23'});
  assert.equal(report.ownerTunnelTargetPort,47831);
  assert.ok(report.blocked.includes('PRIVATE_TUNNEL_HTTPS_MTLS_ROUTE_REQUIRED'));
  fs.chmodSync(profile,0o644);
  assert.deepEqual(read(),{profilePresent:true,valid:false});
  fs.chmodSync(profile,0o600);
  fs.writeFileSync(path.join(folder,'Other.yaml'),yaml,{mode:0o600});
  assert.deepEqual(read(),{profilePresent:true,valid:false});
  const bad=assessMigration({platform:'linux',connectionMode:'private-tunnel',
    inventoryReliable:true,nativePackageInstalled:true,
    allNativePayloadPathsAvailable:true,units:[],tunnelProfilePresent:true,
    tunnelProfileValid:false});
  assert.ok(bad.blocked.includes('OWNER_TUNNEL_MAIN_BINDING_UNVERIFIED'));
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('single native Linux package must contain the actual v0.12 protected Core, native J01 and worker grant modules',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-installed-private-core-'));
 const files=[
  'runtime/node','tunnel/native-tunnel-launch.sh','tunnel/tunnel-client',
  'native-config-preflight.mjs','app/src/server-v0.3.mjs',
  'app/src/v012-private-core-runtime.mjs',
  'app/src/v2-private-pair-mcp-http-ingress.mjs',
  'app/src/v2-private-tunnel-https-gateway.mjs',
  'app/src/v2-private-pair-operation-gate.mjs',
  'app/src/v2-private-signed-worker-grant-adapter.mjs',
  'app/src/v101-private-pair-native-owner-stack.mjs',
  'app/src/native-owner-session-provider-linux.mjs',
  'app/src/native-tunnel-attestor.mjs','app/package.json'
 ];
 try{
  assert.equal(inspectLinuxNativeCorePayload(root),false);
  for(const rel of files){
   const f=path.join(root,rel);
   fs.mkdirSync(path.dirname(f),{recursive:true});
   fs.writeFileSync(f,rel==='app/package.json'
     ?'{"version":"0.12.0-dev.1"}':'NONPRODUCTION_QA_MODULE_ONLY');
  }
  assert.equal(inspectLinuxNativeCorePayload(root),true);
  // The SHA-pinned official Node v22 executable is ~125 MB. Sparse sizes
  // exercise real size admission without copying 125 MB in CI fixtures.
  const runtime=path.join(root,'runtime/node');
  fs.truncateSync(runtime,125*1024*1024);
  assert.equal(inspectLinuxNativeCorePayload(root),true);
  fs.truncateSync(runtime,257*1024*1024);
  assert.equal(inspectLinuxNativeCorePayload(root),false);
  fs.truncateSync(runtime,125*1024*1024);
  const probe=path.join(root,'app/src/v012-private-core-runtime.mjs');
  fs.unlinkSync(probe);
  assert.equal(inspectLinuxNativeCorePayload(root),false);
  // Ordinary Windows CI does not have SeCreateSymbolicLinkPrivilege;
  // exercise type rejection there without requiring Developer Mode/admin.
  if(process.platform==='win32'){
    fs.mkdirSync(probe);
    assert.equal(inspectLinuxNativeCorePayload(root),false);
    fs.rmdirSync(probe);
  }else{
    fs.symlinkSync(path.join(root,'app/src/server-v0.3.mjs'),probe);
    assert.equal(inspectLinuxNativeCorePayload(root),false);
    fs.unlinkSync(probe);
  }
  fs.writeFileSync(probe,'NONPRODUCTION_QA_MODULE_ONLY');
  fs.writeFileSync(path.join(root,'app/package.json'),'{"version":"0.11.0-dev.23"}');
  assert.equal(inspectLinuxNativeCorePayload(root),false);
  fs.writeFileSync(path.join(root,'app/package.json'),'{"version":"0.12.0-dev.1"}');
  assert.equal(inspectLinuxNativeCorePayload(root),true);
  const native=assessMigration({platform:'linux',connectionMode:'private-tunnel',
    inventoryReliable:true,nativePackageInstalled:true,
    allNativePayloadPathsAvailable:false,nativeProtectedCoreFilesPresent:false,
    nativePackageIntegrityVerified:false,units:[]});
  assert.ok(native.blocked.includes('NATIVE_PROTECTED_CORE_FILES_NOT_INSTALLED'));
  assert.ok(native.blocked.includes('NATIVE_RUNTIME_TUNNEL_SERVICE_CONTINUITY_UNPROVEN'));
  assert.ok(native.blocked.includes('NATIVE_INSTALLED_PACKAGE_INTEGRITY_UNVERIFIED'));
  assert.equal(native.nativeProtectedCoreFilesPresent,false);
  assert.equal(native.nativePackageIntegrityVerified,false);
  const packageBuild=fs.readFileSync(path.join(repo,'tools/build-native-linux-package.sh'),'utf8');
  for(const rel of files.filter(x=>x.startsWith('app/src/')))
    assert.ok(packageBuild.includes(rel.replace('app/','')),
      'dpkg builder must verify protected module '+rel);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('Windows Inno→NSIS remains blocked without proven reversible cutover',()=>{
 const r=assessMigration({platform:'win32',legacyInnoPresent:true,inventoryReliable:true});
 assert.equal(r.existingInstalled,true);
 assert.equal(r.decision,'NO_PROMOTE');
 assert.ok(r.blocked.includes('LEGACY_INNO_TO_NSIS_TRANSACTION_MISSING'));
 assert.equal(r.promotionAuthority,'EXTERNAL_REQUIRED');
});
test('unknown inventory and stale native paths are explicit blockers',()=>{
 const r=assessMigration({platform:'linux',nativePackageInstalled:true,inventoryReliable:false,
    allNativePayloadPathsAvailable:false,units:[]});
 assert.ok(r.blocked.includes('INVENTORY_UNAVAILABLE'));
 assert.ok(r.blocked.includes('NATIVE_RUNTIME_TUNNEL_SERVICE_CONTINUITY_UNPROVEN'));
 assert.throws(()=>assessMigration({platform:'android'}),/RC012_MIGRATION_PLATFORM_INVALID/);
});
test('self-reported all booleans cannot grant promotion or access',()=>{
 const f={platform:'linux',inventoryReliable:true,nativePackageInstalled:false,
   allNativePayloadPathsAvailable:true,units:[],activeServiceRestoreTested:true,
   profileBackupReceiptVerified:true,featureParityVerified:true,
   g1AuthenticatedCurrentSession:true,j01OwnerNativeConsent:true,
   revocableFullAccessProven:true,trustedPublisherSignature:true,
   signedUpdateRollbackAccepted:true,installedCanaryAccepted:true};
 const r=assessMigration(f);
 assert.deepEqual(r.blocked,[]);
 assert.equal(r.decision,'NO_PROMOTE');
 assert.equal(r.promotionAuthority,'EXTERNAL_REQUIRED');
});
test('local CLI refuses mutating and ambiguous arguments',()=>{
 const r=spawnSync(process.execPath,[modulePath,'--install'],{encoding:'utf8',timeout:5000});
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/RC012_MIGRATION_PREFLIGHT_READ_ONLY_ONLY/);
});
test('read-only Linux CLI prints only sanitized count/flags, never source secrets',()=>{
 if(process.platform!=='linux')return;
 const snapshot=inspectLocalPlatform('linux');
 assert.equal(snapshot.platform,'linux');
 const r=spawnSync(process.execPath,[modulePath,'--read-only'],{encoding:'utf8',timeout:15000});
 assert.equal(r.status,2);
 const parsed=JSON.parse(r.stdout);
 assert.equal(parsed.readOnly,true);
 assert.equal(parsed.promotionAuthority,'EXTERNAL_REQUIRED');
 assert.equal(r.stdout.includes('api-key'),false);
 assert.equal(r.stdout.includes('CREDENTIALS_DIRECTORY'),false);
});

test('main tunnel profile binding is loopback-only, exact and credential-redacted',()=>{
 const profile=[
   'config_version: 1','control_plane:',
   '  tunnel_id: tunnel_abc123fake','  api_key: secret-test-DO-NOT-LEAK',
   'mcp:','  server_urls:','    - channel: main',
   '      url: "http://127.0.0.1:47831/mcp"'
 ].join('\n');
 const valid=parseMainTunnelBinding(profile);
 assert.deepEqual(valid,{port:47831,channel:'main',path:'/mcp',tls:false});
 assert.doesNotMatch(JSON.stringify(valid),/secret|tunnel_abc|api_key/i);
 for(const target of [
   'http://127.0.0.1:47831/mcp?token=bad',
   'http://127.0.0.1:47831/other',
   'http://127.0.0.1:47831@mcp.evil.example/mcp',
   'http://localhost:47831/mcp',
   'http://127.0.0.2:47831/mcp','http://127.0.0.1:80/mcp'
 ])assert.equal(parseMainTunnelBinding(profile.replace(
   'http://127.0.0.1:47831/mcp',target)),null,target);
 assert.deepEqual(parseMainTunnelBinding(profile.replace(
   'http://127.0.0.1:47831/mcp','https://127.0.0.1:49912/mcp')),
   {port:49912,channel:'main',path:'/mcp',tls:true});
 assert.equal(parseMainTunnelBinding(profile+'\n    - channel: main\n      url: "http://127.0.0.1:49912/mcp"'),null);
 assert.equal(parseMainTunnelBinding('mcp:\n  server_urls:\n    - channel: main\n      url: "http://127.0.0.1:47831/mcp"\n'.repeat(400)),null);
});
test('Windows tunnel target on old Core is explicit NoPromote even if other gates self-report true',()=>{
 const base={platform:'win32',inventoryReliable:true,legacyInnoPresent:true,
   tunnelProfilePresent:true,tunnelProfileValid:true,tunnelTargetPort:47831,
   tunnelTargetVersion:'0.11.0-dev.23',
   profileBackupReceiptVerified:true,featureParityVerified:true,
   g1AuthenticatedCurrentSession:true,j01OwnerNativeConsent:true,
   revocableFullAccessProven:true,trustedPublisherSignature:true,
   signedUpdateRollbackAccepted:true,installedCanaryAccepted:true};
 const old=assessMigration(base);
 assert.equal(old.ownerTunnelTargetPort,47831);
 assert.equal(old.ownerTunnelHttpsConfigured,false);
 assert.equal(old.ownerTunnelTargetRuntimeVersion,'0.11.0-dev.23');
 assert.ok(old.blocked.includes('OWNER_TUNNEL_STILL_TARGETS_LEGACY_OR_UNKNOWN_CORE'));
 const unknown=assessMigration({...base,tunnelProfileValid:false});
 assert.ok(unknown.blocked.includes('OWNER_TUNNEL_MAIN_BINDING_UNVERIFIED'));
 assert.equal(unknown.ownerTunnelTargetPort,null);
 const latest=assessMigration({...base,tunnelTargetVersion:'0.12.0-dev.1',tunnelTargetTls:true});
 assert.equal(latest.ownerTunnelHttpsConfigured,true);
 assert.ok(!latest.blocked.includes('OWNER_TUNNEL_STILL_TARGETS_LEGACY_OR_UNKNOWN_CORE'));
 assert.equal(latest.decision,'NO_PROMOTE');
 assert.ok(latest.blocked.includes('LEGACY_INNO_TO_NSIS_TRANSACTION_MISSING'));
});

test('stable-router backend mapping reports chain without trusting mutable owner profile fields',()=>{
 const status={router:true,listenPort:47831,sourceSha256:'f'.repeat(64),
   schema:1,profile:'default',generation:43,
   activePort:48834,activeVersion:'0.11.0-dev.23',
   token:'DO_NOT_EMIT',configPath:'C:/secret'};
 const observed=classifyObservedRouterStatus(status,47831,'0.11.0-dev.23');
 assert.deepEqual(observed,{detected:true,mappingMatches:true,
   backendPort:48834,backendVersion:'0.11.0-dev.23',generation:43});
 assert.doesNotMatch(JSON.stringify(observed),/token|secret|config/i);
 const mismatched=classifyObservedRouterStatus(status,47831,'0.12.0-dev.1');
 assert.equal(mismatched.detected,true);
 assert.equal(mismatched.mappingMatches,false);
 const rejected=[
   {...status,listenPort:49912},
   {...status,router:false},
   {...status,activePort:47831},
   {...status,activePort:80},
   {...status,sourceSha256:'bad'},
   {...status,generation:0},
   {...status,profile:'other'},
   {...status,activeVersion:'0.13.0-dev.1'}
 ];
 for(const entry of rejected)assert.deepEqual(
   classifyObservedRouterStatus(entry,47831,'0.11.0-dev.23'),
   {detected:false,mappingMatches:false});
});
test('router mismatch adds its own hard blocker even with synthetic successful booleans',()=>{
 const f={platform:'win32',inventoryReliable:true,legacyInnoPresent:true,
   tunnelProfilePresent:true,tunnelProfileValid:true,tunnelTargetPort:47831,
   tunnelTargetVersion:'0.11.0-dev.23',routerDetected:true,
   routerMappingMatches:false,routerBackendPort:48834,
   routerBackendVersion:'0.11.0-dev.23'};
 const blocked=assessMigration(f);
 assert.equal(blocked.ownerStableRouterBackendPort,48834);
 assert.equal(blocked.ownerStableRouterBackendVersion,'0.11.0-dev.23');
 assert.equal(blocked.ownerStableRouterMappingMatches,false);
 assert.ok(blocked.blocked.includes('OWNER_STABLE_ROUTER_BACKEND_MISMATCH'));
 const consistent=assessMigration({...f,routerMappingMatches:true});
 assert.equal(consistent.ownerStableRouterMappingMatches,true);
 assert.ok(!consistent.blocked.includes('OWNER_STABLE_ROUTER_BACKEND_MISMATCH'));
 assert.equal(consistent.decision,'NO_PROMOTE');
});

test('plaintext stable router never qualifies as G1 mTLS ingress after synthetic backend upgrade',()=>{
 const old={platform:'win32',inventoryReliable:true,legacyInnoPresent:false,
   tunnelProfilePresent:true,tunnelProfileValid:true,tunnelTargetPort:47831,
   tunnelTargetTls:false,tunnelTargetVersion:'0.12.0-dev.1',
   routerDetected:true,routerMappingMatches:true,
   routerBackendPort:49912,routerBackendVersion:'0.12.0-dev.1',
   profileBackupReceiptVerified:true,featureParityVerified:true,
   g1AuthenticatedCurrentSession:true,j01OwnerNativeConsent:true,
   revocableFullAccessProven:true,trustedPublisherSignature:true,
   signedUpdateRollbackAccepted:true,installedCanaryAccepted:true};
 const result=assessMigration(old);
 assert.equal(result.ownerStableRouterBackendPort,49912);
 assert.equal(result.ownerTunnelHttpsConfigured,false);
 assert.ok(result.blocked.includes('G1_STABLE_ROUTER_PLAINTEXT_MTLS_INCOMPATIBLE'));
 assert.ok(result.blocked.includes('G1_TUNNEL_HTTPS_MTLS_ROUTE_REQUIRED'));
 assert.equal(result.decision,'NO_PROMOTE');
 const direct=assessMigration({...old,tunnelTargetPort:49913,
   tunnelTargetTls:true,routerDetected:false});
 assert.equal(direct.ownerTunnelHttpsConfigured,true);
 assert.ok(!direct.blocked.includes('G1_STABLE_ROUTER_PLAINTEXT_MTLS_INCOMPATIBLE'));
 assert.ok(!direct.blocked.includes('G1_TUNNEL_HTTPS_MTLS_ROUTE_REQUIRED'));
 assert.equal(direct.decision,'NO_PROMOTE');
 const httpsToOldRouter=assessMigration({...old,tunnelTargetTls:true});
 assert.ok(httpsToOldRouter.blocked.includes('G1_STABLE_ROUTER_PLAINTEXT_MTLS_INCOMPATIBLE'));
 assert.equal(httpsToOldRouter.decision,'NO_PROMOTE');
});

test('private account-device Tunnel requires local pair and owner proof, not optional public OAuth',()=>{
 const f={platform:'win32',inventoryReliable:true,legacyInnoPresent:true,
   ownerRegisteredInstallerFamily:'owner-managed-powershell',
   tunnelProfilePresent:true,tunnelProfileValid:true,tunnelTargetPort:47831,
   tunnelTargetVersion:'0.11.0-dev.23',tunnelTargetTls:false,
   routerDetected:true,routerMappingMatches:true,
   routerBackendPort:48834,routerBackendVersion:'0.11.0-dev.23'};
 const r=assessMigration({...f,connectionMode:'private-tunnel'});
 assert.equal(r.connectionMode,'private-tunnel');
 assert.equal(r.decision,'NO_PROMOTE');
 assert.doesNotMatch(JSON.stringify(r),/api[_-]?key|password|bearer/i,
   'renderer-visible report must contain no credential-shaped keys or values');
 for(const legacy of ['G1_STABLE_ROUTER_PLAINTEXT_MTLS_INCOMPATIBLE',
   'G1_TUNNEL_HTTPS_MTLS_ROUTE_REQUIRED','G1_CURRENT_SESSION_UNVERIFIED',
   'LEGACY_INNO_TO_NSIS_TRANSACTION_MISSING'])
   assert.ok(!r.blocked.includes(legacy),legacy);
 for(const required of [
   'PRIVATE_PLUGIN_TUNNEL_PAIR_BINDING_UNVERIFIED',
   'PRIVATE_TUNNEL_LOOPBACK_ISOLATION_UNVERIFIED',
   'PRIVATE_RUNTIME_CREDENTIAL_OWNERSHIP_UNVERIFIED',
   'PRIVATE_PRIVILEGED_INGRESS_NOT_WIRED',
   'OWNER_MANAGED_TO_UNIFIED_NSIS_TRANSACTION_MISSING',
   'OWNER_TUNNEL_STILL_TARGETS_LEGACY_OR_UNKNOWN_CORE',
   'J01_NATIVE_OWNER_CONSENT_UNVERIFIED',
   'PROFILE_BACKUP_NOT_VERIFIED','NATIVE_INSTALLED_CANARY_NOT_ACCEPTED'
 ])assert.ok(r.blocked.includes(required),required);
 const strict=assessMigration({...f,connectionMode:'managed-oauth'});
 assert.equal(strict.connectionMode,'managed-oauth');
 assert.ok(strict.blocked.includes('G1_CURRENT_SESSION_UNVERIFIED'));
 assert.ok(strict.blocked.includes('G1_STABLE_ROUTER_PLAINTEXT_MTLS_INCOMPATIBLE'));
 assert.ok(strict.blocked.includes('G1_TUNNEL_HTTPS_MTLS_ROUTE_REQUIRED'));
 assert.ok(!strict.blocked.includes('PRIVATE_PLUGIN_TUNNEL_PAIR_BINDING_UNVERIFIED'));
 assert.throws(()=>assessMigration({...f,connectionMode:'anonymous-public'}),
   /RC012_MIGRATION_CONNECTION_MODE_INVALID/);
});

test('private URL MCP binding cannot pass privileged cutover through plaintext or legacy Router',()=>{
 const yes={platform:'win32',connectionMode:'private-tunnel',
   inventoryReliable:true,legacyInnoPresent:false,
   ownerRegisteredInstallerFamily:'none',
   tunnelProfilePresent:true,tunnelProfileValid:true,tunnelTargetPort:49912,
   tunnelTargetVersion:'0.12.0-dev.1',tunnelTargetTls:false,
   privatePairBindingVerified:true,privateLocalIngressIsolated:true,
   privateCredentialOwnershipVerified:true,privatePrivilegedIngressReady:true,
   profileBackupReceiptVerified:true,featureParityVerified:true,
   g1AuthenticatedCurrentSession:true,j01OwnerNativeConsent:true,
   activeServiceRestoreTested:true,revocableFullAccessProven:true,
   trustedPublisherSignature:true,signedUpdateRollbackAccepted:true,
   installedCanaryAccepted:true,units:[]};
 const plaintext=assessMigration(yes);
 assert.ok(plaintext.blocked.includes('PRIVATE_TUNNEL_HTTPS_MTLS_ROUTE_REQUIRED'));
 assert.equal(plaintext.decision,'NO_PROMOTE');
 const router=assessMigration({...yes,tunnelTargetTls:true,
   routerDetected:true,routerMappingMatches:true,
   routerBackendPort:49913,routerBackendVersion:'0.12.0-dev.1'});
 assert.ok(router.blocked.includes('PRIVATE_STABLE_ROUTER_MTLS_INCOMPATIBLE'));
 assert.equal(router.decision,'NO_PROMOTE');
 const protectedDirect=assessMigration({...yes,tunnelTargetTls:true});
 assert.equal(protectedDirect.ownerTunnelHttpsConfigured,true);
 assert.ok(!protectedDirect.blocked.includes('PRIVATE_TUNNEL_HTTPS_MTLS_ROUTE_REQUIRED'));
 assert.ok(!protectedDirect.blocked.includes('PRIVATE_STABLE_ROUTER_MTLS_INCOMPATIBLE'));
 assert.deepEqual(protectedDirect.blocked,[]);
 assert.equal(protectedDirect.decision,'NO_PROMOTE',
   'only external native acceptance can promote even when all facts self-report true');
});

test('synthetic fully positive private flags never authorize install or bypass J01',()=>{
 const f={platform:'linux',connectionMode:'private-tunnel',
   inventoryReliable:true,nativePackageInstalled:false,allNativePayloadPathsAvailable:true,
   units:[],privatePairBindingVerified:true,privateLocalIngressIsolated:true,
   privateCredentialOwnershipVerified:true,privatePrivilegedIngressReady:true,
   activeServiceRestoreTested:true,
   profileBackupReceiptVerified:true,featureParityVerified:true,j01OwnerNativeConsent:true,
   revocableFullAccessProven:true,trustedPublisherSignature:true,
   signedUpdateRollbackAccepted:true,installedCanaryAccepted:true};
 const r=assessMigration(f);
 assert.deepEqual(r.blocked,[]);
 assert.equal(r.decision,'NO_PROMOTE');
 assert.equal(r.promotionAuthority,'EXTERNAL_REQUIRED');
 assert.equal(r.connectionMode,'private-tunnel');
 assert.ok(assessMigration({...f,j01OwnerNativeConsent:false}).blocked.includes(
   'J01_NATIVE_OWNER_CONSENT_UNVERIFIED'));
 assert.ok(assessMigration({...f,privatePrivilegedIngressReady:false}).blocked.includes(
   'PRIVATE_PRIVILEGED_INGRESS_NOT_WIRED'));
});

test('registered owner PowerShell uninstaller is distinct from Inno and cannot trigger blind removal',()=>{
 const registryCommand='    UninstallString    REG_SZ    "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile -File "C:\\Users\\Owner\\Remote Commander\\uninstall.ps1"';
 assert.equal(classifyWindowsUninstallRegistryResponse(registryCommand),'owner-managed-powershell');
 assert.equal(classifyWindowsUninstallRegistryResponse(
   '    UninstallString    REG_SZ    "C:\\Users\\Owner\\Remote Commander\\unins000.exe"'),
   'inno-unverified');
 for(const raw of [
   'UninstallString REG_SZ powershell.exe -EncodedCommand something',
   'UninstallString REG_SZ "C:\\Not-Installer\\pwsh.exe" -File "C:\\elsewhere\\other.ps1"',
   'UninstallString REG_SZ "C:\\Program Files\\Any\\Uninstall.exe"',
   registryCommand+'\n'+registryCommand,
   '',
   'x'.repeat(50001)
 ])assert.equal(classifyWindowsUninstallRegistryResponse(raw),'unverified');
 const actual=assessMigration({platform:'win32',inventoryReliable:true,
   legacyInnoPresent:true,ownerRegisteredInstallerFamily:'owner-managed-powershell'});
 assert.equal(actual.ownerRegisteredInstallerFamily,'owner-managed-powershell');
 assert.ok(actual.blocked.includes('OWNER_MANAGED_TO_UNIFIED_NSIS_TRANSACTION_MISSING'));
 assert.ok(!actual.blocked.includes('LEGACY_INNO_TO_NSIS_TRANSACTION_MISSING'));
 assert.equal(actual.decision,'NO_PROMOTE');
 assert.doesNotMatch(JSON.stringify(actual),/C:\\Users\\Owner|uninstall\.ps1/);
 const weird=assessMigration({platform:'win32',inventoryReliable:true,
   legacyInnoPresent:true,ownerRegisteredInstallerFamily:'multiple-or-unverified'});
 assert.ok(weird.blocked.includes('OWNER_INSTALLER_IDENTITY_UNVERIFIED'));
});

test('independently owner-pinned SHA-256 can replace commercial signer, but not migration acceptance',()=>{
  const facts={platform:'linux',inventoryReliable:true,nativePackageInstalled:false,
    allNativePayloadPathsAvailable:true,units:[],activeServiceRestoreTested:true,
    profileBackupReceiptVerified:true,featureParityVerified:true,
    g1AuthenticatedCurrentSession:true,j01OwnerNativeConsent:true,
    revocableFullAccessProven:true,installedCanaryAccepted:true};
  const absent=assessMigration(facts);
  assert.ok(absent.blocked.includes('TRUSTED_RELEASE_PROVENANCE_UNVERIFIED'));
  assert.ok(absent.blocked.includes('UPDATE_ROLLBACK_PROVENANCE_UNVERIFIED'));
  const approved=assessMigration({...facts,
    ownerPinnedNativeReleaseVerified:true,ownerPinnedRollbackVerified:true});
  assert.equal(approved.blocked.length,0);
  assert.equal(approved.decision,'NO_PROMOTE');
  assert.equal(approved.promotionAuthority,'EXTERNAL_REQUIRED');
  const half=assessMigration({...facts,ownerPinnedNativeReleaseVerified:true});
  assert.ok(half.blocked.includes('UPDATE_ROLLBACK_PROVENANCE_UNVERIFIED'));
});

test('owner-private exact one-tunnel plan preserves existing account ID/key and changes only the local MCP hop',()=>{
  const source=[
    'config_version: 1',
    'control_plane:',
    '  tunnel_id: local-tunnel-fixture-id',
    '  api_key: env:EXCLUSIVE_OWNER_FIXTURE_KEY',
    'health:',
    '  listen_addr: 127.0.0.1:47832',
    'mcp:',
    '  server_urls:',
    '    - channel: main',
    '      url: http://127.0.0.1:47831/mcp',
    ''
  ].join('\n');
  const p=process.platform==='win32'?'C:\\Owner\\private':'/home/owner/private';
  const options={currentYaml:source,protectedPort:47999,
    clientCertPath:path.join(p,'client.crt'),
    clientKeyPath:path.join(p,'client.key'),
    clientCaPath:path.join(p,'ca.crt')};
  const plan=planOwnerPrivateTunnelCutover(options);
  assert.equal(plan.mode,'OFFLINE_PLAN_NO_CUTOVER');
  assert.equal(plan.sourcePort,47831);
  assert.equal(plan.protectedPort,47999);
  assert.equal(plan.activeTunnelChanged,false);
  assert.equal(plan.ownerNativeConsentRequired,true);
  assert.equal(plan.originalTunnelControlPlanePreserved,true);
  assert.equal(plan.originalApiKeyReferencePreserved,true);
  assert.equal(parseMainTunnelBinding(plan.candidateYaml).tls,true);
  assert.equal(parseMainTunnelBinding(plan.candidateYaml).port,47999);
  assert.ok(plan.candidateYaml.includes('  tunnel_id: local-tunnel-fixture-id'));
  assert.ok(plan.candidateYaml.includes('  api_key: env:EXCLUSIVE_OWNER_FIXTURE_KEY'));
  assert.ok(plan.candidateYaml.includes('  listen_addr: 127.0.0.1:47832'));
  assert.equal(plan.candidateYaml.split('  tunnel_id:').length,2);
  assert.equal(plan.candidateYaml.split('  api_key:').length,2);
  assert.ok(!JSON.stringify({...plan,candidateYaml:undefined}).includes('EXCLUSIVE_OWNER_FIXTURE_KEY'));
  assert.throws(()=>planOwnerPrivateTunnelCutover({...options,protectedPort:47831}),
    /RC012_OWNER_TUNNEL_SINGLE_PLAINTEXT_MAIN_REQUIRED/);
  assert.throws(()=>planOwnerPrivateTunnelCutover({...options,currentYaml:plan.candidateYaml}),
    /RC012_OWNER_TUNNEL_SINGLE_PLAINTEXT_MAIN_REQUIRED/);
  assert.throws(()=>planOwnerPrivateTunnelCutover({...options,
    currentYaml:source.replace('  server_urls:','  client_key: malicious\n  server_urls:')}),
    /RC012_OWNER_TUNNEL_ALREADY_HAS_TLS_IDENTITY/);
  assert.throws(()=>planOwnerPrivateTunnelCutover({...options,
    currentYaml:source+'ca_bundle: /tmp/other\n'}),
    /RC012_OWNER_TUNNEL_EXISTING_CA_CONFLICT/);
  assert.throws(()=>planOwnerPrivateTunnelCutover({...options,
    currentYaml:source.replace('  server_urls:',
      '  server_urls:\n    - channel: main\n      url: http://127.0.0.1:47831/mcp')}),
    /RC012_OWNER_TUNNEL_SINGLE_PLAINTEXT_MAIN_REQUIRED|RC012_OWNER_TUNNEL_MAIN_URL_AMBIGUOUS/);
  assert.throws(()=>planOwnerPrivateTunnelCutover({...options,
    clientKeyPath:'../secret'}),
    /RC012_TUNNEL_CERT_PATH_INVALID/);
});

test('offline one-Tunnel owner inspection never emits profile contents or writes source',()=>{
  const isolated=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-owner-tunnel-plan-'));
  const windows=process.platform==='win32';
  const profileName=windows?'chatgpt-remote-commander':'Emad';
  try{
    const profileDir=windows?path.join(isolated,'tunnel-client')
      :path.join(isolated,'.config','tunnel-client');
    const certDir=windows?path.join(isolated,'ChatGPTRemoteCommander','private-pair','default')
      :path.join(isolated,'.config','chatgpt-remote-commander','private-pair','default');
    fs.mkdirSync(profileDir,{recursive:true,mode:0o700});
    fs.mkdirSync(certDir,{recursive:true,mode:0o700});
    fs.chmodSync(profileDir,0o700);fs.chmodSync(certDir,0o700);
    const profileFile=path.join(profileDir,profileName+'.yaml');
    const source=[
      'config_version: 1',
      'control_plane:',
      '  tunnel_id: qa-nonproduction-owner-label',
      '  api_key: env:LOCAL_QA_FIXTURE_ONLY',
      'mcp:',
      '  server_urls:',
      '    - channel: main',
      '      url: http://127.0.0.1:47831/mcp',
      ''
    ].join('\n');
    fs.writeFileSync(profileFile,source,{mode:0o600});
    for(const name of ['client.crt','client.key','ca.crt'])
      fs.writeFileSync(path.join(certDir,name),'noncredential-fixture\n',{mode:0o600});
    const script=path.join(repo,'tools','inspect-owner-private-tunnel-cutover.mjs');
    const options={cwd:repo,encoding:'utf8',timeout:6000,
      env:{...process.env,APPDATA:isolated,HOME:isolated}};
    const result=spawnSync(process.execPath,[script,'--target-port=47999',
      '--profile-name='+profileName],options);
    assert.equal(result.status,0,(result.stderr||'').slice(-1000));
    const summary=JSON.parse(result.stdout.trim());
    assert.equal(summary.mode,'OFFLINE_PLAN_NO_CUTOVER');
    assert.equal(summary.profileName,profileName);
    assert.equal(summary.sourcePort,47831);
    assert.equal(summary.protectedPort,47999);
    assert.equal(summary.candidateYamlIncluded,false);
    assert.equal(summary.ownerCredentialsInOutput,false);
    assert.equal(summary.activeTunnelChanged,false);
    assert.equal(summary.rollbackRequired,true);
    assert.ok(!JSON.stringify(summary).includes('LOCAL_QA_FIXTURE_ONLY'));
    assert.ok(!JSON.stringify(summary).includes('qa-nonproduction-owner-label'));
    assert.equal(fs.readFileSync(profileFile,'utf8'),source);
    const invalid=spawnSync(process.execPath,[script,'--target-port=47999',
      '--profile-name=../../escape'],options);
    assert.notEqual(invalid.status,0);
    assert.match(invalid.stderr,/RC012_OWNER_EXACT_PROFILE_REQUIRED/);
    assert.equal(fs.readFileSync(profileFile,'utf8'),source);
  }finally{fs.rmSync(isolated,{recursive:true,force:true});}
});
