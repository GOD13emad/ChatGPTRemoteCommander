import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {copyOriginalJ01QADenyOnly,inspectOriginalJ01QADenyOnly} from '../tools/gui-original-j01-custody-qa.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const raw=Buffer.from('{"schema":"rc-gui-pending-input-v1","status":"PENDING_NATIVE_EFFECT","nativeOutcome":"UNKNOWN"}\n');
async function withQA(fn){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'rc-e42-j01-qa-'));
 const archiveDir=path.join(base,'archive');
 const sourceFile=path.join(base,'pending.json');
 await fs.mkdir(archiveDir,{mode:0o700});
 await fs.writeFile(sourceFile,raw,{mode:0o600,flag:'wx'});
 const input={qaRoot:base,sourceFile,archiveDir,expectedSha256:sha(raw),expectedBytes:raw.length};
 try{return await fn({...input,base})}finally{await fs.rm(base,{recursive:true,force:true})}
}
const denied=x=>{
 assert.equal(x.releaseAuthorized,false);
 assert.equal(x.ownerAuthenticated,false);
 assert.equal(x.protectedBroker,false);
 assert.equal(x.storageTrusted,false);
 assert.equal(x.fleetQuiescenceProven,false);
 assert.equal(x.originalNativeOutcome,'UNKNOWN');
 assert.equal(x.noReplay,true);
 assert.equal(x.physicalPowerLossProven,false);
 assert.ok(Object.isFrozen(x));
};
test('exclusive exact-byte J01 copy and readback never unlocks native input',()=>withQA(async x=>{
 const before=await fs.readFile(x.sourceFile);
 const out=await copyOriginalJ01QADenyOnly(x);
 denied(out);assert.equal(out.state,'ARCHIVE_BYTES_VERIFIED');
 assert.equal(out.archivedByteMatch,true);
 assert.equal(out.archiveSha256,x.expectedSha256);
 assert.deepEqual(await fs.readFile(x.sourceFile),before);
 const inspected=await inspectOriginalJ01QADenyOnly(x);
 denied(inspected);assert.equal(inspected.state,'ARCHIVE_BYTES_VERIFIED');
 assert.equal(inspected.posixDirectoryFsync,false);
 if(process.platform==='linux')assert.equal(out.posixDirectoryFsync,true);
 if(process.platform==='win32')assert.equal(out.posixDirectoryFsync,false);
}));
test('second same-source capture rejects EEXIST and does not overwrite',()=>withQA(async x=>{
 await copyOriginalJ01QADenyOnly(x);
 const archive=path.join(x.archiveDir,'j01-original-'+x.expectedSha256+'.bin');
 const first=await fs.readFile(archive);
 await assert.rejects(copyOriginalJ01QADenyOnly(x),e=>e.code==='EEXIST');
 assert.deepEqual(await fs.readFile(archive),first);
}));
test('two concurrently attempting exclusive capture yield one winner only',()=>withQA(async x=>{
 const res=await Promise.allSettled([copyOriginalJ01QADenyOnly(x),copyOriginalJ01QADenyOnly(x)]);
 assert.equal(res.filter(y=>y.status==='fulfilled').length,1);
 assert.equal(res.filter(y=>y.status==='rejected'&&y.reason.code==='EEXIST').length,1);
 denied(res.find(y=>y.status==='fulfilled').value);
}));
test('changed original bytes cannot be archived',()=>withQA(async x=>{
 await fs.writeFile(x.sourceFile,Buffer.from('TAMPER'));
 await assert.rejects(copyOriginalJ01QADenyOnly(x),e=>/SIZE_MISMATCH|HASH_MISMATCH/.test(e.code));
 assert.deepEqual(await fs.readdir(x.archiveDir),[]);
}));
test('changed original with equal size is rejected by original SHA',()=>withQA(async x=>{
 await fs.writeFile(x.sourceFile,Buffer.alloc(x.expectedBytes,0x41));
 await assert.rejects(copyOriginalJ01QADenyOnly(x),e=>e.code==='J01_ORIGINAL_HASH_MISMATCH');
}));
test('archive tampering never becomes owner authentication',()=>withQA(async x=>{
 await copyOriginalJ01QADenyOnly(x);
 const f=path.join(x.archiveDir,'j01-original-'+x.expectedSha256+'.bin');
 await fs.writeFile(f,Buffer.alloc(raw.length,0x40));
 const result=await inspectOriginalJ01QADenyOnly(x);
 denied(result);assert.equal(result.state,'ARCHIVE_CORRUPT_DENY');
}));
test('missing archive remains explicitly blocked',()=>withQA(async x=>{
 const r=await inspectOriginalJ01QADenyOnly(x);
 denied(r);assert.equal(r.state,'ARCHIVE_MISSING_DENY');
}));
test('unsafe expected hash, length, or path rejected before IO',()=>withQA(async x=>{
 for(const bad of [{expectedSha256:'00'}, {expectedBytes:0},{sourceFile:'relative'}, {archiveDir:'relative'}]){
  await assert.rejects(copyOriginalJ01QADenyOnly({...x,...bad}),e=>e.code==='J01_CUSTODY_ARGUMENT_INVALID');
 }
 assert.deepEqual(await fs.readdir(x.archiveDir),[]);
}));
test('same source directory cannot be used as archive',()=>withQA(async x=>{
 await assert.rejects(copyOriginalJ01QADenyOnly({...x,archiveDir:path.dirname(x.sourceFile)}),
  e=>e.code==='J01_QA_ARCHIVE_OUTSIDE_ROOT');
}));
test('source symlink is rejected without copying or modifying target',()=>withQA(async x=>{
 const alias=path.join(x.base,'symlink');
 try{await fs.symlink(x.sourceFile,alias);}catch(e){if(['EPERM','EACCES','ENOTSUP'].includes(e.code))return;throw e}
 await assert.rejects(copyOriginalJ01QADenyOnly({...x,sourceFile:alias}),
  e=>e.code==='J01_SOURCE_NOT_SINGLE_REGULAR_FILE');
 assert.deepEqual(await fs.readFile(x.sourceFile),raw);
}));
test('hardlinked source rejected rather than treat link count as isolated',()=>withQA(async x=>{
 const alias=path.join(x.base,'hardlink');
 await fs.link(x.sourceFile,alias);
 await assert.rejects(copyOriginalJ01QADenyOnly(x),e=>e.code==='J01_SOURCE_NOT_SINGLE_REGULAR_FILE');
}));
test('symlink archive directory rejected',()=>withQA(async x=>{
 const alias=path.join(x.base,'archive-link');
 try{await fs.symlink(x.archiveDir,alias,'dir');}catch(e){if(['EPERM','EACCES','ENOTSUP'].includes(e.code))return;throw e}
 await assert.rejects(copyOriginalJ01QADenyOnly({...x,archiveDir:alias}),
  e=>e.code==='J01_ARCHIVE_DIR_INVALID');
}));
test('preexisting archive symlink is never overwritten',()=>withQA(async x=>{
 const archive=path.join(x.archiveDir,'j01-original-'+x.expectedSha256+'.bin');
 try{await fs.symlink(x.sourceFile,archive);}catch(e){if(['EPERM','EACCES','ENOTSUP'].includes(e.code))return;throw e}
 await assert.rejects(copyOriginalJ01QADenyOnly(x),e=>e.code==='EEXIST');
 assert.deepEqual(await fs.readFile(x.sourceFile),raw);
 const result=await inspectOriginalJ01QADenyOnly(x);
 denied(result);assert.equal(result.state,'ARCHIVE_UNSAFE_DENY');
}));
test('partial existing archive is never replaced or treated as complete',()=>withQA(async x=>{
 const archive=path.join(x.archiveDir,'j01-original-'+x.expectedSha256+'.bin');
 await fs.writeFile(archive,Buffer.from('PARTIAL'));
 await assert.rejects(copyOriginalJ01QADenyOnly(x),e=>e.code==='EEXIST');
 const result=await inspectOriginalJ01QADenyOnly(x);
 denied(result);assert.equal(result.state,'ARCHIVE_UNSAFE_DENY');
}));
test('corrupted or missing source cannot be inferred from a valid archive',()=>withQA(async x=>{
 await copyOriginalJ01QADenyOnly(x);
 await fs.unlink(x.sourceFile);
 const r=await inspectOriginalJ01QADenyOnly(x);
 denied(r);assert.equal(r.state,'ARCHIVE_BYTES_VERIFIED');
 assert.equal(r.releaseAuthorized,false);
}));

test('unscoped or outside disposable QA roots cannot inspect or copy real J01',()=>withQA(async x=>{
 for(const p of [undefined,process.cwd(),os.tmpdir(),path.dirname(x.base)]){
  await assert.rejects(copyOriginalJ01QADenyOnly({...x,qaRoot:p}),
    e=>e.code?.startsWith('J01_QA_'));
  await assert.rejects(inspectOriginalJ01QADenyOnly({...x,qaRoot:p}),
    e=>e.code?.startsWith('J01_QA_'));
 }
 await assert.rejects(copyOriginalJ01QADenyOnly({...x,sourceFile:path.join(os.tmpdir(),'gui-pending-native-input-v1.json')}),
   e=>e.code==='J01_QA_SOURCE_OUTSIDE_ROOT');
 assert.deepEqual(await fs.readdir(x.archiveDir),[]);
}));
