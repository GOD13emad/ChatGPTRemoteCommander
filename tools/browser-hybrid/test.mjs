import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const dir=path.dirname(fileURLToPath(import.meta.url));
const call=args=>{
 const r=spawnSync(process.execPath,[path.join(dir,'cli.mjs'),...args],
  {cwd:dir,encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:1024*1024});
 return {status:r.status,out:JSON.parse((r.stdout||r.stderr).trim())};
};
test('doctor reports usable managed backend candidates without personal-session claim',()=>{
 const {status,out}=call(['doctor']);
 assert.equal(status,0);assert.equal(out.status,'PASS');
 assert.ok(out.backends.some(e=>e.requested==='auto'));
 assert.equal(out.personalSessionAttach,false);
 assert.equal(out.ownerConsentRequired,true);
});
test('invalid requested engine fails without opening a browser',()=>{
 const {status,out}=call(['run','--engine=personal-profile','--url=https://example.com']);
 assert.equal(status,1);assert.equal(out.status,'FAIL');assert.match(out.reason,/ENGINE_INVALID/);
});
test('invalid URL scheme and URL userinfo fail closed before browser startup',()=>{
 for(const uri of ['file:///etc/passwd','https://user:secret@example.com/']){
  const {status,out}=call(['run','--url='+uri]);
  assert.equal(status,1);assert.match(out.reason,/HTTP_URL_REQUIRED/);
 }
});
test('missing URL fails before browser startup',()=>{
 const {status,out}=call(['run']);
 assert.equal(status,1);assert.match(out.reason,/URL_REQUIRED/);
});
