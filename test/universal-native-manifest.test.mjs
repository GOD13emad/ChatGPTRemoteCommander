import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareNativeManifest}
  from '../tools/universal-install/native-manifest.mjs';
import {verifyNativePlanInput}
  from '../tools/universal-install/native-transaction.mjs';

test('one declarative manifest generator works identically for Windows/DEB source artifacts',()=>{
  const root=fs.mkdtempSync(path.join(os.homedir(),'rc-universal-manifest-qa-'));
  try{
    for(const platform of ['windows','linux']){
      const dir=path.join(root,platform);fs.mkdirSync(dir);
      const suffix=platform==='windows'?'Windows-x64.exe':'Linux-amd64.deb';
      const a=path.join(dir,'Remote-Commander-Unified-0.12.0-dev.8-'+suffix);
      const b=path.join(dir,'Remote-Commander-Unified-0.12.0-dev.9-'+suffix);
      fs.writeFileSync(a,Buffer.alloc(2000,1));
      fs.writeFileSync(b,Buffer.alloc(2000,2));
      const file=path.join(dir,'manifest.json');
      const args=['--candidate',b,'--previous',a,
        '--expected-head','a'.repeat(40),'--output',file];
      const result=prepareNativeManifest(args,{platform,architecture:'x64'});
      assert.equal(result.status,'UNIVERSAL_NATIVE_DECLARATIVE_MANIFEST_WRITTEN');
      assert.equal(result.independentSourceProvenanceVerified,false);
      const raw=JSON.parse(fs.readFileSync(file,'utf8'));
      assert.equal(raw.schema,'rc-universal-native-install-manifest-v1');
      const {schema,...spec}=raw;
      verifyNativePlanInput(spec);
      assert.equal(spec.candidate.version,'0.12.0-dev.9');
      assert.equal(spec.previous.version,'0.12.0-dev.8');
      assert.throws(()=>prepareNativeManifest(args,{platform,architecture:'x64'}),
        {code:'UNIVERSAL_NATIVE_MANIFEST_OUTPUT_EXISTS'});
    }
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('one manifest generator refuses cross-platform, malformed and missing native packages',()=>{
  const root=fs.mkdtempSync(path.join(os.homedir(),'rc-universal-manifest-qa-'));
  try{
    const w=path.join(root,'Remote-Commander-Unified-0.12.0-dev.8-Windows-x64.exe');
    const l=path.join(root,'Remote-Commander-Unified-0.12.0-dev.9-Linux-amd64.deb');
    fs.writeFileSync(w,Buffer.alloc(2000));
    fs.writeFileSync(l,Buffer.alloc(2000));
    for(const args of [
      ['--candidate',l,'--previous',w,'--expected-head','b'.repeat(40),
        '--output',path.join(root,'out.json')],
      ['--candidate',l,'--previous',w,'--expected-head','BAD_HEAD',
        '--output',path.join(root,'out2.json')]
    ])assert.throws(()=>prepareNativeManifest(args,{platform:'linux',architecture:'x64'}));
    assert.equal(fs.existsSync(path.join(root,'out.json')),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('the same manifest accepts explicit clean-machine install mode, never infers it',()=>{
  const root=fs.mkdtempSync(path.join(os.homedir(),'rc-universal-manifest-qa-'));
  try{
    for(const platform of ['windows','linux']){
      const suffix=platform==='windows'?'Windows-x64.exe':'Linux-amd64.deb';
      const fresh=path.join(root,platform);fs.mkdirSync(fresh);
      const old=path.join(fresh,'Remote-Commander-Unified-0.12.0-dev.8-'+suffix);
      const next=path.join(fresh,'Remote-Commander-Unified-0.12.0-dev.9-'+suffix);
      fs.writeFileSync(old,Buffer.alloc(2020,10));
      fs.writeFileSync(next,Buffer.alloc(2020,11));
      const output=path.join(fresh,'first.json');
      const args=['--fresh','--candidate',next,'--previous',old,
        '--expected-head','f'.repeat(40),'--output',output];
      const r=prepareNativeManifest(args,{platform,architecture:'x64'});
      assert.equal(r.installationKind,'fresh');
      const obj=JSON.parse(fs.readFileSync(output,'utf8'));
      assert.equal(obj.installationKind,'fresh');
      assert.equal(obj.previous.version,'0.12.0-dev.8');
      const {schema,...input}=obj;
      assert.equal(verifyNativePlanInput(input).installationKind,'fresh');
      const twice=args.concat('--fresh');
      assert.throws(()=>prepareNativeManifest(twice,{platform,architecture:'x64'}));
    }
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
