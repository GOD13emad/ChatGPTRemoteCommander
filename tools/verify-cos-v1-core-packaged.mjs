#!/usr/bin/env node
// Validate one internal V1 source component inside a genuine Electron unpacked artifact.
// No installation, runtime launch, auth, elevation or owner-profile modifications.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=s=>{throw Error('COS_V1_PACKAGED_'+s);}
const CO_S_ASAR_SHA=Object.freeze({
 linux:'dfd4bd642394f4d046b350652073812e0fc36f1e1ca3c4743fbefa1e812b2e0b',
 win32:'010f824c34499cbfeafc7067f1c44df3d00e15d5a1c998b9caf557c67eba64be'
});
const R18_MANIFEST_SHA='7512cbc77ed07281864355184da1db1a9d89c00321d50c77bf50b6216e2b9e2a';
function regular(f){
 const stat=fs.lstatSync(f);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)fail('NONREGULAR_ARTIFACT');
 return fs.readFileSync(f);
}
function verify(root){
 if(typeof root!=='string'||!path.isAbsolute(root))fail('ABSOLUTE_UNPACKED_ROOT_REQUIRED');
 const base=path.resolve(root);
 const names=process.platform==='win32'?['win-unpacked','Chat On Steroids']:['linux-unpacked','Chat On Steroids'];
 if(!names.includes(path.basename(base)))fail('UNPACKED_PLATFORM_ROOT_INVALID');
 const component=path.join(base,'resources','commander-v1-core');
 const stat=fs.lstatSync(component);
 if(!stat.isDirectory()||stat.isSymbolicLink())fail('COMPONENT_NOT_DIRECTORY');
 const manifest=regular(path.join(component,'MANIFEST.json'));
 const meta=JSON.parse(manifest.toString('utf8'));
 if(meta.schema!==1||meta.mode!=='QA_INTERNAL_NOT_ACTIVATED'||meta.sourceVersion!=='0.11.0-dev.23-capgap-qa'||
  !['d62c98fd122b3492aac678593f5181ba765820f8383b68c365487338501e0219',
    'dda3d17ebf62f16315f494a9160402cd8a040fba7f93400a3f9310565fc201ad'].includes(meta.serverSha)||
  meta.registrySha!=='23f0f7a18133b506fe7273920d91841b8fcbae7317e4b19e0684240b48a33683'||
  !Array.isArray(meta.files)||meta.files.length!==75)fail('MANIFEST_CONTRACT_INVALID');
 const unique=new Set();let total=0;
 for(const f of meta.files){
  if(!f||typeof f.file!=='string'||!(/^(?:package\.json|src\/[A-Za-z][A-Za-z0-9_.-]{1,95}\.mjs|src\/gui-libei-receiver\.c)$/.test(f.file))||
    unique.has(f.file)||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>600000||
    typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256))fail('MANIFEST_ENTRY_INVALID');
  unique.add(f.file);
  const full=path.join(component,...f.file.split('/'));
  const bytes=regular(full);
  if(bytes.length!==f.bytes||sha(bytes)!==f.sha256)fail('PACKED_SOURCE_FILE_CHANGED');
  total+=f.bytes;
 }
 if(total>3700000)fail('PACKED_SOURCE_TOO_LARGE');
 if(!unique.has('src/server-v0.3.mjs')||!unique.has('src/capability-gap-registry.mjs')||
   sha(regular(path.join(component,'src','server-v0.3.mjs')))!==meta.serverSha||
   sha(regular(path.join(component,'src','capability-gap-registry.mjs')))!==meta.registrySha)fail('REQUIRED_CORE_MODULE_MISSING');
 const asar=path.join(base,'resources','app.asar');
 if(sha(regular(asar))!==CO_S_ASAR_SHA[process.platform])fail('ELECTRON_APP_HASH_UNVERIFIED');
 const workspaceManifest=path.join(base,'resources','commander-v2-workspace','MANIFEST.json');
 if(sha(regular(workspaceManifest))!==R18_MANIFEST_SHA)fail('R18_MANIFEST_HASH_CHANGED');
 return {gate:'COS_V1_CORE_IN_ELECTRON_UNPACKED_QA_PASS',platform:process.platform,
   sourceFileCount:meta.files.length,totalSourceBytes:total,manifestSHA256:sha(manifest),
   v1ServerSHA256:meta.serverSha,backendComponent:'INERT_NOT_STARTED',
   electronAppPresent:true,asarSHA256:CO_S_ASAR_SHA[process.platform],workspaceManifestSHA256:R18_MANIFEST_SHA,installed:false,serviceMigrated:false,authVerified:false,
   nativeWorkerVerified:false,publisherSigned:false,oneHostInstallAcceptance:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(verify(process.argv[2])));}
 catch(e){console.error(String(e.message||e));process.exitCode=2;}
}
export {verify};
