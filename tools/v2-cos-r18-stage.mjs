// One-shot, pinned, rollbackable source-level CoS + Commander V2 R18 QA integration.
// Acts only on explicit isolated CoS tag checkout. Does not modify V1 or publish.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {fileURLToPath} from 'node:url';

const self=path.dirname(fileURLToPath(import.meta.url));
const exactTag='11f7e92db9be74701c8b9c0f890280b206814846';
const indexPin='7e2353eafa61952f29826a70bd88948e19fdbe1fd72acd4c7635ae9c5be790a2';
const builderPins=new Set([
  '490d103a6ca56c8febd4a19ec6d40fe3d09f8f43be550703d91d947e9ad1451d', // Linux QA staged afterPack
  '3894903ddebe33e56ea58bc90a219382616e12a373ef8ee409179ac00f1eac11'  // Windows QA pristine tag
]);
const r18ManifestPin='482d922e31f2a6caf71b9c7829fab58affe473c59237b432884d5c186db7631b';
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=k=>{throw Error('V2_COS_R18_STAGE_'+k);};
const exactReplace=(s,needle,replacement)=>{
  if(s.split(needle).length!==2)fail('ANCHOR_MISMATCH');
  return s.replace(needle,replacement);
};
export function stageIntegratedCoS(target, bundle, options={}) {
  if(typeof target!=='string'||!path.isAbsolute(target)||typeof bundle!=='string'||!path.isAbsolute(bundle))
    fail('ABSOLUTE_PATHS_REQUIRED');
  const home=path.resolve(target), source=path.resolve(bundle);
  if(home===source)fail('SOURCE_TARGET_COLLISION');
  const packageFile=path.join(home,'package.json');
  const marker=path.join(home,'.commander-v2-isolated-qa');
  const sourceManifest=path.join(source,'MANIFEST.json');
  const index=path.join(home,'src/main/index.ts');
  const builder=path.join(home,'electron-builder.yml');
  const adapter=path.join(home,'src/main/commander-v2-center.ts');
  const resources=path.join(home,'resources/commander-v2-workspace');
  const moduleSource=path.join(options.sourceRoot||self,'v2-cos-r18-center.ts');
  for(const file of [packageFile,marker,index,builder,sourceManifest,moduleSource]){
    if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink()||!fs.lstatSync(file).isFile())fail('INPUT_INVALID');
  }
  for(const folder of [home,source,path.dirname(adapter),path.dirname(resources)]){
    if(!fs.existsSync(folder)||fs.lstatSync(folder).isSymbolicLink()||!fs.lstatSync(folder).isDirectory())fail('ROOT_INVALID');
  }
  if(fs.readFileSync(marker,'utf8')!=='V2_COS_DISPOSABLE_SOURCE_QA_ONLY\n')fail('QA_MARKER_REQUIRED');
  const git=spawnSync('git',['-C',home,'rev-parse','HEAD'],{encoding:'utf8',timeout:5000});
  if(git.status!==0||git.stdout.trim()!==exactTag)fail('OFFICIAL_TAG_NOT_PINNED');
  const pkg=JSON.parse(fs.readFileSync(packageFile,'utf8'));
  if(pkg.name!=='chat-on-steroids'||pkg.version!=='2.1.50')fail('VERSION_INVALID');
  if(fs.existsSync(adapter)||fs.existsSync(resources))fail('ALREADY_INTEGRATED_REFUSE');
  const indexBytes=fs.readFileSync(index),builderBytes=fs.readFileSync(builder);
  if(digest(indexBytes)!==indexPin||!builderPins.has(digest(builderBytes)))fail('TARGET_CHANGED_REFUSE');
  const manifestBytes=fs.readFileSync(sourceManifest);
  if(digest(manifestBytes)!==r18ManifestPin)fail('R18_MANIFEST_NOT_ACCEPTED');
  const manifest=JSON.parse(manifestBytes.toString('utf8'));
  if(manifest.mode!=='LOCAL_GUI_PREVIEW_NO_PROMOTION'||manifest.files.length!==21)fail('NOT_ACCEPTED_R18');
  const set=new Set(manifest.files.map(f=>f.path));
  if(set.size!==21||!set.has('server.mjs')||!set.has('index.html')||
     !set.has('app.js')||!set.has('local-model-evidence.mjs'))fail('R18_RUNTIME_MISSING');
  const files=[];
  for(const f of manifest.files){
    if(!f||typeof f.path!=='string'||!/^[a-zA-Z0-9][\w.-]+$/.test(f.path)||!Number.isInteger(f.bytes)||f.bytes<0||
       !/^[a-f0-9]{64}$/.test(f.sha256))fail('MANIFEST_ENTRY_INVALID');
    const full=path.join(source,f.path);
    if(!fs.existsSync(full)||fs.lstatSync(full).isSymbolicLink()||!fs.lstatSync(full).isFile())fail('R18_SOURCE_FILE_INVALID');
    const bytes=fs.readFileSync(full);
    if(bytes.length!==f.bytes||digest(bytes)!==f.sha256)fail('R18_SOURCE_FILE_HASH_CHANGED');
    files.push({name:f.path,bytes});
  }
  const oldIndex=indexBytes.toString('utf8');
  let nextIndex=exactReplace(oldIndex,
    "import { closeRemoteSessions } from './remote/ssh.js';",
    "import { closeRemoteSessions } from './remote/ssh.js';\nimport { createCommanderV2Center } from './commander-v2-center.js';");
  nextIndex=exactReplace(nextIndex,
    'const windowActivation = createWindowActivationGate(showWindow);',
    'const windowActivation = createWindowActivationGate(showWindow);\nconst commanderV2Center = createCommanderV2Center({resourcesPath:process.resourcesPath,BrowserWindowClass:BrowserWindow});');
  nextIndex=exactReplace(nextIndex,
    "{ label: mainText('Open'), click: windowActivation.request },",
    "{ label: mainText('Open'), click: windowActivation.request },\n      ...(commanderV2Center.available() ? [{label:'Commander V2 Control Center (read-only)',\n        click: () => void commanderV2Center.open().catch(error => logWarn('V2 Control Center: '+String(error)))}] : []),");
  nextIndex=exactReplace(nextIndex,
    "app.on('before-quit', () => {",
    "app.on('before-quit', () => {\n  void commanderV2Center.close().catch(error => logWarn('V2 Control Center close: '+String(error)));");
  const oldBuilder=builderBytes.toString('utf8');
  const nextBuilder=exactReplace(oldBuilder,
    '  - from: LICENSE\n    to: LICENSE',
    '  - from: LICENSE\n    to: LICENSE\n  - from: resources/commander-v2-workspace\n    to: commander-v2-workspace\n    filter:\n      - \"**/*\"');

  const runtimeTemp=path.join(home,'resources','.commander-v2-workspace-stage-'+process.pid);
  const adapterTemp=adapter+'.r18-stage-'+process.pid;
  const indexTemp=index+'.r18-stage-'+process.pid;
  const builderTemp=builder+'.r18-stage-'+process.pid;
  const names=[runtimeTemp,adapterTemp,indexTemp,builderTemp];
  for(const f of names)if(fs.existsSync(f))fail('TEMP_COLLISION');
  let wroteIndex=false,wroteBuilder=false,addedRuntime=false,addedAdapter=false;
  try {
    fs.mkdirSync(runtimeTemp,{mode:0o700});
    for(const f of files)fs.writeFileSync(path.join(runtimeTemp,f.name),f.bytes,{flag:'wx',mode:0o644});
    fs.writeFileSync(path.join(runtimeTemp,'MANIFEST.json'),manifestBytes,{flag:'wx',mode:0o644});
    fs.writeFileSync(adapterTemp,fs.readFileSync(moduleSource),{flag:'wx',mode:0o644});
    fs.writeFileSync(indexTemp,nextIndex,{flag:'wx'});
    fs.writeFileSync(builderTemp,nextBuilder,{flag:'wx'});
    if(digest(fs.readFileSync(index))!==indexPin||!builderPins.has(digest(fs.readFileSync(builder))))
      fail('CONCURRENT_TARGET_CHANGE');
    fs.renameSync(runtimeTemp,resources);addedRuntime=true;
    fs.renameSync(adapterTemp,adapter);addedAdapter=true;
    fs.renameSync(indexTemp,index);wroteIndex=true;
    fs.renameSync(builderTemp,builder);wroteBuilder=true;
    return {status:'V2_R18_BUNDLED_IN_COS_TAG_QA',runtimeFiles:22,manifestSHA256:r18ManifestPin,
      indexSHA256:digest(Buffer.from(nextIndex)),builderSHA256:digest(Buffer.from(nextBuilder))};
  }catch(error){
    if(wroteBuilder)fs.writeFileSync(builder,builderBytes);
    if(wroteIndex)fs.writeFileSync(index,indexBytes);
    if(addedAdapter)fs.rmSync(adapter,{force:true});
    if(addedRuntime)fs.rmSync(resources,{recursive:true,force:true});
    throw error;
  }finally{
    for(const f of [adapterTemp,indexTemp,builderTemp])try{fs.rmSync(f,{force:true});}catch{}
    try{fs.rmSync(runtimeTemp,{recursive:true,force:true});}catch{}
  }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {process.stdout.write(JSON.stringify(stageIntegratedCoS(process.argv[2],process.argv[3]))+'\n');}
  catch(error){process.stderr.write(String(error instanceof Error ? error.message : error)+'\n');process.exitCode=2;}
}
