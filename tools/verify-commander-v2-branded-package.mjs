#!/usr/bin/env node
// Verify QA-only Commander V2 native package identity, UI and bundled V1 source; no install.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=k=>{throw Error('COMMANDER_V2_IDENTITY_QA_'+k)};
const ASAR={linux:'5d6b282b223544a660e690f6f87a4b5d3fff1712fffa94bdc92ef982f4ebd7ec',win32:'cc67f90c7780d46bc902c4f32a10f909ef2d77d5391b8af0eade474ac2d75ded'};
const MANIFEST={linux:'c6c64886301c427bae8b8934304eaf82ee6382fefc01aee8e013e0745c4f1306',win32:'aff379a6ffccbf6e0837d2dcf01415283b0a44205ce4aece6b19cfe914a4c923'};
const BUILDER={linux:'4fe769085de49247ae62ad8c8cc83b9b97a697aea689bb07ba481cf7289e5a62',win32:'70b7de6ca385091c1493b7ae0cb84bf308b188d8b88eda8acb0c8dfa516833c4'};
function read(f){const st=fs.lstatSync(f);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)fail('NONREGULAR_FILE');return fs.readFileSync(f)}
export function verify(target){
 if(typeof target!=='string'||!path.isAbsolute(target)||!Object.hasOwn(ASAR,process.platform))fail('PLATFORM');
 const unpacked=path.resolve(target);
 if(path.basename(unpacked)!==(process.platform==='win32'?'win-unpacked':'linux-unpacked')||path.basename(path.dirname(unpacked))!=='commander-v2-qa')fail('UNPACKED_QA_ROOT');
 const root=path.dirname(path.dirname(path.dirname(unpacked)));
 if(path.basename(root)!==(process.platform==='win32'?'official-cos-tag2150-sparse-20261104':'cos2150-unified-rebuild-20261104'))fail('VENDOR_QA_ROOT');
 if(read(path.join(root,'.commander-v2-isolated-qa')).toString()!=='V2_COS_DISPOSABLE_SOURCE_QA_ONLY\n')fail('NOT_QA');
 if(sha(read(path.join(root,'electron-builder.yml')))!==BUILDER[process.platform])fail('BUILDER_IDENTITY_CHANGED');
 const archive=path.join(unpacked,'resources','app.asar');
 const asarBytes=read(archive);
 if(sha(asarBytes)!==ASAR[process.platform])fail('ASAR_CHANGED');
 const asar=createRequire(path.join(root,'package.json'))('@electron/asar');
 const fromAsar=p=>asar.extractFile(archive,path.join(...p.split('/')));
 const pkg=JSON.parse(fromAsar('package.json').toString('utf8'));
 if(pkg.name!=='chat-on-steroids'||pkg.version!=='2.1.50'||pkg.productName!=='Commander V2'||pkg.desktopName!=='io.github.god13emad.commanderv2.desktop')fail('PACKAGE_IDENTITY_INVALID');
 const html=fromAsar('out/renderer/index.html').toString('utf8');
 const main=fromAsar('out/main/index.js').toString('utf8');
 if(!html.includes('<title>Commander V2</title>')||!main.includes('Commander V2'))fail('COMPILED_GUI_BRAND_INVALID');
 const v1=path.join(unpacked,'resources','commander-v1-core'),v1bytes=read(path.join(v1,'MANIFEST.json'));
 if(sha(v1bytes)!==MANIFEST[process.platform])fail('V1_MANIFEST_CHANGED');
 const vm=JSON.parse(v1bytes);
 if(vm.mode!=='QA_INTERNAL_NOT_ACTIVATED'||!Array.isArray(vm.files)||vm.files.length!==75)fail('V1_NOT_ISOLATED');
 const seen=new Set();
 for(const f of vm.files){
  if(!f||typeof f.file!=='string'||!(/^(?:package\.json|src\/[A-Za-z][A-Za-z0-9_.-]{1,95}\.mjs|src\/gui-libei-receiver\.c)$/.test(f.file))||
     seen.has(f.file)||!/^[0-9a-f]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<0)fail('V1_ENTRY_INVALID');
  seen.add(f.file);
  const data=read(path.join(v1,...f.file.split('/')));
  if(data.length!==f.bytes||sha(data)!==f.sha256)fail('V1_BYTES_CHANGED');
 }
 if(sha(read(path.join(unpacked,'resources','commander-v2-workspace','MANIFEST.json')))!=='7512cbc77ed07281864355184da1db1a9d89c00321d50c77bf50b6216e2b9e2a')fail('WORKSPACE_MANIFEST_INVALID');
 const binary=path.join(unpacked,process.platform==='win32'?'Commander V2.exe':'commander-v2');
 const executable=fs.lstatSync(binary);if(!executable.isFile()||executable.isSymbolicLink())fail('EXECUTABLE_MISSING');
 return {gate:'COMMANDER_V2_BRANDED_NATIVE_QA_PASS',platform:process.platform,displayName:'Commander V2',originalFrameworkVersion:pkg.version,
   asarSHA256:ASAR[process.platform],v1Files:seen.size,upstreamCoSProvenancePreserved:true,installed:false,
   v1RuntimeActivated:false,accountAuthenticated:false,workerEffectsVerified:false,signedRelease:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(verify(process.argv[2])));}
 catch(e){console.error(String(e.message||e));process.exitCode=2;}
}
