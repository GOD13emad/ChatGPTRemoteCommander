#!/usr/bin/env node
// Hosted, disposable *real native package effect* proof for the exact shared
// coordinator. Not an owner-host installer, grant, publisher trust or cutover.
// Only GitHub-hosted runners and an exact checked-out test commit. The signed
// pair mode uses already-attested packages without rebuilding either release.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {admittedDisposableHost,inspectUnifiedNativeSource,nativeLifecycleSpec}
  from '../tools/universal-install/native-smoke.mjs';
import {createNativeOsAdapter}
  from '../tools/universal-install/native-os-adapters.mjs';
import {executeNativeTransaction,verifyNativePlanInput}
  from '../tools/universal-install/native-transaction.mjs';
import {createNativeFileJournal}
  from '../tools/universal-install/native-journal.mjs';
import {officialNativeVerifierBinary,verifySignedNativeRelease}
  from '../tools/universal-install/signed-native-provenance.mjs';
import {verifyCompiledCore} from './native-compiled-core-verifier.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PKG='chatgpt-remote-commander';
const REPO='GOD13emad/ChatGPTRemoteCommander';
const SHA=/^[a-f0-9]{40}$/;
const VERSION=/^0\.12\.0-dev\.([1-9][0-9]{0,8})$/;
const fail=c=>{throw Object.assign(new Error(c),{code:c});};
const check=(condition,code)=>{if(!condition)fail(code);};
function nativeCommand(binary,args,opts={},permittedArtifacts=[]){
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
        :permittedArtifacts.includes(args[2])),
      'RC012_HOSTED_NATIVE_EFFECT_ARGUMENT_DENIED');
    binary='sudo';args=['-n','--',...args];
  }
  const r=spawnSync(binary,args,{
    encoding:'utf8',windowsHide:true,timeout:timeoutMs,maxBuffer:256*1024
  });
  check(!r.error&&!r.signal&&Number.isInteger(r.status),
    'RC012_HOSTED_OS_NATIVE_TOOL_UNAVAILABLE');
  if(checkExit&&r.status!==0){
    const tool=path.basename(binary).toLowerCase();
    // Preserve the failing phase and exit code without printing credentials,
    // artifact paths, registry values or raw subprocess output.
    const script=tool==='powershell.exe'&&args.includes('-EncodedCommand')
      ?Buffer.from(args.at(-1),'base64').toString('utf16le'):'';
    const phase=script.includes('Get-NetTCPConnection')?'listeners'
      :script.includes('Get-ChildItem')?'registration'
      :script.includes('Start-Process')?'installer'
      :script.includes('VersionInfo.FileVersion')?'artifact-version'
      :tool.match(/^gh(?:\.exe)?$/)?args.slice(0,2).join('-'):tool;
    const category=/PathNotFound|ObjectNotFound/.test(r.stderr??'')
      ?'PATH_NOT_FOUND':/AccessDenied|PermissionDenied/.test(r.stderr??'')
      ?'ACCESS_DENIED':null;
    console.error(JSON.stringify({status:'RC012_HOSTED_NATIVE_COMMAND_FAILED',
      tool,phase,category,exitCode:r.status}));
    fail('RC012_HOSTED_OS_NATIVE_EFFECT_FAILED');
  }
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
export function parseSignedPair(raw){
  const invalid='RC012_HOSTED_SIGNED_PAIR_INVALID';
  check(typeof raw==='string'&&raw.length<=1024,invalid);
  let pair;
  try{pair=JSON.parse(raw);}catch{fail(invalid);}
  check(Array.isArray(pair)&&pair.length===2,invalid);
  for(const target of pair)
    check(target&&Object.keys(target).sort().join(',')==='head,run,version'
      &&typeof target.run==='string'&&/^[1-9][0-9]{0,15}$/.test(target.run)
      &&typeof target.head==='string'&&SHA.test(target.head)
      &&typeof target.version==='string'&&VERSION.test(target.version),invalid);
  const [baseline,candidate]=pair;
  check(baseline.run!==candidate.run&&baseline.head!==candidate.head
    &&Number(VERSION.exec(baseline.version)[1])<Number(VERSION.exec(candidate.version)[1]),
    invalid);
  return pair;
}
function downloadSignedArtifact(target,directory,platform){
  const gh=officialNativeVerifierBinary();
  const name=platform==='windows'?'rc-unified-windows-nsis-qa':'rc-unified-linux-deb-qa';
  const record=JSON.parse(nativeCommand(gh,[
    'run','view',target.run,'--repo',REPO,'--json','headSha,conclusion,workflowName'
  ],{timeoutMs:30000}).stdout);
  check(record.headSha===target.head&&record.conclusion==='success'
    &&record.workflowName==='Unified Installer Pilot (NoPromote)',
    'RC012_HOSTED_SIGNED_PAIR_RUN_MISMATCH');
  const assets=path.join(directory,target.run);
  fs.mkdirSync(assets);
  nativeCommand(gh,['run','download',target.run,'--repo',REPO,
    '--name',name,'--dir',assets],{timeoutMs:180000});
  const filename=path.basename(nativeLifecycleSpec(process.platform,target.version).artifact);
  check(fs.readdirSync(assets).join()===filename,'RC012_HOSTED_SIGNED_PAIR_ASSET_MISMATCH');
  const file=path.join(assets,filename),sha256=hashFile(file);
  const manifestPath=path.join(directory,target.run+'.json');
  fs.writeFileSync(manifestPath,JSON.stringify({sourceHead:target.head,
    platform:process.platform,candidate:{sha256,bytes:fs.statSync(file).size}
  }),{flag:'wx',mode:0o600});
  const proof=verifySignedNativeRelease({manifestPath,candidatePath:file,
    expectedCommit:target.head,platform});
  check(proof.signedCandidateVerified&&proof.candidateSha256===sha256,
    'RC012_HOSTED_SIGNED_PAIR_PROVENANCE_FAILED');
  console.log(JSON.stringify({status:'RC012_HOSTED_SIGNED_ARTIFACT_VERIFIED',
    platform,...target,sha256}));
  return {path:file,sha256,version:target.version};
}
function installedCoreProof(platform,head){
  const base=platform==='windows'
    ?path.join(process.env.LOCALAPPDATA,'Programs','remote-commander-unified')
    :'/opt/Remote Commander';
  const coreRoot=path.join(base,'resources','core');
  const sourceManifest=path.join(coreRoot,'source-manifest.json');
  const core=verifyCompiledCore({coreRoot,sourceManifest,expectedCommit:head});
  return {files:core.files,manifestSha256:smallFileHash(sourceManifest),
    executableSha256:hashFile(path.join(base,platform==='windows'
      ?'Remote Commander.exe':'remote-commander-unified'))};
}
function smallFileHash(file){
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
export async function hostedNativeCoordinatorProof(args=process.argv.slice(2)){
  check(args.length===3&&['--run','--run-signed-pair'].includes(args[0])
    &&args[1]==='--expected-commit'&&SHA.test(args[2]),
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
  const pair=args[0]==='--run-signed-pair'?parseSignedPair(process.env.RC012_SIGNED_PAIR):null;
  // A hosted runner's HOME can be populated by earlier independent QA steps.
  // Never weaken the real fresh-install owner-state guard or delete its files:
  // use an explicitly disposable, empty owner HOME for this CI-only lifecycle.
  const originalHome=process.env.HOME;
  const qaHome=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP,
    'rc012-native-hosted-owner-'));
  check(fs.lstatSync(qaHome).isDirectory()
    &&fs.readdirSync(qaHome).length===0,
    'RC012_HOSTED_FRESH_OWNER_HOME_UNTRUSTED');
  process.env.HOME=qaHome;
  let upgradeProof=null;
  try{
    const artifacts=pair?pair.map(t=>downloadSignedArtifact(t,qaHome,platform)):[{
      path:path.resolve(root,source.spec.artifact),version:source.version
    }];
    const baseline=artifacts[0];
    if(!pair){
      check(baseline.path.startsWith(root+path.sep),
        'RC012_HOSTED_NATIVE_COORDINATOR_ARTIFACT_OUTSIDE_SOURCE');
      baseline.sha256=hashFile(baseline.path);
    }
    const permittedArtifacts=artifacts.map(artifact=>artifact.path);
    const adapter=createNativeOsAdapter({platform,
      architecture:'x64',run:(binary,argv,opts)=>
        nativeCommand(binary,argv,opts,permittedArtifacts)});
    const fresh={
      product:'ChatGPTRemoteCommander',platform,architecture:'x64',
      installationKind:'fresh',previous:null,candidate:baseline,
      expectedCommit:pair?.[0].head??head
    };
    const upgrade=pair?verifyNativePlanInput({...fresh,
      installationKind:'upgrade',expectedCommit:pair[1].head,
      previous:baseline,candidate:artifacts[1]
    }):null;
    const act=(action,input,status)=>executeNativeTransaction({
      action,input,adapter,...(action==='plan'?{}:{
        journal:createNativeFileJournal(),
        approve:async plan=>({kind:'native-owner-install-approval',
          transactionId:plan.transactionId,approved:true})
      })
    }).then(result=>{
      check(result.status===status,'RC012_HOSTED_NATIVE_COORDINATOR_UNEXPECTED_STATE');
      if(pair)console.log(JSON.stringify({status,action,platform,
        candidateVersion:input.candidate.version}));
      return result;
    });
    await act('plan',fresh,'READY_TO_FIRST_INSTALL');
    await act('apply',fresh,'NATIVE_PACKAGE_FIRST_INSTALLED');
    if(upgrade){
      const oldCore=installedCoreProof(platform,pair[0].head);
      await act('plan',upgrade,'READY_TO_APPLY');
      const applied=await act('apply',upgrade,'NATIVE_PACKAGE_UPGRADED');
      const newCore=installedCoreProof(platform,pair[1].head);
      await act('plan',upgrade,'ALREADY_INSTALLED');
      const restored=await act('rollback',upgrade,'NATIVE_PACKAGE_ROLLED_BACK');
      const restoredCore=installedCoreProof(platform,pair[0].head);
      check(applied.transactionId!==restored.transactionId
        &&JSON.stringify(oldCore)===JSON.stringify(restoredCore),
        'RC012_HOSTED_SIGNED_PAIR_OLD_PAYLOAD_NOT_RESTORED');
      upgradeProof={baseline:{...pair[0],sha256:baseline.sha256,installedCore:oldCore},
        candidate:{...pair[1],sha256:upgrade.candidate.sha256,installedCore:newCore},
        restoredCore,applyTransactionId:applied.transactionId,
        rollbackTransactionId:restored.transactionId};
    }
    await act('rollback',fresh,'NATIVE_PACKAGE_ROLLED_BACK');
    await act('plan',fresh,'READY_TO_FIRST_INSTALL');
  }finally{
    if(originalHome===undefined)delete process.env.HOME;
    else process.env.HOME=originalHome;
  }
  // Keep the package and receipt files available for runner diagnostics after
  // a failed effect. Successful proof verified package absence before deletion.
  fs.rmSync(qaHome,{recursive:true,force:true});
  return Object.freeze({
    schema:'rc012-hosted-native-coordinator-v1',
    status:pair?'DISPOSABLE_SIGNED_PAIR_NATIVE_LIFECYCLE_PASS'
      :'DISPOSABLE_FIRST_INSTALL_AND_NATIVE_UNINSTALL_PASS',
    head,platform,candidateVersion:pair?.[1].version??source.version,
    ...(upgradeProof?{upgradeProof}:{}),
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
