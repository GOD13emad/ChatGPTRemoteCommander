import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const linux={skip:process.platform!=='linux'};
function fixture(t,kind){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-dependency-order-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const tools=path.join(root,'tools'), home=path.join(root,'home'), marker=path.join(root,'executed');
 fs.mkdirSync(tools);fs.mkdirSync(home);
 const prefix=kind==='tunnel'?'tunnel-client':'cua-driver';
 const helper='install-'+prefix+'-linux.sh', pinName=prefix+'-pin.json';
 for(const f of [helper,'json-field.mjs'])fs.copyFileSync(path.join(repo,'tools',f),path.join(tools,f));
 const pin=JSON.parse(read('tools/'+pinName));
 const arch=process.arch==='arm64'?'arm64':'amd64', asset=pin.assets['linux-'+arch];
 const final=kind==='tunnel'?path.join(tools,'tunnel-client-v'+pin.version+'-linux-'+arch):path.join(root,'data','chatgpt-remote-commander','adapters','cua-driver','v'+pin.version);
 fs.mkdirSync(final,{recursive:true});
 const binary=path.join(final,prefix);
 const version=kind==='tunnel'?pin.version+'+'+pin.upstreamCommit:'cua-driver '+pin.version;
 const stub=()=>fs.writeFileSync(binary,'#!/bin/sh\nprintf invoked > "$RC_TEST_MARKER"\nprintf "%s\\n" "'+version+'"\n',{mode:0o700});
 stub();
 asset.binarySha256=sha(binary);
 const companion=path.join(final,'cloudflared');
 if(kind==='tunnel'){
  fs.writeFileSync(companion,'#!/bin/sh\nexit 0\n',{mode:0o700});
  asset.cloudflaredSha256=sha(companion);
 }
 fs.writeFileSync(path.join(tools,pinName),JSON.stringify(pin));
 const receipt=path.join(final,'.verified-archive-sha256');
 fs.writeFileSync(receipt,asset.sha256+'\n');
 const meta={schema:1,version:pin.version,releaseTag:pin.releaseTag,upstreamCommit:pin.upstreamCommit,asset:asset.file,assetSha256:asset.sha256,binarySha256:asset.binarySha256,verification:kind==='tunnel'?'archive-and-binary-set-sha256':'official-archive-receipt-and-binary-sha256'};
 if(kind==='tunnel')meta.cloudflaredSha256=asset.cloudflaredSha256;
 const metaDir=kind==='tunnel'?path.join(root,'var'):final;
 fs.mkdirSync(metaDir,{recursive:true});
 fs.writeFileSync(path.join(metaDir,prefix+'-installed.json'),JSON.stringify(meta));
 const args=kind==='tunnel'?['--install-dir',root]:['--pin-file',path.join(tools,pinName),'--data-home',path.join(root,'data')];
 const run=()=>spawnSync('bash',[path.join(tools,helper),...args,'--verify-only'],{encoding:'utf8',timeout:15000,env:{...process.env,HOME:home,XDG_DATA_HOME:path.join(root,'data'),RC_TEST_MARKER:marker}});
 return {binary,companion,receipt,marker,run};
}
for(const kind of ['tunnel','cua']){
 test(kind+' valid synthetic pinned executable may run its version probe',linux,t=>{
  const f=fixture(t,kind);const r=f.run();
  assert.equal(r.status,0,r.stderr);assert.ok(fs.existsSync(f.marker));
 });
 test(kind+' tampered existing binary is rejected before execution',linux,t=>{
  const f=fixture(t,kind);fs.appendFileSync(f.binary,'# changed bytes\n');
  const r=f.run();assert.notEqual(r.status,0);assert.equal(fs.existsSync(f.marker),false);
 });
 test(kind+' mismatched archive receipt is rejected before execution in verify-only mode',linux,t=>{
  const f=fixture(t,kind);fs.writeFileSync(f.receipt,'0'.repeat(64));
  const r=f.run();assert.notEqual(r.status,0);assert.equal(fs.existsSync(f.marker),false);
 });
}
test('tunnel rejects a changed companion before invoking the pinned executable',linux,t=>{
 const f=fixture(t,'tunnel');fs.appendFileSync(f.companion,'# changed\n');
 const r=f.run();assert.notEqual(r.status,0);assert.equal(fs.existsSync(f.marker),false);
});
test('Windows helper and preparer guard ordering precedes version probes',()=>{
 for(const [file,guard,probe] of [
  ['tools/install-tunnel-client-windows.ps1',"if ($actual -cne $binarySha", '& $exe --version'],
  ['tools/install-cua-driver-windows.ps1',"if ($actual -cne $binarySha", '& $exe --version'],
  ['tools/prepare-owner-workspace-candidate.ps1',"throw 'OWNER_WORKSPACE_CANDIDATE_CUA_PROVENANCE_INVALID'",'& $cua --version'],
  ['tools/launch-owner-workspace.ps1',"throw 'OWNER_WORKSPACE_CUA_PROVENANCE_INVALID'",'& $cua --version']
 ]){
  const source=read(file);const g=source.indexOf(guard),p=source.indexOf(probe);
  assert.ok(g>=0&&p>g,file+' must verify before executing');
 }
});
