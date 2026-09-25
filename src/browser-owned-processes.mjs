import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

export function browserProfileArgument(profileDir){
 if(typeof profileDir!=='string'||!profileDir)return null;
 return '--user-data-dir='+profileDir;
}
export function argvHasExactArgument(argv,argument){
 return Array.isArray(argv)&&typeof argument==='string'&&argv.some(value=>value===argument);
}
export function commandLineHasExactArgument(commandLine,argument){
 if(typeof commandLine!=='string'||typeof argument!=='string'||!argument)return false;
 const hay=commandLine.toLowerCase(),needle=argument.toLowerCase();
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
   if(argvHasExactArgument(argv,argument))found.push(pid);
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
