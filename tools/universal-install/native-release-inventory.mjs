// File inventory only: no release approval, signing, installation or publishing.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {nativeV012ReleaseAssetSet} from './release-admission-0.12.mjs';

const deny=()=>{throw Error('RC012_NATIVE_RELEASE_INVENTORY_DENIED');};
export async function inspectNativeReleaseInventory({version,directory}={}){
 if(typeof version!=='string'||!/^0\.12\.(?:0|[1-9][0-9]*)$/.test(version)
    ||typeof directory!=='string'||!path.isAbsolute(directory))deny();
 const root=fs.lstatSync(directory);
 if(!root.isDirectory()||root.isSymbolicLink())deny();
 const entries=fs.readdirSync(directory,{withFileTypes:true});
 const names=['Remote-Commander-Unified-'+version+'-Windows-x64.exe',
              'Remote-Commander-Unified-'+version+'-Linux-amd64.deb'];
 if(entries.length!==names.length||entries.some(e=>!e.isFile()||e.isSymbolicLink()||!names.includes(e.name)))deny();
 const assets=[];
 for(const name of names){
  const filename=path.join(directory,name);
  const original=fs.lstatSync(filename);
  if(!original.isFile()||original.isSymbolicLink()||original.nlink!==1
     ||original.size<1024||original.size>1536*1024*1024)deny();
  const fd=fs.openSync(filename,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{
   const before=fs.fstatSync(fd);
   if(!before.isFile()||before.dev!==original.dev||before.ino!==original.ino
      ||before.size!==original.size||before.nlink!==1)deny();
   const hash=createHash('sha256');
   const buffer=Buffer.alloc(64*1024);
   let count=0;
   for(let n;(n=fs.readSync(fd,buffer,0,buffer.length,null))>0;){
    count+=n;if(count>before.size)deny();hash.update(buffer.subarray(0,n));
   }
   const after=fs.fstatSync(fd),linked=fs.lstatSync(filename);
   if(count!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs
      ||after.ctimeMs!==before.ctimeMs||linked.dev!==before.dev||linked.ino!==before.ino
      ||linked.nlink!==1||linked.isSymbolicLink())deny();
   assets.push({name,state:'uploaded',size:count,digest:'sha256:'+hash.digest('hex')});
  }finally{fs.closeSync(fd);}
 }
 const release={tag_name:'v'+version,assets};
 if(!nativeV012ReleaseAssetSet(release))deny();
 return {schema:'rc012-native-release-inventory-v1',version,...release,
   inventoryOnly:true,publicationApproved:false,provenanceVerified:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==4)deny();
  const result=await inspectNativeReleaseInventory({version:process.argv[2],directory:process.argv[3]});
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch(e){console.error('RC012_NATIVE_RELEASE_INVENTORY_DENIED');process.exitCode=2;}
}
