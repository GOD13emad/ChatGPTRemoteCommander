import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {DatabaseSync, backup} from 'node:sqlite';

function fail(code) { throw new Error('V012_SQLITE_'+code); }
function hashFile(file) {
  const h=crypto.createHash('sha256');
  const fd=fs.openSync(file,fs.constants.O_RDONLY);
  const b=Buffer.allocUnsafe(65536);
  try { let n; while((n=fs.readSync(fd,b,0,b.length,null))>0) h.update(b.subarray(0,n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function noAliases(p){
  let cur=path.resolve(p);
  while(true){
    const st=fs.lstatSync(cur);
    if(st.isSymbolicLink()) fail('ALIAS_PATH');
    const parent=path.dirname(cur);
    if(parent===cur) break;
    cur=parent;
  }
}
function sourceCandidate(){
  const root=path.join(os.homedir(),'.chatgpt-remote-commander','delivery');
  noAliases(root);
  const dirs=fs.readdirSync(root,{withFileTypes:true})
    .filter(x=>x.isDirectory()&&!x.isSymbolicLink())
    .map(x=>{const d=path.join(root,x.name);return {d,mtime:fs.statSync(d).mtimeMs};})
    .sort((a,b)=>b.mtime-a.mtime).slice(0,18);
  const candidates=[]; let scanned=0;
  function walk(d,depth){
    if(depth>3||scanned>1200)return;
    for(const x of fs.readdirSync(d,{withFileTypes:true})){
      if(x.isSymbolicLink())continue;
      const name=path.join(d,x.name);
      if(x.isDirectory()){walk(name,depth+1);continue;}
      if(!x.isFile())continue;
      scanned++;
      if(path.extname(x.name).toLowerCase()!=='.sqlite')continue;
      const st=fs.statSync(name);
      if(st.size<4096||st.size>8*1024*1024||Date.now()-st.mtimeMs>14*86400*1000)continue;
      const fd=fs.openSync(name,fs.constants.O_RDONLY);
      const b=Buffer.alloc(16);try{fs.readSync(fd,b,0,16,0);}finally{fs.closeSync(fd);}
      if(!b.equals(Buffer.from('SQLite format 3\0','binary')))continue;
      noAliases(name);
      candidates.push({file:name,mtime:st.mtimeMs,bytes:st.size});
    }
  }
  for(const d of dirs)walk(d.d,0);
  if(candidates.length===0)fail('NO_ELIGIBLE_DELIVERY_DATABASE');
  return candidates.sort((a,b)=>b.mtime-a.mtime)[0];
}
async function onlineSnapshot(src,dest){
  if(fs.existsSync(dest))fail('DESTINATION_EXISTS');
  const db=new DatabaseSync(src,{readOnly:true});
  try { await backup(db,dest,{rate:128}); }
  finally {db.close();}
  const verify=new DatabaseSync(dest,{readOnly:true});
  try {
    if(verify.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')fail('INTEGRITY_FAILED');
  }finally{verify.close();}
  return {bytes:fs.statSync(dest).size,sha256:hashFile(dest)};
}
function checkRestore(dest,output){
  const restored=path.join(output,'disposable-restored.sqlite');
  if(fs.existsSync(restored))fail('RESTORE_EXISTS');
  try{
    fs.copyFileSync(dest,restored,fs.constants.COPYFILE_EXCL);
    const db=new DatabaseSync(restored,{readOnly:true});
    try {if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')fail('RESTORE_CHECK_FAILED');}
    finally{db.close();}
    if(hashFile(dest)!==hashFile(restored))fail('RESTORE_HASH_FAILED');
  }finally{if(fs.existsSync(restored))fs.unlinkSync(restored);}
}
async function run(){
  const [mode,output]=process.argv.slice(2);
  if(process.platform!=='win32'||!['fixture','pilot'].includes(mode)||!output)fail('EXPLICIT_WINDOWS_MODE_REQUIRED');
  const parent=path.join(process.env.LOCALAPPDATA,'CommanderV2','migration-private');
  const expected=fs.realpathSync(parent);
  if(path.dirname(path.resolve(output)).toLowerCase()!==expected.toLowerCase()||
     !path.basename(output).startsWith('v012-sqlite-'))fail('PRIVATE_OUTPUT_SCOPE');
  noAliases(output);
  let src,fixtureWriter;
  if(mode==='fixture'){
    src=path.join(output,'fake-source.sqlite');
    const db=new DatabaseSync(src);
    try{
      db.exec('PRAGMA journal_mode=WAL');
      db.exec('CREATE TABLE fixture (id INTEGER PRIMARY KEY, note TEXT)');
      db.exec("INSERT INTO fixture (id,note) VALUES (1,'fixture-A'),(2,'fixture-B')");
    }finally{db.close();}
    fixtureWriter=new DatabaseSync(src);
    fixtureWriter.exec('BEGIN IMMEDIATE');
    fixtureWriter.exec("INSERT INTO fixture (id,note) VALUES (3,'NOT_COMMITTED')");
  }else{
    src=sourceCandidate().file;
  }
  const dest=path.join(output,'online-snapshot.sqlite');
  let summary;
  try{
    const snapshot=await onlineSnapshot(src,dest);
    checkRestore(dest,output);
    if(mode==='fixture'){
      const db=new DatabaseSync(dest,{readOnly:true});
      try{if(db.prepare('SELECT COUNT(*) AS n FROM fixture').get().n!==2)fail('UNCOMMITTED_VISIBLE');}
      finally{db.close();}
    }
    summary={schema:1,mode,backupSha256:snapshot.sha256,backupBytes:snapshot.bytes,
      sqliteOnlineBackup:'PASS',sqliteIntegrity:'PASS',disposableRestore:'PASS',
      sourceModifiedByTool:false,liveWholeServiceConsistent:false,fullOwnerStateCovered:false,
      installedCutoverAuthorized:false};
    if(mode==='pilot'){
      summary.sourceFileFingerprint=crypto.createHash('sha256').update(src).digest('hex').slice(0,16);
      summary.sourceAgeMinutes=Math.trunc((Date.now()-fs.statSync(src).mtimeMs)/60000);
    }
    fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(summary));
    console.log('V012_SQLITE_BACKUP_RECEIPT='+JSON.stringify(summary));
  }finally{
    if(fixtureWriter){fixtureWriter.exec('ROLLBACK');fixtureWriter.close();}
    if(mode==='fixture'){
      for(const x of ['fake-source.sqlite','fake-source.sqlite-wal','fake-source.sqlite-shm','online-snapshot.sqlite']){
        try{fs.unlinkSync(path.join(output,x));}catch(e){if(e.code!=='ENOENT')throw e;}
      }
    }
  }
}
run().catch(e=>{console.error(e.message?.startsWith('V012_SQLITE_')?e.message:'V012_SQLITE_NATIVE_FAILED');process.exitCode=2;});
