#!/usr/bin/env node
// Identical entrypoint and declarative manifest on Linux and Windows.
// --plan does not require elevation. --apply/--rollback require a real owner
// TTY challenge, then the native installer/OS approval. No J01 key/grant/cutover.
import fs from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath} from 'node:url';
import {executeNativeTransaction}
  from './native-transaction.mjs';
import {createNativeOsAdapter}
  from './native-os-adapters.mjs';
import {createNativeFileJournal}
  from './native-journal.mjs';

const fail=s=>{throw Object.assign(new Error(s),{code:s});};
function options(args){
  if(args.length!==3||!['--plan','--apply','--rollback'].includes(args[0])
    ||args[1]!=='--manifest')
    fail('UNIVERSAL_NATIVE_CLI_ARGUMENTS_INVALID');
  if(typeof args[2]!=='string'||!path.isAbsolute(args[2]))
    fail('UNIVERSAL_NATIVE_CLI_MANIFEST_ABSOLUTE_REQUIRED');
  return {mode:args[0].slice(2),file:path.resolve(args[2])};
}
function readManifest(file){
  const s=fs.lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||s.size<70||s.size>4096)
    fail('UNIVERSAL_NATIVE_CLI_MANIFEST_UNTRUSTED');
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!data||data.schema!=='rc-universal-native-install-manifest-v1')
    fail('UNIVERSAL_NATIVE_CLI_MANIFEST_SCHEMA_INVALID');
  const {schema,provenanceManifestPath=null,...input}=data;
  if(provenanceManifestPath!==null
    &&(typeof provenanceManifestPath!=='string'
      ||!path.isAbsolute(provenanceManifestPath)))
    fail('UNIVERSAL_NATIVE_PROVENANCE_PATH_INVALID');
  return {input,provenanceManifestPath};
}
async function nativeApproval(plan){
  if(!process.stdin.isTTY||!process.stdout.isTTY)
    fail('UNIVERSAL_NATIVE_OWNER_TTY_REQUIRED');
  const rl=createInterface({input:process.stdin,output:process.stdout});
  try{
    // Read-only display contains no credentials and cannot be used for Worker.
    console.error('Package-only native '+plan.platform+' '+plan.installedVersion+
      ' -> '+plan.candidate.version+' (NO TUNNEL CUTOVER).');
    console.error('Type EXACT transaction ID to approve this native package effect:');
    const got=await rl.question('ID> ');
    if(got.trim()!==plan.transactionId)
      fail('UNIVERSAL_NATIVE_OWNER_DECLINED');
    return {kind:'native-owner-install-approval',
      transactionId:plan.transactionId,approved:true};
  }finally{rl.close();}
}
export async function nativeCli(argv=process.argv.slice(2)){
  const {mode,file}=options(argv);
  const {input,provenanceManifestPath}=readManifest(file);
  const os=process.platform==='win32'?'windows':process.platform;
  if(input.platform!==os)
    fail('UNIVERSAL_NATIVE_CLI_PLATFORM_MISMATCH');
  const adapter=createNativeOsAdapter({
    platform:os,architecture:process.arch
  });
  // No native effect is permitted from a self-asserted source SHA.
  // Require the EXISTING owner-pinned verifier (one shared source of truth),
  // independent full manifest hash and exact HEAD before owner TTY consent.
  if(mode!=='plan'){
    const pinned=process.env.RC012_OWNER_PINNED_NATIVE_MANIFEST_SHA256;
    const head=process.env.RC012_OWNER_PINNED_SOURCE_HEAD;
    if(!provenanceManifestPath||head!==input.expectedCommit
      ||typeof pinned!=='string'||!/^[a-f0-9]{64}$/.test(pinned))
      fail('UNIVERSAL_NATIVE_INDEPENDENT_PROVENANCE_REQUIRED');
    const {verifyOwnerPinnedNativeRelease}=await import(
      '../../packaging/unified/owner-pinned-provenance.mjs');
    const proof=await verifyOwnerPinnedNativeRelease({
      manifestPath:provenanceManifestPath,
      ownerPinnedManifestSha256:pinned,ownerPinnedHead:head,
      candidatePath:input.candidate.path,rollbackPath:input.previous.path,
      platform:os==='windows'?'win32':os
    });
    if(proof.ownerPinnedNativeReleaseVerified!==true
      ||proof.ownerPinnedRollbackVerified!==true
      ||proof.candidateSha256!==input.candidate.sha256
      ||proof.rollbackSha256!==input.previous.sha256)
      fail('UNIVERSAL_NATIVE_PROVENANCE_MISMATCH');
  }
  const journal=mode==='plan'?undefined:createNativeFileJournal();
  const result=await executeNativeTransaction({
    action:mode,input,adapter,journal,approve:nativeApproval
  });
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  nativeCli().then(x=>console.log(JSON.stringify(x)))
    .catch(e=>{
      console.error(JSON.stringify({status:'UNIVERSAL_NATIVE_DENIED',
        code:e?.code??'UNIVERSAL_NATIVE_UNEXPECTED_ERROR',
        packageOnly:true,liveCoreChanged:false}));
      process.exitCode=2;
    });
