#!/usr/bin/env node
// Build exactly one offline Commander V2 bundle manifest; no network, installer run,
// service registration or legacy-host modification.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createManifest,validateManifest} from './v2-universal-install-engine.mjs';
const fail=reason=>{throw Error('V2_BUNDLE_BUILD_'+reason)};
export function buildBundle({source,version,platform,arch,mode,entry}){
  if(typeof source!=='string'||!path.isAbsolute(source))fail('ABSOLUTE_SOURCE_REQUIRED');
  const root=path.resolve(source);
  if(!fs.existsSync(root)||!fs.lstatSync(root).isDirectory()||fs.lstatSync(root).isSymbolicLink())
    fail('SOURCE_NOT_REAL_DIRECTORY');
  if(fs.existsSync(path.join(root,'manifest.json')))fail('MANIFEST_ALREADY_PRESENT');
  const files=[];
  function scan(dir,relative=''){
    if(files.length>10000)fail('FILE_COUNT_EXCEEDED');
    for(const x of fs.readdirSync(dir,{withFileTypes:true})){
      const rel=relative?relative+'/'+x.name:x.name;
      const abs=path.join(dir,x.name);
      const st=fs.lstatSync(abs);
      if(st.isSymbolicLink())fail('SYMLINK_IN_BUNDLE');
      if(st.isDirectory()){scan(abs,rel);continue;}
      if(!st.isFile()||st.nlink!==1)fail('NONREGULAR_OR_HARDLINKED');
      files.push(rel);
    }
  }
  scan(root);
  files.sort((a,b)=>a.localeCompare(b,'en'));
  const manifest=createManifest({source:root,version,platform,arch,mode,entry,files});
  const info=validateManifest(manifest);
  const manifestFile=path.join(root,'manifest.json');
  fs.writeFileSync(manifestFile,JSON.stringify(manifest),{flag:'wx',mode:0o600});
  return {schema:1,product:'Commander V2',release:info.id,manifestSha256:info.digest,
    sourceFiles:info.files,sourceBytes:info.bytes,sourceModified:true,
    executableTrustedByPublisher:false,changesInstalled:false};
}
function parse(args){
  const allowed=new Set(['source','version','platform','arch','mode','entry']);
  const o={};
  if(args.length!==12)fail('REQUIRED_OPTIONS');
  for(let i=0;i<args.length;i+=2){
    const name=args[i]?.replace(/^--/,'');
    if(!allowed.has(name)||Object.hasOwn(o,name))fail('UNKNOWN_OR_DUPLICATE_OPTION');
    o[name]=args[i+1];
  }
  if(Object.keys(o).length!==6)fail('MISSING_OPTION');
  return o;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.stdout.write(JSON.stringify(buildBundle(parse(process.argv.slice(2))))+'\n');}
  catch(e){console.error(e.message?.startsWith('V2_BUNDLE_BUILD_')?e.message:'V2_BUNDLE_BUILD_FAILED');process.exitCode=2;}
}
