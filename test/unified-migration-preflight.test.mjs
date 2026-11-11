import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessMigration,inspectLocalPlatform} from '../packaging/unified/migration-preflight.mjs';

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
