'use strict';
// Shared native-runtime and compiled-package companion integrity contract.
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
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
function verifyCompanion({companionRoot,sourceManifest=null,expectedCommit,expectedTree=null}){
  fail(typeof companionRoot==='string'&&path.isAbsolute(companionRoot)&&
    (sourceManifest===null||(typeof sourceManifest==='string'&&path.isAbsolute(sourceManifest)))&&
    typeof expectedCommit==='string'&&SHA40.test(expectedCommit)&&
    (expectedTree===null||(typeof expectedTree==='string'&&SHA40.test(expectedTree))),
    'COMPANION_ARGUMENTS_INVALID');
  const root=path.resolve(companionRoot);
  const rootStat=fs.lstatSync(root);
  fail(rootStat.isDirectory()&&!rootStat.isSymbolicLink(),'COMPANION_ROOT_INVALID');
  const actualBytes=readRegular(path.join(root,'source-manifest.json'),32768);
  if(sourceManifest!==null)fail(actualBytes.equals(readRegular(sourceManifest,32768)),
    'COMPANION_MANIFEST_CHANGED');
  const receipt=JSON.parse(actualBytes.toString('utf8'));
  fail(receipt.schema===1&&receipt.kind==='COMMANDER_OPTIONAL_BROWSER_COMPANION'
    &&receipt.head===expectedCommit&&SHA40.test(receipt.tree)
    &&(expectedTree===null||receipt.tree===expectedTree)
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
  const exactKeys=(obj,keys)=>obj&&typeof obj==='object'&&!Array.isArray(obj)
    &&Object.keys(obj).length===keys.length&&keys.every(k=>Object.hasOwn(obj,k));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  fail(exactKeys(manifest,['manifest_version','name','version','description','permissions',
      'host_permissions','background','content_scripts','action'])
    &&manifest.manifest_version===3&&manifest.name==='Commander Chat Companion'
    &&typeof manifest.version==='string'&&/^\d+\.\d+\.\d+$/.test(manifest.version)
    &&typeof manifest.description==='string'
    &&same(manifest.permissions,['storage'])
    &&same(manifest.host_permissions,['http://127.0.0.1:41267/*'])
    &&exactKeys(manifest.background,['service_worker','type'])
    &&manifest.background.service_worker==='background.js'&&manifest.background.type==='module'
    &&Array.isArray(manifest.content_scripts)&&manifest.content_scripts.length===1
    &&exactKeys(manifest.content_scripts[0],['matches','js','run_at'])
    &&same(manifest.content_scripts[0].matches,['https://chatgpt.com/*','https://chat.openai.com/*'])
    &&same(manifest.content_scripts[0].js,['content.js'])
    &&manifest.content_scripts[0].run_at==='document_idle'
    &&exactKeys(manifest.action,['default_popup','default_title'])
    &&manifest.action.default_popup==='popup.html'
    &&manifest.action.default_title==='Commander Chat Companion',
    'COMPANION_UNEXPECTED_EXTENSION_PERMISSIONS');
  return Object.freeze({
    status:'COMPILED_COMPANION_HASH_PASS',commit:receipt.head,
    files:checked,coreBundleModified:false,
    installedBrowserEnabled:false,chatAuthenticationVerified:false
  });
}

// Local consistency check against the Core from the SAME package. Publisher
// authenticity is verified separately by the signed/attested installer gate.
function validateBundledCompanion(companionRoot,coreRoot){
  fail(typeof coreRoot==='string'&&path.isAbsolute(coreRoot),'COMPANION_CORE_ROOT_INVALID');
  const stat=fs.lstatSync(coreRoot);
  fail(stat.isDirectory()&&!stat.isSymbolicLink(),'COMPANION_CORE_ROOT_INVALID');
  const core=JSON.parse(readRegular(path.join(coreRoot,'source-manifest.json'),1024*1024));
  fail(core.schema===2&&typeof core.head==='string'&&SHA40.test(core.head)
    &&typeof core.tree==='string'&&SHA40.test(core.tree),'COMPANION_CORE_IDENTITY_INVALID');
  verifyCompanion({companionRoot,expectedCommit:core.head,expectedTree:core.tree});
  return path.join(companionRoot,'extensions','chatgpt-companion');
}
module.exports={verifyCompanion,validateBundledCompanion};
