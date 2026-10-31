import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {encodeV2NativeMessage,createV2NativeMessageDecoder}
 from '../src/v2-native-messaging-protocol.mjs';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const project=path.join(root,'desktop/v2-native-host-launcher/RCV2.NativeHost.csproj');
const source=fs.readFileSync(path.join(root,'desktop/v2-native-host-launcher/Program.cs'),'utf8');
const origin='chrome-extension://'+'a'.repeat(32)+'/';
test('Windows native binary launcher is a V2-only source project, not browser registration',()=>{
 assert.equal(fs.existsSync(project),true);
 assert.match(source,/RedirectStandardInput = true/);
 assert.match(source,/RedirectStandardOutput = true/);
 assert.match(source,/CopyToAsync/);
 assert.match(source,/RCV2_NATIVE_MESSAGING_ALLOWED_ORIGIN/);
 assert.doesNotMatch(source,/RegistryKey|OpenSubKey|SetValue\(/);
});
const available=process.platform==='win32'&&typeof process.env.RCV2_NATIVE_LAUNCHER_DIR==='string'
 &&fs.existsSync(path.join(process.env.RCV2_NATIVE_LAUNCHER_DIR,'RCV2.NativeHost.exe'));
test('compiled Windows native host transports real binary frames with pinned extension ID', {skip:!available},t=>{
 const from=process.env.RCV2_NATIVE_LAUNCHER_DIR;
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rcv2-nativehost-e2e-'));
 t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 for(const f of ['RCV2.NativeHost.exe','RCV2.NativeHost.dll',
   'RCV2.NativeHost.deps.json','RCV2.NativeHost.runtimeconfig.json']){
  if(fs.existsSync(path.join(from,f)))fs.copyFileSync(path.join(from,f),path.join(tmp,f));
 }
 fs.writeFileSync(path.join(tmp,'native-host-config.json'),
  JSON.stringify({schema:1,origin,nodePath:process.execPath,
   hostScriptPath:path.join(root,'tools/v2-native-messaging-host.mjs')}));
 const payload=encodeV2NativeMessage({schema:1,type:'owner_preflight',requestId:'native-123'});
 const run=(args,input=payload)=>spawnSync(path.join(tmp,'RCV2.NativeHost.exe'),args,
   {input,timeout:12000,env:{...process.env,
     RCV2_NATIVE_MESSAGING_ALLOWED_ORIGIN:'chrome-extension://'+'b'.repeat(32)+'/'}});
 const ok=run([origin]);
 assert.equal(ok.status,0,ok.stderr?.toString());
 const decoder=createV2NativeMessageDecoder(),messages=decoder.push(ok.stdout);
 decoder.finish();
 assert.equal(messages.length,1);
 assert.equal(messages[0].requestId,'native-123');
 assert.equal(messages[0].toolsAuthorized,false);
 assert.equal(messages[0].chatAuthorized,false);
 assert.equal(messages[0].canReadCookies,false);
 const wrong=run(['chrome-extension://'+'b'.repeat(32)+'/']);
 assert.notEqual(wrong.status,0);
 assert.equal(wrong.stdout?.length,0);
 const fake=run([origin],encodeV2NativeMessage({schema:1,type:'execute_tool',requestId:'native-123'}));
 assert.notEqual(fake.status,0);
 assert.equal(fake.stdout?.length,0);
 const extra=run([origin,'--parent-window=0']);
 assert.equal(extra.status,0);
 const badFlag=run([origin,'--anything']);
 assert.notEqual(badFlag.status,0);
 assert.equal(badFlag.stdout?.length,0);
});
