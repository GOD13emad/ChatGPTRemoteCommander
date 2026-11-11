'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const sha256=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const expectDirectory=p=>{
  const s=fs.lstatSync(p);
  if(!s.isDirectory()||s.isSymbolicLink())throw Error('UNIFIED_PATH_NOT_DIRECTORY');
};
const safeTree=p=>{
  expectDirectory(p);
  for(const item of fs.readdirSync(p,{withFileTypes:true})){
    const at=path.join(p,item.name);
    if(item.isSymbolicLink())throw Error('UNIFIED_SYMLINK_REFUSED');
    if(item.isDirectory())safeTree(at);
    else if(!item.isFile())throw Error('UNIFIED_SPECIAL_FILE_REFUSED');
  }
};
function validateCore(coreDir){
  expectDirectory(coreDir);
  const m=JSON.parse(fs.readFileSync(path.join(coreDir,'source-manifest.json'),'utf8'));
  if(m.schema!==2 || !/^[a-f0-9]{40}$/.test(m.head||'') ||
      !/^[a-f0-9]{40}$/.test(m.tree||'') ||
      !Number.isInteger(m.count) || m.count<10 ||
      !m.files || typeof m.files!=='object' || Array.isArray(m.files))
    throw Error('UNIFIED_SOURCE_IDENTITY_INVALID');
  const fileNames=Object.keys(m.files);
  if(fileNames.length!==m.count ||
     !['src/server-v0.3.mjs','package.json','config.json'].every(f=>fileNames.includes(f)))
    throw Error('UNIFIED_SOURCE_MANIFEST_INCOMPLETE');
  const expected=new Set();
  for(const [rel,hash] of Object.entries(m.files)){
    if(typeof rel!=='string' || rel.includes('\\') ||
      rel.startsWith('/') || rel.split('/').some(x=>!x||x==='.'||x==='..') ||
      !/^[a-f0-9]{64}$/.test(hash))
      throw Error('UNIFIED_SOURCE_MANIFEST_INVALID');
    const p=path.join(coreDir,...rel.split('/'));
    const stat=fs.lstatSync(p);
    if(!stat.isFile() || stat.isSymbolicLink() || sha256(p)!==hash)
      throw Error('UNIFIED_SOURCE_HASH_MISMATCH '+rel);
    expected.add(rel);
  }
  function checkTree(dir,rel=''){
    for(const e of fs.readdirSync(dir,{withFileTypes:true})){
      const current=rel?rel+'/'+e.name:e.name;
      if(e.isSymbolicLink())throw Error('UNIFIED_CORE_SYMLINK '+current);
      if(!rel && current==='var'){
        if(!e.isDirectory())throw Error('UNIFIED_CORE_VAR_NOT_DIRECTORY');
        continue; // Core writes only runtime data here; never execute from this directory.
      }
      if(e.isDirectory())checkTree(path.join(dir,e.name),current);
      else if(e.isFile()){
        if(current==='source-manifest.json' || current==='.unified-source.json')continue;
        if(!expected.delete(current))throw Error('UNIFIED_CORE_UNEXPECTED_FILE '+current);
      }else throw Error('UNIFIED_CORE_SPECIAL '+current);
    }
  }
  checkTree(coreDir);
  if(expected.size)throw Error('UNIFIED_CORE_MISSING_FILES '+[...expected].slice(0,2).join(','));
  const pkg=JSON.parse(fs.readFileSync(path.join(coreDir,'package.json'),'utf8'));
  if(pkg.version!=='0.12.0-dev.1')throw Error('UNIFIED_SOURCE_VERSION_MISMATCH');
  return m;
}
function preparePreviewCore(source,userData){
  safeTree(source);
  const manifest=validateCore(source);
  fs.mkdirSync(userData,{recursive:true,mode:0o700});
  expectDirectory(userData);
  const parent=path.join(userData,'runtime');
  fs.mkdirSync(parent,{recursive:true,mode:0o700});
  expectDirectory(parent);
  const target=path.join(parent,'core');
  const marker=path.join(target,'.unified-source.json');
  if(fs.existsSync(target)){
    expectDirectory(target);
    const old=JSON.parse(fs.readFileSync(marker,'utf8'));
    if(old.head!==manifest.head||old.tree!==manifest.tree)
      throw Error('UNIFIED_CORE_DIFFERENT_SOURCE_REQUIRES_CONTROLLED_UPGRADE');
    validateCore(target);
    return {target,head:manifest.head,existing:true};
  }
  const tmp=path.join(parent,'.core-incoming-'+process.pid);
  if(fs.existsSync(tmp))throw Error('UNIFIED_STAGING_ALREADY_EXISTS');
  try{
    fs.cpSync(source,tmp,{recursive:true,force:false,errorOnExist:true});
    fs.writeFileSync(path.join(tmp,'.unified-source.json'),
      JSON.stringify({head:manifest.head,tree:manifest.tree})+'\n',{flag:'wx',mode:0o600});
    validateCore(tmp);
    fs.renameSync(tmp,target);
    return {target,head:manifest.head,existing:false};
  }catch(e){
    if(fs.existsSync(tmp))fs.rmSync(tmp,{recursive:true,force:true});
    throw e;
  }
}
function previewConfig(coreDir,userData,port){
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('UNIFIED_PREVIEW_PORT');
  const isolated=path.join(userData,'preview');
  fs.mkdirSync(isolated,{recursive:true,mode:0o700});
  const base=JSON.parse(fs.readFileSync(path.join(coreDir,'config.json'),'utf8'));
  base.host='127.0.0.1';base.port=port; base.allowedRoots=[isolated];
  base.allowedPrograms=[];base.autoUpdate={enabled:false};
  base.auditLog=path.join(isolated,'audit.jsonl');
  base.powerMode={enabled:false,fullFilesystem:false,allowShell:false,
    allowProcessControl:false,allowPermanentDelete:false,
    guiControl:{enabled:false},browserControl:{enabled:false}};
  base.capabilityProfile={tier:'STANDARD'};
  base.requireTrustedIngress=false;
  const file=path.join(isolated,'preview-config.json');
  fs.writeFileSync(file,JSON.stringify(base,null,2)+'\n',{mode:0o600});
  return {file,root:isolated};
}
module.exports={validateCore,preparePreviewCore,previewConfig};
