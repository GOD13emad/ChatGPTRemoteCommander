#!/usr/bin/env node
// One hosted native installer lifecycle entrypoint for Windows and Linux.
// Reuse the platform's installed/rollback tools; never emulate a live grant.
// --plan is always read-only. --run is confined to disposable hosted CI.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const check=(yes,code)=>{if(!yes)fail(code);};
const SHA=/^[0-9a-f]{40}$/;
const VERSION=/^0\.12\.0-dev\.[1-9][0-9]*$/;
const read=name=>JSON.parse(fs.readFileSync(path.join(repo,name),'utf8'));

export function nativeLifecycleSpec(os,version){
  check(VERSION.test(version),'RC012_NATIVE_VERSION_INVALID');
  if(os==='linux')return Object.freeze({
    runner:'bash',script:'test/unified-native-upgrade-smoke.sh',
    artifact:'dist/unified/Remote-Commander-Unified-'+version+'-Linux-amd64.deb',
    ghOs:'Linux',format:'DEB'});
  if(os==='win32')return Object.freeze({
    runner:'pwsh',script:'test/unified-windows-owner-migration.ps1',
    artifact:'dist/unified/Remote-Commander-Unified-'+version+'-Windows-x64.exe',
    ghOs:'Windows',format:'NSIS'});
  fail('RC012_NATIVE_PLATFORM_UNSUPPORTED');
}
export function inspectUnifiedNativeSource({directory=repo,os=process.platform}={}){
  const source=read('package.json'),gui=read('packaging/unified/package.json');
  const train=read('docs/release-train-0.12.json');
  const contract=read('installer/universal-install-contract.json');
  check(VERSION.test(source.version)&&source.version===gui.version
    &&source.version===train.sourceVersion
    &&train.train==='0.12'&&train.channel==='development'
    &&train.status==='INTEGRATION_CANDIDATE_NOT_FINAL'
    &&train.publishApproved===false&&train.installedPromotionApproved===false
    &&train.isStable===false&&train.releaseTag===null
    &&contract.schema==='rc-unified-installer-v1'
    &&contract.nativeCandidateRoot==='packaging/unified'
    &&contract.nativeInstallAuthority==='tools/universal-install/native-cli.mjs'
    &&contract.nativeTransactionalEngine?.entrypoint===contract.nativeInstallAuthority
    &&contract.nativeTransactionalEngine?.ownerIndependentProvenanceRequired===true
    &&contract.nativeTransactionalEngine?.provenanceModule==='packaging/unified/owner-pinned-provenance.mjs'
    &&contract.nativeTransactionalEngine?.initialInstallNeedsHistoricalPackage===false
    &&contract.nativeTransactionalEngine?.coreCutoverAllowed===false,
    'RC012_NATIVE_SOURCE_TRAIN_DRIFT');
  check(path.resolve(directory)===repo,'RC012_NATIVE_DIFFERENT_SOURCE_ROOT');
  return Object.freeze({version:source.version,spec:nativeLifecycleSpec(os,source.version)});
}
function gitHead(){
  const r=cp.spawnSync('git',['-C',repo,'rev-parse','HEAD'],{
    encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:1024});
  check(!r.error&&r.status===0,'RC012_NATIVE_GIT_HEAD_UNAVAILABLE');
  return r.stdout.trim();
}
export function admittedDisposableHost({env=process.env,spec,home=repo}={}){
  return env.CI==='true'&&env.GITHUB_ACTIONS==='true'
    &&env.RUNNER_ENVIRONMENT==='github-hosted'
    &&env.RUNNER_OS===spec?.ghOs
    &&typeof env.GITHUB_WORKSPACE==='string'
    &&path.resolve(env.GITHUB_WORKSPACE)===path.resolve(home)
    &&typeof env.RUNNER_TEMP==='string'&&path.isAbsolute(env.RUNNER_TEMP)
    &&path.resolve(env.RUNNER_TEMP)!==path.resolve(home);
}
function readOnlyPlan(commit,inspection){
  return {status:'RC012_UNIVERSAL_NATIVE_QA_PLAN_READY',
    expectedCommit:commit,version:inspection.version,
    nativeFormat:inspection.spec.format,
    nativeSmokeScript:inspection.spec.script,
    artifact:inspection.spec.artifact,
    sharedTransaction:['install','upgrade','verify','rollback'],
    liveInstallApproved:false,ownerGrantIssued:false,qaOnly:true};
}
export function executeCli(args,env=process.env){
  check(args.length===3&&['--plan','--run'].includes(args[0])
    &&args[1]==='--expected-commit'&&SHA.test(args[2]),
    'RC012_NATIVE_ARGUMENTS_INVALID');
  const expected=args[2], actual=gitHead();
  check(actual===expected,'RC012_NATIVE_COMMIT_MISMATCH');
  const inspected=inspectUnifiedNativeSource();
  const plan=readOnlyPlan(expected,inspected);
  if(args[0]==='--plan')return plan;
  check(admittedDisposableHost({env,spec:inspected.spec}),
    'RC012_NATIVE_HOSTED_RUNNER_ONLY');
  const script=path.join(repo,inspected.spec.script);
  const artifact=path.join(repo,inspected.spec.artifact);
  for(const p of [script,artifact]){
    const f=fs.lstatSync(p);
    check(f.isFile()&&!f.isSymbolicLink()&&f.size>0,
      'RC012_NATIVE_ARTIFACT_UNTRUSTED');
  }
  const argv=inspected.spec.runner==='pwsh'
    ?['-NoLogo','-NoProfile','-File',script]:[script];
  const result=cp.spawnSync(inspected.spec.runner,argv,{
    cwd:repo,env,stdio:'inherit',windowsHide:true,timeout:20*60*1000});
  check(!result.error&&result.status===0,
    'RC012_NATIVE_DISPOSABLE_LIFECYCLE_FAILED');
  return {status:'RC012_UNIVERSAL_NATIVE_DISPOSABLE_LIFECYCLE_PASS',
    expectedCommit:expected,version:inspected.version,
    nativeFormat:inspected.spec.format,
    nativeSmokeScript:inspected.spec.script,
    realHostedNativeInstallAndRollback:true,
    ownerInstalledAcceptance:false,fullAccessGranted:false,
    productionPromotion:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(executeCli(process.argv.slice(2))));}
  catch(e){console.error(JSON.stringify({status:'RC012_UNIVERSAL_NATIVE_DENIED',
    reason:String(e.code||e.message)}));process.exitCode=2;}
}
