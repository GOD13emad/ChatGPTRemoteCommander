#!/usr/bin/env node
// Identical entrypoint and declarative manifest on Linux and Windows.
// --plan does not require elevation. --apply/--rollback require a real owner
// TTY challenge, then the native installer/OS approval. No J01 key/grant/cutover.
import fs from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {verifySignedNativeRelease} from './signed-native-provenance.mjs';
import {executeNativeTransaction}
  from './native-transaction.mjs';
import {createNativeOsAdapter}
  from './native-os-adapters.mjs';
import {createNativeFileJournal}
  from './native-journal.mjs';

const fail=s=>{throw Object.assign(new Error(s),{code:s});};
function options(args){
  if(![3,4].includes(args.length)||!['--plan','--apply','--rollback'].includes(args[0])
    ||(args.length===4&&(!['--gui-approval','--attested-gui-approval'].includes(args[3])||args[0]==='--plan'))
    ||args[1]!=='--manifest')
    fail('UNIVERSAL_NATIVE_CLI_ARGUMENTS_INVALID');
  if(typeof args[2]!=='string'||!path.isAbsolute(args[2]))
    fail('UNIVERSAL_NATIVE_CLI_MANIFEST_ABSOLUTE_REQUIRED');
  return {mode:args[0].slice(2),file:path.resolve(args[2]),
    guiApproval:['--gui-approval','--attested-gui-approval'].includes(args[3]),
    signedApproval:args[3]==='--attested-gui-approval'};
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
export function windowsGuiApprovalScript(plan){
  // Do not interpolate untrusted manifest values into PowerShell instructions.
  const message='ChatGPT Commander - package only\n'+plan.installedVersion+
    ' -> '+plan.candidate.version+'\nTransaction: '+plan.transactionId+
    '\nActive 0.11 Core and Tunnel stay untouched.\n'+
    'No account enrollment, Worker grant or chat binding.\nApprove installation?';
  const b64=Buffer.from(message,'utf8').toString('base64');
  return [
    "$ErrorActionPreference='Stop'",
    "if (-not [Environment]::UserInteractive -or "+
      "[Diagnostics.Process]::GetCurrentProcess().SessionId -le 0) {exit 19}",
    "$owner=[Security.Principal.WindowsIdentity]::GetCurrent()",
    "if ($owner.IsSystem -or $owner.IsAnonymous) {exit 19}",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$message=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+b64+"'))",
    "$answer=[System.Windows.Forms.MessageBox]::Show($message,"+
      "'ChatGPT Commander - Native owner approval',"+
      "[System.Windows.Forms.MessageBoxButtons]::YesNo,"+
      "[System.Windows.Forms.MessageBoxIcon]::Question,"+
      "[System.Windows.Forms.MessageBoxDefaultButton]::Button2)",
    "if($answer -eq [System.Windows.Forms.DialogResult]::Yes) {exit 0} else {exit 10}"
  ].join('\n');
}
export async function nativeApproval(plan,{guiApproval=false}={}){
  if(guiApproval&&process.platform==='win32'){
    const source=windowsGuiApprovalScript(plan);
    const encoded=Buffer.from(source,'utf16le').toString('base64');
    const shell=path.join(process.env.SystemRoot||'C:\\\\Windows',
      'System32','WindowsPowerShell','v1.0','powershell.exe');
    const result=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive',
      '-Sta','-EncodedCommand',encoded],{
      stdio:'ignore',timeout:120000,windowsHide:false});
    if(result.error||result.status!==0)
      fail('UNIVERSAL_NATIVE_OWNER_DECLINED');
    return {kind:'native-owner-install-approval',
      transactionId:plan.transactionId,approved:true};
  }
  if(guiApproval){
    if(process.platform!=='linux'||typeof process.getuid!=='function'
      ||process.getuid()===0||!(process.env.DISPLAY||process.env.WAYLAND_DISPLAY)
      ||!process.env.XDG_RUNTIME_DIR)
      fail('UNIVERSAL_NATIVE_GUI_OWNER_SESSION_REQUIRED');
    // Show the exact package scope. Never obtain consent from a redirected
    // stdin, an environment boolean, a fake pin, or an external IPC message.
    const prompt='Commander native package only\n'+plan.installedVersion+
      ' → '+plan.candidate.version+'\nTransaction: '+plan.transactionId+
      '\nActive 0.11 Tunnel remains untouched.\nApprove this package operation?';
    const result=spawnSync('/usr/bin/zenity',[
      '--question','--title=ChatGPT Commander - Owner approval',
      '--text='+prompt,'--ok-label=Approve package',
      '--cancel-label=Cancel','--width=430'],{
      stdio:'ignore',timeout:120000,windowsHide:true});
    if(result.error||result.status!==0)
      fail('UNIVERSAL_NATIVE_OWNER_DECLINED');
    return {kind:'native-owner-install-approval',
      transactionId:plan.transactionId,approved:true};
  }
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
  const {mode,file,guiApproval,signedApproval}=options(argv);
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
    if(signedApproval&&mode!=='apply')
      fail('UNIVERSAL_NATIVE_SIGNED_ROLLBACK_OWNER_BASELINE_REQUIRED');
    const signed=signedApproval?verifySignedNativeRelease({
      manifestPath:provenanceManifestPath,candidatePath:input.candidate.path,
      expectedCommit:input.expectedCommit,platform:os}):null;
    const pinned=signedApproval?signed.manifestSha256
      :process.env.RC012_OWNER_PINNED_NATIVE_MANIFEST_SHA256;
    const head=signedApproval?signed.sourceHead
      :process.env.RC012_OWNER_PINNED_SOURCE_HEAD;
    if(!provenanceManifestPath||head!==input.expectedCommit
      ||typeof pinned!=='string'||!/^[a-f0-9]{64}$/.test(pinned))
      fail('UNIVERSAL_NATIVE_INDEPENDENT_PROVENANCE_REQUIRED');
    const provenance=await import(
      '../../packaging/unified/owner-pinned-provenance.mjs');
    const fresh=input.installationKind==='fresh'&&input.previous===null;
    const proof=fresh
      ?await provenance.verifyOwnerPinnedFreshNativeRelease({
        manifestPath:provenanceManifestPath,
        ownerPinnedManifestSha256:pinned,ownerPinnedHead:head,
        candidatePath:input.candidate.path,
        platform:os==='windows'?'win32':os
      })
      :await provenance.verifyOwnerPinnedNativeRelease({
        manifestPath:provenanceManifestPath,
        ownerPinnedManifestSha256:pinned,ownerPinnedHead:head,
        candidatePath:input.candidate.path,rollbackPath:input.previous.path,
        platform:os==='windows'?'win32':os
      });
    if(proof.ownerPinnedNativeReleaseVerified!==true
      ||proof.candidateSha256!==input.candidate.sha256
      ||!fresh&&(proof.ownerPinnedRollbackVerified!==true
        ||proof.rollbackSha256!==input.previous.sha256)
      ||fresh&&proof.rollbackTarget!=='NATIVE_ABSENCE')
      fail('UNIVERSAL_NATIVE_PROVENANCE_MISMATCH');
  }
  const journal=mode==='plan'?undefined:createNativeFileJournal();
  const result=await executeNativeTransaction({
    action:mode,input,adapter,journal,
    approve:plan=>nativeApproval(plan,{guiApproval})
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
