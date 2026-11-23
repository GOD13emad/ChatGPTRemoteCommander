import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const read=x=>fs.readFileSync(path.join(root,x),'utf8');
const contract=JSON.parse(read('installer/universal-install-contract.json'));
const release=JSON.parse(read('docs/release-train-0.12.json'));
const engine=read('tools/universal-install/engine.mjs');

test('public Core archive allowlist excludes optional extensions without losing dirty-source checks',()=>{
  const source=read('packaging/unified/prepare.mjs');
  const start=source.indexOf("execFileSync('git',['-c','core.autocrlf=false','archive'");
  const end=source.indexOf("],{",start);
  assert.ok(start>=0&&end>start,'source must use pinned git archive');
  const roots=source.slice(start,end);
  assert.doesNotMatch(roots,/'extensions'/,
    'optional private extensions must not enter distributable public Core');
  assert.match(source,/const touched=runGit\(\['status','--porcelain=v1'.*'extensions'/,
    'tracked or dirty extensions remain part of source-integrity census');
  assert.match(roots,/'src','tools','vendor','assets','config\.json','package\.json'/,
    'keep required approved source roots');
});
test('one package contract covers both operating systems and all nine accepted components',()=>{
  assert.equal(contract.schema,'rc-unified-installer-v1');
  assert.deepEqual(Object.keys(contract.platforms),['windows','linux']);
  assert.equal(contract.sourceTrain,'0.12');
  assert.equal(new Set(contract.commonComponents).size,9);
  for(const c of contract.commonComponents)
    assert.ok(release.components.find(x=>x.id===c && x.required===true),c);
  assert.deepEqual(contract.commonActions,['package','verify','install','upgrade','rollback','status']);
  assert.equal(contract.nativeCandidateRoot,'packaging/unified');
  assert.equal(contract.qaTransactionHelper,'tools/universal-install/engine.mjs');
  const auth=contract.nativeTransactionalEngine;
  assert.equal(contract.nativeInstallAuthority,'tools/universal-install/native-cli.mjs');
  assert.equal(auth.entrypoint,contract.nativeInstallAuthority);
  assert.equal(auth.commonCoordinator,'tools/universal-install/native-transaction.mjs');
  assert.equal(auth.osAdapter,'tools/universal-install/native-os-adapters.mjs');
  assert.equal(auth.journal,'tools/universal-install/native-journal.mjs');
  assert.equal(auth.manifestGenerator,'tools/universal-install/native-manifest.mjs');
  assert.equal(auth.provenanceModule,'packaging/unified/owner-pinned-provenance.mjs');
  assert.equal(auth.initialInstallNeedsHistoricalPackage,false);
  assert.equal(auth.initialInstallManifestSchema,2);
  assert.equal(auth.hostedNativeEffectProof,'test/universal-native-coordinator-hosted.mjs');
  assert.ok(fs.existsSync(path.join(root,auth.hostedNativeEffectProof)));
  assert.equal(auth.ownerIndependentProvenanceRequired,true);
  assert.equal(auth.coreCutoverAllowed,false);
  assert.equal(auth.initialInstallIsLiveOwnerHostAccepted,false);
  for(const p of [auth.entrypoint,auth.commonCoordinator,auth.osAdapter,
    auth.journal,auth.manifestGenerator,auth.provenanceModule]){
    assert.ok(contract.requiredEmbeddedCoreFiles.includes(p),p);
    assert.ok(contract.requiredSourceFiles.includes(p),p);
  }
  for(const f of contract.requiredEmbeddedCoreFiles)
    assert.ok(contract.requiredSourceFiles.includes(f) || f==='config.json',f);
  for(const p of ['packaging/unified/package.json',
    'packaging/unified/owner-systemd-creds-profile-recovery.sh']){
    assert.ok(contract.requiredEmbeddedCoreFiles.includes(p),p);
    assert.ok(contract.requiredSourceFiles.includes(p),p);
  }
  const native=read('packaging/unified/prepare.mjs');
  assert.match(native,/requiredEmbeddedCoreFiles/u);
  assert.match(native,/UNIFIED_CANDIDATE_CONTRACT_INVALID/u);
  assert.match(native,/unifiedContract\.nativeInstallAuthority/u);
  assert.match(native,/unifiedContract\.nativeTransactionalEngine\?\.commonCoordinator/u);
  assert.match(native,/packaging\/unified\/owner-pinned-provenance\.mjs/u);
  assert.match(native,/unifiedContract\.presentation\?\.crossOsVisualParityAccepted/u);
  for(const p of contract.requiredSourceFiles)
    assert.ok(fs.existsSync(path.join(root,p)),p);
});

test('immutable public Core tar omits optional extension bundle path',()=>{
 const native=read('packaging/unified/prepare.mjs');
 assert.match(native,/'archive','--format=tar','--output',tar,head,\s*'src','tools','vendor','assets','config\.json','package\.json'/u);
 assert.doesNotMatch(native,/'archive','--format=tar','--output',tar,head,\s*'src','tools','vendor','assets','extensions'/u);
});

test('an exact-source installer QA pass cannot authorize v0.12 stable or all-account Full Power',()=>{
  assert.equal(release.publishApproved,false);
  assert.equal(release.installedPromotionApproved,false);
  assert.equal(contract.releaseAdmission.stablePublished,false);
  assert.equal(contract.presentation.crossOsVisualParityAccepted,false);
  assert.equal(contract.profile.fullPowerIsNotOsElevation,true);
  assert.equal(contract.profile.independentAccountTunnel,true);
  assert.match(engine,/realServicesStarted:false,ownerConsentGranted:false/u);
  assert.match(engine,/productionInstallEnabled:false/u);
  assert.match(engine,/releasePath\(target,state\.previous\)/u);
  assert.match(engine,/core\.autocrlf=false/u);
  assert.match(engine,/core\.eol=lf/u);
  assert.doesNotMatch(engine,/systemctl|schtasks|reg\.exe|sudo|winget|npm\s+install/u);
});

test('native Windows/Linux matrix requires exact-file equality before installer acceptance',()=>{
  const y=read('.github/workflows/unified-installer-pilot.yml');
  for(const marker of ['exact-source-parity:', 'needs: [package]',
    'rc012-native-core-Windows','rc012-native-core-Linux',
    'verify-native-parity.mjs','--expected-commit',
    'packaging/unified/.stage/core/source-manifest.json']){
    assert.ok(y.includes(marker), marker);
  }
  assert.match(y,/os: \[ubuntu-latest, windows-latest\]/);
  assert.ok(y.includes('include-hidden-files: true'));
  const deps=read('package.json');
  assert.ok(deps.includes('test/universal-native-parity.test.mjs'));
});

test('source regression owner-recovery batches respect native test deadlines without dropping coverage',()=>{
  const source=read('tools/run-v012-source-regression.mjs');
  assert.match(source,/files\.slice\(20, 21\).*Protected Core/);
  assert.match(source,/files\.slice\(21, 22\).*Windows DPAPI recovery/);
  assert.match(source,/files\.slice\(22, 23\).*Linux encrypted recovery/);
  assert.match(source,/index === 13 \? 100000/);
  assert.match(source,/index === 14 \? \(part === 0 \? 55000 : 65000\)/);
  assert.match(source,/new Set\(batches\.flat\(\)\)\.size!==files\.length/);
});

test('Linux native and GUI payloads reuse exactly one verified public Core manifest',()=>{
  const prepare=read('packaging/unified/prepare.mjs');
  const builder=read('tools/build-native-linux-package.sh');
  const staged=prepare.match(/'archive','--format=tar','--output',tar,head,\s*([\s\S]*?)\],\{/u);
  assert.ok(staged,'the canonical committed Core allowlist must remain available');
  const stagedPaths=[...staged[1].matchAll(/'([^']+)'/gu)].map(m=>m[1]);
  assert.ok(builder.includes('node "$ROOT/packaging/unified/prepare.mjs"'));
  assert.ok(builder.includes('cp -a -- "$PUBLIC_CORE/." "$APP/"'));
  assert.ok(builder.includes('validateCore(stage),native=validateCore(installed)'));
  assert.ok(builder.includes('JSON.stringify(staged.files)!==JSON.stringify(native.files)'));
  assert.doesNotMatch(builder,/git -C "\$ROOT" archive --format=tar "\$HEAD"/u,
    'the native builder must not independently archive source roots');
  assert.ok(stagedPaths.includes(contract.nativeTransactionalEngine.provenanceModule),
    'the runtime owner-pinned provenance verifier must appear in the canonical Core');
  assert.ok(!stagedPaths.includes('extensions'),
    'optional/private extensions must not enter public Core');
  for(const required of contract.requiredEmbeddedCoreFiles){
    assert.ok(stagedPaths.some(p=>required===p||required.startsWith(p+'/')),
      'required runtime source absent from canonical Core: '+required);
  }
});
