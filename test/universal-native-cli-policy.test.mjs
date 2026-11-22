import './managed-update-scheduler.test.mjs';
import './managed-updates-policy.test.mjs';
import './universal-native-signed-owner-approval.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cli=path.join(root,'tools/universal-install/native-cli.mjs');
const osName=process.platform==='win32'?'windows':process.platform;
function run(args,env=process.env){
  const r=spawnSync(process.execPath,[cli,...args],{
    encoding:'utf8',windowsHide:true,timeout:12000,
    maxBuffer:8192,env
  });
  assert.equal(r.error,undefined,String(r.error||''));
  return r;
}
test('common native CLI rejects wrong argument shape before any external effect',()=>{
  for(const args of [
    ['--apply','--manifest','relative.json'],
    ['--install','--manifest','/tmp/no'],
    ['--rollback'],
    ['--apply','--manifest','/tmp/a','--silent'],
    ['--plan','--manifest','/tmp/a','--gui-approval']
  ]){
    const r=run(args);
    assert.equal(r.status,2);
    assert.match(r.stderr,/UNIVERSAL_NATIVE_CLI_/);
  }
});
test('native --apply and --rollback refuse absent independent owner provenance even with valid manifest',()=>{
  if(!['linux','windows'].includes(osName))return;
  const dir=fs.mkdtempSync(path.join(os.homedir(),'rc-universal-cli-qa-'));
  try{
    const file=path.join(dir,'valid.json');
    const data={
      schema:'rc-universal-native-install-manifest-v1',
      product:'ChatGPTRemoteCommander',platform:osName,
      architecture:process.arch,expectedCommit:'a'.repeat(40),
      previous:{version:'0.12.0-dev.8',sha256:'b'.repeat(64),
        path:path.join(dir,'old.pkg')},
      candidate:{version:'0.12.0-dev.9',sha256:'c'.repeat(64),
        path:path.join(dir,'new.pkg')}
    };
    fs.writeFileSync(file,JSON.stringify(data),{mode:0o600});
    const env={...process.env};
    delete env.RC012_OWNER_PINNED_NATIVE_MANIFEST_SHA256;
    delete env.RC012_OWNER_PINNED_SOURCE_HEAD;
    for(const mode of ['--apply','--rollback']){
      const r=run([mode,'--manifest',file],env);
      assert.equal(r.status,2);
      const result=JSON.parse(r.stderr);
      assert.equal(result.code,'UNIVERSAL_NATIVE_INDEPENDENT_PROVENANCE_REQUIRED');
      assert.equal(result.liveCoreChanged,false);
      assert.equal(result.packageOnly,true);
    }
    assert.equal(fs.readdirSync(dir).length,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('GUI native approval rejects an absent owner seat before displaying a dialog',async()=>{
  if(process.platform!=='linux')return;
  const {nativeApproval,resolveLinuxOwnerGuiSession}=await import(
    '../tools/universal-install/native-cli.mjs');
  const oldDisplay=process.env.DISPLAY;
  const oldWayland=process.env.WAYLAND_DISPLAY;
  const oldRuntime=process.env.XDG_RUNTIME_DIR;
  try{
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.XDG_RUNTIME_DIR;
    await assert.rejects(nativeApproval({
      platform:'linux',installedVersion:'0.12.0-dev.9',
      candidate:{version:'0.12.0-dev.10'},transactionId:'fixture-only'
    },{
      guiApproval:true,
      ownerSeatResolver:()=>{
        throw new Error('UNIVERSAL_NATIVE_GUI_OWNER_SESSION_REQUIRED');
      }
    }),/UNIVERSAL_NATIVE_GUI_OWNER_SESSION_REQUIRED/);
    assert.throws(()=>resolveLinuxOwnerGuiSession({
      env:{},run:()=>({status:1})
    }),/UNIVERSAL_NATIVE_GUI_OWNER_SESSION_REQUIRED/);
  }finally{
    for(const [k,v] of [['DISPLAY',oldDisplay],
      ['WAYLAND_DISPLAY',oldWayland],['XDG_RUNTIME_DIR',oldRuntime]]){
      if(v===undefined)delete process.env[k];else process.env[k]=v;
    }
  }
});

test('GUI approval cannot bypass independently established provenance',()=>{
  if(!['linux','windows'].includes(osName))return;
  const dir=fs.mkdtempSync(path.join(os.homedir(),'rc-universal-cli-gui-qa-'));
  try{
    const file=path.join(dir,'manifest.json');
    fs.writeFileSync(file,JSON.stringify({
      schema:'rc-universal-native-install-manifest-v1',
      platform:osName,expectedCommit:'a'.repeat(40),
      architecture:process.arch,product:'ChatGPTRemoteCommander',
      installationKind:'fresh',previous:null,
      candidate:{path:path.join(dir,'candidate.pkg'),sha256:'b'.repeat(64),version:'0.12.0-dev.10'}
    }),{mode:0o600});
    const env={...process.env};
    delete env.RC012_OWNER_PINNED_NATIVE_MANIFEST_SHA256;
    delete env.RC012_OWNER_PINNED_SOURCE_HEAD;
    const r=run(['--apply','--manifest',file,'--gui-approval'],env);
    assert.equal(r.status,2);
    assert.equal(JSON.parse(r.stderr).code,'UNIVERSAL_NATIVE_INDEPENDENT_PROVENANCE_REQUIRED');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Linux shared CLI rejects foreign/missing owner GUI authority without prompt',async()=>{
  if(process.platform!=='linux')return;
  const {resolveLinuxOwnerGuiSession}=await import('../tools/universal-install/native-cli.mjs');
  const uid=process.getuid();
  assert.throws(()=>resolveLinuxOwnerGuiSession({
    env:{DISPLAY:'localhost:10.0',XDG_RUNTIME_DIR:'/run/user/'+uid},
    ownerUid:uid,run:()=>({status:0,stdout:''})
  }),/UNIVERSAL_NATIVE_GUI_OWNER_SESSION_REQUIRED/);
  assert.throws(()=>resolveLinuxOwnerGuiSession({
    env:{DISPLAY:':0',XAUTHORITY:'/tmp/absent-commander-owner-auth',
      XDG_RUNTIME_DIR:'/run/user/'+uid},
    ownerUid:uid
  }),/UNIVERSAL_NATIVE_GUI_OWNER_SESSION_REQUIRED/);
});
