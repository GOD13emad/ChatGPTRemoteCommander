// Public evidence archive only. Never an admission registry, key store,
// grant authority, or lease release mechanism. The verifier's expected
// reservation and public key must come from independent trusted owner state.
// Private directory mode is not proof of isolation from a same-UID Worker.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {normalizeNativeCessationExpected,encodeNativeCessationCertificateClaims,
  verifyNativeCessationCertificate} from './v012-native-cessation-certificate.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const DB='v012-native-cessation-evidence.sqlite';
function safeDirectory(directory){
  if(process.platform!=='linux'||typeof directory!=='string'||!path.isAbsolute(directory)
    ||directory.length>4096||directory.includes('\0')||path.resolve(directory)!==directory)
    fail('CESSATION_ARCHIVE_DIRECTORY_REQUIRED');
  let cursor=path.parse(directory).root;
  for(const name of directory.slice(cursor.length).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,name);
    const s=fs.lstatSync(cursor);
    if(!s.isDirectory()||s.isSymbolicLink())fail('CESSATION_ARCHIVE_DIRECTORY_ALIAS');
  }
  const s=fs.lstatSync(directory);
  if(s.uid!==process.getuid()||(s.mode&0o077)!==0||fs.realpathSync.native(directory)!==directory)
    fail('CESSATION_ARCHIVE_DIRECTORY_NOT_PRIVATE');
  return directory;
}
function checkedFiles(file){
  for(const suffix of ['','-journal','-wal','-shm']){
    const s=fs.lstatSync(file+suffix,{throwIfNoEntry:false});
    if(s&&(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||
      s.uid!==process.getuid()||(s.mode&0o077)!==0))
      fail('CESSATION_ARCHIVE_FILE_UNTRUSTED');
  }
}
function expectedDigest(e){return sha(JSON.stringify(normalizeNativeCessationExpected(e)));}
export function openNativeCessationEvidenceArchive({directory}={}){
  const dir=safeDirectory(directory),file=path.join(dir,DB);
  checkedFiles(file);
  try{
    const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|
      fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    fs.closeSync(fd);
  }catch(e){if(e.code!=='EEXIST')throw e;}
  checkedFiles(file);
  const db=new DatabaseSync(file,{timeout:1000,allowExtension:false});
  let closed=false;
  try{
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=EXTRA; PRAGMA busy_timeout=1000;');
    if(db.prepare('PRAGMA journal_mode').get().journal_mode!=='delete')
      fail('CESSATION_ARCHIVE_JOURNAL_MODE');
    db.exec('CREATE TABLE IF NOT EXISTS evidence (lease_id TEXT PRIMARY KEY, expected_sha TEXT NOT NULL, packet_json TEXT NOT NULL)');
    if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')fail('CESSATION_ARCHIVE_CORRUPT');
  }catch(e){db.close();throw e;}
  const ready=()=>{if(closed)fail('CESSATION_ARCHIVE_CLOSED');safeDirectory(dir);checkedFiles(file);};
  return Object.freeze({
    // Caller supplies independently verified expected state. Never persist
    // the key, receipt body, private key or an authorization decision.
    record({packet,expected,publicKeyPem,now=Date.now()}={}){
      ready();
      const e=normalizeNativeCessationExpected(expected);
      if(!verifyNativeCessationCertificate({packet,expected:e,publicKeyPem,now}))
        fail('CESSATION_ARCHIVE_EVIDENCE_INVALID');
      const canonical={claims:JSON.parse(encodeNativeCessationCertificateClaims(packet.claims)),signature:packet.signature};
      const text=JSON.stringify(canonical),digest=expectedDigest(e);
      if(Buffer.byteLength(text)>16384)fail('CESSATION_ARCHIVE_EVIDENCE_TOO_LARGE');
      db.exec('BEGIN IMMEDIATE');
      try{
        const old=db.prepare('SELECT expected_sha,CASE WHEN length(CAST(packet_json AS BLOB))<=16384 THEN packet_json ELSE NULL END AS packet_json FROM evidence WHERE lease_id=?').get(e.binding.leaseId);
        if(old){
          if(old.expected_sha!==digest||old.packet_json!==text)fail('CESSATION_ARCHIVE_CONFLICT');
          db.exec('COMMIT');return Object.freeze({recorded:false,duplicate:true});
        }
        db.prepare('INSERT INTO evidence(lease_id,expected_sha,packet_json) VALUES(?,?,?)').run(e.binding.leaseId,digest,text);
        db.exec('COMMIT');return Object.freeze({recorded:true,duplicate:false});
      }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
    },
    read({expected,publicKeyPem,now=Date.now()}={}){
      try{
        ready();
        const e=normalizeNativeCessationExpected(expected);
        const row=db.prepare('SELECT expected_sha,CASE WHEN length(CAST(packet_json AS BLOB))<=16384 THEN packet_json ELSE NULL END AS packet_json FROM evidence WHERE lease_id=?').get(e.binding.leaseId);
        if(!row||row.expected_sha!==expectedDigest(e)||typeof row.packet_json!=='string'
          ||Buffer.byteLength(row.packet_json)>16384)return null;
        const packet=JSON.parse(row.packet_json);
        return verifyNativeCessationCertificate({packet,expected:e,publicKeyPem,now});
      }catch{return null;}
    },
    close(){if(!closed){closed=true;db.close();}}
  });
}
