import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NATIVE_BASELINE_PROOF_SCHEMA,requireNativeBaselineProof
} from '../tools/universal-install/native-baseline-proof.mjs';

const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const previous={sha256:B,version:'0.12.0-dev.9'};
const before={version:previous.version,registeredInstallCount:1,
  runtime:{fingerprint:A}};
function exact(){
  return {
    schema:NATIVE_BASELINE_PROOF_SCHEMA,
    artifactSha256:B,version:previous.version,
    archivedPayloadSha256:C,installedPayloadSha256:C,
    runtimeFingerprint:A,completeInventory:true,
    nativeRegistrationVerified:true,ownerRestoreVerified:true,
    provenanceVerified:true
  };
}
test('full native restore receipt is bound to prior package, live inventory and runtime',()=>{
  const result=requireNativeBaselineProof(exact(),previous,before);
  assert.match(result.identity,/^[0-9a-f]{64}$/);
  assert.equal(result.payloadSha256,C);
  assert.equal(requireNativeBaselineProof(exact(),previous,before).identity,
    result.identity);
  assert.notEqual(requireNativeBaselineProof({
    ...exact(),archivedPayloadSha256:A,installedPayloadSha256:A
  },previous,before).identity,result.identity);
});
test('every missing, forged or insufficient restore proof fails closed',()=>{
  const defective=[
    null,{},[],{...exact(),schema:'v0'},
    {...exact(),artifactSha256:A},
    {...exact(),version:'0.12.0-dev.8'},
    {...exact(),archivedPayloadSha256:B},
    {...exact(),installedPayloadSha256:B},
    {...exact(),completeInventory:false},
    {...exact(),completeInventory:'true'},
    {...exact(),nativeRegistrationVerified:false},
    {...exact(),ownerRestoreVerified:false},
    {...exact(),provenanceVerified:false},
    {...exact(),runtimeFingerprint:B},
    {...exact(),added:'not allowed'}
  ];
  for(const mutant of defective){
    assert.throws(()=>requireNativeBaselineProof(mutant,previous,before),
      {code:'UNIVERSAL_NATIVE_BASELINE_RESTORE_UNVERIFIED'});
  }
});
test('a prior artifact receipt cannot be re-used across runtime or version changes',()=>{
  assert.throws(()=>requireNativeBaselineProof(
    exact(),previous,{...before,version:'0.12.0-dev.10'}
  ),{code:'UNIVERSAL_NATIVE_BASELINE_RESTORE_UNVERIFIED'});
  assert.throws(()=>requireNativeBaselineProof(exact(),previous,{
    ...before,runtime:{fingerprint:B}
  }),{code:'UNIVERSAL_NATIVE_BASELINE_RESTORE_UNVERIFIED'});
  assert.throws(()=>requireNativeBaselineProof(
    exact(),{...previous,sha256:C},before
  ),{code:'UNIVERSAL_NATIVE_BASELINE_RESTORE_UNVERIFIED'});
});
