// Advisory-only native dispatcher census. This is NOT synchronization,
// a security boundary, or evidence that no command can be dispatched.
// Never expose command lines, tokens, arguments, or GUI content.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
const execFileAsync=promisify(execFile);

const windowsQuery=String.raw`$ErrorActionPreference='Stop'
$rows=@()
$procs=Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='pwsh.exe' OR Name='powershell.exe'"
foreach($p in $procs){
  $c=[string]$p.CommandLine
  $role=$null
  if($c -match '(?i)server-v0(?:[.]3|[.]2(?:[.]1)?)?[.]mjs'){$role='core'}
  elseif($c -match '(?i)gui-control[.]ps1' -and $c -match '(?i)-Server'){$role='native-helper'}
  if($null -ne $role){
    $rows+=@{pid=[int]$p.ProcessId;session=[int]$p.SessionId;role=$role}
  }
}
@{complete=$true;rows=@($rows)}|ConvertTo-Json -Depth 4 -Compress`;

const linuxMatch=(command)=>{
  if(/(?:^|\/)server-v0(?:\.3|\.2(?:\.1)?)?\.mjs(?:\s|$)/i.test(command))return 'core';
  if(/(?:^|\/)gui-control-linux\.py(?:\s|$)/i.test(command)&&/(?:^|\s)--server(?:\s|$)/i.test(command))return 'native-helper';
  return null;
};
async function scanLinux(){
  const entries=await fs.readdir('/proc',{withFileTypes:true});
  const rows=[];let uncertain=0;
  for(const entry of entries){
    if(!entry.isDirectory()||!/^[0-9]+$/.test(entry.name))continue;
    const pid=Number(entry.name);
    let raw;
    try{raw=await fs.readFile('/proc/'+pid+'/cmdline');}
    catch(error){if(error?.code==='ENOENT'||error?.code==='ESRCH')continue;uncertain++;continue;}
    // Command lines are kept in process memory only. Never return them.
    const args=raw.toString('utf8').split('\0').filter(Boolean);
    const role=linuxMatch(args.join(' '));
    if(!role)continue;
    let session=null;
    try{
      const stat=await fs.readFile('/proc/'+pid+'/stat','utf8');
      const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');
      const value=Number(fields[3]);if(Number.isSafeInteger(value))session=value;
    }catch{uncertain++;}
    rows.push({pid,session,role});
  }
  return {complete:uncertain===0,rows,unreadableProcessRecords:uncertain};
}
function validateRows(parsed){
  if(!parsed||typeof parsed!=='object'||!Array.isArray(parsed.rows)||parsed.rows.length>1024)
    throw Error('GUI_DISPATCHER_SCAN_INVALID');
  return parsed.rows.map(row=>{
    if(!Number.isSafeInteger(row.pid)||row.pid<1||
      !Number.isSafeInteger(row.session)||row.session<0||
      !['core','native-helper'].includes(row.role))
      throw Error('GUI_DISPATCHER_SCAN_INVALID');
    return {pid:row.pid,session:row.session,role:row.role};
  });
}
export async function scanGuiDispatchers({platform=process.platform}={}){
  try{
    let result;
    if(platform==='win32'){
      const out=await execFileAsync('pwsh.exe',['-NoProfile','-NonInteractive','-Command',windowsQuery],{
        windowsHide:true,timeout:8000,maxBuffer:131072
      });
      result=JSON.parse(out.stdout.trim());
    }else if(platform==='linux'){
      result=await scanLinux();
    }else throw Error('GUI_DISPATCHER_PLATFORM_UNSUPPORTED');
    const rows=validateRows(result).sort((a,b)=>a.pid-b.pid);
    return {
      scan:'ADVISORY_ONLY',coverage:result.complete===true?'PROCESS_CENSUS_ONLY':'INCOMPLETE',
      active:rows,activeCount:rows.length,
      quiescenceProven:false,releaseAuthorized:false,noReplay:true,
      limits:'A process census is not a cross-session native dispatch barrier'
    };
  }catch{
    // Enumeration failure MUST NOT be interpreted as zero dispatchers.
    return {scan:'FAILED',coverage:'UNKNOWN',active:null,activeCount:null,
      quiescenceProven:false,releaseAuthorized:false,noReplay:true,
      limits:'Dispatcher enumeration failed; no native coordination proven'};
  }
}
