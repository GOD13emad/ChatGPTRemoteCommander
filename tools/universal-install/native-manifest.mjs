#!/usr/bin/env node
// Host-independent declarative manifest generator. Identical command and
// output schema on Linux and Windows; reads local native artifacts only.
// Its SHA values are an inventory, NOT independently trusted provenance.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyNativePlanInput}
  from './native-transaction.mjs';

const fail=s=>{throw Object.assign(new Error(s),{code:s});};
const SHA=/^[a-f0-9]{40}$/;
const NAME=/^Remote-Commander-Unified-((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-dev\.[1-9][0-9]*)?)-(Windows|Linux)-(x64|arm64|amd64)\.(exe|deb)$/;
function readArgs(args){
  const keys=new Set(['--candidate','--previous','--expected-head','--output']);
  const fresh=args.filter(x=>x==='--fresh').length;
  if(fresh>1||![8,9].includes(args.length)||(args.length===9)!==(fresh===1))
    fail('UNIVERSAL_NATIVE_MANIFEST_ARGS_REQUIRED');
  const parts=fresh?args.filter(x=>x!=='--fresh'):args;
  const v=new Map();
  for(let i=0;i<8;i+=2){
    if(!keys.has(parts[i])||v.has(parts[i])||typeof parts[i+1]!=='string')
      fail('UNIVERSAL_NATIVE_MANIFEST_ARGS_INVALID');
    v.set(parts[i],parts[i+1]);
  }
  if(v.size!==4||!SHA.test(v.get('--expected-head')??''))
    fail('UNIVERSAL_NATIVE_MANIFEST_SOURCE_HEAD_INVALID');
  for(const k of ['--candidate','--previous','--output'])
    if(!path.isAbsolute(v.get(k)??''))
      fail('UNIVERSAL_NATIVE_MANIFEST_ABSOLUTE_PATH_REQUIRED');
  return {values:v,fresh:fresh===1};
}
function inspect(file,platform,architecture){
  const p=path.resolve(file),st=fs.lstatSync(p);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1
    ||st.size<1024||st.size>1024*1024*1024)
    fail('UNIVERSAL_NATIVE_MANIFEST_ARTIFACT_UNTRUSTED');
  const m=NAME.exec(path.basename(p));
  const wantedPlatform=platform==='windows'?'Windows':'Linux';
  const wantedArch=platform==='linux'&&architecture==='x64'?'amd64':architecture;
  const wantedExtension=platform==='windows'?'exe':'deb';
  if(!m||m[2]!==wantedPlatform||m[3]!==wantedArch
    ||m[4]!==wantedExtension)
    fail('UNIVERSAL_NATIVE_MANIFEST_PACKAGE_FAMILY_INVALID');
  const h=createHash('sha256'),fd=fs.openSync(p,'r'),buf=Buffer.alloc(1024*1024);
  try{
    const before=fs.fstatSync(fd);
    if(before.dev!==st.dev||before.ino!==st.ino||before.size!==st.size)
      fail('UNIVERSAL_NATIVE_MANIFEST_ARTIFACT_CHANGED');
    let bytes=0;
    for(let n;(n=fs.readSync(fd,buf,0,buf.length,null))>0;){
      bytes+=n;h.update(buf.subarray(0,n));
    }
    const after=fs.fstatSync(fd),leaf=fs.lstatSync(p);
    if(bytes!==before.size||after.size!==before.size
      ||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs
      ||leaf.ino!==before.ino||leaf.dev!==before.dev
      ||leaf.mtimeMs!==before.mtimeMs||leaf.isSymbolicLink())
      fail('UNIVERSAL_NATIVE_MANIFEST_ARTIFACT_CHANGED');
  }finally{buf.fill(0);fs.closeSync(fd);}
  return {path:p,sha256:h.digest('hex'),version:m[1]};
}
export function prepareNativeManifest(args,{
  platform=process.platform==='win32'?'windows':process.platform,
  architecture=os.arch()
}={}){
  if(!['windows','linux'].includes(platform)
    ||!['x64','arm64'].includes(architecture))
    fail('UNIVERSAL_NATIVE_MANIFEST_PLATFORM_UNSUPPORTED');
  const {values:v,fresh}=readArgs(args);
  const output=path.resolve(v.get('--output'));
  if(fs.existsSync(output))fail('UNIVERSAL_NATIVE_MANIFEST_OUTPUT_EXISTS');
  const input=verifyNativePlanInput({
    product:'ChatGPTRemoteCommander',platform,architecture,
    expectedCommit:v.get('--expected-head'),
    ...(fresh?{installationKind:'fresh'}:{}),
    candidate:inspect(v.get('--candidate'),platform,architecture),
    previous:inspect(v.get('--previous'),platform,architecture)
  });
  if(path.resolve(input.candidate.path)===output
    ||path.resolve(input.previous.path)===output)
    fail('UNIVERSAL_NATIVE_MANIFEST_OUTPUT_COLLISION');
  const data={schema:'rc-universal-native-install-manifest-v1',...input};
  fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n',{
    mode:0o600,flag:'wx'
  });
  return {status:'UNIVERSAL_NATIVE_DECLARATIVE_MANIFEST_WRITTEN',
    platform,output,installationKind:fresh?'fresh':'upgrade',
    installedArtifactCount:2,
    independentSourceProvenanceVerified:false,
    nativeEffectsPerformed:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(prepareNativeManifest(process.argv.slice(2))));}
  catch(e){console.error(JSON.stringify({status:'UNIVERSAL_NATIVE_MANIFEST_DENIED',
    code:e?.code??'UNIVERSAL_NATIVE_UNEXPECTED_ERROR'}));process.exitCode=2;}
}
