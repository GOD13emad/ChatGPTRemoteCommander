import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const cli=path.join(root,'tools/qualification-failed-stage-r173.mjs');
const sha='ca7613b47e1a5f9756e7c38c26f642c2acfa874e';
const check='qualification-check-'+sha.slice(0,12)+'-'+'a'.repeat(32);
const failed='qualification-test-'+sha.slice(0,12)+'-'+'b'.repeat(32);
const line=(id)=>[
 'GATE_OUTPUT_FILES runId='+id+' stdout=C:/test/qualification-output-'+id+'.stdout.log stderr=ignored',
 'GATE_OUTPUT_HASH runId='+id+' stdoutSha256='+'0'.repeat(64)+' stderrSha256='+'0'.repeat(64)
].join('\n');
function fixture(t,content){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rcv2-r173-stage-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'updater.stdout.log');
 fs.writeFileSync(file,content);
 return {file,run:(commit=sha)=>spawnSync(process.execPath,[cli,file,commit],{encoding:'utf8',timeout:2000})};
}
test('R173 selects only failed TEST, not earlier successful CHECK, when both log pairs exist',t=>{
 const f=fixture(t,[line(check),'GATE_PASS check runId='+check,
  line(failed),'QUALIFICATION_FAILURE_RECORDED gate=test code=GATE_FAIL test exit=1',
  'AUTO_UPDATE_FAIL GATE_FAIL test exit=1 runId='+failed+' stdout=/private/path/token'].join('\r\n'));
 const r=f.run();
 assert.equal(r.status,0,r.stderr);
 assert.equal(r.stdout.trim(),'R173_FAILED_STAGE_ID='+failed);
 assert.doesNotMatch(r.stdout,/private|token|stdout=|check/);
});
test('R173 selects failed CHECK when TEST has never started',t=>{
 const f=fixture(t,[line(check),'AUTO_UPDATE_FAIL GATE_FAIL check exit=1 runId='+check].join('\n'));
 assert.equal(f.run().stdout.trim(),'R173_FAILED_STAGE_ID='+check);
});
test('multiple failed stages, mismatched commit and missing hash fail closed',t=>{
 const base=[line(check),'AUTO_UPDATE_FAIL GATE_FAIL check exit=1 runId='+check];
 const f=fixture(t,[...base,line(failed),'AUTO_UPDATE_FAIL GATE_FAIL test exit=1 runId='+failed].join('\n'));
 assert.equal(f.run().status,3);
 assert.equal(f.run('f'.repeat(40)).status,3);
 const j=fixture(t,[base[1],base[0].split('\n')[0]].join('\n'));
 assert.equal(j.run().status,3);
});
test('rejects symbolic links, empty files, secret-like text and malformed failure record',t=>{
 const f=fixture(t,'secret=untrusted\n');
 assert.equal(f.run().status,3);
 fs.writeFileSync(f.file,'');
 assert.equal(f.run().status,3);
 fs.writeFileSync(f.file,[line(failed),'AUTO_UPDATE_FAIL GATE_FAIL test exit=0 runId='+failed].join('\n'));
 assert.equal(f.run().status,3);
 const link=path.join(path.dirname(f.file),'link.log');
 try{fs.symlinkSync(f.file,link);
  assert.equal(spawnSync(process.execPath,[cli,link,sha],{encoding:'utf8'}).status,3);
 }catch(e){if(!['EPERM','EACCES','ENOTSUP'].includes(e.code))throw e;}
});
test('R173 script requires unique selected failure stage and still validates inner hash',()=>{
 const source=fs.readFileSync(path.join(root,'test/release-rollback-windows-r173.ps1'),'utf8');
 assert.match(source,/qualification-failed-stage-r173\.mjs/);
 assert.match(source,/R173_STAGE_SELECTION_FAIL_CLOSED/);
 assert.match(source,/R173_FAILED_STAGE_ID=/);
 const selection=source.indexOf('qualification-failed-stage-r173.mjs');
 const hash=source.indexOf('Get-FileHash -LiteralPath $inner -Algorithm SHA256');
 assert.ok(selection>=0&&hash>selection);
 assert.match(source,/LOG_HASH_UNATTESTED/);
});
