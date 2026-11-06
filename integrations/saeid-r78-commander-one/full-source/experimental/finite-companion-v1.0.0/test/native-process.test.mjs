import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNativeEnvelope,requireSuccessfulExecution}from'../src/native-process.mjs';

// All fixtures are synthetic; no child process is launched by these tests.
const options={timeoutMs:1000,maxOutputBytes:1024,memoryMb:64};
const proof={schema:1,status:'COMPLETED',win32Error:0,cleanupWin32Error:0,cleanupConfirmed:true,pid:20,creationFileTime:'134354963942609784',assignedBeforeResume:true,exitCode:0,elapsedMs:50,activeJobProcesses:0,peakJobMemoryBytes:1024,ownedJobTerminated:false,stdoutHex:'4f4b0a',stderrHex:''};
const envelope=(native=proof,extra={})=>({text:JSON.stringify(native),helperExitCode:native.status==='COMPLETED'?0:1,signal:null,closed:true,pipeError:null,overflow:false,helperPid:10,...extra});
const validate=(native=proof,extra={})=>validateNativeEnvelope(envelope(native,extra),options);
test('exact natural completion accepted and frozen',()=>{const result=validate();assert.equal(result.stdout,'OK\n');assert.equal(requireSuccessfulExecution(result),result);assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.proof));});
test('native false positive preserves failure proof but cannot pass target exit zero',()=>{const result=validate({...proof,status:'DESCENDANTS_AFTER_ROOT_EXIT',ownedJobTerminated:true});assert.equal(result.exitCode,0);assert.equal(result.helperExitCode,1);assert.throws(()=>requireSuccessfulExecution(result));});
test('natural target nonzero cannot become successful',()=>assert.throws(()=>requireSuccessfulExecution(validate({...proof,exitCode:7}))));
test('unvalidated lookalike result has no acceptance identity',()=>assert.throws(()=>requireSuccessfulExecution({...validate()})));
for(const [key,value]of[['schema',2],['win32Error','0'],['win32Error',-1],['cleanupWin32Error',0.5],['cleanupConfirmed','true'],['assignedBeforeResume',1],['ownedJobTerminated',null],['pid',1.5],['pid',-1],['exitCode','0'],['elapsedMs',-1],['elapsedMs',13001],['activeJobProcesses',9],['peakJobMemoryBytes',67108865],['peakJobMemoryBytes','1'],['creationFileTime',134354963942609784],['creationFileTime','01'],['creationFileTime','18446744073709551616'],['stdoutHex','ffx'],['stderrHex','a'],['status','SOMETHING_NEW']])test('schema rejects '+key+'='+String(value),()=>assert.throws(()=>validate({...proof,[key]:value})));
for(const [key,value]of[['helperExitCode',1],['signal','SIGTERM'],['closed',false],['pipeError','EPIPE'],['overflow',true],['helperPid',0]])test('completed envelope rejects '+key,()=>assert.throws(()=>validate(proof,{[key]:value})));
for(const delta of[{assignedBeforeResume:false},{pid:0},{creationFileTime:'0'},{pid:10},{cleanupWin32Error:5,cleanupConfirmed:false},{activeJobProcesses:1,cleanupConfirmed:false},{ownedJobTerminated:true},{win32Error:1}])test('completed contradicting proof '+JSON.stringify(delta),()=>assert.throws(()=>validate({...proof,...delta})));
test('known native error with unconfirmed cleanup remains diagnostic only',()=>{const result=validate({...proof,status:'WALL_DEADLINE',ownedJobTerminated:true,cleanupWin32Error:258,cleanupConfirmed:false,activeJobProcesses:1});assert.equal(result.proof.cleanupConfirmed,false);assert.throws(()=>requireSuccessfulExecution(result));});
test('cleanup contradiction and error/helper exit disagreement denied',()=>{assert.throws(()=>validate({...proof,status:'WALL_DEADLINE',activeJobProcesses:1,cleanupConfirmed:true}));assert.throws(()=>validate({...proof,status:'WALL_DEADLINE'},{helperExitCode:0}));});
test('duplicate decoded JSON keys denied',()=>{const text=JSON.stringify(proof).replace('"schema":1','"schema":1,"\\u0073chema":1');assert.throws(()=>validateNativeEnvelope(envelope(proof,{text}),options));});
test('strict UTF8 refuses corrupt target stdout and stderr',()=>{assert.throws(()=>validate({...proof,stdoutHex:'ff'}));assert.throws(()=>validate({...proof,stderrHex:'c328'}));});
test('output bound applies to total bytes across stdout/stderr',()=>assert.throws(()=>validate({...proof,stdoutHex:'00'.repeat(1024),stderrHex:'00'})));
test('exact JSON excludes additional/missing fields',()=>{assert.throws(()=>validate({...proof,unexpected:true}));const missing={...proof};delete missing.exitCode;assert.throws(()=>validate(missing));});
test('request limits bounded without launching children',()=>{for(const delta of[{timeoutMs:99},{timeoutMs:180001},{maxOutputBytes:63},{maxOutputBytes:1048577},{memoryMb:63},{memoryMb:1025},{memoryMb:64.1}])assert.throws(()=>validateNativeEnvelope(envelope(),{...options,...delta}));});
