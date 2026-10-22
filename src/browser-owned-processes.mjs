import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// A browser launcher can exit after handing off its custom profile to a child.
// A short grace period is allowed only when that exact profile produces its
// DevToolsActivePort file. Nothing is attached to a personal/default profile.
export async function waitForBrowserDevToolsPort(portFile,child,{waitMs=6000,exitGraceMs=2500,pollMs=25}={}){
 const started=Date.now();
 let parentExitAt=null;
 for(;;){
  if(fs.existsSync(portFile)){
   const lines=fs.readFileSync(portFile,'utf8').trim().split(/\r?\n/);
   const port=Number(lines[0]);
   if(Number.isInteger(port)&&port>0&&port<=65535)return port;
  }
  const now=Date.now();
  if(child.exitCode!==null){
   if(parentExitAt===null)parentExitAt=now;
   if(now-parentExitAt>=exitGraceMs)throw new Error('BROWSER_LAUNCH_FAILED');
  }
  if(now-started>=waitMs)break;
  await new Promise(resolve=>setTimeout(resolve,Math.max(1,Math.min(pollMs,waitMs-(now-started)))));
 }
 throw new Error(child.exitCode!==null?'BROWSER_LAUNCH_FAILED':'BROWSER_DEVTOOLS_TIMEOUT');
}

export function browserProfileArgument(profileDir){
 if(typeof profileDir!=='string'||!profileDir)return null;
 return '--user-data-dir='+profileDir;
}
export function argvHasExactArgument(argv,argument){
 return Array.isArray(argv)&&typeof argument==='string'&&argv.some(value=>value===argument);
}
export function commandLineHasExactArgument(commandLine,argument,{caseSensitive=false}={}){
 if(typeof commandLine!=='string'||typeof argument!=='string'||!argument)return false;
 const hay=caseSensitive?commandLine:commandLine.toLowerCase(),needle=caseSensitive?argument:argument.toLowerCase();
 let from=0;
 while(from<=hay.length-needle.length){
  const i=hay.indexOf(needle,from);if(i<0)return false;
  const before=i===0||/\s|"/.test(commandLine[i-1]);
  const end=i+argument.length;
  const after=end===commandLine.length||/\s|"/.test(commandLine[end]);
  if(before&&after)return true;
  from=i+1;
 }
 return false;
}
// Chromium on Linux may rewrite /proc/<pid>/cmdline into a single space-
 // delimited process-title string rather than NUL-separated argv. Accept that
 // fallback only when /proc/<pid>/exe resolves to a known browser executable.
 // Preserve exact argument boundary matching: a profile-prefix sibling cannot
 // be mistaken for the owned profile.
const linuxBrowserExecutables=new Set([
 'chrome','chromium','chromium-browser','brave','brave-browser',
 'microsoft-edge','msedge','chrome-headless-shell','headless_shell'
]);
export function linuxCommandLineHasOwnedBrowserProfile(argv,argument,executable){
 if(argvHasExactArgument(argv,argument))return true;
 if(!Array.isArray(argv)||argv.length!==1||typeof argv[0]!=='string'||typeof executable!=='string')return false;
 if(!linuxBrowserExecutables.has(path.basename(executable)))return false;
 return commandLineHasExactArgument(argv[0],argument,{caseSensitive:true});
}
function windowsProcessesWithProfileArgs(){
 const script="[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match '--user-data-dir=' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
 for(const exe of ['pwsh.exe','powershell.exe']){
  const r=spawnSync(exe,['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,shell:false,timeout:6000,maxBuffer:4*1024*1024});
  if(r.error?.code==='ENOENT')continue;
  if(r.status!==0||!String(r.stdout??'').trim())return [];
  try{
   const parsed=JSON.parse(String(r.stdout).trim());
   return Array.isArray(parsed)?parsed:[parsed];
  }catch{return [];}
 }
 return [];
}
export function findProcessesUsingBrowserProfile(profileDir,{platform=process.platform,selfPid=process.pid}={}){
 const argument=browserProfileArgument(profileDir);if(!argument)return [];
 const found=[];
 if(platform==='win32'){
  for(const row of windowsProcessesWithProfileArgs()){
   const pid=Number(row?.ProcessId);
   if(Number.isInteger(pid)&&pid>0&&pid!==selfPid&&commandLineHasExactArgument(row?.CommandLine,argument))found.push(pid);
  }
  return [...new Set(found)];
 }
 if(platform==='linux'){
  let entries=[];try{entries=fs.readdirSync('/proc');}catch{return [];}
  for(const name of entries){
   if(!/^\d+$/.test(name))continue;
   const pid=Number(name);if(pid===selfPid)continue;
   let argv;try{argv=fs.readFileSync('/proc/'+name+'/cmdline','utf8').split('\0').filter(Boolean);}catch{continue;}
   if(argvHasExactArgument(argv,argument)){found.push(pid);continue;}
   // Do not trust an arbitrary process that merely mentions a profile path.
   // Chrome's rewritten process title is eligible only with Chrome's real exe.
   if(argv.length!==1||!argv[0].includes(argument))continue;
   let exe;try{exe=fs.readlinkSync('/proc/'+name+'/exe');}catch{continue;}
   if(linuxCommandLineHasOwnedBrowserProfile(argv,argument,exe))found.push(pid);
  }
 }
 return [...new Set(found)];
}
export function terminateProcessesUsingBrowserProfile(profileDir,options={}){
 const platform=options.platform??process.platform;
 const pids=findProcessesUsingBrowserProfile(profileDir,{platform,selfPid:options.selfPid??process.pid});
 for(const pid of pids){
  if(platform==='win32'){
   try{spawnSync('taskkill.exe',['/PID',String(pid),'/T','/F'],{stdio:'ignore',windowsHide:true,shell:false,timeout:6000});}catch{}
  }else{
   try{process.kill(pid,'SIGKILL');}catch{}
  }
 }
 return pids;
}
