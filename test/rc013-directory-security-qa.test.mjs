import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ProjectCoordinationDirectory} from '../src/project-coordination-directory.mjs';

function fixture(cb) {
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'rc013-directory-qa-'));
 const directory=path.join(base,'index');
 fs.mkdirSync(directory,{mode:0o700});
 const make=()=>new ProjectCoordinationDirectory({
  directory,
  resolveAttestedRoute:async()=>({}),
  authorizeProject:async()=>false
 });
 try {return cb({base,directory,make});}
 finally {fs.rmSync(base,{recursive:true,force:true});}
}

test('RC013 existing owner-private directory is admitted and DB file remains private',{skip:process.platform==='win32'},()=>{
 fixture(({directory,make})=>{
  fs.chmodSync(directory,0o700);
  const d=make();
  try {
   assert.equal(fs.statSync(directory).mode & 0o077,0);
   assert.equal(fs.statSync(path.join(directory,'project-conversations.sqlite')).mode & 0o077,0);
  } finally {d.close();}
 });
});

test('RC013 existing writable-by-others directory must fail closed BEFORE SQLite open',{skip:process.platform==='win32'},()=>{
 fixture(({directory,make})=>{
  fs.chmodSync(directory,0o777);
  assert.throws(()=>{const d=make();d.close();},
    err=>err?.projectHubCode==='PROJECT_HUB_DIRECTORY_UNSAFE');
  assert.equal(fs.existsSync(path.join(directory,'project-conversations.sqlite')),false);
 });
});

test('RC013 existing group-readable directory must fail closed BEFORE SQLite open',{skip:process.platform==='win32'},()=>{
 fixture(({directory,make})=>{
  fs.chmodSync(directory,0o750);
  assert.throws(()=>{const d=make();d.close();},
    err=>err?.projectHubCode==='PROJECT_HUB_DIRECTORY_UNSAFE');
  assert.equal(fs.existsSync(path.join(directory,'project-conversations.sqlite')),false);
 });
});
