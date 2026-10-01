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
  'test/workflow-http.test.mjs',
  'test/async-operations.test.mjs',
  'test/tunnel-log-rotation.test.mjs'
];

export function prioritizeSensitiveQualificationCommands(command){
  if(typeof command!=='string'||!command)throw new Error('CI_TEST_COMMAND_INVALID');
  const parts=command.split(' && ').map(part=>part.trim()).filter(Boolean);
  const sensitive=[],rest=[];
  for(const part of parts){
    if(SENSITIVE_QUALIFICATION_FILES.some(file=>part.endsWith(' '+file)))sensitive.push(part);
    else rest.push(part);
  }
  if(sensitive.length!==SENSITIVE_QUALIFICATION_FILES.length)throw new Error('CI_TEST_SENSITIVE_COMMANDS_MISSING');
  return [...sensitive,...rest].join(' && ');
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
  const bounded=boundNodeTestConcurrency(original,args.concurrency);
  const command=args.prioritizeSensitive?prioritizeSensitiveQualificationCommands(bounded.command):bounded.command;
  console.log('CI_TEST_CONCURRENCY script='+args.script+' concurrency='+Number(args.concurrency)+' replacements='+bounded.replacements+' prioritizeSensitive='+args.prioritizeSensitive);
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
