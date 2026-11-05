#!/usr/bin/env node
// Verify QA-only Commander V2 native package identity, UI and bundled V1 source; no install.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=k=>{throw Error('COMMANDER_V2_IDENTITY_QA_'+k)};
const ASAR={
  'commander-v2-qa':{linux:'5d6b282b223544a660e690f6f87a4b5d3fff1712fffa94bdc92ef982f4ebd7ec',win32:'cc67f90c7780d46bc902c4f32a10f909ef2d77d5391b8af0eade474ac2d75ded'},
  'commander-v2-supervised-qa':{linux:'a5375df381e051998c2f3d35dbc5ca5069cf81f4a26ecb4ea34a1ec1a0116ce1',win32:'ad2b3bc6e7cd409ff006e31b31802e30d4f5e71eb6daa155dff41e07c92a534d'},
  'commander-v2-authqa':{linux:'c3eee5b8c41b96ff95d666113799f472ada8edf6fcc7fd009a28b71e860c6724',win32:'307720af01d9a0fb2602f97a5aa28c49092b9c3e919e8b9a6a01ff9b85034e0b'}
};
const MANIFEST={
  'commander-v2-qa':{linux:'c6c64886301c427bae8b8934304eaf82ee6382fefc01aee8e013e0745c4f1306',win32:'aff379a6ffccbf6e0837d2dcf01415283b0a44205ce4aece6b19cfe914a4c923'},
  'commander-v2-supervised-qa':{linux:'c6c64886301c427bae8b8934304eaf82ee6382fefc01aee8e013e0745c4f1306',win32:'aff379a6ffccbf6e0837d2dcf01415283b0a44205ce4aece6b19cfe914a4c923'},
  'commander-v2-authqa':{linux:'45f141302e19728d7ee2eb4898c5fa35d1b99889ef6707760fd079dda7771842',win32:'f91097d773bb754cba34900d8f44609555b1936a510e55af9ee933cd4f7d239a'}
};
const BUILDER={linux:'33098915e57cdb9e206444cbae611b647b6a5e912cd2706e9a5a466cffec34b6',win32:'47d6693cb1f99bc946b63bf7f7b8a4bef041d6145cbc6cf3dcf23f60f698379f'};
const NATIVE_DEB_PRERM=Object.freeze({
 builder:'9abdbeaf5d1c8c9c263142311d5ee36ca79c93e09d6575e0429186a6af62e365',
 hook:'a2fb497525e7383e82b2040c455caf04fe15adfcd13bdb86502a82332a7e3b82'
});
function read(f){const st=fs.lstatSync(f);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)fail('NONREGULAR_FILE');return fs.readFileSync(f)}
export function verify(target){
 if(typeof target!=='string'||!path.isAbsolute(target)||!['linux','win32'].includes(process.platform))fail('PLATFORM');
 const unpacked=path.resolve(target);
 const output=path.basename(path.dirname(unpacked));
 if(path.basename(unpacked)!==(process.platform==='win32'?'win-unpacked':'linux-unpacked')||!Object.hasOwn(ASAR,output))fail('UNPACKED_QA_ROOT');
 const expectedAsar=ASAR[output][process.platform];
 const authGated=output==='commander-v2-authqa';
 const supervised=output!=='commander-v2-qa';
 const root=path.dirname(path.dirname(path.dirname(unpacked)));
 if(path.basename(root)!==(process.platform==='win32'?'official-cos-tag2150-sparse-20261104':'cos2150-unified-rebuild-20261104'))fail('VENDOR_QA_ROOT');
 if(read(path.join(root,'.commander-v2-isolated-qa')).toString()!=='V2_COS_DISPOSABLE_SOURCE_QA_ONLY\n')fail('NOT_QA');
 // Existing published QA native payloads remain pinned to their original
 // ASAR/manifest hashes; a newer, separately staged DEB build configuration is
 // accepted only if BOTH the precise builder SHA and exact maintainer hook match.
 const builderBytes=read(path.join(root,'electron-builder.yml'));
 const builderHash=sha(builderBytes);
 const nativeDebPrermStaged=process.platform==='linux'&&builderHash===NATIVE_DEB_PRERM.builder;
 if(builderHash!==BUILDER[process.platform]&&!nativeDebPrermStaged)fail('BUILDER_IDENTITY_CHANGED');
 if(nativeDebPrermStaged&&
    sha(read(path.join(root,'build','v2-deb-alternatives-prerm.sh')))!==NATIVE_DEB_PRERM.hook)
  fail('DEB_PRERM_HOOK_CHANGED');
 const yml=builderBytes.toString('utf8');
 if(nativeDebPrermStaged&&
    !yml.includes('--before-remove=build/v2-deb-alternatives-prerm.sh'))
  fail('DEB_PRERM_FPM_FLAG_MISSING');
 const acl=read(path.join(root,'scripts','windows-installer-acl.nsh')).toString('utf8');
 if(!yml.includes('  shortcutName: Commander V2')||!yml.includes('  uninstallDisplayName: Commander V2')||
    acl.includes('Chat On Steroids')||!acl.includes('Commander V2'))fail('NSIS_UI_IDENTITY_CHANGED');
 const archive=path.join(unpacked,'resources','app.asar');
 const asarBytes=read(archive);
 if(sha(asarBytes)!==expectedAsar)fail('ASAR_CHANGED');
 const asar=createRequire(path.join(root,'package.json'))('@electron/asar');
 const fromAsar=p=>asar.extractFile(archive,path.join(...p.split('/')));
 const pkg=JSON.parse(fromAsar('package.json').toString('utf8'));
 if(pkg.name!=='chat-on-steroids'||pkg.version!=='2.1.50'||pkg.productName!=='Commander V2'||pkg.desktopName!=='io.github.god13emad.commanderv2.desktop')fail('PACKAGE_IDENTITY_INVALID');
 const html=fromAsar('out/renderer/index.html').toString('utf8');
 const main=fromAsar('out/main/index.js').toString('utf8');
 if(!html.includes('<title>Commander V2</title>')||!main.includes('Commander V2'))fail('COMPILED_GUI_BRAND_INVALID');
 if(supervised){
  const supervisorSourceSHA=sha(read(path.join(root,'.commander-v2-core-supervisor-qa-backup','MANIFEST.json')));
  if(authGated?supervisorSourceSHA!=='b394f8b4bff77983cd26737be513ca67a3241b696129a43e66fc7289dc3c115d':
   !['169d1cb357b9939f1e4b97cb99c41b43d7e1f7650e6df58edea47d53214e280b','b394f8b4bff77983cd26737be513ca67a3241b696129a43e66fc7289dc3c115d'].includes(supervisorSourceSHA))
   fail('SUPERVISOR_SOURCE_MANIFEST_CHANGED');
  if(!main.includes('embedded V1 Core QA state: ')||!main.includes('--commander-v2-core-qa')||
     !main.includes('COMMANDER_V2_EMBEDDED_CORE_QA')||!main.includes('EXPLICIT_ISOLATED_QA'))fail('SUPERVISOR_NOT_COMPILED_OR_NOT_GATED');
 }
 const v1=path.join(unpacked,'resources','commander-v1-core'),v1bytes=read(path.join(v1,'MANIFEST.json'));
 if(sha(v1bytes)!==MANIFEST[output][process.platform])fail('V1_MANIFEST_CHANGED');
 const vm=JSON.parse(v1bytes);
 if(vm.mode!=='QA_INTERNAL_NOT_ACTIVATED'||!Array.isArray(vm.files)||vm.files.length!==75||
   (authGated?vm.qaTransportAuth!=='QA_EPHEMERAL_PROCESS_BEARER_NOT_OWNER_LOGIN':vm.qaTransportAuth!==undefined))fail('V1_NOT_ISOLATED');
 const seen=new Set();
 for(const f of vm.files){
  if(!f||typeof f.file!=='string'||!(/^(?:package\.json|src\/[A-Za-z][A-Za-z0-9_.-]{1,95}\.mjs|src\/gui-libei-receiver\.c)$/.test(f.file))||
     seen.has(f.file)||!/^[0-9a-f]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<0)fail('V1_ENTRY_INVALID');
  seen.add(f.file);
  const data=read(path.join(v1,...f.file.split('/')));
  if(data.length!==f.bytes||sha(data)!==f.sha256)fail('V1_BYTES_CHANGED');
 }
 if(authGated){
  const source=path.join(root,'resources','commander-v1-core');
  if(sha(read(path.join(source,'MANIFEST.json')))!==MANIFEST[output][process.platform]||
     !main.includes('COMMANDER_V2_QA_MCP_SECRET'))fail('AUTH_CONTROLLER_OR_SOURCE_MISSING');
 }
 if(sha(read(path.join(unpacked,'resources','commander-v2-workspace','MANIFEST.json')))!=='7512cbc77ed07281864355184da1db1a9d89c00321d50c77bf50b6216e2b9e2a')fail('WORKSPACE_MANIFEST_INVALID');
 const binary=path.join(unpacked,process.platform==='win32'?'Commander V2.exe':'commander-v2');
 const executable=fs.lstatSync(binary);if(!executable.isFile()||executable.isSymbolicLink())fail('EXECUTABLE_MISSING');
 return {gate:'COMMANDER_V2_BRANDED_NATIVE_QA_PASS',platform:process.platform,displayName:'Commander V2',originalFrameworkVersion:pkg.version,
   asarSHA256:expectedAsar,v1Files:seen.size,supervisorCompiled:supervised,supervisorAutoEnabled:false,
   coreMcpProcessCapabilityAuth:authGated,ownerAccountAuthVerified:false,upstreamCoSProvenancePreserved:true,installed:false,
   v1RuntimeActivated:false,accountAuthenticated:false,workerEffectsVerified:false,signedRelease:false,
   nativeDebPrermStaged};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(verify(process.argv[2])));}
 catch(e){console.error(String(e.message||e));process.exitCode=2;}
}
