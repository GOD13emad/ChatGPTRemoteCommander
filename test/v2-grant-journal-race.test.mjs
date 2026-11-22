import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {V2GrantRegistry} from '../src/v2-grant-registry.mjs';

test('transient SQLite rollback journal vanishing during inspection does not block safe registry init',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-journal-race-'));
  const dir=path.join(root,'private');
  const origExists=fs.existsSync,origLstat=fs.lstatSync;
  let inspected=0;
  try{
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const isJournal=p=>String(p).endsWith('v2-access.sqlite-journal');
    fs.existsSync=(p,...args)=>isJournal(p)?true:origExists(p,...args);
    fs.lstatSync=(p,...args)=>{
      if(isJournal(p)){
        inspected++;
        const e=new Error('simulated SQLite journal deletion after prior lookup');
        e.code='ENOENT';throw e;
      }
      return origLstat(p,...args);
    };
    const registry=new V2GrantRegistry({directory:dir,authorizeAdministration:()=>true});
    try{
      assert.equal(registry.db.prepare('PRAGMA user_version').get().user_version,3);
    }finally{registry.close();}
    assert.equal(inspected,1);
  }finally{
    fs.existsSync=origExists;fs.lstatSync=origLstat;
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('transient-file validation still rejects forged symlink journal metadata',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-aliased-journal-'));
  const directory=path.join(root,'private');
  const original=fs.lstatSync;
  try{
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    fs.lstatSync=(p,...args)=>{
      if(String(p).endsWith('v2-access.sqlite-journal'))
        return {isFile:()=>false,isSymbolicLink:()=>true,nlink:1};
      return original(p,...args);
    };
    assert.throws(()=>new V2GrantRegistry({directory,authorizeAdministration:()=>true}),
      /V2_GRANT_ALIAS_NOT_ALLOWED/);
  }finally{fs.lstatSync=original;fs.rmSync(root,{recursive:true,force:true});}
});
test('transient-file validation never swallows unexpected filesystem errors',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-journal-denied-'));
  const directory=path.join(root,'private');
  const original=fs.lstatSync;
  try{
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    fs.lstatSync=(p,...args)=>{
      if(String(p).endsWith('v2-access.sqlite-journal')){
        const error=new Error('injected EACCES');error.code='EACCES';throw error;
      }
      return original(p,...args);
    };
    assert.throws(()=>new V2GrantRegistry({directory,authorizeAdministration:()=>true}),
      e=>e?.code==='EACCES');
  }finally{fs.lstatSync=original;fs.rmSync(root,{recursive:true,force:true});}
});
