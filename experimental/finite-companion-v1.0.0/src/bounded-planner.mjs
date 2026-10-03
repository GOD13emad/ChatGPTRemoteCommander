import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {argumentsFor,proposalSchema,validateModelResult,MODEL} from './model-contract.mjs';
import {runGuarded,requireSuccessfulExecution,verifyImage} from './native-process.mjs';
import {admitPlannerContext} from './planner-admission.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fail(code){throw Object.assign(new Error(code),{code});}
export function writeNew(file,value){const fd=fs.openSync(file,'wx',0o600);try{const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);const s=fs.fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.size!==bytes.length)fail('OWNED_RECORD_TYPE');}finally{fs.closeSync(fd);}}
export function readBounded(file,limit){if(!Number.isInteger(limit)||limit<1||limit>1048576)fail('PROPOSAL_READ_BOUND');const before=fs.lstatSync(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>limit)fail('PROPOSAL_FILE_BOUND');const fd=fs.openSync(file,'r');try{const s=fs.fstatSync(fd);if(s.dev!==before.dev||s.ino!==before.ino||s.size!==before.size||s.nlink!==1)fail('PROPOSAL_FILE_CHANGED');const buffer=Buffer.alloc(limit+1);let count=0;while(count<buffer.length){const n=fs.readSync(fd,buffer,count,buffer.length-count,count);if(!n)break;count+=n;}const after=fs.fstatSync(fd);if(count>limit||after.dev!==s.dev||after.ino!==s.ino||after.nlink!==1||after.size!==s.size||after.mtimeMs!==s.mtimeMs||after.ctimeMs!==s.ctimeMs||count!==s.size)fail('PROPOSAL_FILE_CHANGED');return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,count));}finally{fs.closeSync(fd);}}
export function createBoundedPlanner({recordRoot,helper,helperSha256,executable,executableSha256,maxCalls=2}){
 if(!path.win32.isAbsolute(recordRoot)||maxCalls!==2||!fs.lstatSync(recordRoot).isDirectory()||fs.readdirSync(recordRoot).length)fail('PLANNER_FRESH_ROOT_REQUIRED');
 verifyImage(helper,helperSha256);verifyImage(executable,executableSha256);let calls=0,busy=false,failed=false;const records=[];
 return Object.freeze({records:()=>Object.freeze([...records]),describe:()=>({model:MODEL,maxCalls:2,calls,failed,busy,toolsEnabled:false,retry:false}),
  async plan(context,{signal}={}){
   if(failed||busy||calls>=2||signal?.aborted)fail('PLANNER_LATCHED_OR_BUDGET');
   context=admitPlannerContext(context);
   busy=true;const call=++calls,root=path.join(recordRoot,'call-'+call);const intent={schema:1,phase:'RESERVED_BEFORE_MODEL',call,model:MODEL,context,at:new Date().toISOString(),maxCalls:2,automaticRetry:false};
   try{
    fs.mkdirSync(root);writeNew(path.join(root,'INTENT.json'),intent);writeNew(path.join(root,'proposal.schema.json'),proposalSchema);
    const prompt='You are a proposal-only controller for an explicitly owner-authorized finite Saeed host qualification. You have NO tools. Choose CONTINUE_STEP for the stated harmless predefined step if the owner and bounded budget are valid; otherwise STOP. Never invent or execute instructions. Respond only to the supplied schema. Context: '+JSON.stringify(context);
    const native=await runGuarded({helper,helperSha256,executable,executableSha256,cwd:root,args:argumentsFor(root),input:prompt,timeoutMs:45000,maxOutputBytes:65536,memoryMb:512});
    writeNew(path.join(root,'NATIVE_RESULT.json'),native);
    requireSuccessfulExecution(native);
    const artifact=readBounded(path.join(root,'proposal.json'),1024);
    const validated=validateModelResult({stdout:native.stdout,artifact,exitCode:native.exitCode,signal:native.signal,stderr:native.stderr,overflow:native.overflow,pipeError:native.pipeError});
    if(signal?.aborted)fail('PLANNER_ABORTED_AFTER_RESULT_NO_EFFECT');
    const record={schema:1,status:'PASS_MODEL_PROPOSAL_VALIDATED',call,model:MODEL,threadId:validated.threadId,usage:validated.usage,choice:validated.proposal.choice,streamSha256:sha(native.stdout),artifactSha256:sha(artifact),nativeProof:native.proof,knownDiagnostic:validated.knownDisabledToolDiagnostic,automaticRetry:false};
    writeNew(path.join(root,'RECEIPT.json'),record);records.push(record);return validated.proposal;
   }catch(error){failed=true;try{writeNew(path.join(root,'FAILURE.json'),{schema:1,status:'FAIL_PRESERVE_NO_RETRY',code:error.code??error.message,helperPid:error.helperPid??null,cleanupSafe:error.cleanupSafe??null,call,intent});}catch(secondary){error.collectorError=secondary.code??secondary.message;}throw error;}finally{busy=false;}
  }});
}
