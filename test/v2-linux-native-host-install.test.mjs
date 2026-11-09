import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {planV2LinuxNativeHost,installV2LinuxNativeHost}
 from '../tools/v2-linux-native-host-install.mjs';
import {encodeV2NativeMessage,createV2NativeMessageDecoder}
 from '../src/v2-native-messaging-protocol.mjs';
const isLinux=process.platform==='linux';
const origin='chrome-extension://'+'a'.repeat(32)+'/';
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rcv2-linux-native-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return dir;
}
test('Linux owner-only installer rejects other platform without mutating data',{skip:!isLinux},t=>{
 const home=fixture(t);
 assert.throws(()=>planV2LinuxNativeHost({home,browser:'brave',extensionId:'*'}),
  {code:'V2_LINUX_NATIVE_EXACT_ID_REQUIRED'});
 assert.throws(()=>planV2LinuxNativeHost({home,browser:'firefox',extensionId:'a'.repeat(32)}),
  {code:'V2_LINUX_NATIVE_EXACT_ID_REQUIRED'});
 assert.equal(fs.readdirSync(home).length,0);
});
test('Linux native plans support Chromium/Brave/Chrome/Edge with exact origin only',
 {skip:!isLinux},t=>{
 const home=fixture(t);
 for(const browser of ['chrome','chromium','brave','edge']){
  const plan=planV2LinuxNativeHost({home,browser,extensionId:'a'.repeat(32)});
  const doc=JSON.parse(plan.manifestContent);
  assert.equal(plan.mutationPerformed,false);
  assert.equal(plan.paired,false);
  assert.equal(plan.chatAuthorized,false);
  assert.equal(doc.path,plan.launcher);
  assert.deepEqual(doc.allowed_origins,[origin]);
  assert.equal(doc.type,'stdio');
  assert.equal(plan.script.includes('RCV2_NATIVE_MESSAGING_ALLOWED_ORIGIN'),true);
 }
 assert.equal(fs.readdirSync(home).length,0);
});
test('real Linux shell launcher relays framed owner-only message and rejects action',{
 skip:!isLinux},t=>{
 const home=fixture(t);
 const plan=planV2LinuxNativeHost({home,browser:'brave',extensionId:'a'.repeat(32)});
 const launcher=path.join(home,'mock-wrapper');
 fs.writeFileSync(launcher,plan.script,{mode:0o700});
 const invoke=(o,msg)=>spawnSync(launcher,[o],{
  input:encodeV2NativeMessage(msg),timeout:10000,
  env:{...process.env,RCV2_NATIVE_MESSAGING_ALLOWED_ORIGIN:'chrome-extension://'+'b'.repeat(32)+'/'}});
 const hello={schema:1,type:'owner_preflight',requestId:'linux-123'};
 const result=invoke(origin,hello);
 assert.equal(result.status,0,result.stderr.toString());
 const decoder=createV2NativeMessageDecoder();
 const packets=decoder.push(result.stdout);decoder.finish();
 assert.equal(packets[0].requestId,'linux-123');
 assert.equal(packets[0].toolsAuthorized,false);
 assert.equal(packets[0].chatAuthorized,false);
 assert.equal(packets[0].canReadCookies,false);
 const wrong=invoke('chrome-extension://'+'b'.repeat(32)+'/',hello);
 assert.notEqual(wrong.status,0);
 assert.equal(wrong.stdout.length,0);
 const attack=invoke(origin,{...hello,type:'execute_tool'});
 assert.notEqual(attack.status,0);
 assert.equal(attack.stdout.length,0);
});
test('Linux owner installer forbids arbitrary test home and unpinned side effects',
 {skip:!isLinux},t=>{
 const home=fixture(t),plan=planV2LinuxNativeHost({
  home,browser:'brave',extensionId:'a'.repeat(32)});
 assert.throws(()=>installV2LinuxNativeHost(plan,{
  expectedNodeSha256:plan.nodeSha256,expectedHostSha256:plan.hostSha256,home}),
 {code:'V2_LINUX_NATIVE_OWNER_REQUIRED'});
 assert.equal(fs.readdirSync(home).length,0);
});
test('native installer source does not invoke sudo, roots or profile exports',()=>{
 const body=fs.readFileSync(fileURLToPath(new URL('../tools/v2-linux-native-host-install.mjs',
  import.meta.url)),'utf8');
 assert.match(body,/V2_LINUX_NATIVE_OWNER_REQUIRED/);
 assert.match(body,/EXISTING_INSTALL_RECONCILIATION_REQUIRED/);
 assert.doesNotMatch(body,/exec\(.*sudo|spawn\(.*sudo|sudo\s|cookies|password.store|profiles\/Default/i);
});

test('owner-local installation in a disposable HOME registers manifest and blocks a second install',
 {skip:!isLinux},t=>{
 const home=fixture(t);
 const cli=fileURLToPath(new URL('../tools/v2-linux-native-host-install.mjs',import.meta.url));
 const env={...process.env,HOME:home};
 const cmd=(...args)=>spawnSync(process.execPath,[cli,...args],{
  env,encoding:'utf8',timeout:10000});
 const initial=cmd('plan','brave','a'.repeat(32));
 assert.equal(initial.status,0,initial.stderr);
 const plan=JSON.parse(initial.stdout);
 assert.equal(plan.installed,false);
 assert.equal(fs.existsSync(plan.path),false);
 const done=cmd('install','brave','a'.repeat(32),plan.nodeSha256,plan.hostSha256);
 assert.equal(done.status,0,done.stderr);
 const receipt=JSON.parse(done.stdout);
 assert.equal(receipt.installed,true);
 assert.equal(receipt.chatAuthorized,false);
 assert.equal(receipt.browserConsentVerified,false);
 const manifest=JSON.parse(fs.readFileSync(plan.path,'utf8'));
 assert.equal(manifest.type,'stdio');
 assert.deepEqual(manifest.allowed_origins,[origin]);
 assert.equal(manifest.path,plan.launcher);
 assert.equal((fs.statSync(plan.launcher).mode&0o777),0o700);
 const result=spawnSync(plan.launcher,[origin],{
  input:encodeV2NativeMessage({schema:1,type:'owner_preflight',requestId:'isolated-install-1'}),
  env,timeout:10000});
 assert.equal(result.status,0,result.stderr.toString());
 const d=createV2NativeMessageDecoder(),data=d.push(result.stdout);
 d.finish();
 assert.equal(data[0].toolsAuthorized,false);
 assert.equal(data[0].chatAuthorized,false);
 const again=cmd('install','brave','a'.repeat(32),plan.nodeSha256,plan.hostSha256);
 assert.notEqual(again.status,0);
 assert.match(again.stderr,/V2_LINUX_NATIVE_INSTALL_DENIED/);
});

test('rejects a forged installer plan with substituted script, manifest or destination before writing',
 {skip:!isLinux},t=>{
 const home=fixture(t);
 const installer=fileURLToPath(new URL('../tools/v2-linux-native-host-install.mjs',
  import.meta.url));
 // Execute in a fresh process with HOME set to the temporary owner-only directory.
 const child=String.raw`
import {planV2LinuxNativeHost,installV2LinuxNativeHost} from ${JSON.stringify(installer)};
const p=planV2LinuxNativeHost({browser:'brave',extensionId:'a'.repeat(32)});
const overrides=[
 {script:'#!/bin/sh\\\\necho unexpected >&2\\\\n'},
 {manifestContent:JSON.stringify({name:'attacker.native',path:'/tmp/injected'})},
 {manifest:p.manifest+'-forged'},
 {launcher:p.launcher+'-forged'},
 {origin:'chrome-extension://'+'b'.repeat(32)+'/'}
];
for (const override of overrides){
 try{
  installV2LinuxNativeHost({...p,...override},{
   expectedNodeSha256:p.nodeSha256,expectedHostSha256:p.hostSha256});
  process.exit(17);
 }catch(e){
  if(e.code!=='V2_LINUX_NATIVE_PINNED_OWNER_PLAN_REQUIRED')process.exit(18);
 }
}
console.log('FORGED_PLAN_DENIED');
`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',child],{
  env:{...process.env,HOME:home},encoding:'utf8',timeout:10000
 });
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/FORGED_PLAN_DENIED/);
 assert.equal(fs.readdirSync(home).length,0);
});
