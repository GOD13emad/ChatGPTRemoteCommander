#!/usr/bin/env node
// Cross-platform, read-only, archive-member audit. NEVER means a native
// rollback is authorized. Full restore needs independent owner/OS evidence.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {compareNativePackageToInstalled}
  from './native-package-inventory.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
function parse(args){
  if(args.length!==6)fail('NATIVE_BASELINE_AUDIT_ARGS_REQUIRED');
  const m=new Map();
  for(let i=0;i<args.length;i+=2){
    const k=args[i],v=args[i+1];
    if(!['--previous','--sha256','--installed-root'].includes(k)||
      m.has(k)||typeof v!=='string'||v.length>8192)
      fail('NATIVE_BASELINE_AUDIT_ARGS_INVALID');
    m.set(k,v);
  }
  if(m.size!==3||
    !path.isAbsolute(m.get('--previous')??'')||
    !path.isAbsolute(m.get('--installed-root')??'')||
    !/^[a-f0-9]{64}$/.test(m.get('--sha256')??''))
    fail('NATIVE_BASELINE_AUDIT_IDENTITY_INVALID');
  const platform=process.platform==='win32'?'windows':
    process.platform==='linux'?'linux':null;
  if(!platform)fail('NATIVE_BASELINE_AUDIT_OS_UNSUPPORTED');
  return {platform,packagePath:m.get('--previous'),
    expectedPackageSha256:m.get('--sha256'),
    installedRoot:m.get('--installed-root')};
}
export async function audit(args=process.argv.slice(2)){
  const x=parse(args);
  const result=await compareNativePackageToInstalled(x);
  return Object.freeze({
    schema:'rc-native-baseline-audit-v1',
    platform:x.platform,
    status:result.payloadMatch?'ARCHIVE_MEMBERS_MATCHED_ONLY':
      'ARCHIVE_MEMBERS_DIFFER',
    packageSha256:result.packageSha256,
    archivedPayloadSha256:result.archivedPayloadSha256,
    installedPayloadSha256:result.installedPayloadSha256,
    countedArchiveFiles:result.fileCount,
    matched:result.match,missing:result.missing,
    different:result.different,unsafe:result.unsafe,
    mismatchNames:result.mismatches,
    archiveMembersVerified:result.archiveMembersVerified,
    completeInventory:false,
    completeRestoreVerified:false,
    ownerApprovalIssued:false,
    nativePackageEffectPerformed:false
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  audit().then(x=>console.log(JSON.stringify(x))).catch(error=>{
    console.error(JSON.stringify({
      schema:'rc-native-baseline-audit-v1',status:'DENIED',
      code:typeof error?.code==='string'?error.code:'NATIVE_BASELINE_AUDIT_UNAVAILABLE',
      completeRestoreVerified:false
    }));
    process.exitCode=2;
  });
}
