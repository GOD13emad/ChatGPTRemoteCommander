import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {validateCore,preparePreviewCore,previewConfig}=require('../packaging/unified/pilot-runtime.cjs');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const resource=path.join(repo,'packaging/unified/.stage/core');
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');

test('one installer definition uses Windows NSIS per user and Linux DEB, not old host repairs',()=>{
 const y=fs.readFileSync(path.join(repo,'packaging/unified/electron-builder.yml'),'utf8');
 assert.match(y,/target: nsis/);
 assert.match(y,/perMachine: false/);
 assert.match(y,/allowElevation: false/);
 assert.match(y,/target: deb/);
 assert.match(y,/from: .stage\/core/);
});
test('immutable packaged source and restricted preview boot',async()=>{
 const manifest=validateCore(resource);
 assert.match(manifest.head,/^[0-9a-f]{40}$/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-unified-'));
 try{
   const one=preparePreviewCore(resource,dir);
   assert.equal(one.existing,false);
   const again=preparePreviewCore(resource,dir);
   assert.equal(again.existing,true);
   assert.equal(again.head,manifest.head);
   assert.equal(sha(path.join(one.target,'src/server-v0.3.mjs')),manifest.files['src/server-v0.3.mjs']);
   const cfg=previewConfig(one.target,dir,59315);
   const obj=JSON.parse(fs.readFileSync(cfg.file,'utf8'));
   assert.equal(obj.host,'127.0.0.1');
   assert.equal(obj.capabilityProfile.tier,'STANDARD');
   assert.equal(obj.powerMode.enabled,false);
   assert.equal(obj.powerMode.fullFilesystem,false);
   assert.equal(obj.powerMode.allowShell,false);
   assert.equal(obj.autoUpdate.enabled,false);
   assert.deepEqual(obj.allowedPrograms,[]);
   assert.deepEqual(obj.allowedRoots,[cfg.root]);
   const entry=path.join(one.target,'src/server-v0.3.mjs');
   const child=spawn(process.execPath,[entry],{
      cwd:one.target,stdio:['ignore','pipe','pipe'],
      env:{...process.env,REMOTE_COMMANDER_CONFIG:cfg.file,
        COMMANDER_ONE_REQUIRE_TRUSTED_INGRESS:'0'}
   });
   let log='';
   for(const s of [child.stdout,child.stderr])s.on('data',x=>{log=(log+x.toString()).slice(-2400);});
   try{
     const started=Date.now();let ok=false;
     while(Date.now()-started<9000){
       if(child.exitCode!==null)break;
       ok=await new Promise(resolve=>{
         const req=http.get('http://127.0.0.1:59315/health',res=>{res.resume();resolve(res.statusCode===200);});
         req.on('error',()=>resolve(false));req.setTimeout(700,()=>{req.destroy();resolve(false);});
       });
       if(ok)break;
       await new Promise(r=>setTimeout(r,150));
     }
     assert.ok(ok,'real isolated 0.12 core should expose /health; '+log);
   }finally{
     child.kill();
     await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,1500).unref();});
   }
   const bad=path.join(one.target,'src/server-v0.3.mjs');
   fs.appendFileSync(bad,'\n// tampered\n');
   assert.throws(()=>preparePreviewCore(resource,dir),/UNIFIED_SOURCE_HASH_MISMATCH/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('preview rejects paths outside controlled port range',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-unified-invalid-'));
 try{assert.throws(()=>previewConfig(resource,dir,0),/UNIFIED_PREVIEW_PORT/);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
