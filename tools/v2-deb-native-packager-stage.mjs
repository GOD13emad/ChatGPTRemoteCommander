#!/usr/bin/env node
// Pinned, owner-local QA packaging integration. Not a public release or V1 migration.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(new Error('V2_DEB_PRERM_'+code),{code})};
export const PINS=Object.freeze({
 builderOld:'33098915e57cdb9e206444cbae611b647b6a5e912cd2706e9a5a466cffec34b6',
 hook:'a2fb497525e7383e82b2040c455caf04fe15adfcd13bdb86502a82332a7e3b82'
});
const oldAnchor='deb:\n  packageName: commander-v2\n  depends:';
const addition='  fpm:\n    - "--before-remove=build/v2-deb-alternatives-prerm.sh"\n';
const newAnchor='deb:\n  packageName: commander-v2\n'+addition+'  depends:';
export function patchDebAnchor(yml){
 if(typeof yml!=='string'||yml.split(oldAnchor).length!==2||
    yml.includes('--before-remove='))
  fail('ANCHOR_CHANGED');
 return yml.replace(oldAnchor,newAnchor);
}
export function patchYaml(yml){
 if(typeof yml!=='string'||sha(Buffer.from(yml))!==PINS.builderOld)
  fail('BASELINE_CHANGED');
 return patchDebAnchor(yml);
}
function owned(p){
 const s=fs.lstatSync(p);
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||
   (typeof process.getuid==='function'&&s.uid!==process.getuid()))fail('UNTRUSTED_FILE');
 return fs.readFileSync(p);
}
function noAliasedParents(p){
 let a=path.parse(p).root;
 for(const part of p.slice(a.length).split(path.sep).filter(Boolean)){
  a=path.join(a,part);
  if(fs.existsSync(a)&&fs.lstatSync(a).isSymbolicLink())fail('ALIASED_PATH');
 }
}
function context(){
 if(process.platform!=='linux')fail('LINUX_OWNER_QA_ONLY');
 const root=path.join(os.homedir(),'.local','state','CommanderV2','QA',
  'cos2150-unified-rebuild-20261104');
 noAliasedParents(root);
 const marker=owned(path.join(root,'.commander-v2-isolated-qa'));
 if(marker.toString('utf8')!=='V2_COS_DISPOSABLE_SOURCE_QA_ONLY\n')
  fail('OWNER_QA_MARKER_INVALID');
 const product=JSON.parse(owned(path.join(root,'package.json')).toString('utf8'));
 if(product.version!=='2.1.50'||product.productName!=='Commander V2')
  fail('NATIVE_PRODUCT_CHANGED');
 const canonicalRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const src=path.join(canonicalRoot,'tools','v2-deb-alternatives-prerm.sh');
 noAliasedParents(src);
 const hook=owned(src);
 if(sha(hook)!==PINS.hook)fail('CANONICAL_HOOK_CHANGED');
 const builder=path.join(root,'electron-builder.yml');
 const dest=path.join(root,'build','v2-deb-alternatives-prerm.sh');
 noAliasedParents(dest);
 return {root,builder,dest,hook};
}
function validate({builder,dest,hook}){
 const bytes=owned(builder);
 const yml=bytes.toString('utf8');
 if(yml.split(newAnchor).length!==2||
    sha(Buffer.from(yml.replace(newAnchor,oldAnchor)))!==PINS.builderOld)
  fail('BUILDER_NOT_PINNED');
 if(sha(owned(dest))!==sha(hook))fail('STAGED_HOOK_SHA_CHANGED');
 return Object.freeze({
  gate:'V2_NATIVE_DEB_FPM_PRERM_SOURCE_STAGED',
  builderSha256:sha(bytes),hookSha256:sha(hook),
  nativePackageBuilt:false,installedOwnerChanged:false
 });
}
export function stage({apply=false}={}){
 const ctx=context();
 const {builder,dest,root,hook}=ctx;
 const before=owned(builder);
 if(before.toString('utf8').includes(newAnchor))
  return validate(ctx);
 if(!apply)fail('STAGE_NOT_APPLIED');
 if(sha(before)!==PINS.builderOld||fs.existsSync(dest))
  fail('BASELINE_OR_DESTINATION_CHANGED');
 const updated=Buffer.from(patchYaml(before.toString('utf8')),'utf8');
 const tmp=builder+'.v2-prerm-stage-tmp';
 const lock=path.join(root,'build','.v2-prerm-stage.lock');
 if(fs.existsSync(tmp))fail('INCOMPLETE_STAGE_PRESENT');
 let fd,placed=false,renamed=false;
 try{
  fd=fs.openSync(lock,'wx',0o600);
  fs.writeFileSync(fd,'owner-private staging\n');fs.fsyncSync(fd);
  // Exclusive, no-clobber hook copy. The QA owner tree remains the sole writer.
  const hookfd=fs.openSync(dest,'wx',0o755);
  placed=true;
  try{fs.writeFileSync(hookfd,hook);fs.fchmodSync(hookfd,0o755);fs.fsyncSync(hookfd)}
  finally{fs.closeSync(hookfd)}
  const tmpfd=fs.openSync(tmp,'wx',0o600);
  try{fs.writeFileSync(tmpfd,updated);fs.fsyncSync(tmpfd)}
  finally{fs.closeSync(tmpfd)}
  if(sha(owned(builder))!==PINS.builderOld)fail('CONCURRENT_BUILDER_CHANGE');
  fs.renameSync(tmp,builder);renamed=true;
  return validate(ctx);
 }catch(e){
  if(renamed&&fs.existsSync(builder)&&sha(owned(builder))===sha(updated)){
   const rollback=builder+'.v2-prerm-revert-tmp';
   const rollbackFd=fs.openSync(rollback,'wx',0o600);
   try{fs.writeFileSync(rollbackFd,before);fs.fsyncSync(rollbackFd)}
   finally{fs.closeSync(rollbackFd)}
   fs.renameSync(rollback,builder);
  }
  if(placed&&fs.existsSync(dest)&&sha(owned(dest))===PINS.hook)
   fs.unlinkSync(dest);
  throw e;
 }finally{
  if(fs.existsSync(tmp))fs.unlinkSync(tmp);
  if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lock)}
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3||!['--verify','--apply'].includes(process.argv[2]))
   fail('EXPLICIT_MODE_REQUIRED');
  console.log(JSON.stringify(stage({apply:process.argv[2]==='--apply'})));
 }catch(e){console.error(String(e?.message||'V2_DEB_PRERM_STAGE_FAILED'));process.exitCode=2}
}
