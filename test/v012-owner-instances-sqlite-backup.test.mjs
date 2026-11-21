import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {snapshotOneSqlite} from '../tools/v012-owner-instances-sqlite-backup.mjs';

test('online backup excludes a live uncommitted WAL row and proves disposable restore',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v012-instances-sqlite-fixture-'));
 let writer;
 try{
  const source=path.join(root,'live.sqlite'),target=path.join(root,'snapshot.sqlite');
  const restored=path.join(root,'restored.sqlite');
  const first=new DatabaseSync(source);
  first.exec('PRAGMA journal_mode=WAL;CREATE TABLE fixture (id INTEGER PRIMARY KEY, note TEXT)');
  first.exec("INSERT INTO fixture VALUES (1,'A'),(2,'B')");
  first.close();
  writer=new DatabaseSync(source);
  writer.exec('BEGIN IMMEDIATE');
  writer.exec("INSERT INTO fixture VALUES (3,'PENDING')");
  const result=await snapshotOneSqlite(source,target,restored);
  assert.equal(result.sha256.length,64);
  assert.equal(result.bytes,fs.statSync(target).size);
  assert.equal(fs.existsSync(restored),false);
  const check=new DatabaseSync(target,{readOnly:true});
  try{assert.equal(check.prepare('SELECT COUNT(*) AS n FROM fixture').get().n,2);}
  finally{check.close();}
  assert.equal(fs.existsSync(source),true);
 }finally{
  if(writer){writer.exec('ROLLBACK');writer.close();}
  fs.rmSync(root,{recursive:true,force:true});
 }
});
test('existing output is never overwritten',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v012-instances-sqlite-deny-'));
 try{
  const source=path.join(root,'source.sqlite');
  const db=new DatabaseSync(source);
  db.exec('CREATE TABLE x (id INTEGER);INSERT INTO x VALUES (1)');db.close();
  const dest=path.join(root,'target.sqlite'),restore=path.join(root,'restore.sqlite');
  fs.writeFileSync(dest,'ORIGINAL_BYTES');
  await assert.rejects(snapshotOneSqlite(source,dest,restore),/OUTPUT_EXISTS/);
  assert.equal(fs.readFileSync(dest,'utf8'),'ORIGINAL_BYTES');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
