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
  const call=(...args)=>spawnSync('bash',args,{encoding:'utf8',timeout:15000,env:{...process.env,DISPLAY:'',WAYLAND_DISPLAY:''}});
  let result=call(path.join(root,'tools/build-linux-single-file.sh'),out);
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/LINUX_SINGLE_FILE_BUILD_PASS/);
  assert.ok(fs.statSync(out).size>5000);
  // A source-pinned installer must not vary with mktemp paths, timestamps or
  // the build host's umask. Compare the complete .run bytes, not only payload.
  const outAgain=path.join(dir,'Remote-Commander-Linux-Setup-repeat.run');
  result=call(path.join(root,'tools/build-linux-single-file.sh'),outAgain);
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.ok(fs.readFileSync(out).equals(fs.readFileSync(outAgain)),
    'two builds from one immutable Git head must be byte-for-byte identical');
  // Inspect the exact packaged launcher, not merely the source scripts.
  // A nominal newer .run must not install a stale Core default.
  const artifact=fs.readFileSync(out);
  const marker=Buffer.from('__RC_PRODUCT_PAYLOAD_BEGIN__\n');
  const cut=artifact.indexOf(marker);
  assert.ok(cut>0,'embedded payload marker must occur once');
  assert.equal(artifact.indexOf(marker,cut+marker.length),-1);
  const tarPath=path.join(dir,'embedded.tar.gz');
  fs.writeFileSync(tarPath,artifact.subarray(cut+marker.length));
  const extracted=spawnSync('tar',['-xOzf',tarPath,'./SETUP.sh'],{encoding:'utf8'});
  assert.equal(extracted.status,0,extracted.stderr);
  const expectedVersion=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
  const source=spawnSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'});
  assert.equal(source.status,0,source.stderr);
  assert.match(extracted.stdout,new RegExp("export REMOTE_COMMANDER_SOURCE_REF='v"+expectedVersion.replaceAll('.','\\.')+"'"));
  assert.ok(extracted.stdout.includes("export REMOTE_COMMANDER_EXPECTED_COMMIT='"+source.stdout.trim()+"'"));

  result=call(out,'--list-products');
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/core\s+available/);
  assert.match(result.stdout,/browser\s+conditional/);
  result=call(out,'--plan-only','--all');
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/selected=core,work-plugin changesApplied=false/);
  result=call(out,'--plan-only','--product','browser');
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/selected=core,browser changesApplied=false/);
  assert.match(result.stdout,/BROWSER_REQUIRES_LINUX_X86_64_X11_INTERACTIVE_SUDO_ONLINE_367MB/);
  fs.appendFileSync(out,Buffer.from('tampered'));
  result=call(out,'--plan-only','--all');
  assert.equal(result.status,3);
  assert.match(result.stderr,/LINUX_PAYLOAD_SHA256_MISMATCH/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});


test('single-file builder rejects a dirty source checkout before issuing a pinned artifact',
  {skip:process.platform==='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-linux-source-dirty-'));
 const clone=path.join(dir,'repo');
 const out=path.join(dir,'dirty.run');
 try{
  const git=spawnSync('git',['clone','--quiet','--no-hardlinks',root,clone],
    {encoding:'utf8',timeout:15000});
  assert.equal(git.status,0,git.stderr);
  fs.appendFileSync(path.join(clone,'installer/products.json'),'\n');
  const call=spawnSync('bash',[path.join(clone,'tools/build-linux-single-file.sh'),out],
    {encoding:'utf8',timeout:15000});
  assert.equal(call.status,2,call.stderr||call.stdout);
  assert.match(call.stderr,/LINUX_BOOTSTRAP_SOURCE_DIRTY/);
  assert.equal(fs.existsSync(out),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
