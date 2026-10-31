import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
const script=fileURLToPath(new URL('../tools/native-windows-uia.ps1',import.meta.url));
const positive=v=>Number.isSafeInteger(v)&&v>0&&v<=2147483647;
const windowHandle=v=>Number.isSafeInteger(v)&&v>0;
const finger=/^[a-f0-9]{24}$/;
const request=/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
function fail(code){return Object.assign(new Error(code),{code});}
// This runner never launches a daemon, never runs shell fragments and never elevates.
// Windows UIA executes only under the already-authorized owning principal.
export async function nativeWindowsUIACall(operation,input={},{
 platform=process.platform,runner=exec,scriptPath=script,powershell='pwsh.exe'
}={}){
 if(platform!=='win32')throw fail('AGENTOS_NATIVE_WINDOWS_ONLY');
 if(!['Observe','Invoke'].includes(operation)||!positive(input.pid)||!windowHandle(input.windowId))
  throw fail('AGENTOS_NATIVE_INPUT_INVALID');
 const args=['-NoLogo','-NoProfile','-NonInteractive','-File',scriptPath,
  '-Operation',operation,'-TargetPid',String(input.pid),'-WindowHandle',String(input.windowId)];
 if(operation==='Observe'){
  if(input.maxElements!==undefined&&(!Number.isInteger(input.maxElements)||input.maxElements<1||input.maxElements>100))
   throw fail('AGENTOS_NATIVE_INPUT_INVALID');
  args.push('-MaxElements',String(input.maxElements??70));
 }else{
  if(!finger.test(input.fingerprint??'')||typeof input.controlName!=='string'||!input.controlName.length
    ||input.controlName.length>150||!request.test(input.requestId??'')
    ||typeof input.explicitUserAuthorization!=='string'||input.explicitUserAuthorization.trim().length<12
    ||input.explicitUserAuthorization.length>512)throw fail('AGENTOS_NATIVE_INVOKE_CONTRACT_INVALID');
  args.push('-Fingerprint',input.fingerprint,'-ControlName',input.controlName,
    '-RequestId',input.requestId,'-ExplicitUserAuthorization',input.explicitUserAuthorization);
 }
 let stdout;
 try{({stdout}=await runner(powershell,args,{
  shell:false,windowsHide:true,encoding:'utf8',timeout:operation==='Observe'?11000:14000,
  maxBuffer:128*1024
 }));}catch(e){
  if(e?.code==='ENOENT')throw fail('AGENTOS_NATIVE_POWERSHELL_UNAVAILABLE');
  // The process may have issued its action before transport failure: no replay.
  throw fail('AGENTOS_NATIVE_OUTCOME_UNCERTAIN');
 }
 let response;
 try{response=JSON.parse(stdout.trim());}catch{throw fail('AGENTOS_NATIVE_RESPONSE_INVALID');}
 const foregroundValid=(response?.foregroundStatus==='PRESERVED'&&response?.foregroundTouched===false)
  ||(response?.foregroundStatus==='CHANGED'&&response?.foregroundTouched===true)
  ||(response?.foregroundStatus==='UNOBSERVABLE'&&response?.foregroundTouched===null);
 if(response?.ok!==true||response?.pid!==input.pid||response?.windowHandle!==input.windowId
   ||response?.provider!=='windows-uia-native'||response?.physicalInputTouched!==false
   ||!foregroundValid)throw fail('AGENTOS_NATIVE_RESPONSE_UNTRUSTED');
 if(operation==='Observe'){
  if(response.mode!=='NATIVE_UIA_OBSERVE'||!Array.isArray(response.elements)
    ||response.elements.length>100
    ||response.elements.some(x=>typeof x.name!=='string'||typeof x.fingerprint!=='string'||!finger.test(x.fingerprint)))
   throw fail('AGENTOS_NATIVE_RESPONSE_UNTRUSTED');
 }else if(response.mode!=='NATIVE_UIA_INVOKE'||response.requestId!==input.requestId
  ||response.invocationIssued!==true||response.userGoalVerified!==false)
  throw fail('AGENTOS_NATIVE_RESPONSE_UNTRUSTED');
 return response;
}
