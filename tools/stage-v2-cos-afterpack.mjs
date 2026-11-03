// Stages a source-level CoS 2.1.50 afterPack overlay in an EXPLICIT isolated checkout.
// No installation, no publish, no V1 edit, and never touches users' browser profiles.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const fail=message=>{throw Error('V2_COS_STAGE_'+message);};
const OFFICIAL=Object.freeze({
  'package.json':'b105d426bc3bd8e5e86ebd11a2bb6d06d72c391b',
  'electron-builder.yml':'407e1742971e75891afd2b1369eb986684dfe404',
  'scripts/afterpack-macos-adhoc-seal.mjs':'670d321575f409645410db59c38cba0c70dae1d0'
});
const gitBlob=file=>{const bytes=fs.readFileSync(file);return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');};
export function stageCoSAfterPack(target,{sourceRoot=root,expectedBlobs=OFFICIAL}={}) {
  if(typeof target!=='string'||!path.isAbsolute(target))fail('ABSOLUTE_TARGET_REQUIRED');
  const full=path.resolve(target);
  const yml=path.join(full,'electron-builder.yml');
  const pkg=path.join(full,'package.json');
  const marker=path.join(full,'.commander-v2-isolated-qa');
  const mac=path.join(full,'scripts','afterpack-macos-adhoc-seal.mjs');
  const wrapper=path.join(full,'scripts','commander-v2-afterpack.mjs');
  const hook=path.join(full,'scripts','v2-cos-linux-afterpack.mjs');
  for (const file of [full,path.join(full,'scripts'),pkg,yml,mac]){
    if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink())fail('SOURCE_LAYOUT_INVALID');
  }
  if(!fs.statSync(full).isDirectory())fail('SOURCE_LAYOUT_INVALID');
  if(!fs.existsSync(marker)||fs.lstatSync(marker).isSymbolicLink()||
     !fs.lstatSync(marker).isFile()||fs.readFileSync(marker,'utf8')!=='V2_COS_DISPOSABLE_SOURCE_QA_ONLY\n')
    fail('ISOLATED_QA_MARKER_REQUIRED');
  if(!expectedBlobs||typeof expectedBlobs!=='object'||Array.isArray(expectedBlobs))fail('BLOBS_INVALID');
  for(const [name,pin]of Object.entries(expectedBlobs)){
    if(!Object.hasOwn(OFFICIAL,name)||typeof pin!=='string'||!(/^[a-f0-9]{40}$/.test(pin))||
       gitBlob(path.join(full,name))!==pin)fail('UPSTREAM_SOURCE_PIN_MISMATCH');
  }
  if(Object.keys(expectedBlobs).length!==Object.keys(OFFICIAL).length)fail('BLOBS_INCOMPLETE');
  const meta=JSON.parse(fs.readFileSync(pkg,'utf8'));
  if(meta.name!=='chat-on-steroids'||meta.version!=='2.1.50')fail('VERSION_PIN_INVALID');
  const before=fs.readFileSync(yml,'utf8');
  const needle='afterPack: scripts/afterpack-macos-adhoc-seal.mjs';
  if(before.split(needle).length!==2)fail('ORIGINAL_HOOK_MISMATCH');
  for(const file of [wrapper,hook])if(fs.existsSync(file))fail('OVERLAY_ALREADY_PRESENT');
  if(!fs.existsSync(path.join(sourceRoot,'v2-cos-afterpack-chain.mjs'))||
     !fs.existsSync(path.join(sourceRoot,'v2-cos-linux-afterpack.mjs')))
    fail('OVERLAY_SOURCE_MISSING');
  // Preflight owned, regular files; staging deliberately targets disposable source copies.
  for(const file of [pkg,yml,mac]){
    const st=fs.lstatSync(file);
    if(!st.isFile()||st.nlink!==1||(process.getuid&&st.uid!==process.getuid()))fail('SOURCE_OWNER_INVALID');
  }
  const temp=yml+'.v2-stage-'+process.pid;
  if(fs.existsSync(temp))fail('STAGE_TEMP_EXISTS');
  try{
    fs.copyFileSync(path.join(sourceRoot,'v2-cos-afterpack-chain.mjs'),wrapper,fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(path.join(sourceRoot,'v2-cos-linux-afterpack.mjs'),hook,fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(temp,before.replace(needle,'afterPack: scripts/commander-v2-afterpack.mjs'),{flag:'wx'});
    fs.renameSync(temp,yml);
  }catch(err){
    if(fs.existsSync(temp))fs.unlinkSync(temp);
    for(const file of [hook,wrapper])if(fs.existsSync(file))fs.unlinkSync(file);
    throw err;
  }
  return Object.freeze({status:'SOURCE_OVERLAY_STAGED_NOT_BUILT',version:meta.version,originalMacHookRetained:true,linuxHook:hook});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=stageCoSAfterPack(process.argv[2]);process.stdout.write(JSON.stringify(result)+'\n');}
  catch(err){process.stderr.write((String(err?.message||'').startsWith('V2_COS_STAGE_')?err.message:'V2_COS_STAGE_FAILED')+'\n');process.exitCode=2;}
}
