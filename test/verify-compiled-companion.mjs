#!/usr/bin/env node
// Verify the optional Companion was embedded in the *same* native installer,
// independent from the public Core source manifest. No install/elevation.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const SHA40=/^[a-f0-9]{40}$/,SHA64=/^[a-f0-9]{64}$/;
const EXTENSION='extensions/chatgpt-companion/';
const FILES=Object.freeze([
  'README.md','background.js','content.js','manifest.json',
  'popup.css','popup.html','popup.js','protocol.js'
]);
const fail=(ok,code)=>{if(!ok)throw Error(code);};
function readRegular(file,max){
  const stat=fs.lstatSync(file);
  fail(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&
    stat.size>0&&stat.size<=max,'COMPANION_UNTRUSTED_FILE');
  return fs.readFileSync(file);
}
export function verifyCompiledCompanion({companionRoot,sourceManifest,expectedCommit}){
  fail([companionRoot,sourceManifest].every(x=>typeof x==='string'&&path.isAbsolute(x))&&
    SHA40.test(expectedCommit),'COMPANION_ARGUMENTS_INVALID');
  const root=path.resolve(companionRoot);
  const rootStat=fs.lstatSync(root);
  fail(rootStat.isDirectory()&&!rootStat.isSymbolicLink(),'COMPANION_ROOT_INVALID');
  const expectedBytes=readRegular(sourceManifest,32768);
  const actualBytes=readRegular(path.join(root,'source-manifest.json'),32768);
  fail(actualBytes.equals(expectedBytes),'COMPANION_MANIFEST_CHANGED');
  const receipt=JSON.parse(actualBytes.toString('utf8'));
  fail(receipt.schema===1&&receipt.kind==='COMMANDER_OPTIONAL_BROWSER_COMPANION'
    &&receipt.head===expectedCommit&&SHA40.test(receipt.tree)
    &&receipt.count===FILES.length&&receipt.files&&
    typeof receipt.files==='object'&&!Array.isArray(receipt.files),
    'COMPANION_MANIFEST_INVALID');
  const listed=Object.entries(receipt.files);
  fail(listed.length===FILES.length,'COMPANION_FILE_COUNT_INVALID');
  const names=new Set(FILES.map(x=>EXTENSION+x));
  for(const [name,hash] of listed){
    fail(names.has(name)&&SHA64.test(hash),'COMPANION_UNLISTED_OR_UNSAFE_PATH');
  }
  let checked=0;
  const found=new Set();
  function walk(dir,prefix=''){
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      const relative=prefix+entry.name;
      fail(relative.length<=160&&!relative.includes('..')&&
        relative.split('/').every(x=>x&&/^[A-Za-z0-9._-]+$/.test(x)),
        'COMPANION_PATH_INVALID');
      const abs=path.join(dir,entry.name);
      const stat=fs.lstatSync(abs);
      fail(!stat.isSymbolicLink(),'COMPANION_LINK_REFUSED');
      if(entry.isDirectory()){
        fail(stat.isDirectory()&&(
          relative==='extensions'||relative==='extensions/chatgpt-companion'),
          'COMPANION_UNEXPECTED_DIRECTORY');
        walk(abs,relative+'/');
      } else {
        fail(entry.isFile()&&stat.isFile()&&stat.nlink===1,
          'COMPANION_FILE_TYPE_INVALID');
        if(relative==='source-manifest.json')continue;
        fail(names.has(relative)&&!found.has(relative),'COMPANION_EXTRA_FILE');
        const content=readRegular(abs,65536);
        fail(createHash('sha256').update(content).digest('hex')===receipt.files[relative],
          'COMPANION_FILE_SHA_MISMATCH');
        found.add(relative);checked++;
      }
    }
  }
  walk(root);
  fail(checked===receipt.count,'COMPANION_FILE_MISSING');
  const manifest=JSON.parse(readRegular(path.join(root,EXTENSION+'manifest.json'),65536));
  fail(manifest.manifest_version===3&&manifest.name==='Commander Chat Companion'
    &&JSON.stringify(manifest.permissions)===JSON.stringify(['storage'])
    &&JSON.stringify(manifest.host_permissions)===JSON.stringify(['http://127.0.0.1:41267/*'])
    &&manifest.background?.service_worker==='background.js',
    'COMPANION_UNEXPECTED_EXTENSION_PERMISSIONS');
  return Object.freeze({
    status:'COMPILED_COMPANION_HASH_PASS',commit:receipt.head,
    files:checked,coreBundleModified:false,
    installedBrowserEnabled:false,chatAuthenticationVerified:false
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),map=new Map();
    for(let i=0;i<args.length;i+=2){
      fail(i+1<args.length&&['--companion-root','--source-manifest','--expected-commit'].includes(args[i])
        &&!map.has(args[i]),'COMPANION_CLI_ARGUMENTS');
      map.set(args[i],args[i+1]);
    }
    fail(map.size===3,'COMPANION_CLI_REQUIRED');
    console.log(JSON.stringify(verifyCompiledCompanion({
      companionRoot:map.get('--companion-root'),
      sourceManifest:map.get('--source-manifest'),
      expectedCommit:map.get('--expected-commit')
    })));
  }catch(err){
    console.error(JSON.stringify({status:'COMPILED_COMPANION_HASH_FAIL',
      code:String(err?.message||err)}));
    process.exitCode=2;
  }
}
