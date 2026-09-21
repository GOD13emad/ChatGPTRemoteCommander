import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const tool=path.join(root,'tools','router-retire.mjs');
function state(dir){
  const file=path.join(dir,'route.json');
  fs.writeFileSync(file,JSON.stringify({
    schema:1,profile:'default',generation:11,
    active:{port:48835,version:'0.8.13',commit:'1111111111111111111111111111111111111111',configSha256:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',configPath:'C:/new/config.json',projectDir:'C:/new'},
    previous:{port:48834,version:'0.8.9',commit:'2222222222222222222222222222222222222222',configSha256:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',configPath:'C:/old/config.json',projectDir:'C:/old'},
    updatedAt:new Date().toISOString()
  },null,2)+'\n');
  return file;
}
function run(args){return spawnSync(process.execPath,[tool,...args],{encoding:'utf8'});}

test('router retire atomically clears the exact previous backend and advances generation',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-retire-'));
  const file=state(dir);
  const r=run(['--state',file,'--expected-generation','11','--profile','default','--previous-port','48834','--previous-commit','2222222222222222222222222222222222222222']);
  assert.equal(r.status,0,r.stderr);
  const next=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(next.generation,12);
  assert.equal(next.previous,null);
  assert.equal(next.active.port,48835);
});

test('router retire fails closed on generation conflict',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-retire-'));
  const file=state(dir);
  const r=run(['--state',file,'--expected-generation','10','--profile','default','--previous-port','48834','--previous-commit','2222222222222222222222222222222222222222']);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/ROUTER_GENERATION_CONFLICT/);
  assert.notEqual(JSON.parse(fs.readFileSync(file,'utf8')).previous,null);
});

test('router retire fails closed on previous identity mismatch',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-retire-'));
  const file=state(dir);
  const r=run(['--state',file,'--expected-generation','11','--profile','default','--previous-port','49999','--previous-commit','2222222222222222222222222222222222222222']);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/ROUTER_RETIRE_PREVIOUS_PORT_MISMATCH/);
  assert.notEqual(JSON.parse(fs.readFileSync(file,'utf8')).previous,null);
});
