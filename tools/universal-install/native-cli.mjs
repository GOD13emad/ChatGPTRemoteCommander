#!/usr/bin/env node
// Identical entrypoint and declarative manifest on Linux and Windows.
// --plan does not require elevation. --apply/--rollback require a real owner
// TTY challenge, then the native installer/OS approval. No J01 key/grant/cutover.
import fs from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {verifyPublicSignedNativeRelease,windowsNativePowerShell} from './signed-native-provenance.mjs';
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
    // Use a real visible topmost owner form; an opacity-zero MessageBox
    // host is not a reliable visible consent surface on active desktops.
    // Explicit Yes/No buttons, Cancel default and bounded expiry; never
    // infer approval from session existence or inherited capabilities.
    "$dialog=New-Object System.Windows.Forms.Form",
    "$dialog.Text='ChatGPT Commander - Native owner approval'",
    "$dialog.StartPosition='CenterScreen'",
    "$dialog.TopMost=$true",
    "$dialog.ShowInTaskbar=$true",
    "$dialog.FormBorderStyle='FixedDialog'",
    "$dialog.Width=650",
    "$dialog.Height=320",
    "$dialog.MaximizeBox=$false",
    "$dialog.MinimizeBox=$false",
    "$label=New-Object System.Windows.Forms.Label",
    "$label.SetBounds(20,15,605,188)",
    "$label.Text=$message",
    "$approve=New-Object System.Windows.Forms.Button",
    "$approve.Text='Approve package only'",
    "$approve.SetBounds(285,215,170,36)",
    "$approve.DialogResult=[System.Windows.Forms.DialogResult]::Yes",
    "$decline=New-Object System.Windows.Forms.Button",
    "$decline.Text='Decline'",
    "$decline.SetBounds(475,215,125,36)",
    "$decline.DialogResult=[System.Windows.Forms.DialogResult]::No",
    "$dialog.Controls.Add($label)",
    "$dialog.Controls.Add($approve)",
    "$dialog.Controls.Add($decline)",
    "$dialog.AcceptButton=$decline",
    "$dialog.CancelButton=$decline",
    "$timer=New-Object System.Windows.Forms.Timer",
    "$timer.Interval=85000",
    "$timer.Add_Tick({$timer.Stop();$dialog.DialogResult=[System.Windows.Forms.DialogResult]::Cancel;$dialog.Close()})",
    "$timer.Start()",
    "try {$answer=$dialog.ShowDialog()} finally {$timer.Stop();$timer.Dispose();$dialog.Dispose()}",
    "if($answer -eq [System.Windows.Forms.DialogResult]::Yes){exit 0}else{exit 10}"
  ].join('\n');
}
export function resolveLinuxOwnerGuiSession({
  env=process.env,run=spawnSync,
  ownerUid=typeof process.getuid==='function'?process.getuid():null
}={}){
  if(process.platform!=='linux'||!Number.isInteger(ownerUid)||ownerUid===0)
    fail('UNIVERSAL_NATIVE_GUI_OWNER_SESSION_REQUIRED');
  // Read the *current user's* systemd session environment; do not borrow
  // another account's Xauthority, remote display, or GUI input permission.
  let vars={...env};
  if(!vars.DISPLAY&&!vars.WAYLAND_DISPLAY){
    const r=run('/usr/bin/systemctl',['--user','show-environment'],{
      encoding:'utf8',timeout:5000,maxBuffer:65536,windowsHide:true});
    if(r.error||r.status!==0||typeof r.stdout!=='string')
      fail('UNIVERSAL_NATIVE_GUI_OWNER_SESSION_REQUIRED');
    const found=new Map();
    for(const line of r.stdout.split(/\r?\n/)){
      const i=line.indexOf('=');
      if(i<1)continue;
      const key=line.slice(0,i),value=line.slice(i+1);
      if(['DISPLAY','XAUTHORITY','WAYLAND_DISPLAY','XDG_RUNTIME_DIR'].includes(key)){
        if(found.has(key))fail('UNIVERSAL_NATIVE_GUI_OWNER_SESSION_REQUIRED');
        found.set(key,value);
      }
    }
    for(const [k,v] of found)if(!vars[k])vars[k]=v;
  }
  const runtime='/run/user/'+ownerUid;
  if(vars.XDG_RUNTIME_DIR&&vars.XDG_RUNTIME_DIR!==runtime)
    fail('UNIVERSAL_NATIVE_GUI_OWNER_SESSION_REQUIRED');
  const rt=fs.lstatSync(runtime,{throwIfNoEntry:false});
  if(!rt?.isDirectory()||rt.isSymbolicLink()
    ||rt.uid!==ownerUid||(rt.mode&0o077)!==0)
    fail('UNIVERSAL_NATIVE_GUI_OWNER_SESSION_REQUIRED');
  vars.XDG_RUNTIME_DIR=runtime;
  if(typeof vars.DISPLAY==='string'&&/^:[0-9]+(?:\.[0-9]+)?$/.test(vars.DISPLAY)){
    const authority=vars.XAUTHORITY;
    if(typeof authority!=='string'||!path.isAbsolute(authority))
      fail('UNIVERSAL_NATIVE_GUI_OWNER_SESSION_REQUIRED');
    const st=fs.lstatSync(authority,{throwIfNoEntry:false});
    if(!st?.isFile()||st.isSymbolicLink()||st.nlink!==1
      ||st.uid!==ownerUid||(st.mode&0o077)!==0)
      fail('UNIVERSAL_NATIVE_GUI_OWNER_SESSION_REQUIRED');
    return {DISPLAY:vars.DISPLAY,XAUTHORITY:authority,
      XDG_RUNTIME_DIR:runtime};
  }
  if(typeof vars.WAYLAND_DISPLAY==='string'
    &&/^wayland-[0-9]+$/.test(vars.WAYLAND_DISPLAY)){
    const socket=fs.lstatSync(path.join(runtime,vars.WAYLAND_DISPLAY),
      {throwIfNoEntry:false});
    if(socket?.isSocket()&&socket.uid===ownerUid)
      return {WAYLAND_DISPLAY:vars.WAYLAND_DISPLAY,
        XDG_RUNTIME_DIR:runtime};
  }
  fail('UNIVERSAL_NATIVE_GUI_OWNER_SESSION_REQUIRED');
}
export async function nativeApproval(plan,{
  guiApproval=false,ownerSeatResolver=resolveLinuxOwnerGuiSession
}={}){
  if(guiApproval&&process.platform==='win32'){
    const source=windowsGuiApprovalScript(plan);
    const encoded=Buffer.from(source,'utf16le').toString('base64');
    const shell=windowsNativePowerShell();
    const result=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive',
      '-Sta','-EncodedCommand',encoded],{
      stdio:'ignore',timeout:120000,windowsHide:false});
    if(result.error||result.status!==0)
      fail('UNIVERSAL_NATIVE_OWNER_DECLINED');
    return {kind:'native-owner-install-approval',
      transactionId:plan.transactionId,approved:true};
  }
  if(guiApproval){
    const seat=ownerSeatResolver();
    // Show the exact package scope. Never obtain consent from a redirected
    // stdin, an environment boolean, a fake pin, or an external IPC message.
    const prompt='Commander native package only\n'+plan.installedVersion+
      ' → '+plan.candidate.version+'\nTransaction: '+plan.transactionId+
      '\nActive 0.11 Tunnel remains untouched.\nApprove this package operation?';
    const result=spawnSync('/usr/bin/zenity',[
      '--question','--title=ChatGPT Commander - Owner approval',
      '--text='+prompt,'--ok-label=Approve package',
      '--cancel-label=Cancel','--width=430'],{
      stdio:'ignore',timeout:120000,windowsHide:true,
      env:{...process.env,...seat}});
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
    const fresh=input.installationKind==='fresh'&&input.previous===null;
    // An attestation covers the candidate only. An upgrade may execute the
    // previous package after a failed verification, so its manifest needs an
    // independent pin even when the candidate is attested.
    const needsOwnerPin=!signedApproval||!fresh;
    const ownerDigest=process.env.RC012_OWNER_PINNED_NATIVE_MANIFEST_SHA256;
    const ownerHead=process.env.RC012_OWNER_PINNED_SOURCE_HEAD;
    if(!provenanceManifestPath||needsOwnerPin&&(
      ownerHead!==input.expectedCommit||typeof ownerDigest!=='string'
      ||!/^[a-f0-9]{64}$/.test(ownerDigest)))
      fail('UNIVERSAL_NATIVE_INDEPENDENT_PROVENANCE_REQUIRED');
    const signed=signedApproval?await verifyPublicSignedNativeRelease({
      manifestPath:provenanceManifestPath,candidatePath:input.candidate.path,
      expectedCommit:input.expectedCommit,platform:os}):null;
    const pinned=needsOwnerPin?ownerDigest:signed.manifestSha256;
    const head=signed?.sourceHead??ownerHead;
    if(signed&&(signed.manifestSha256!==pinned||head!==input.expectedCommit))
      fail('UNIVERSAL_NATIVE_PROVENANCE_MISMATCH');
    const provenance=await import(
      '../../packaging/unified/owner-pinned-provenance.mjs');
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
