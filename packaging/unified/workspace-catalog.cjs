'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const invalid=()=>{throw Error('WORKSPACE_CATALOG_INVALID');};
function projectAddons(doc,platform){
  const os=platform==='win32'?'windows':platform==='linux'?'linux':null;
  const a=doc?.controlCenterAddons;
  if(!os||doc?.schema!==1||a?.schema!==1||a.surface!=='control-center'||
     a.defaultAutoInstall!==false||a.capability!=='DISCOVERY_ONLY_UNTIL_SIGNED_ARTIFACT_AND_OWNER_GRANT'||
     !Array.isArray(a.items)||a.items.length>64)invalid();
  const ids=new Set(),items=[];
  for(const x of a.items){
    if(!x||typeof x.id!=='string'||!/^[a-z][a-z0-9-]{1,48}$/.test(x.id)||ids.has(x.id)||
       typeof x.name!=='string'||x.name.length<1||x.name.length>100||/[\x00-\x1f\x7f]/.test(x.name)||
       x.admission!=='planned'||x.downloadDefault!==false||!Array.isArray(x.platforms)||
       x.platforms.length<1||x.platforms.length>2||new Set(x.platforms).size!==x.platforms.length||
       x.platforms.some(y=>!['windows','linux'].includes(y)))invalid();
    ids.add(x.id);
    items.push({id:x.id,name:x.name,state:'PLANNED',platformSupported:x.platforms.includes(os),installable:false});
  }
  return {readOnly:true,actionAuthorization:false,items};
}
function readCatalog(root,source,platform){
  const read=(name,max)=>{
    const file=path.join(root,name),st=fs.lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>max)invalid();
    const bytes=fs.readFileSync(file);
    if(bytes.length!==st.size)invalid();
    return bytes;
  };
  const receipt=JSON.parse(read('source.json',1024).toString('utf8'));
  const raw=read('products.json',16384);
  if(!/^[a-f0-9]{40}$/.test(source?.head??'')||!/^[a-f0-9]{40}$/.test(source?.tree??'')||
     receipt.head!==source.head||receipt.tree!==source.tree||
     receipt.sha256!==createHash('sha256').update(raw).digest('hex'))invalid();
  return projectAddons(JSON.parse(raw.toString('utf8')),platform);
}
module.exports={projectAddons,readCatalog};
