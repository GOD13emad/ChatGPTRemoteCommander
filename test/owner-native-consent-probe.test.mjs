import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ACTION, MAX_TIMEOUT_MS, planOwnerConsent, classifyNativeResult, runOwnerConsentProbe } from '../tools/owner-native-consent-probe.mjs';

const linux = ()=>planOwnerConsent({platform:'linux',ownerPresent:true});
const windows = ()=>planOwnerConsent({platform:'win32',ownerPresent:true});

test('explicit owner-present approval intent is mandatory', ()=>{
  assert.throws(()=>planOwnerConsent({platform:'linux'}),/EXPLICIT_CURRENT_OWNER_CONSENT_REQUIRED/);
  assert.throws(()=>planOwnerConsent({platform:'linux',ownerPresent:1}),/EXPLICIT_CURRENT_OWNER_CONSENT_REQUIRED/);
});
test('no arbitrary elevated action or unsupported OS',()=>{
  assert.throws(()=>planOwnerConsent({platform:'linux',ownerPresent:true,action:'sudo.shell'}),/UNSUPPORTED_PRIVILEGED_ACTION/);
  assert.throws(()=>planOwnerConsent({platform:'darwin',ownerPresent:true}),/UNSUPPORTED_OS_NATIVE_APPROVAL/);
});
test('timeouts have strict bounds',()=>{
  for(const timeoutMs of [0,999,MAX_TIMEOUT_MS+1,-100,Infinity,1.5,'5000']) {
    assert.throws(()=>planOwnerConsent({platform:'linux',ownerPresent:true,timeoutMs}),/INVALID_APPROVAL_TIMEOUT/);
  }
});
test('Linux invokes only exact native polkit identity probe, never a shell',()=>{
  const p=linux();
  assert.equal(p.file,'/usr/bin/pkexec');
  assert.deepEqual([...p.args],['--disable-internal-agent','/usr/bin/id','-u']);
  assert.equal(p.action,ACTION);
  assert.equal(p.commandIdentity.length,64);
  assert.deepEqual(p.args,planOwnerConsent({platform:'linux',ownerPresent:true}).args);
  assert.throws(()=>p.args.push('sh'),TypeError);
});
test('Windows invokes OS RunAs only with fixed read-only elevated token probe',()=>{
  const p=windows();
  assert.ok(p.file.toLowerCase().endsWith('powershell.exe'));
  assert.equal(p.args[0],'-NoProfile');
  assert.equal(p.args[1],'-NonInteractive');
  const outer=Buffer.from(p.args.at(-1),'base64').toString('utf16le');
  assert.match(outer,/Start-Process/);
  assert.match(outer,/-Verb RunAs/);
  assert.match(outer,/IsInRole/); // Part of the parent encoded child identity check.
  assert.doesNotMatch(outer,/(?:password|passwd|sudoers|autoAdminLogon)/i);
});
test('Linux approval needs both exit zero and exact root-identity output',()=>{
  const p=linux();
  assert.equal(classifyNativeResult(p,{status:0,stdout:'0\n'}).approved,true);
  for(const output of ['1000','0\n123','APPROVED','']) {
    assert.equal(classifyNativeResult(p,{status:0,stdout:output}).approved,false);
  }
});
test('Windows approval requires exact OS wrapper signal',()=>{
  const p=windows();
  assert.equal(classifyNativeResult(p,{status:0,stdout:'RC_OWNER_OS_CONSENT_APPROVED\n'}).approved,true);
  assert.equal(classifyNativeResult(p,{status:0,stdout:'APPROVED'}).approved,false);
  assert.equal(classifyNativeResult(p,{status:8,stdout:'RC_OWNER_OS_CONSENT_APPROVED'}).approved,false);
});
test('OS rejection, unsupported session, timeout and failures remain distinct',()=>{
  const p=linux();
  assert.equal(classifyNativeResult(p,{status:126}).status,'DENIED_BY_OS');
  assert.equal(classifyNativeResult(p,{status:127}).status,'UNAVAILABLE');
  assert.equal(classifyNativeResult(p,{status:2}).status,'UNVERIFIED_OR_FAILED');
  assert.equal(classifyNativeResult(p,{status:null,error:{code:'ETIMEDOUT'}}).status,'UNCERTAIN_TIMEOUT');
  assert.equal(classifyNativeResult(p,{status:null,signal:'SIGTERM'}).status,'UNCERTAIN_TIMEOUT');
});
test('runner receives fixed argv with no shell, no stdin or excess output',()=>{
  let invoked=false;
  const result=runOwnerConsentProbe({platform:'linux',ownerPresent:true,timeoutMs:1100},(file,args,opts)=>{
    invoked=true;
    assert.equal(file,'/usr/bin/pkexec');
    assert.deepEqual(args,['--disable-internal-agent','/usr/bin/id','-u']);
    assert.equal(opts.shell,false);assert.equal(opts.timeout,1100);
    assert.deepEqual(opts.stdio,['ignore','pipe','pipe']);
    assert.equal(opts.maxBuffer,2048);
    return {status:0,stdout:'0\n',stderr:'SENSITIVE_DO_NOT_LOG'};
  });
  assert.equal(invoked,true);
  assert.deepEqual(Object.keys(result).sort(),['approved','commandIdentity','status']);
  assert.equal(result.approved,true);
});
test('denied/timeout never replay automatically or convert into claimed root',()=>{
  let n=0;
  const denied=runOwnerConsentProbe({platform:'linux',ownerPresent:true},()=>{n++;return{status:126,stdout:'0'}});
  assert.equal(n,1);assert.equal(denied.approved,false);
  const timed=runOwnerConsentProbe({platform:'linux',ownerPresent:true},()=>{n++;return {status:null,error:{code:'ETIMEDOUT'}}});
  assert.equal(n,2);assert.equal(timed.approved,false);
});
test('invalid plans cannot synthesize an approval receipt',()=>{
  assert.throws(()=>classifyNativeResult({}, {status:0,stdout:'0'}),/INVALID_APPROVAL_PLAN/);
});
test('native plan command identity is stable and exact, not a universal authorization',()=>{
  const a=linux(),b=linux(),c=windows();
  assert.equal(a.commandIdentity,b.commandIdentity);
  assert.notEqual(a.commandIdentity,c.commandIdentity);
  assert.match(a.commandIdentity,/^[a-f0-9]{64}$/);
});
