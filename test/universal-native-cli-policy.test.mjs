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
    ['--apply','--manifest','/tmp/a','--silent']
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
