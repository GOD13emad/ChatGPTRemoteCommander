import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// Source-only review. No adapters, model, host, install, replay or cleanup.
const root=fs.realpathSync.native(path.dirname(fileURLToPath(import.meta.url)));
const pins=[
  {relative:'src/project-catalog.mjs',bytes:13097,sha256:'00113ce157f9f01aa4e60ffc2cbb6850012af6397b22028b1ed05594654faee1'},
  {relative:'src/durable-project-runner.mjs',bytes:33339,sha256:'61dead8706838e8d806c2d3e47fe8b6d1fb86e3168d0de85ed126164325da728'},
  {relative:'test/generic-project-runner.test.mjs',bytes:50338,sha256:'cdef08121b7ab362d76e759999102c6a19fc2699730416f9a24bd8983fa053f1'}
];
const expected={tests:88,pass:88,fail:0,cancelled:0,skipped:0,todo:0,plan:88};
const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
function inspect(relative){
  const target=path.join(root,...relative.split('/')),before=fs.lstatSync(target,{bigint:true});
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size>1048576n)fail('CI_SOURCE_ALIAS_OR_BOUND');
  const fd=fs.openSync(target,'r');try{
    const held=fs.fstatSync(fd,{bigint:true});
    if(held.dev!==before.dev||held.ino!==before.ino||held.nlink!==1n||held.size!==before.size)fail('CI_SOURCE_OPEN_DRIFT');
    const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(target,{bigint:true});
    for(const value of [after,named])if(value.dev!==held.dev||value.ino!==held.ino||value.nlink!==1n||value.size!==held.size||value.mtimeNs!==held.mtimeNs||value.ctimeNs!==held.ctimeNs)fail('CI_SOURCE_READ_DRIFT');
    return {relative,bytes:bytes.length,sha256:digest(bytes)};
  }finally{fs.closeSync(fd);}
}
function verifyPins(){
  const result=pins.map(pin=>inspect(pin.relative));
  for(let n=0;n<pins.length;n++)if(result[n].bytes!==pins[n].bytes||result[n].sha256!==pins[n].sha256)fail('CI_FROZEN_SOURCE_PIN_DRIFT');
  return result;
}
if(Number(process.versions.node.split('.')[0])<24)fail('CI_NODE_24_REQUIRED');
if(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version!=='1.1.1')fail('CI_VERSION_DRIFT');
const pre=verifyPins();
const audit=fs.realpathSync.native(fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'rc-source-v111-')));
const intent={schema:1,scope:'SYNTAX_AND_SYNTHETIC_88_ONLY',version:'1.1.1',startedAt:new Date().toISOString(),pre,expected,retry:'NO_AUTOMATIC_RETRY',operationalAcceptance:'UNPROVEN'};
fs.writeFileSync(path.join(audit,'INTENT.json'),JSON.stringify(intent,null,2)+'\n',{flag:'wx'});
const env={...process.env};
for(const name of Object.keys(env))if(['remote_commander_config','node_options','node_path'].includes(name.toLowerCase()))delete env[name];
env.TEMP=fs.realpathSync.native(os.tmpdir());env.TMP=env.TEMP;
const phases=[];let primary=null,counts=null,post=null;
function run(phase,args){
  const result=spawnSync(process.execPath,args,{cwd:root,env,shell:false,windowsHide:true,encoding:null,timeout:120000,maxBuffer:1048576});
  const stdout=result.stdout??Buffer.alloc(0),stderr=result.stderr??Buffer.alloc(0);
  const stdoutName=phase+'.stdout.log',stderrName=phase+'.stderr.log';
  fs.writeFileSync(path.join(audit,stdoutName),stdout,{flag:'wx'});fs.writeFileSync(path.join(audit,stderrName),stderr,{flag:'wx'});
  phases.push({phase,exitCode:result.status,signal:result.signal,error:result.error?{code:result.error.code??null,message:result.error.message}:null,
    stdout:{name:stdoutName,bytes:stdout.length,sha256:digest(stdout)},stderr:{name:stderrName,bytes:stderr.length,sha256:digest(stderr)}});
  if(result.error||result.status!==0||result.signal)fail('CI_'+phase+'_FAILED');
  return stdout.toString('utf8');
}
try{
  for(const pin of pins)run('PARSER_'+path.basename(pin.relative),['--check',path.join(root,...pin.relative.split('/'))]);
  run('PARSER_ci-source.mjs',['--check',fileURLToPath(import.meta.url)]);
  const tap=run('SYNTHETIC',['--test','--test-reporter=tap','--test-concurrency=1',path.join(root,'test','generic-project-runner.test.mjs')]);
  counts={};for(const name of ['tests','pass','fail','cancelled','skipped','todo']){
    const matches=[...tap.matchAll(new RegExp('^# '+name+' ([0-9]+)\\r?$','gm'))];
    if(matches.length!==1)fail('CI_TAP_SUMMARY_AMBIGUOUS');counts[name]=Number(matches[0][1]);
  }
  const plans=[...tap.matchAll(/^1\.\.([0-9]+)\r?$/gm)];if(plans.length!==1)fail('CI_TAP_PLAN_AMBIGUOUS');counts.plan=Number(plans[0][1]);
  for(const name of Object.keys(expected))if(counts[name]!==expected[name])fail('CI_EXACT_88_GATE_FAILED');
}catch(error){primary={code:error.code??null,message:error.message};}
try{post=verifyPins();}catch(error){if(primary)primary.secondary={code:error.code??null,message:error.message};else primary={code:error.code??null,message:error.message};}
const receipt={...intent,status:primary?'FAIL_PRESERVED_NO_RETRY':'PASS_SOURCE_ONLY',completedAt:new Date().toISOString(),node:process.version,platform:process.platform,
  primaryFailure:primary,counts,phases,post,sourceUnchanged:JSON.stringify(pre)===JSON.stringify(post),actualModelCalls:0,actualNativeActions:0,liveHostRequests:0,installed:false,coreUpgraded:false,githubMutation:false};
fs.writeFileSync(path.join(audit,'RETURN.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:receipt.status,counts,sourceUnchanged:receipt.sourceUnchanged,audit,primaryFailure:primary,operationalAcceptance:'UNPROVEN'}));
if(primary)process.exitCode=1;
