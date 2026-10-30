import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {captureV2MigrationManifest} from '../src/v2-migration-ledger.mjs';
import {executeV2MigrationPreflight} from '../tools/v2-migration-preflight.mjs';
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-r8-preflight-'));
 const manifest={schema:1,hostId:'hpc-host',platform:'win32',osPrincipalId:'sid-admin',
  observedAtMs:1000,sourceBuild:'0.11.0-dev.18',profiles:[{
   profileId:'default',ownerOsPrincipalId:'sid-admin',desktopSeatId:'rdp-2',
   accountRef:'managedref:account',workspaceRef:'managedref:workspace',
   browserProfileRef:'ownerref:browser',tunnels:[{
    enrollmentId:'tunnel-one',credentialRef:'wincred:tunnel-key-one',
    endpointRef:'managedref:port',supervisorRef:'managedref:supervisor',autostart:true
   }],projects:[]
  }]};
 const a=path.join(dir,'baseline.json'),b=path.join(dir,'proposed.json');
 fs.writeFileSync(a,JSON.stringify(manifest),{mode:0o600});
 fs.writeFileSync(b,JSON.stringify({...manifest,observedAtMs:1001}),{mode:0o600});
 return {manifest,a,b,dir,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('CLI reads two pinned snapshot files without writing secrets or declaring migration FINAL',()=>{
 const f=fixture();
 try{
  const sha=captureV2MigrationManifest(f.manifest).digest;
  const a=fs.statSync(f.a).mtimeMs,b=fs.statSync(f.b).mtimeMs;
  const out=executeV2MigrationPreflight(['--baseline',f.a,'--proposed',f.b,'--baseline-digest',sha]);
  assert.equal(out.status,'METADATA_PRESERVATION_PRECHECK_READY');
  assert.equal(out.cutoverAccepted,false);
  assert.equal(out.credentialUsability,'NOT_TESTED');
  assert.equal(fs.statSync(f.a).mtimeMs,a);
  assert.equal(fs.statSync(f.b).mtimeMs,b);
  assert.equal(JSON.stringify(out).includes('wincred:'),false);
 }finally{f.cleanup();}
});
test('CLI blocked result has nonzero exit and no credential reference disclosure',()=>{
 const f=fixture();
 try{
  const sha=captureV2MigrationManifest(f.manifest).digest;
  const changed=JSON.parse(fs.readFileSync(f.b,'utf8'));
  changed.profiles[0].tunnels=[];
  fs.writeFileSync(f.b,JSON.stringify(changed));
  const cli=fileURLToPath(new URL('../tools/v2-migration-preflight.mjs',import.meta.url));
  let result;
  try{execFileSync(process.execPath,[cli,'--baseline',f.a,'--proposed',f.b,
    '--baseline-digest',sha],{encoding:'utf8'});}
  catch(e){result=e;}
  assert.equal(result.status,3);
  const out=JSON.parse(result.stdout);
  assert.equal(out.status,'PRESERVATION_BLOCKED');
  assert.equal(out.differences[0].kind,'tunnel');
  assert.equal(JSON.stringify(out).includes('wincred:'),false);
 }finally{f.cleanup();}
});
test('CLI refuses aliasing, missing pin and inconsistent baseline',()=>{
 const f=fixture();
 try{
  assert.throws(()=>executeV2MigrationPreflight([]),{code:'V2_PREFLIGHT_USAGE'});
  const pin=captureV2MigrationManifest(f.manifest).digest;
  assert.throws(()=>executeV2MigrationPreflight([
   '--baseline',f.a,'--proposed',f.a,'--baseline-digest',pin
  ]),{code:'V2_PREFLIGHT_DISTINCT_SNAPSHOTS_REQUIRED'});
  assert.throws(()=>executeV2MigrationPreflight([
   '--baseline',f.a,'--proposed',f.b,'--baseline-digest','0'.repeat(64)
  ]),{code:'V2_MIGRATION_BASELINE_MISMATCH'});
 }finally{f.cleanup();}
});
