import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {oneShotNativeWorkerSigner,classifyNativeSignerStageFailure}
  from '../tools/v012-native-worker-registration-signer-linux.mjs';
test('signer rejects absence of systemd encrypted credential without inspecting real identity',async()=>{
  await assert.rejects(oneShotNativeWorkerSigner({
    profile:'qa-profile',readInput:async()=>JSON.stringify({})
  }),{code:'RC012_NATIVE_SIGNER_CREDENTIAL_SCOPE_REQUIRED'});
});
test('native signer CLI refuses unprovisioned invocation and cannot grant from stdin',()=>{
  const script=path.resolve(import.meta.dirname,'../tools/v012-native-worker-registration-signer-linux.mjs');
  const env={...process.env};
  delete env.CREDENTIALS_DIRECTORY;
  delete env.RC012_NATIVE_SIGNER_SCOPE;
  const r=spawnSync(process.execPath,[script,'qa-profile'],{
    input:'{"grant":"FULL_POWER"}',encoding:'utf8',env,timeout:5000
  });
  assert.equal(r.status,2);
  assert.match(r.stderr,/RC012_NATIVE_SIGNER_COMMAND_SCOPE_REQUIRED/);
  assert.equal(r.stdout,'');
});

test('signer fail-closed diagnostic labels preserve trusted codes and hide untrusted exception details',()=>{
 const classify=classifyNativeSignerStageFailure;
 for(const stage of ['PRECHECK','TRANSPORT_BOOTSTRAP','DEVICE_EVIDENCE','TRANSPORT_RECHECK',
   'CREDENTIAL_LOAD','ENVELOPE']){
  assert.equal(classify(stage,new TypeError('must not leak key path or content')),
    'RC012_NATIVE_SIGNER_'+stage+'_UNCLASSIFIED');
  assert.equal(classify(stage,{code:'ENOENT',message:'must not leak local path'}),
    'RC012_NATIVE_SIGNER_'+stage+'_UNCLASSIFIED');
  assert.equal(classify(stage,{code:'NATIVE_WORKER_KEY_CREDENTIAL_INVALID'}),
    'NATIVE_WORKER_KEY_CREDENTIAL_INVALID');
  assert.equal(classify(stage,{code:'RC012_WORKER_SIGNING_INTENT_INVALID'}),
    'RC012_WORKER_SIGNING_INTENT_INVALID');
 }
 assert.equal(classify('UNKNOWN_STAGE',new TypeError('secret')), 'RC012_NATIVE_SIGNER_DENIED');
 assert.equal(classify('CREDENTIAL_LOAD',{get code(){throw Error('secret')}}),
   'RC012_NATIVE_SIGNER_CREDENTIAL_LOAD_UNCLASSIFIED');
 assert.equal(classify('PRECHECK',{code:'RC012_OWNER_WITNESS_SOCKET_NOT_PINNED'}),
   'RC012_OWNER_WITNESS_SOCKET_NOT_PINNED');
 assert.equal(classify('PRECHECK',{code:'RC012_LINUX_OWNER_TRUST_FILE_UNSAFE'}),
   'RC012_LINUX_OWNER_TRUST_FILE_UNSAFE');
 assert.equal(classify('PRECHECK',{code:'ENOENT',message:'secret path'}),
   'RC012_NATIVE_SIGNER_PRECHECK_UNCLASSIFIED');
 assert.equal(classify('ENVELOPE',{code:'RC012_OWNER_WITNESS_SOCKET_NOT_PINNED'}),
   'RC012_NATIVE_SIGNER_ENVELOPE_UNCLASSIFIED');
});

test('native signer precheck keeps bounded witness denial and does not emit an envelope',()=>{
 if(process.platform!=='linux'||process.getuid?.()===0)return;
 const home=mkdtempSync(path.join(tmpdir(),'rc012-signer-precheck-'));
 try{
  const script=path.resolve(import.meta.dirname,'../tools/v012-native-worker-registration-signer-linux.mjs');
  const env={...process.env,HOME:home,CREDENTIALS_DIRECTORY:home,
    RC012_NATIVE_SIGNER_SCOPE:'SIGNED_ENVELOPE_NO_GRANT'};
  delete env.RC012_OWNER_WITNESS_SOCKET_PATH;
  delete env.RC012_OWNER_WITNESS_PUBLIC_KEY_PATH;
  const r=spawnSync(process.execPath,[script,'qa-precheck'],{
    env,input:'{}\n',encoding:'utf8',timeout:5000
  });
  assert.equal(r.status,2);
  assert.equal(r.stdout,'');
  assert.equal(r.stderr.trim(),'RC012_OWNER_WITNESS_SOCKET_NOT_PINNED');
 }finally{rmSync(home,{recursive:true,force:true});}
});
