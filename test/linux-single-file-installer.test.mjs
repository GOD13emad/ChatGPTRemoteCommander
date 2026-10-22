import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('single-file Linux launcher supports offline product plan and rejects corrupt payload', {skip:process.platform==='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-linux-single-file-'));
 const out=path.join(dir,'Remote-Commander-Linux-Setup.run');
 try{
  const call=(...args)=>spawnSync('bash',args,{encoding:'utf8',timeout:15000});
  let result=call(path.join(root,'tools/build-linux-single-file.sh'),out);
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/LINUX_SINGLE_FILE_BUILD_PASS/);
  assert.ok(fs.statSync(out).size>5000);
  result=call(out,'--list-products');
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/core\s+available/);
  assert.match(result.stdout,/browser\s+unavailable/);
  result=call(out,'--plan-only','--all');
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/selected=core,work-plugin changesApplied=false/);
  result=call(out,'--plan-only','--product','browser');
  assert.equal(result.status,2);
  assert.match(result.stderr,/PRODUCT_UNAVAILABLE browser/);
  fs.appendFileSync(out,Buffer.from('tampered'));
  result=call(out,'--plan-only','--all');
  assert.equal(result.status,3);
  assert.match(result.stderr,/LINUX_PAYLOAD_SHA256_MISMATCH/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
