import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const script=path.join(root,'tools/v2-native-host-owner-install.ps1');
const body=fs.readFileSync(script,'utf8');
const Windows=process.platform==='win32';
const build=process.env.RCV2_NATIVE_LAUNCHER_DIR;
const args=(mode,extension='a'.repeat(32),browser='Brave')=>[
 '-NoLogo','-NoProfile','-NonInteractive','-File',script,
 '-Mode',mode,'-Browser',browser,
 '-ExtensionId',extension,
 '-LauncherBuildDir',build??path.join(root,'desktop/v2-native-host-launcher'),
 '-NodePath',process.execPath,
 '-HostScriptPath',path.join(root,'tools/v2-native-messaging-host.mjs')
];
test('owner installer supports exact pinned ID and never provisions from a model hint',()=>{
 assert.match(body,/V2_NATIVE_EXACT_EXTENSION_ID_REQUIRED/);
 assert.match(body,/V2_NATIVE_OWNER_CONTEXT_REQUIRED/);
 assert.match(body,/V2_NATIVE_PINNED_ARTIFACT_HASH_REQUIRED/);
 assert.match(body,/V2_NATIVE_CANONICAL_HOST_REQUIRED/);
 assert.match(body,/NativeMessaging\.stage-/);
 assert.match(body,/HKCU:/);
 assert.match(body,/Existing_Install_Reconciliation_Required/i);
 assert.doesNotMatch(body,/HKEY_LOCAL_MACHINE|HKLM:|RUNAS|Start-Process.*-Verb RunAs/i);
});
test('Windows owner plan is read-only and describes only the browser-scoped registration',
 {skip:!Windows||!build},()=>{
 const run=spawnSync('pwsh',args('Plan'),{encoding:'utf8',timeout:8000});
 assert.equal(run.status,0,run.stderr);
 const result=JSON.parse(run.stdout);
 assert.equal(result.mode,'Plan');
 assert.equal(result.mutationPerformed,false);
 assert.equal(result.liveBrowserConnected,false);
 assert.equal(result.nativeOwnerConsentRequired,true);
 assert.match(result.registryKey,/^HKCU:\\SOFTWARE\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\/);
 assert.equal(result.origin,'chrome-extension://'+'a'.repeat(32)+'/');
});
test('owner plan rejects malformed extension ID instead of widening wildcard origins',
 {skip:!Windows||!build},()=>{
 for(const id of ['abc','*','A'.repeat(32)]){
  const run=spawnSync('pwsh',args('Plan',id),{encoding:'utf8',timeout:8000});
  assert.notEqual(run.status,0);
  assert.doesNotMatch(run.stdout,/"mutationPerformed":true/);
 }
});
