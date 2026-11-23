import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyCompiledCompanion} from './verify-compiled-companion.mjs';

const HEAD='c'.repeat(40), TREE='d'.repeat(40);
const names=['README.md','background.js','content.js','manifest.json',
  'popup.css','popup.html','popup.js','protocol.js'];
function fixture(t){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-compiled-companion-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true,maxRetries:3}));
  const root=path.join(temp,'installed'),ext=path.join(root,'extensions','chatgpt-companion');
  fs.mkdirSync(ext,{recursive:true});
  const files={};
  for(const name of names){
    const content=name==='manifest.json'?JSON.stringify({
      manifest_version:3,name:'Commander Chat Companion',permissions:['storage'],
      host_permissions:['http://127.0.0.1:41267/*'],
      background:{service_worker:'background.js'}
    }):'fixture_'+name;
    fs.writeFileSync(path.join(ext,name),content);
    files['extensions/chatgpt-companion/'+name]=
      createHash('sha256').update(content).digest('hex');
  }
  const manifest=path.join(temp,'source-manifest.json');
  const receipt={schema:1,kind:'COMMANDER_OPTIONAL_BROWSER_COMPANION',
    head:HEAD,tree:TREE,count:names.length,files};
  const data=JSON.stringify(receipt);
  fs.writeFileSync(manifest,data);
  fs.writeFileSync(path.join(root,'source-manifest.json'),data);
  const verify=(expectedCommit=HEAD)=>verifyCompiledCompanion({
    companionRoot:root,sourceManifest:manifest,expectedCommit
  });
  return {temp,root,ext,manifest,receipt,verify};
}
test('exact optional Companion payload verifies independent from public Core',t=>{
  const x=fixture(t),result=x.verify();
  assert.equal(result.status,'COMPILED_COMPANION_HASH_PASS');
  assert.equal(result.files,8);assert.equal(result.chatAuthenticationVerified,false);
  assert.equal(result.installedBrowserEnabled,false);
});
test('corrupted manifest, payload, missing/extra file and wrong commit fail closed',t=>{
  const x=fixture(t);
  assert.throws(()=>x.verify('f'.repeat(40)),/COMPANION_MANIFEST_INVALID/);
  fs.appendFileSync(path.join(x.root,'source-manifest.json'),' ');
  assert.throws(()=>x.verify(),/COMPANION_MANIFEST_CHANGED/);
  fs.copyFileSync(x.manifest,path.join(x.root,'source-manifest.json'));
  fs.appendFileSync(path.join(x.ext,'popup.js'),'X');
  assert.throws(()=>x.verify(),/COMPANION_FILE_SHA_MISMATCH/);
  fs.writeFileSync(path.join(x.ext,'popup.js'),'fixture_popup.js');
  fs.writeFileSync(path.join(x.ext,'unexpected.txt'),'bad');
  assert.throws(()=>x.verify(),/COMPANION_EXTRA_FILE/);
  fs.rmSync(path.join(x.ext,'unexpected.txt'));
  fs.rmSync(path.join(x.ext,'popup.js'));
  assert.throws(()=>x.verify(),/COMPANION_FILE_MISSING/);
});
test('unexpected permission and unsafe manifest file are rejected',t=>{
  const x=fixture(t),name='extensions/chatgpt-companion/manifest.json';
  const manifest={manifest_version:3,name:'Commander Chat Companion',permissions:['debugger'],
    host_permissions:['http://127.0.0.1:41267/*'],
    background:{service_worker:'background.js'}};
  fs.writeFileSync(path.join(x.ext,'manifest.json'),JSON.stringify(manifest));
  x.receipt.files[name]=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  fs.writeFileSync(x.manifest,JSON.stringify(x.receipt));
  fs.writeFileSync(path.join(x.root,'source-manifest.json'),JSON.stringify(x.receipt));
  assert.throws(()=>x.verify(),/COMPANION_UNEXPECTED_EXTENSION_PERMISSIONS/);
  delete x.receipt.files[name];
  x.receipt.files['extensions/chatgpt-companion/../unsafe.js']='f'.repeat(64);
  fs.writeFileSync(x.manifest,JSON.stringify(x.receipt));
  fs.writeFileSync(path.join(x.root,'source-manifest.json'),JSON.stringify(x.receipt));
  assert.throws(()=>x.verify(),/COMPANION_UNLISTED_OR_UNSAFE_PATH/);
});
test('symlink extraction and special file types refused',t=>{
  const x=fixture(t);
  const target=path.join(x.ext,'protocol.js');
  fs.rmSync(target);
  try{fs.symlinkSync(path.join(x.ext,'background.js'),target);}catch(err){
    if(['EPERM','EACCES'].includes(err?.code))return;
    throw err;
  }
  assert.throws(()=>x.verify(),/COMPANION_LINK_REFUSED/);
});
