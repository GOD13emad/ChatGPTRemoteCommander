// One shared native-install transaction for every owner host and OS.
// Windows/DEB adapters implement only OS APIs; policy, journal, reconciliation,
// exact SHA/version checks and rollback are identical. No profile/Tunnel/Worker
// mutations and no implicit privilege escalation are permitted here.
import {createHash} from 'node:crypto';

export const TRANSACTION_SCHEMA='rc-universal-native-transaction-v1';
const HASH=/^[a-f0-9]{64}$/;
const SHA=/^[a-f0-9]{40}$/;
const VERSION=/^0\.12\.0-dev\.([1-9][0-9]*)$/;
const PRODUCT='ChatGPTRemoteCommander';
const fail=(code)=>{throw Object.assign(new Error(code),{code});};
const assert=(condition,code)=>{if(!condition)fail(code);};
const sha=value=>createHash('sha256').update(value).digest('hex');
const required=['inspect','snapshot','install','verify','restore'];
const safeString=v=>typeof v==='string'&&v.length>0&&v.length<=256
  &&!/[\u0000-\u001f\u007f]/.test(v);

export function verifyNativePlanInput(value){
  assert(value&&Object.getPrototypeOf(value)===Object.prototype
    &&Object.keys(value).sort().join(',')===
      'architecture,candidate,expectedCommit,platform,previous,product'.split(',').sort().join(','),
    'UNIVERSAL_NATIVE_PLAN_SHAPE_INVALID');
  assert(value.product===PRODUCT&&['linux','windows'].includes(value.platform)
    &&['x64','arm64'].includes(value.architecture)&&SHA.test(value.expectedCommit),
    'UNIVERSAL_NATIVE_PLAN_IDENTITY_INVALID');
  for(const which of ['candidate','previous']){
    const item=value[which];
    assert(item&&Object.getPrototypeOf(item)===Object.prototype
      &&Object.keys(item).sort().join(',')==='path,sha256,version',
      'UNIVERSAL_NATIVE_ARTIFACT_SHAPE_INVALID');
    assert(safeString(item.path)&&HASH.test(item.sha256)&&VERSION.test(item.version),
      'UNIVERSAL_NATIVE_ARTIFACT_ID_INVALID');
  }
  const newV=+VERSION.exec(value.candidate.version)[1];
  const oldV=+VERSION.exec(value.previous.version)[1];
  assert(Number.isSafeInteger(newV)&&Number.isSafeInteger(oldV)&&newV>oldV,
    'UNIVERSAL_NATIVE_VERSION_ORDER_INVALID');
  assert(value.candidate.path!==value.previous.path
    &&value.candidate.sha256!==value.previous.sha256,
    'UNIVERSAL_NATIVE_ROLLBACK_IDENTITY_COLLISION');
  return Object.freeze({
    product:PRODUCT,platform:value.platform,architecture:value.architecture,
    expectedCommit:value.expectedCommit,
    candidate:Object.freeze({...value.candidate}),
    previous:Object.freeze({...value.previous})
  });
}
function exactSnapshot(value){
  assert(value&&Object.getPrototypeOf(value)===Object.prototype,
    'UNIVERSAL_NATIVE_SNAPSHOT_INVALID');
  assert(safeString(value.version)&&VERSION.test(value.version)
    &&value.product===PRODUCT&&value.format==='native'
    &&value.registeredInstallCount===1&&value.integrityVerified===true,
    'UNIVERSAL_NATIVE_BASELINE_NOT_ADMITTED');
  assert(value.runtime&&Object.getPrototypeOf(value.runtime)===Object.prototype
    &&value.runtime.liveCoreCutover===false
    &&value.runtime.ownerGrantIssued===false
    &&value.runtime.existingTunnelModified===false,
    'UNIVERSAL_NATIVE_RUNTIME_SCOPE_INVALID');
  assert(typeof value.runtime.fingerprint==='string'
    &&HASH.test(value.runtime.fingerprint),
    'UNIVERSAL_NATIVE_RUNTIME_FINGERPRINT_INVALID');
  return value;
}
function identity(spec,before){
  const values=[
    TRANSACTION_SCHEMA,spec.product,spec.platform,spec.architecture,
    spec.expectedCommit,spec.candidate.version,spec.candidate.sha256,
    spec.previous.version,spec.previous.sha256,before.runtime.fingerprint
  ];
  return sha(values.join('\0'));
}
function sameRuntime(before,after){
  return before.runtime.fingerprint===after.runtime.fingerprint
    &&after.runtime.liveCoreCutover===false
    &&after.runtime.ownerGrantIssued===false
    &&after.runtime.existingTunnelModified===false;
}
function compatibleObserved(observed,spec){
  return observed.product===PRODUCT&&observed.format==='native'
    &&observed.registeredInstallCount===1
    &&observed.integrityVerified===true;
}
const outcome=(status,plan,extra={})=>Object.freeze({
  schema:TRANSACTION_SCHEMA,status,transactionId:plan.transactionId,
  product:PRODUCT,platform:plan.platform,
  beforeVersion:plan.previous.version,candidateVersion:plan.candidate.version,
  ...extra,
  productionCutover:false,workerGrantIssued:false,
  otherAccountTunnelChanged:false
});
/**
 * Adapter: inspect(artifact) -> metadata {product,platform,architecture,
 *   version,sha256,format:'native'} after OS-native package inspection;
 * snapshot() -> exactSnapshot(), install(candidate,plan),
 * verify(candidate,plan) -> exactSnapshot(), restore(previous,plan).
 *
 * Journal: claim(id) (exclusive, no auto stale-lock removal), write(stage,details),
 * close() releases only the owned lock. A failed/uncertain effect is reconciled
 * BEFORE another install; retries are intentionally not automatic.
 *
 * approve(plan) must perform owner-visible authorization before ANY native
 * effect. An approved package upgrade is NOT a J01 Worker grant or cutover.
 */
export async function executeNativeTransaction({
  action='plan',input,adapter,journal,approve
}={}){
  assert(['plan','apply','rollback'].includes(action),
    'UNIVERSAL_NATIVE_ACTION_INVALID');
  const spec=verifyNativePlanInput(input);
  assert(adapter&&required.every(k=>typeof adapter[k]==='function'),
    'UNIVERSAL_NATIVE_ADAPTER_INCOMPLETE');
  const [candidate,previous,before]=await Promise.all([
    adapter.inspect(spec.candidate),
    adapter.inspect(spec.previous),
    adapter.snapshot()
  ]);
  for(const [given,seen] of [[spec.candidate,candidate],[spec.previous,previous]]){
    assert(seen&&seen.product===spec.product&&seen.platform===spec.platform
      &&seen.architecture===spec.architecture&&seen.format==='native'
      &&seen.version===given.version&&seen.sha256===given.sha256,
      'UNIVERSAL_NATIVE_OS_PACKAGE_IDENTITY_MISMATCH');
  }
  exactSnapshot(before);
  assert(compatibleObserved(before,spec),'UNIVERSAL_NATIVE_STATE_UNTRUSTED');
  const atBaseline=before.version===spec.previous.version;
  const atCandidate=before.version===spec.candidate.version;
  assert(atBaseline||atCandidate,'UNIVERSAL_NATIVE_INSTALLED_VERSION_DRIFT');
  const plan=Object.freeze({
    ...spec,transactionId:identity(spec,before),
    baselineRuntimeFingerprint:before.runtime.fingerprint,
    installedVersion:before.version,
    rollbackVerified:true,
    expectedCommitIsAssertionOnly:true,
    crossAccountMutation:false,
    ownerConsentRequired:action!=='plan',
    cutoverRequiresSeparateAuthorization:true
  });
  if(action==='plan')return outcome(atCandidate?'ALREADY_INSTALLED':'READY_TO_APPLY',plan,{
    plan,packageOnly:true,approvalIssued:false,
    sourceCommitVerified:false,independentReleaseProvenanceVerified:false
  });
  assert(journal&&['claim','write','close'].every(k=>typeof journal[k]==='function')
    &&typeof approve==='function',
    'UNIVERSAL_NATIVE_EFFECT_AUTHORITY_REQUIRED');
  assert(action==='apply'?atBaseline:atCandidate,
    'UNIVERSAL_NATIVE_ACTION_BASELINE_MISMATCH');
  // Avoid a caller supplying an async "yes" without an owner approval contract.
  const granted=await approve(plan);
  assert(granted?.kind==='native-owner-install-approval'
    &&granted.transactionId===plan.transactionId
    &&granted.approved===true,
    'UNIVERSAL_NATIVE_OWNER_APPROVAL_REQUIRED');
  await journal.claim(plan.transactionId);
  try{
    const fresh=await adapter.snapshot();
    exactSnapshot(fresh);
    assert(fresh.version===before.version&&sameRuntime(before,fresh),
      'UNIVERSAL_NATIVE_PRE_EFFECT_DRIFT');
    const primary=action==='apply'?spec.candidate:spec.previous;
    const desiredVersion=primary.version;
    await journal.write('INTENT_COMMITTED',{
      transactionId:plan.transactionId,action,version:desiredVersion
    });
    let primaryError;
    try{
      await journal.write('NATIVE_EFFECT_STARTED',{action,version:desiredVersion});
      if(action==='apply')await adapter.install(primary,plan);
      else await adapter.restore(primary,plan);
      const after=exactSnapshot(await adapter.verify(primary,plan));
      assert(after.version===desiredVersion&&compatibleObserved(after,spec)
        &&sameRuntime(before,after),
        'UNIVERSAL_NATIVE_POST_EFFECT_VERIFICATION_FAILED');
      await journal.write('VERIFIED',{action,version:desiredVersion});
      return outcome(action==='apply'?'NATIVE_PACKAGE_UPGRADED':'NATIVE_PACKAGE_ROLLED_BACK',plan,{
        packageOnly:true,approvalIssued:true,observedVersion:after.version,
        reversible:action==='apply'
      });
    }catch(error){primaryError=error;}
    // An installer error does NOT establish that installation did not occur.
    // Reconcile once, do not re-run an unknown native effect. For apply only,
    // restore the exact old package when candidate state is positively proven.
    let observed;
    try{observed=exactSnapshot(await adapter.snapshot());}
    catch{await journal.write('NEEDS_MANUAL_RECONCILIATION',{
      action,reason:'OBSERVATION_UNAVAILABLE'
    });fail('UNIVERSAL_NATIVE_EFFECT_OUTCOME_UNKNOWN');}
    if(observed.version===before.version&&compatibleObserved(observed,spec)
      &&sameRuntime(before,observed)){
      await journal.write('NO_CHANGE_VERIFIED',{action});
      fail('UNIVERSAL_NATIVE_EFFECT_FAILED_BASELINE_PRESERVED');
    }
    if(action==='apply'&&observed.version===spec.candidate.version
      &&compatibleObserved(observed,spec)&&sameRuntime(before,observed)){
      await journal.write('ROLLBACK_STARTED',{reason:'FAILED_VERIFICATION'});
      try{
        await adapter.restore(spec.previous,plan);
        const restored=exactSnapshot(await adapter.verify(spec.previous,plan));
        assert(restored.version===before.version&&sameRuntime(before,restored),
          'UNIVERSAL_NATIVE_ROLLBACK_VERIFICATION_FAILED');
        await journal.write('ROLLBACK_VERIFIED',{reason:primaryError?.code||'NATIVE_FAILURE'});
      }catch{
        await journal.write('NEEDS_MANUAL_RECONCILIATION',{
          action,reason:'ROLLBACK_UNVERIFIED'
        });fail('UNIVERSAL_NATIVE_ROLLBACK_UNVERIFIED');
      }
      fail('UNIVERSAL_NATIVE_EFFECT_FAILED_ROLLED_BACK');
    }
    await journal.write('NEEDS_MANUAL_RECONCILIATION',{
      action,reason:'UNKNOWN_NATIVE_STATE'
    });
    fail('UNIVERSAL_NATIVE_EFFECT_OUTCOME_UNKNOWN');
  }finally{
    await journal.close();
  }
}
