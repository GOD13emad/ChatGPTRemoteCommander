// Read-only AT-SPI runner. Bound to the current owning Linux login session.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile);
const helper=fileURLToPath(new URL('../tools/native-linux-atspi.py',import.meta.url));
const fail=code=>Object.assign(new Error(code),{code});
function session(platform,env,uid){
 return platform==='linux'&&Number.isSafeInteger(uid)&&uid>0&&
  env?.XDG_RUNTIME_DIR==='/run/user/'+uid&&
  !!(env.DBUS_SESSION_BUS_ADDRESS||env.WAYLAND_DISPLAY||env.DISPLAY);
}
const parse=text=>{try{return JSON.parse(String(text).trim());}catch{return null;}};
export async function probeLinuxATSPI({platform=process.platform,env=process.env}={},{
 runner=execute,python='python3',scriptPath=helper,
 uid=typeof process.getuid==='function'?process.getuid():-1
}={}){
 if(!session(platform,env,uid))return {ready:false,code:'ATSPI_OWNER_SESSION_UNAVAILABLE'};
 try{
  const {stdout}=await runner(python,[scriptPath,'probe'],{
   shell:false,windowsHide:true,encoding:'utf8',timeout:4500,maxBuffer:8192,env});
  const v=parse(stdout);
  if(v?.ok===true&&v.provider==='linux-atspi-native'&&v.mode==='AT_SPI_PROBE'&&v.desktopAccessible===true)
   return {ready:true,provider:'linux-atspi-native'};
 }catch{}
 return {ready:false,code:'ATSPI_NATIVE_PROBE_FAILED'};
}
export async function observeLinuxATSPI(input={},{
 platform=process.platform,env=process.env,runner=execute,python='python3',
 scriptPath=helper,uid=typeof process.getuid==='function'?process.getuid():-1
}={}){
 if(!session(platform,env,uid))throw fail('ATSPI_OWNER_SESSION_UNAVAILABLE');
 if(!Number.isSafeInteger(input.pid)||input.pid<1||input.pid>2147483647||
    input.maxElements!==undefined&&(!Number.isInteger(input.maxElements)||
    input.maxElements<1||input.maxElements>100))throw fail('ATSPI_TARGET_INVALID');
 const max=input.maxElements??70;
 let stdout;
 try{
  ({stdout}=await runner(python,[scriptPath,'observe',String(input.pid),String(max)],{
   shell:false,windowsHide:true,encoding:'utf8',timeout:10000,maxBuffer:65536,env}));
 }catch{throw fail('ATSPI_NATIVE_OUTCOME_UNAVAILABLE');}
 const v=parse(stdout);
 if(v?.ok!==true||v.provider!=='linux-atspi-native'||v.mode!=='AT_SPI_OBSERVE'||
    v.pid!==input.pid||!Array.isArray(v.elements)||v.elements.length>max||
    v.elements.some(e=>typeof e.role!=='string'||e.role.length>100||
      typeof e.name!=='string'||e.name.length>160))
  throw fail('ATSPI_NATIVE_RESPONSE_UNTRUSTED');
 return v;
}
