import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {evaluateWindowsRelease} from '../tools/verify-windows-release-policy.mjs';

const policy=JSON.parse(readFileSync('docs/UNSIGNED_WINDOWS_RELEASE_POLICY.json','utf8'));
const releaseNotes=readFileSync('docs/RELEASE_0.10.24.md','utf8');
const example={signed:'false',version:'0.10.24',tag:'v0.10.24',policy,releaseNotes};

test('unsigned v0.10.24 is denied absent separate owner acceptance',()=>{
 assert.equal(policy.allowUnsignedWithGitHubAttestation,false);
 assert.throws(()=>evaluateWindowsRelease(example),/WINDOWS_UNSIGNED_RELEASE_NOT_AUTHORIZED/);
});
test('valid Authenticode signer accepts exactly matching version/tag',()=>{
 const outcome=evaluateWindowsRelease({...example,signed:'true'});
 assert.equal(outcome.mode,'AUTHENTICODE_SIGNED');
 assert.equal(outcome.allowed,true);
});
test('future unsigned versions cannot inherit a historical policy',()=>{
 assert.throws(()=>evaluateWindowsRelease({...example,version:'0.10.25',tag:'v0.10.25'}),/WINDOWS_UNSIGNED_RELEASE_NOT_AUTHORIZED/);
});
test('reject false signer claims and unknown signer status',()=>{
 for(const value of ['','unknown','NotSigned','True','FALSE'])
  assert.throws(()=>evaluateWindowsRelease({...example,signed:value}),/WINDOWS_RELEASE_SIGNATURE_STATUS_UNVERIFIED/);
});
test('reject tag mismatch and expanded historical scopes',()=>{
 assert.throws(()=>evaluateWindowsRelease({...example,tag:'v0.10.20'}),/WINDOWS_RELEASE_TAG_VERSION_MISMATCH/);
 for(const change of [{scope:'all-versions'},{publishedInstallerSignature:'Valid'},{riskAcknowledgement:''},{verification:''}])
  assert.throws(()=>evaluateWindowsRelease({...example,policy:{...policy,...change}}),/WINDOWS_UNSIGNED_RELEASE_NOT_AUTHORIZED/);
});
test('new release notes must disclose unsigned risk and preserve provenance wording',()=>{
 for(const phrase of ['Windows installer: UNSIGNED','SmartScreen','GitHub attestation','0.10.20','J01'])
  assert.ok(releaseNotes.includes(phrase),phrase);
 assert.throws(()=>evaluateWindowsRelease(example),/WINDOWS_UNSIGNED_RELEASE_NOT_AUTHORIZED/);
});
test('on-disk release CLI denies unsigned candidate but accepts verified signed route',()=>{
 const base={...process.env,RELEASE_VERSION:'0.10.24',RELEASE_TAG:'v0.10.24'};
 const denied=spawnSync(process.execPath,['tools/verify-windows-release-policy.mjs'],{
  encoding:'utf8',env:{...base,SETUP_SIGNED:'false'}});
 assert.notEqual(denied.status,0);
 assert.match(denied.stderr,/WINDOWS_UNSIGNED_RELEASE_NOT_AUTHORIZED/);
 const accepted=spawnSync(process.execPath,['tools/verify-windows-release-policy.mjs'],{
  encoding:'utf8',env:{...base,SETUP_SIGNED:'true'}});
 assert.equal(accepted.status,0,accepted.stderr);
 assert.match(accepted.stdout,/AUTHENTICODE_SIGNED/);
});
