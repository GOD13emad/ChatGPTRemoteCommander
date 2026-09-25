import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const tool=path.resolve('tools/retained-backends.mjs');
function run(args){
  const r=spawnSync(process.execPath,[tool,...args],{encoding:'utf8'});
  if(r.status!==0)throw new Error(r.stderr||r.stdout||'retained tool failed');
  return r.stdout;
}
test('retained backend registry adds, lists, protects and removes exact identity',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-retained-'));
  try{
    const file=path.join(root,'retained-backends.json');
    const project=path.join(root,'release');
    const cfg=path.join(root,'config.json');
    fs.mkdirSync(project,{recursive:true});fs.writeFileSync(cfg,'{}\n');
    const commit='a'.repeat(40),sha='b'.repeat(64);
    const add=JSON.parse(run(['--file',file,'--action','add','--profile','default','--port','48831','--version','0.8.37','--commit',commit,'--config-sha',sha,'--config-path',cfg,'--project-dir',project,'--terminal-pids','11,12']));
    assert.equal(add.ok,true);assert.equal(add.count,1);
    const tsv=run(['--file',file,'--action','list-tsv']).trim().split('\t');
    assert.deepEqual(tsv.slice(0,5),['default','48831','0.8.37',commit,sha]);
    assert.equal(tsv[7],'11,12');
    assert.equal(run(['--file',file,'--action','protected-projects']).trim(),path.resolve(project));
    const again=JSON.parse(run(['--file',file,'--action','add','--profile','default','--port','48831','--version','0.8.37','--commit',commit,'--config-sha',sha,'--config-path',cfg,'--project-dir',project,'--terminal-pids','12,13']));
    assert.equal(again.count,1);
    const rem=JSON.parse(run(['--file',file,'--action','remove','--profile','default','--port','48831','--commit',commit]));
    assert.equal(rem.removed,1);
    assert.equal(run(['--file',file,'--action','list-tsv']),'');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('retained registry rejects invalid backend identity',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-retained-bad-'));
  try{
    const r=spawnSync(process.execPath,[tool,'--file',path.join(root,'x.json'),'--action','add','--profile','default','--port','0','--version','x','--commit','bad','--config-sha','bad','--config-path',root,'--project-dir',root],{encoding:'utf8'});
    assert.notEqual(r.status,0);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
