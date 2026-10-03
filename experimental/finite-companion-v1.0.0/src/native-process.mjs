import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {childEnv,parseBoundedJson} from './model-contract.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const admitted=new WeakSet(),UINT32=4294967295;
const phases=new Set(['COMPLETED','ARGUMENT_BOUND','ABSOLUTE_PATH_REQUIRED','INPUT_BOUND','JOB_CREATE','JOB_LIMITS','CPU_LIMIT','INPUT_PIPE','OUTPUT_PIPE','ERROR_PIPE','INPUT_INHERIT','OUTPUT_INHERIT','ERROR_INHERIT','ATTRIBUTE_INIT','ATTRIBUTE_HANDLES','ARGUMENT_SIZE','COMMAND_SIZE','PROCESS_CREATE','PROCESS_IMAGE','TOKEN_OPEN','TOKEN_QUERY','TOKEN_SID','PROCESS_IDENTITY','PROCESS_TIMES','JOB_ASSIGN_BEFORE_EXECUTION','JOB_MEMBERSHIP','PROCESS_RESUME','PIPE_OBSERVATION','PIPE_READ','WALL_DEADLINE','EXIT_CODE','JOB_ACCOUNTING','DESCENDANTS_AFTER_ROOT_EXIT','NATIVE_UNEXPECTED','INPUT_PIPE_FAILED','JOB_NOT_EMPTY','WAIT_FAILURE']);
const keys=['schema','status','win32Error','cleanupWin32Error','cleanupConfirmed','pid','creationFileTime','assignedBeforeResume','exitCode','elapsedMs','activeJobProcesses','peakJobMemoryBytes','ownedJobTerminated','stdoutHex','stderrHex'];
function exact(value,fields){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('PROCESS_PROOF_SCHEMA');
 const properties=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(properties);
 if(names.length!==fields.length||names.some(key=>typeof key!=='string'||!fields.includes(key)||!Object.hasOwn(properties[key],'value')||!properties[key].enumerable))fail('PROCESS_PROOF_SCHEMA');
}
function int(value,min,max){return Number.isSafeInteger(value)&&value>=min&&value<=max;}
function limits(options){
 exact(options,['timeoutMs','maxOutputBytes','memoryMb']);
 if(!int(options.timeoutMs,100,180000)||!int(options.maxOutputBytes,64,1048576)||!int(options.memoryMb,64,1024))fail('PROCESS_REQUEST_BOUND');
}
function utf8(bytes){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('PROCESS_UTF8_DENIED');}}
export function verifyImage(file,hash){
 if(typeof file!=='string'||!path.win32.isAbsolute(file)||typeof hash!=='string'||! /^[a-f0-9]{64}$/.test(hash))fail('PROCESS_IMAGE_PIN');
 const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||sha(fs.readFileSync(file))!==hash)fail('PROCESS_IMAGE_PIN');
}
// Failure proofs survive for diagnosis but never pass execution admission.
export function validateNativeEnvelope(envelope,options){
 limits(options);exact(envelope,['text','helperExitCode','signal','closed','pipeError','overflow','helperPid']);
 if(typeof envelope.text!=='string'||!int(envelope.helperPid,1,UINT32)||!int(envelope.helperExitCode,0,2)||envelope.signal!==null||envelope.closed!==true||envelope.pipeError!==null||envelope.overflow!==false)fail('PROCESS_ENVELOPE_FAILED');
 const native=parseBoundedJson(envelope.text,options.maxOutputBytes*2+8192);exact(native,keys);
 if(native.schema!==1||!phases.has(native.status)||!int(native.win32Error,0,UINT32)||!int(native.cleanupWin32Error,0,UINT32)||typeof native.cleanupConfirmed!=='boolean'||typeof native.assignedBeforeResume!=='boolean'||typeof native.ownedJobTerminated!=='boolean'||!int(native.pid,0,UINT32)||!int(native.exitCode,0,UINT32)||!int(native.elapsedMs,0,options.timeoutMs+12000)||!int(native.activeJobProcesses,0,8)||!int(native.peakJobMemoryBytes,0,options.memoryMb*1048576)||typeof native.creationFileTime!=='string'||! /^(?:0|[1-9][0-9]{0,19})$/.test(native.creationFileTime)||BigInt(native.creationFileTime)>18446744073709551615n||![native.stdoutHex,native.stderrHex].every(value=>typeof value==='string'&&/^(?:[a-f0-9]{2})*$/.test(value))||native.stdoutHex.length+native.stderrHex.length>options.maxOutputBytes*2)fail('PROCESS_PROOF_SCHEMA');
 if(native.cleanupConfirmed!==(native.cleanupWin32Error===0&&native.activeJobProcesses===0)||native.assignedBeforeResume&&(native.pid===0||native.creationFileTime==='0'||native.pid===envelope.helperPid)||native.ownedJobTerminated&&native.pid===0)fail('PROCESS_PROOF_CONTRADICTION');
 if(native.status==='COMPLETED'){
  if(envelope.helperExitCode!==0||native.win32Error!==0||native.cleanupWin32Error!==0||!native.cleanupConfirmed||!native.assignedBeforeResume||native.ownedJobTerminated||native.activeJobProcesses!==0)fail('PROCESS_SUCCESS_PROOF_CONTRADICTION');
 }else if(envelope.helperExitCode===0)fail('PROCESS_FAILURE_PROOF_CONTRADICTION');
 const result=Object.freeze({helperPid:envelope.helperPid,helperExitCode:envelope.helperExitCode,closed:true,proof:Object.freeze({...native}),stdout:utf8(Buffer.from(native.stdoutHex,'hex')),stderr:utf8(Buffer.from(native.stderrHex,'hex')),exitCode:native.exitCode,signal:null,overflow:false,pipeError:null});
 admitted.add(result);return result;
}
export function requireSuccessfulExecution(result){
 if(!admitted.has(result))fail('PROCESS_UNVALIDATED_RESULT');
 const proof=result.proof;if(result.helperExitCode!==0||proof.status!=='COMPLETED'||!proof.cleanupConfirmed||!proof.assignedBeforeResume||proof.activeJobProcesses!==0||proof.ownedJobTerminated||proof.win32Error!==0||proof.cleanupWin32Error!==0||result.exitCode!==0)fail('PROCESS_EXECUTION_NOT_SUCCESSFUL');
 return result;
}
export async function runGuarded({helper,helperSha256,executable,executableSha256,cwd,args,input='',timeoutMs=120000,maxOutputBytes=1048576,memoryMb=512}){
 const options={timeoutMs,maxOutputBytes,memoryMb};limits(options);
 if(process.platform!=='win32'||typeof cwd!=='string'||!path.win32.isAbsolute(cwd)||!Array.isArray(args)||types.isProxy(args)||Object.getPrototypeOf(args)!==Array.prototype||args.length>100||Object.keys(args).length!==args.length||args.some(arg=>typeof arg!=='string'||arg.includes('\0')||!arg.isWellFormed()||arg.length>8192)||typeof input!=='string'||!input.isWellFormed()||Buffer.byteLength(input)>65536)fail('PROCESS_REQUEST_BOUND');
 verifyImage(helper,helperSha256);verifyImage(executable,executableSha256);let total=0,overflow=false,closed=false,pipeError=null,timer;
 const output=[],errors=[],child=spawn(helper,[String(timeoutMs),String(maxOutputBytes),String(memoryMb),executable,cwd,...args],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],env:childEnv(process.env)});
 const envelopeLimit=maxOutputBytes*2+8192;
 for(const [stream,collector]of[[child.stdout,output],[child.stderr,errors]])stream.on('data',bytes=>{total+=bytes.length;if(total<=envelopeLimit)collector.push(bytes);else overflow=true;});
 child.stdin.on('error',error=>{pipeError=error.code??'PIPE';});child.stdin.end(input);
 const exit=await new Promise((resolve,reject)=>{
  timer=setTimeout(()=>reject(Object.assign(new Error('NATIVE_HELPER_CLOSE_UNCONFIRMED_NO_RETRY'),{code:'NATIVE_HELPER_CLOSE_UNCONFIRMED_NO_RETRY',helperPid:child.pid,cleanupSafe:false})),timeoutMs+12000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',(code,signal)=>{closed=true;clearTimeout(timer);resolve({code,signal});});
 });
 verifyImage(helper,helperSha256);verifyImage(executable,executableSha256);
 if(errors.length)fail('PROCESS_ENVELOPE_FAILED');
 return validateNativeEnvelope({text:utf8(Buffer.concat(output)),helperExitCode:exit.code,signal:exit.signal,closed,pipeError,overflow,helperPid:child.pid},options);
}
