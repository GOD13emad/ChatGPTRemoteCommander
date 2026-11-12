import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessMigration,inspectLocalPlatform,parseMainTunnelBinding,classifyObservedRouterStatus,classifyWindowsUninstallRegistryResponse} from '../packaging/unified/migration-preflight.mjs';

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
 assert.ok(r.blocked.includes('SIGNED_UPDATE_ROLLBACK_UNVERIFIED'));
 assert.equal(JSON.stringify(r).includes('apikey'),false);
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
 for(const legacy of ['G1_STABLE_ROUTER_PLAINTEXT_MTLS_INCOMPATIBLE',
   'G1_TUNNEL_HTTPS_MTLS_ROUTE_REQUIRED','G1_CURRENT_SESSION_UNVERIFIED',
   'LEGACY_INNO_TO_NSIS_TRANSACTION_MISSING'])
   assert.ok(!r.blocked.includes(legacy),legacy);
 for(const required of [
   'PRIVATE_PLUGIN_TUNNEL_PAIR_BINDING_UNVERIFIED',
   'PRIVATE_TUNNEL_LOOPBACK_ISOLATION_UNVERIFIED',
   'PRIVATE_API_KEY_OWNERSHIP_UNVERIFIED',
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
test('synthetic fully positive private flags never authorize install or bypass J01',()=>{
 const f={platform:'linux',connectionMode:'private-tunnel',
   inventoryReliable:true,nativePackageInstalled:false,allNativePayloadPathsAvailable:true,
   units:[],privatePairBindingVerified:true,privateLocalIngressIsolated:true,
   privateCredentialOwnershipVerified:true,activeServiceRestoreTested:true,
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
