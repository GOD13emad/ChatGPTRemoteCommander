import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const helper=path.join(root,'tools','stage-pinned-tunnel.mjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const version='0.0.15';
const arch=process.arch==='arm64'?'arm64':'amd64';
function fixture(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rc-pinned-tunnel-stage-'));
 const install=path.join(temp,'install'),stage=path.join(temp,'release');
 const tools=path.join(install,'tools'),stools=path.join(stage,'tools');
 const srcDir=path.join(tools,'tunnel-client-v'+version+'-linux-'+arch);
 fs.mkdirSync(srcDir,{recursive:true});fs.mkdirSync(stools,{recursive:true});
 fs.mkdirSync(path.join(install,'var'));
 const payload=Buffer.alloc(16000,0x5a);
 const from=path.join(srcDir,'tunnel-client');
 fs.writeFileSync(from,payload,{mode:0o700});
 const pin={schema:1,version,releaseTag:'v'+version,upstreamCommit:'a'.repeat(40),sha256sumsSha256:'b'.repeat(64)};
 const receipt={schema:1,version,releaseTag:pin.releaseTag,upstreamCommit:pin.upstreamCommit,
  asset:'tunnel-client-v'+version+'-linux-'+arch+'.zip',assetSha256:'c'.repeat(64),binarySha256:sha(payload)};
 const receiptPath=path.join(install,'var','tunnel-client-installed.json');
 fs.writeFileSync(path.join(stools,'tunnel-client-pin.json'),JSON.stringify(pin));
 fs.writeFileSync(receiptPath,JSON.stringify(receipt));
 const destination=path.join(stools,path.basename(srcDir),'tunnel-client');
 const run=()=>spawnSync(process.execPath,[helper,'--install-root',install,'--stage-root',stage],
  {encoding:'utf8',timeout:6000,maxBuffer:50000});
 const cleanup=()=>fs.rmSync(temp,{recursive:true,force:true});
 return {install,stage,from,destination,receiptPath,receipt,pin,payload,run,cleanup};
}
test('pinned binary staged once and second invocation verifies rather than overwrites',{skip:process.platform!=='linux'},()=>{
 const f=fixture();try{
  let r=f.run();assert.equal(r.status,0,r.stderr);
  assert.equal(fs.readFileSync(f.destination).compare(f.payload),0);
  assert.ok(fs.statSync(f.destination).mode&0o100);
  r=f.run();assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/STAGE_PINNED_TUNNEL_PRESENT/);
 }finally{f.cleanup()}
});
test('tampered installed binary is not copied',{skip:process.platform!=='linux'},()=>{
 const f=fixture();try{
  fs.appendFileSync(f.from,'tamper');
  const r=f.run();assert.notEqual(r.status,0);
  assert.match(r.stderr,/BINARY_SHA256/);
  assert.equal(fs.existsSync(f.destination),false);
 }finally{f.cleanup()}
});
test('receipt different from pinned version fails before copying',{skip:process.platform!=='linux'},()=>{
 const f=fixture();try{
  fs.writeFileSync(f.receiptPath,JSON.stringify({...f.receipt,version:'0.0.14'}));
  const r=f.run();assert.notEqual(r.status,0);
  assert.match(r.stderr,/PIN_RECEIPT_MISMATCH/);
  assert.equal(fs.existsSync(f.destination),false);
 }finally{f.cleanup()}
});
test('existing target conflict is not silently replaced',{skip:process.platform!=='linux'},()=>{
 const f=fixture();try{
  fs.mkdirSync(path.dirname(f.destination));
  fs.writeFileSync(f.destination,Buffer.alloc(16000,0x7a),{mode:0o700});
  const r=f.run();assert.notEqual(r.status,0);
  assert.match(r.stderr,/EXISTING_TARGET_CONFLICT/);
  assert.equal(fs.readFileSync(f.destination)[0],0x7a);
 }finally{f.cleanup()}
});
test('symlink source cannot be staged',{skip:process.platform!=='linux'},()=>{
 const f=fixture();try{
  fs.renameSync(f.from,f.from+'.real');
  fs.symlinkSync(f.from+'.real',f.from);
  const r=f.run();assert.notEqual(r.status,0);
  assert.match(r.stderr,/PATH_TYPE/);
 }finally{f.cleanup()}
});
test('Linux updater stages verified binary before any active config, and project integrity lists helper',()=>{
 const script=fs.readFileSync(path.join(root,'auto-update-linux.sh'),'utf8');
 const stage=script.indexOf("IFS=$'\\t' read -r COMMIT VERSION STAGE_DIR < <(stage_release \"$REF\")");
 const repair=script.indexOf('node "$STAGE_PIN_HELPER" --install-root "$INSTALL_DIR"');
 const cfg=script.indexOf('ACTIVE_CFG="$(active_config "$STAGE_DIR")"');
 assert.ok(stage>0 && repair>stage && cfg>repair);
 assert.ok(fs.readFileSync(path.join(root,'test/source-integrity.mjs'),'utf8')
  .includes("'tools/stage-pinned-tunnel.mjs'"));
});
