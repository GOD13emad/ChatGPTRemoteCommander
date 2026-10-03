import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const self=fileURLToPath(import.meta.url);
const root=path.resolve(path.dirname(self),'..');

export function boundNodeTestConcurrency(script,concurrency){
  if(typeof script!=='string'||!script)throw new Error('CI_TEST_SCRIPT_INVALID');
  const n=Number(concurrency);
  if(!Number.isSafeInteger(n)||n<1||n>8)throw new Error('CI_TEST_CONCURRENCY_INVALID');
  const marker='node --test ';
  const count=script.split(marker).length-1;
  if(count<1)throw new Error('CI_TEST_COMMAND_MISSING');
  return {
    command:script.split(marker).join(`node --test --test-concurrency=${n} `),
    replacements:count
  };
}

const SENSITIVE_QUALIFICATION_FILES=[
  'test/mcp-tasks-extension.test.mjs',
  'test/tunnel-log-rotation.test.mjs',
  'test/async-operations.test.mjs',
  'test/workflow-http.test.mjs'
];

export function prioritizeSensitiveQualificationCommands(command){
  if(typeof command!=='string'||!command)throw new Error('CI_TEST_COMMAND_INVALID');
  const parts=command.split(' && ').map(part=>part.trim()).filter(Boolean);
  const byFile=new Map(),rest=[];
  for(const part of parts){
    const file=SENSITIVE_QUALIFICATION_FILES.find(item=>part.endsWith(' '+item));
    if(file){
      if(byFile.has(file))throw new Error('CI_TEST_SENSITIVE_COMMAND_DUPLICATE');
      byFile.set(file,part);
    }else rest.push(part);
  }
  if(byFile.size!==SENSITIVE_QUALIFICATION_FILES.length)throw new Error('CI_TEST_SENSITIVE_COMMANDS_MISSING');
  return [...SENSITIVE_QUALIFICATION_FILES.map(file=>byFile.get(file)),...rest].join(' && ');
}

export function parseQualificationArgs(argv){
  const out={script:null,concurrency:null,prioritizeSensitive:false};
  for(let i=0;i<argv.length;i++){
    const key=argv[i],value=argv[++i];
    if(value===undefined)throw new Error('CI_TEST_ARGUMENT_MISSING');
    if(key==='--script')out.script=value;
    else if(key==='--concurrency')out.concurrency=value;
    else if(key==='--prioritize-sensitive')out.prioritizeSensitive=value==='1'||value==='true';
    else throw new Error('CI_TEST_ARGUMENT_UNKNOWN');
  }
  if(!['test','check'].includes(out.script))throw new Error('CI_TEST_SCRIPT_NOT_ALLOWED');
  return out;
}

function run(){
  const args=parseQualificationArgs(process.argv.slice(2));
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const original=pkg?.scripts?.[args.script];
  const requestedConcurrency=Number(args.concurrency);
  const effectiveConcurrency=process.platform==='win32'?1:requestedConcurrency;
  const bounded=boundNodeTestConcurrency(original,effectiveConcurrency);
  const prioritizeSensitive=args.prioritizeSensitive||process.platform==='win32';
  const command=prioritizeSensitive?prioritizeSensitiveQualificationCommands(bounded.command):bounded.command;
  console.log('CI_TEST_CONCURRENCY script='+args.script+' requestedConcurrency='+requestedConcurrency+' effectiveConcurrency='+effectiveConcurrency+' replacements='+bounded.replacements+' prioritizeSensitive='+prioritizeSensitive);
  const child=process.platform==='win32'
    ? spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',command],{cwd:root,env:process.env,stdio:'inherit'})
    : spawnSync('/bin/sh',['-lc',command],{cwd:root,env:process.env,stdio:'inherit'});
  if(child.error)throw child.error;
  if(child.signal)throw new Error(`CI_TEST_SIGNAL_${child.signal}`);
  process.exitCode=Number.isInteger(child.status)?child.status:1;
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(self)){
  try{run();}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
}
