import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

const helper=new URL('../tools/browser-control.mjs',import.meta.url);
const profile=path.join(os.tmpdir(),'rc-browser-eof-'+process.pid+'-'+Date.now().toString(36));
const child=spawn(process.execPath,[helper.pathname.startsWith('/')&&process.platform==='win32'?helper.pathname.slice(1):helper.pathname,'--server'],{stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});
let stderr='';child.stderr.on('data',c=>stderr+=c.toString('utf8'));
const rl=createInterface({input:child.stdout,crlfDelay:Infinity});
const it=rl[Symbol.asyncIterator]();
const next=async()=>{
 const result=await Promise.race([it.next(),new Promise((_,reject)=>setTimeout(()=>reject(Error('HELPER_LINE_TIMEOUT')),10000))]);
 if(result.done)throw Error('HELPER_EOF '+stderr.slice(-500));
 return JSON.parse(result.value);
};
const send=o=>child.stdin.write(JSON.stringify(o)+'\n');
try{
 const ready=await next();if(ready.ok!==true||ready.ready!==true)throw Error('HELPER_NOT_READY');
 send({action:'status'});const status=await next();
 if(status.available!==true){
  console.log(JSON.stringify({status:'BROWSER_EOF_SKIP',reason:'NO_CHROMIUM_BROWSER'}));
 }else{
  send({action:'start',profileDir:profile,isolated:true});const started=await next();
  if(started.ok!==true||started.background!==true)throw Error('BROWSER_START_FAIL');
  const portFile=path.join(profile,'DevToolsActivePort');
  if(!fs.existsSync(portFile))throw Error('DEVTOOLS_PORT_FILE_MISSING');
  const port=Number(fs.readFileSync(portFile,'utf8').trim().split(/\r?\n/)[0]);
  if(!Number.isInteger(port)||port<1)throw Error('DEVTOOLS_PORT_INVALID');
  child.stdin.end();
  await Promise.race([once(child,'close'),new Promise((_,reject)=>setTimeout(()=>reject(Error('HELPER_CLOSE_TIMEOUT')),10000))]);
  let removed=false;
  for(let i=0;i<80;i++){if(!fs.existsSync(profile)){removed=true;break;}await new Promise(r=>setTimeout(r,50));}
  if(!removed)throw Error('ISOLATED_PROFILE_NOT_REMOVED_AFTER_EOF');
  let devtoolsAlive=false;
  try{const response=await fetch('http://127.0.0.1:'+port+'/json/version',{signal:AbortSignal.timeout(500)});devtoolsAlive=response.ok;}catch{}
  if(devtoolsAlive)throw Error('CHROMIUM_SURVIVED_HELPER_EOF');
  console.log(JSON.stringify({status:'BROWSER_EOF_CLEANUP_PASS',profileRemoved:true,devtoolsClosed:true}));
 }
}finally{
 rl.close();
 if(child.exitCode===null){try{child.stdin.end();}catch{}child.kill();}
 for(let i=0;i<10&&fs.existsSync(profile);i++){try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:50});}catch{}await new Promise(r=>setTimeout(r,50));}
}
