// Read-only archive-to-installed payload equality for the universal native
// installer. Standard bsdtar/libarchive for NSIS inner 7z; Debian dpkg-deb
// for DEB data tar. Never invoke installers or extract file trees to the host.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const fail=(code)=>{throw Object.assign(new Error(code),{code});};
const check=(ok,code)=>{if(!ok)fail(code);};
const MAX_PACKAGE_BYTES=1024*1024*1024;
const MAX_ARCHIVE_BYTES=1024*1024*1024;
const MAX_ENTRIES=20000;
const hash=v=>createHash('sha256').update(v).digest('hex');
const windows=process.platform==='win32';
const bin=windows?'tar.exe':'tar';
const hex64=/^[a-f0-9]{64}$/;

function validMember(raw){
  check(typeof raw==='string'&&raw.length>0&&raw.length<=4096,
    'NATIVE_BASELINE_ARCHIVE_PATH_INVALID');
  const n=raw.replaceAll('\\','/').replace(/^(\.\/)+/,'').replace(/\/+$/,'');
  check(n&&n[0]!=='/'&&!/^[a-z]:/i.test(n)
    &&!n.split('/').some(s=>s==='..'||s==='.'||s==='')
    &&!/[\u0000-\u001f\u007f]/.test(n),
  'NATIVE_BASELINE_ARCHIVE_PATH_INVALID');
  return n;
}
function listArchive(file){
  const opts={encoding:'utf8',windowsHide:true,timeout:90000,
    maxBuffer:8*1024*1024};
  const names=spawnSync(bin,['-tf',file],opts);
  const long=spawnSync(bin,['-tvf',file],opts);
  const errors=String(names.stderr??'')+' '+String(long.stderr??'');
  if(/(?:LZMA codec is unsupported|unsupported compression|Unsupported Method)/i
    .test(errors))fail('NATIVE_BASELINE_ARCHIVE_CODEC_UNAVAILABLE');
  check(!names.error&&!names.signal&&names.status===0&&
    !long.error&&!long.signal&&long.status===0,
  'NATIVE_BASELINE_ARCHIVE_LIST_FAILED');
  const paths=names.stdout.split(/\r?\n/).filter(Boolean);
  const details=long.stdout.split(/\r?\n/).filter(Boolean);
  check(paths.length>0&&paths.length===details.length&&paths.length<=MAX_ENTRIES,
    'NATIVE_BASELINE_ARCHIVE_MANIFEST_INVALID');
  const entries=[],seen=new Set();
  for(let i=0;i<paths.length;i++){
    const row=details[i].trim().split(/\s+/);
    const mode=row[0]?.[0];
    check(mode==='-'||mode==='d',
      'NATIVE_BASELINE_ARCHIVE_LINK_OR_DEVICE_UNSUPPORTED');
    const sizeToken=windows?row[4]:row[2];
    const size=Number(sizeToken);
    check(Number.isSafeInteger(size)&&size>=0&&size<=MAX_ARCHIVE_BYTES,
      'NATIVE_BASELINE_ARCHIVE_SIZE_INVALID');
    // GNU tar puts ./ at the root of a .deb data archive: metadata only.
    if(paths[i]==='./'||paths[i]==='.'){
      check(mode==='d'&&size===0,
        'NATIVE_BASELINE_ARCHIVE_ROOT_INVALID');
      continue;
    }
    const name=validMember(paths[i]);
    const key=windows?name.toLowerCase():name;
    check(!seen.has(key),'NATIVE_BASELINE_ARCHIVE_DUPLICATE_PATH');
    seen.add(key);
    entries.push({name,mode,size});
  }
  const total=entries.reduce((n,e)=>n+(e.mode==='-'?e.size:0),0);
  check(Number.isSafeInteger(total)&&total<=MAX_ARCHIVE_BYTES,
    'NATIVE_BASELINE_ARCHIVE_EXPANSION_LIMIT');
  return {entries,total};
}
async function tarPayloadHashes(file,entries,total){
  const command=spawn(bin,['-xOf',file],{
    windowsHide:true,stdio:['ignore','pipe','pipe']
  });
  const completed=new Promise((resolve,reject)=>{
    command.once('error',reject);
    command.once('close',(code,signal)=>{
      if(signal)reject(new Error('NATIVE_BASELINE_ARCHIVE_STREAM_SIGNAL'));
      else resolve(code);
    });
  });
  const expected=entries.filter(x=>x.mode==='-');
  const shaMap=new Map();
  let index=0,remaining=expected[0]?.size??0,bytes=0;
  let sha=createHash('sha256');
  function finalize(){
    while(index<expected.length&&remaining===0){
      shaMap.set(expected[index].name,sha.digest('hex'));
      index++;sha=createHash('sha256');
      remaining=expected[index]?.size??0;
    }
  }
  finalize();
  let stderr='';
  command.stderr.on('data',x=>{if(stderr.length<4096)stderr+=x.toString('utf8').slice(0,512);});
  try{
    for await(const chunk of command.stdout){
      let pos=0;
      while(pos<chunk.length){
        check(index<expected.length,
          'NATIVE_BASELINE_ARCHIVE_EXTRA_STREAM_DATA');
        const consumed=Math.min(remaining,chunk.length-pos);
        sha.update(chunk.subarray(pos,pos+consumed));
        remaining-=consumed;pos+=consumed;bytes+=consumed;
        check(bytes<=total&&bytes<=MAX_ARCHIVE_BYTES,
          'NATIVE_BASELINE_ARCHIVE_STREAM_LIMIT');
        finalize();
      }
    }
  }catch(error){command.kill();throw error;}
  const exit=await completed;
  check(exit===0&&index===expected.length&&bytes===total,
    'NATIVE_BASELINE_ARCHIVE_STREAM_FAILED');
  return shaMap;
}
function installedDigest(root,entries,wantHashes){
  const resolved=fs.realpathSync(root);
  const base=resolved.endsWith(path.sep)?resolved:resolved+path.sep;
  let match=0,missing=0,different=0,unsafe=0;
  const archiveRows=[],liveRows=[];
  const mismatches=[];
  for(const e of entries){
    if(e.mode!=='-')continue;
    const rel=e.name.replaceAll('/',path.sep);
    const p=path.resolve(resolved,rel);
    const cmp=windows?p.toLowerCase():p;
    const cmpBase=windows?base.toLowerCase():base;
    const expected=wantHashes.get(e.name);
    check(hex64.test(expected??''),'NATIVE_BASELINE_ARCHIVE_INVENTORY_INCOMPLETE');
    archiveRows.push(e.name+'\0'+expected);
    if(!cmp.startsWith(cmpBase)){
      unsafe++;mismatches.push(e.name);liveRows.push(e.name+'\0'+'UNSAFE');
      continue;
    }
    let actual='MISSING';
    try{
      const st=fs.lstatSync(p);
      if(!st.isFile()||st.isSymbolicLink()||
        !(windows?fs.realpathSync(p).toLowerCase():fs.realpathSync(p)).startsWith(cmpBase)){
        unsafe++;actual='UNSAFE';
      }else{
        const digest=createHash('sha256'),fd=fs.openSync(p,'r'),
          buf=Buffer.alloc(1024*1024);
        try{
          for(let n;(n=fs.readSync(fd,buf,0,buf.length,null))>0;)
            digest.update(buf.subarray(0,n));
        }finally{buf.fill(0);fs.closeSync(fd);}
        actual=digest.digest('hex');
        if(actual===expected)match++;
        else different++;
      }
    }catch(error){
      if(error?.code==='ENOENT')missing++;
      else unsafe++;
    }
    if(actual!==expected)mismatches.push(e.name);
    liveRows.push(e.name+'\0'+actual);
  }
  return {
    archivedPayloadSha256:hash(archiveRows.sort().join('\n')),
    installedPayloadSha256:hash(liveRows.sort().join('\n')),
    fileCount:archiveRows.length,match,missing,different,unsafe,
    mismatches:mismatches.slice(0,16)
  };
}
// Optional bounded, read-only surplus census of the *application root*, not
// whole host filesystems. This cannot attest to native registration or owner
// mutable data; never promote it to a complete restore proof.
function scanExtraInstalledFiles(root,archiveEntries){
  const local=path.resolve(root),parsed=path.parse(local);
  check(local!==parsed.root,
    'NATIVE_BASELINE_SURPLUS_HOST_ROOT_REFUSED');
  const top=fs.lstatSync(local);
  check(top.isDirectory()&&!top.isSymbolicLink(),
    'NATIVE_BASELINE_SURPLUS_ROOT_UNSAFE');
  const canonicalRoot=fs.realpathSync(local);
  const base=canonicalRoot.endsWith(path.sep)?canonicalRoot:
    canonicalRoot+path.sep;
  const safeBase=windows?base.toLowerCase():base;
  const expected=new Set(archiveEntries.filter(x=>x.mode==='-').map(x=>
    windows?x.name.toLowerCase():x.name
  ));
  let visited=0,scannedFiles=0,extraFiles=0,extraBytes=0;
  const extras=[];
  const dirs=[{absolute:local,depth:0}];
  while(dirs.length){
    const {absolute,depth}=dirs.pop();
    check(depth<=32,'NATIVE_BASELINE_SURPLUS_DEPTH_LIMIT');
    const contents=fs.readdirSync(absolute,{withFileTypes:true});
    for(const part of contents){
      visited++;
      check(visited<=MAX_ENTRIES,
        'NATIVE_BASELINE_SURPLUS_ENTRY_LIMIT');
      const full=path.join(absolute,part.name);
      const st=fs.lstatSync(full);
      check(!st.isSymbolicLink()&&!(st.isBlockDevice()||
        st.isCharacterDevice()||st.isFIFO()||st.isSocket()),
      'NATIVE_BASELINE_SURPLUS_UNSAFE_ENTRY');
      const canonical=fs.realpathSync(full);
      check((windows?canonical.toLowerCase():canonical)
        .startsWith(safeBase),'NATIVE_BASELINE_SURPLUS_UNSAFE_ENTRY');
      if(st.isDirectory()){
        dirs.push({absolute:full,depth:depth+1});continue;
      }
      check(st.isFile(),'NATIVE_BASELINE_SURPLUS_UNSUPPORTED_ENTRY');
      scannedFiles++;
      const name=path.relative(local,full).split(path.sep).join('/');
      const key=windows?name.toLowerCase():name;
      check(!name.startsWith('../')&&!name.startsWith('/')
        &&!name.includes('\\')&&!name.includes('\0'),
      'NATIVE_BASELINE_SURPLUS_PATH_UNSAFE');
      if(!expected.has(key)){
        extraFiles++;
        extraBytes+=st.size;
        check(Number.isSafeInteger(extraBytes),
          'NATIVE_BASELINE_SURPLUS_BYTES_LIMIT');
        if(extras.length<32)extras.push(name);
      }
    }
  }
  return Object.freeze({status:'SCOPED_EXTRA_FILE_CENSUS_ONLY',
    installedRootWasNotHostRoot:true,
    scannedEntries:visited,scannedFiles,
    extraFileCount:extraFiles,extraByteCount:extraBytes,
    extraNames:extras.sort(),fullRestoreVerified:false});
}
export async function compareNativeArchiveToInstalled({
  archivePath,installedRoot,scanExtraFiles=false
}){
  check(path.isAbsolute(archivePath)&&path.isAbsolute(installedRoot),
    'NATIVE_BASELINE_PATH_NOT_ABSOLUTE');
  const archive=fs.lstatSync(archivePath);
  check(archive.isFile()&&!archive.isSymbolicLink()&&
    archive.size>32&&archive.size<=MAX_ARCHIVE_BYTES,
  'NATIVE_BASELINE_ARCHIVE_FILE_UNTRUSTED');
  const {entries,total}=listArchive(archivePath);
  const hashes=await tarPayloadHashes(archivePath,entries,total);
  const receipt=installedDigest(installedRoot,entries,hashes);
  check(typeof scanExtraFiles==='boolean',
    'NATIVE_BASELINE_SURPLUS_OPTION_INVALID');
  const extra=scanExtraFiles?
    scanExtraInstalledFiles(installedRoot,entries):null;
  return Object.freeze({
    ...receipt,...(extra?{installedExtras:extra}:{}),
    archiveEntries:entries.length,totalPayloadBytes:total,
    archiveMembersVerified:receipt.missing===0&&receipt.unsafe===0,
    // Strictly archive-member scoped: cannot yet attest to extra installed
    // files, generated NSIS uninstaller, registry or mutable owner recovery.
    // Never pass this partial inventory as a complete restore receipt.
    completeInventory:false,
    payloadMatch:receipt.match===receipt.fileCount&&
      receipt.different===0&&receipt.missing===0&&receipt.unsafe===0
  });
}
function extractNSIS7z(installer,dest){
  const st=fs.lstatSync(installer);
  check(st.isFile()&&!st.isSymbolicLink()&&st.size>1024&&
    st.size<=MAX_PACKAGE_BYTES,'NATIVE_BASELINE_NSIS_UNTRUSTED');
  const fd=fs.openSync(installer,'r');
  try{
    const probe=Buffer.alloc(Math.min(st.size,1024*1024));
    fs.readSync(fd,probe,0,probe.length,0);
    const magic=Buffer.from([0x37,0x7a,0xbc,0xaf,0x27,0x1c]);
    const idx=probe.indexOf(magic);
    check(idx>=0&&probe.indexOf(magic,idx+6)<0&&idx+32<=probe.length,
      'NATIVE_BASELINE_NSIS_7Z_SIGNATURE_AMBIGUOUS');
    const header=probe.subarray(idx+12,idx+32);
    check(zlib.crc32(header)===probe.readUInt32LE(idx+8),
      'NATIVE_BASELINE_NSIS_START_CRC_INVALID');
    const off=Number(probe.readBigUInt64LE(idx+12));
    const count=Number(probe.readBigUInt64LE(idx+20));
    const length=32+off+count;
    check(Number.isSafeInteger(length)&&length>32&&
      length<=MAX_ARCHIVE_BYTES&&idx+length<=st.size,
      'NATIVE_BASELINE_NSIS_ARCHIVE_BOUNDS_INVALID');
    // 7z next headers are small; reject before allocating attacker data.
    check(count<8*1024*1024,'NATIVE_BASELINE_NSIS_HEADER_LIMIT');
    const next=Buffer.alloc(count);
    fs.readSync(fd,next,0,count,idx+32+off);
    check(zlib.crc32(next)===probe.readUInt32LE(idx+28),
      'NATIVE_BASELINE_NSIS_NEXT_CRC_INVALID');
    const out=fs.openSync(dest,'wx',0o600),buf=Buffer.alloc(2*1024*1024);
    try{
      let n=0;
      while(n<length){
        const amt=Math.min(buf.length,length-n);
        const read=fs.readSync(fd,buf,0,amt,idx+n);
        check(read===amt,'NATIVE_BASELINE_NSIS_ARCHIVE_TRUNCATED');
        fs.writeSync(out,buf,0,read);n+=read;
      }
    }finally{buf.fill(0);fs.closeSync(out);}
    return length;
  }finally{fs.closeSync(fd);}
}
async function unpackDebTar(input,dest){
  const q=spawn('dpkg-deb',['--fsys-tarfile',input],{
    stdio:['ignore','pipe','pipe'],windowsHide:true
  });
  const completed=new Promise((resolve,reject)=>{
    q.once('error',reject);
    q.once('close',(code,signal)=>{
      if(signal)reject(new Error('NATIVE_BASELINE_DEB_UNAVAILABLE'));
      else resolve(code);
    });
  });
  const fd=fs.openSync(dest,'wx',0o600);
  let n=0,stderr='';
  q.stderr.on('data',x=>{if(stderr.length<1024)stderr+=x.toString('utf8').slice(0,250);});
  try{
    for await(const buf of q.stdout){
      n+=buf.length;
      check(n<=MAX_ARCHIVE_BYTES,'NATIVE_BASELINE_DEB_TAR_LIMIT');
      fs.writeSync(fd,buf);
    }
  }catch(e){q.kill();throw e;}
  finally{fs.closeSync(fd);}
  const code=await completed;
  check(code===0&&n>512,'NATIVE_BASELINE_DEB_EXTRACTION_FAILED');
  return n;
}
export async function compareNativePackageToInstalled({
  platform,packagePath,installedRoot,expectedPackageSha256,
  scanExtraFiles=false
}){
  check(['windows','linux'].includes(platform)&&platform===
    (windows?'windows':'linux'),'NATIVE_BASELINE_PLATFORM_MISMATCH');
  check(path.isAbsolute(packagePath)&&path.isAbsolute(installedRoot)&&
    hex64.test(expectedPackageSha256),
    'NATIVE_BASELINE_ARGUMENTS_INVALID');
  const st=fs.lstatSync(packagePath);
  check(st.isFile()&&!st.isSymbolicLink()&&st.size>1024&&
    st.size<=MAX_PACKAGE_BYTES,'NATIVE_BASELINE_PACKAGE_UNTRUSTED');
  const h=createHash('sha256'),fd=fs.openSync(packagePath,'r'),
    buf=Buffer.alloc(1024*1024);
  try{for(let n;(n=fs.readSync(fd,buf,0,buf.length,null))>0;)
    h.update(buf.subarray(0,n));}finally{fs.closeSync(fd);buf.fill(0);}
  check(h.digest('hex')===expectedPackageSha256,
    'NATIVE_BASELINE_PACKAGE_SHA_MISMATCH');
  const stats=fs.statfsSync(os.tmpdir());
  check(Number(stats.bavail)*Number(stats.bsize)>Math.min(
    MAX_ARCHIVE_BYTES,Math.max(256*1024*1024,st.size*6)),
  'NATIVE_BASELINE_TEMP_SPACE_UNAVAILABLE');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-native-baseline-'));
  try{
    const extracted=path.join(dir,platform==='windows'?'payload.7z':'payload.tar');
    if(platform==='windows')extractNSIS7z(packagePath,extracted);
    else await unpackDebTar(packagePath,extracted);
    const result=await compareNativeArchiveToInstalled({
      archivePath:extracted,installedRoot,scanExtraFiles
    });
    return Object.freeze({...result,packageSha256:expectedPackageSha256});
  }finally{
    // This directory was atomically created by this invocation and contains
    // only our one fixed payload archive. Never delete arbitrary caller paths.
    const files=fs.readdirSync(dir);
    check(files.length<=1&&files.every(x=>
      x==='payload.7z'||x==='payload.tar'),
    'NATIVE_BASELINE_TEMP_UNEXPECTED_CONTENT');
    fs.rmSync(dir,{recursive:true,force:false});
  }
}
