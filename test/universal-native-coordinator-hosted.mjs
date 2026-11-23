#!/usr/bin/env node
// Hosted, disposable *real native package effect* proof for the exact shared
// coordinator. Not an owner-host installer, grant, publisher trust or cutover.
// Only GitHub-hosted runner, exact checked-out commit and one signed source
// package. Native package operations remain OS-native, never custom shell code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {admittedDisposableHost,inspectUnifiedNativeSource}
  from '../tools/universal-install/native-smoke.mjs';
import {createNativeOsAdapter}
  from '../tools/universal-install/native-os-adapters.mjs';
import {executeNativeTransaction}
  from '../tools/universal-install/native-transaction.mjs';
import {createNativeFileJournal}
  from '../tools/universal-install/native-journal.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PKG='chatgpt-remote-commander';
const fail=c=>{throw Object.assign(new Error(c),{code:c});};
const check=(condition,code)=>{if(!condition)fail(code);};
let permittedArtifactPath=null;
function nativeCommand(binary,args,opts={}){
  const {timeoutMs=15000,checkExit=true}=opts;
  // The only substitute for polkit on an ephemeral, ownerless CI runner is
  // its preauthorized root package manager (sudo -n). Never expose this
  // runner to normal live owner accounts or users' installed packages.
  if(binary==='pkexec'){
    check(process.platform==='linux'
      &&args[0]==='/usr/bin/dpkg'
      &&args.length===3
      &&['--install','--remove'].includes(args[1])
      &&(args[1]==='--remove'?args[2]===PKG
        :args[2]===permittedArtifactPath),
      'RC012_HOSTED_NATIVE_EFFECT_ARGUMENT_DENIED');
    binary='sudo';args=['-n','--',...args];
  }
  const r=spawnSync(binary,args,{
    encoding:'utf8',windowsHide:true,timeout:timeoutMs,maxBuffer:256*1024
  });
  check(!r.error&&!r.signal&&Number.isInteger(r.status),
    'RC012_HOSTED_OS_NATIVE_TOOL_UNAVAILABLE');
  if(checkExit)check(r.status===0,'RC012_HOSTED_OS_NATIVE_EFFECT_FAILED');
  return {code:r.status,stdout:(r.stdout??'').trim(),
    stderr:(r.stderr??'').trim()};
}
function hashFile(file){
  const stat=fs.lstatSync(file);
  check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>1024
    &&stat.size<1024*1024*1024,'RC012_HOSTED_ARTIFACT_UNTRUSTED');
  const h=createHash('sha256'),fd=fs.openSync(file,'r');
  const b=Buffer.alloc(1024*1024);
  try{for(let n;(n=fs.readSync(fd,b,0,b.length,null))>0;)
    h.update(b.subarray(0,n));}
  finally{b.fill(0);fs.closeSync(fd);}
  return h.digest('hex');
}
function gitHead(){
  return nativeCommand('git',['-C',root,'rev-parse','HEAD']).stdout;
}
export async function hostedNativeCoordinatorProof(args=process.argv.slice(2)){
  check(args.length===3&&args[0]==='--run'
    &&args[1]==='--expected-commit'
    &&/^[a-f0-9]{40}$/.test(args[2]),
    'RC012_HOSTED_NATIVE_COORDINATOR_ARGUMENTS_INVALID');
  const head=args[2],actual=gitHead();
  check(head===actual,'RC012_HOSTED_NATIVE_COORDINATOR_HEAD_DRIFT');
  const source=inspectUnifiedNativeSource();
  check(admittedDisposableHost({
    spec:source.spec,home:root
  }), 'RC012_HOSTED_NATIVE_COORDINATOR_CI_ONLY');
  const platform=process.platform==='win32'?'windows':process.platform;
  check(['windows','linux'].includes(platform)
    &&os.arch()==='x64','RC012_HOSTED_NATIVE_COORDINATOR_PLATFORM_UNSUPPORTED');
  // The disposable runner must use a FRESH owner state, independently of
  // ~/.config and ~/.local modified by earlier GitHub CI tests/build tools.
  // This isolation is deliberately limited to admitted, non-owner CI hosts:
  // real users keep native profile checks and are never silently rehomed.
  if(platform==='linux'){
    const temp=path.resolve(process.env.RUNNER_TEMP);
    const original=fs.lstatSync(temp);
    check(original.isDirectory()&&!original.isSymbolicLink()
      &&original.uid===process.getuid()
      &&fs.realpathSync(temp)===temp,
      'RC012_HOSTED_OWNER_TEMP_UNTRUSTED');
    const home=fs.mkdtempSync(path.join(temp,'rc012-native-owner-'));
    fs.chmodSync(home,0o700);
    process.env.HOME=home;
    check(os.homedir()===home&&fs.readdirSync(home).length===0,
      'RC012_HOSTED_OWNER_HOME_ISOLATION_FAILED');
  }
  const candidatePath=path.resolve(root,source.spec.artifact);
  check(candidatePath.startsWith(root+path.sep),
    'RC012_HOSTED_NATIVE_COORDINATOR_ARTIFACT_OUTSIDE_SOURCE');
  const input={
    product:'ChatGPTRemoteCommander',
    platform,architecture:'x64',installationKind:'fresh',
    expectedCommit:head,previous:null,
    candidate:{path:candidatePath,sha256:hashFile(candidatePath),
      version:source.version}
  };
  // Constrain any injected native sudo effect to this exact, hashed
  // artifact and package ID; never use runtime-supplied arbitrary commands.
  permittedArtifactPath=candidatePath;
  const adapter=createNativeOsAdapter({platform,
    architecture:'x64',run:nativeCommand});
  const journal=createNativeFileJournal();
  const ownerOfEphemeralRunner=async plan=>({
    kind:'native-owner-install-approval',
    transactionId:plan.transactionId,approved:true
  });
  const current=await executeNativeTransaction({
    action:'plan',input,adapter
  });
  check(current.status==='READY_TO_FIRST_INSTALL'
    &&current.beforeVersion===null,
    'RC012_HOSTED_NATIVE_COORDINATOR_NOT_EMPTY');
  const installed=await executeNativeTransaction({
    action:'apply',input,adapter,journal,approve:ownerOfEphemeralRunner
  });
  check(installed.status==='NATIVE_PACKAGE_FIRST_INSTALLED'
    &&installed.observedVersion===source.version,
    'RC012_HOSTED_NATIVE_FIRST_INSTALL_NOT_VERIFIED');
  const removed=await executeNativeTransaction({
    action:'rollback',input,adapter,
    journal:createNativeFileJournal(),
    approve:ownerOfEphemeralRunner
  });
  check(removed.status==='NATIVE_PACKAGE_ROLLED_BACK'
    &&removed.observedVersion===null,
    'RC012_HOSTED_NATIVE_CLEAN_ROLLBACK_NOT_VERIFIED');
  const final=await executeNativeTransaction({
    action:'plan',input,adapter
  });
  check(final.status==='READY_TO_FIRST_INSTALL'
    &&final.beforeVersion===null,
    'RC012_HOSTED_NATIVE_FINAL_ABSENCE_NOT_VERIFIED');
  return Object.freeze({
    schema:'rc012-hosted-native-coordinator-v1',
    status:'DISPOSABLE_FIRST_INSTALL_AND_NATIVE_UNINSTALL_PASS',
    head,platform,candidateVersion:source.version,
    exactSourceAndArtifactVerified:true,
    nativeEffectsVerified:true,
    finalPackageAbsent:true,ownerHostConsentVerified:false,
    ownerTunnelChanged:false,workerGrantIssued:false,
    stablePromotionAllowed:false
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  hostedNativeCoordinatorProof().then(x=>console.log(JSON.stringify(x)))
    .catch(e=>{
      console.error(JSON.stringify({status:'RC012_HOSTED_NATIVE_COORDINATOR_DENIED',
        reason:e?.code??'RC012_HOSTED_NATIVE_UNEXPECTED_ERROR',
        productionPromotion:false}));
      process.exitCode=2;
    });
