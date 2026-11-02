#!/usr/bin/env node
// Keep the Git-fetched release self-contained: Git excludes the platform binary.
// Fail closed unless the installed executable matches the pinned installer receipt.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

function fail(code){throw Error('STAGE_PINNED_TUNNEL_'+code)}
function parse(argv){
  const o={};
  for(let i=0;i<argv.length;i+=2){
    const k=argv[i],v=argv[i+1];
    if(!v)fail('ARGUMENT');
    if(k==='--install-root')o.install=path.resolve(v);
    else if(k==='--stage-root')o.stage=path.resolve(v);
    else fail('ARGUMENT');
  }
  if(!o.install||!o.stage||o.install===o.stage)fail('ROOTS');
  return o;
}
function checkedPath(p,kind,{requireOwned=true}={}){
  const s=fs.lstatSync(p);
  if(s.isSymbolicLink() || (kind==='file'&&!s.isFile()) || (kind==='dir'&&!s.isDirectory()))fail('PATH_TYPE');
  if(requireOwned && process.getuid && s.uid!==process.getuid())fail('OWNER');
  if(fs.realpathSync.native(p)!==path.resolve(p))fail('INDIRECT_PATH');
  return s;
}
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
function main(){
  if(process.platform!=='linux')fail('LINUX_ONLY');
  const {install,stage}=parse(process.argv.slice(2));
  checkedPath(install,'dir');checkedPath(stage,'dir');
  const arch={x64:'amd64',arm64:'arm64'}[os.arch()];
  if(!arch)fail('ARCH_UNSUPPORTED');
  const pinPath=path.join(stage,'tools','tunnel-client-pin.json');
  const receiptPath=path.join(install,'var','tunnel-client-installed.json');
  checkedPath(pinPath,'file');checkedPath(receiptPath,'file');
  const pin=JSON.parse(fs.readFileSync(pinPath,'utf8'));
  const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
  const version=pin.version;
  if(pin.schema!==1 || receipt.schema!==1 || !/^0\.[0-9]+\.[0-9]+$/.test(version??'') ||
     receipt.version!==version || receipt.releaseTag!==pin.releaseTag ||
     receipt.upstreamCommit!==pin.upstreamCommit ||
     receipt.asset!==('tunnel-client-v'+version+'-linux-'+arch+'.zip') ||
     !/^[a-f0-9]{64}$/.test(receipt.binarySha256??'') ||
     !/^[a-f0-9]{64}$/.test(receipt.assetSha256??'') ||
     (receipt.sha256sumsSha256 && receipt.sha256sumsSha256!==pin.sha256sumsSha256))fail('PIN_RECEIPT_MISMATCH');
  const relative=path.join('tools','tunnel-client-v'+version+'-linux-'+arch,'tunnel-client');
  const source=path.join(install,relative);
  checkedPath(path.join(install,'tools'),'dir');
  const s=checkedPath(path.dirname(source),'dir');
  const exe=checkedPath(source,'file');
  if(!(exe.mode & 0o111) || exe.size<10000)fail('EXECUTABLE_INVALID');
  const bytes=fs.readFileSync(source);
  if(sha(bytes)!==receipt.binarySha256)fail('BINARY_SHA256');
  const stageTools=path.join(stage,'tools');
  checkedPath(stageTools,'dir');
  const targetDir=path.join(stageTools,path.basename(path.dirname(source)));
  if(fs.existsSync(targetDir))checkedPath(targetDir,'dir');
  else fs.mkdirSync(targetDir,{mode:0o700});
  checkedPath(targetDir,'dir');
  const target=path.join(targetDir,'tunnel-client');
  if(fs.existsSync(target)){
    const st=checkedPath(target,'file');
    if(!(st.mode & 0o111)||sha(fs.readFileSync(target))!==receipt.binarySha256)
      fail('EXISTING_TARGET_CONFLICT');
    console.log('STAGE_PINNED_TUNNEL_PRESENT sha256='+receipt.binarySha256);
    return;
  }
  // O_EXCL prevents replacing another process's file. Only the exact validated
  // binary is copied; no credentials or user state is copied into the release.
  const temp=path.join(targetDir,'.tunnel-verified-'+process.pid);
  let fd;
  try{
    fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o700);
    fs.writeFileSync(fd,bytes);
    fs.fchmodSync(fd,0o700);
    fs.fsyncSync(fd);
    fs.closeSync(fd);fd=undefined;
    if(sha(fs.readFileSync(temp))!==receipt.binarySha256)fail('COPY_SHA256');
    if(fs.existsSync(target))fail('CONCURRENT_TARGET');
    fs.renameSync(temp,target);
  }finally{
    if(fd!==undefined)fs.closeSync(fd);
    if(fs.existsSync(temp))fs.unlinkSync(temp);
  }
  console.log('STAGE_PINNED_TUNNEL_PASS sha256='+receipt.binarySha256);
}
try{main()}catch(e){console.error(e?.message??String(e));process.exitCode=2}
