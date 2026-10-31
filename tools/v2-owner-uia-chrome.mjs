// V2 native owner's read-only browser-chrome accessibility adapter.
// This is NOT an action broker, not authentication, and does not read page
// contents, URLs, passwords, cookies, profiles, DOM, or the clipboard.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {userInfo} from 'node:os';
import {mkdir,writeFile} from 'node:fs/promises';

const run=promisify(execFile);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const ALLOWED=Object.freeze(['Back','Forward','Reload','Search','New Tab','Home','Downloads','Bookmark this tab']);
const SET=new Set(ALLOWED);
const DEC=/^[1-9][0-9]{0,19}$/;
function positive(x){return typeof x==='string'&&DEC.test(x);}
export function normalizeOwnerUiaChrome(x){
 if(x?.status==='UNAVAILABLE')return Object.freeze({status:'UNAVAILABLE',controls:Object.freeze([])});
 if(x?.status!=='OBSERVED'||!Array.isArray(x.controls)||x.controls.length>16)
  fail('V2_OWNER_UIA_PROOF_INVALID');
 const controls=[];
 for(const v of x.controls)if(typeof v!=='string'||!SET.has(v)||controls.includes(v))
  fail('V2_OWNER_UIA_PROOF_INVALID');
 else controls.push(v);
 return Object.freeze({status:'OBSERVED',controls:Object.freeze(controls)});
}
export async function inspectOwnerUiaChrome({
 seat,pid,windowId,processStartTicks,probe
}={}){
 if(!Number.isSafeInteger(seat)||seat<1||seat>128||
    !Number.isSafeInteger(pid)||pid<1||!positive(windowId)||!positive(processStartTicks))
  fail('V2_OWNER_UIA_TARGET_INVALID');
 if(process.platform!=='win32'&&!probe)
  return normalizeOwnerUiaChrome({status:'UNAVAILABLE'});
 try{
  if(probe)return normalizeOwnerUiaChrome(await probe({seat,pid,windowId,processStartTicks}));
  const script=[
    "$ErrorActionPreference='Stop'",
    "$p=Get-Process -Id ([int]$env:RC_V2_OWNER_PID) -ErrorAction Stop",
    "if($p.SessionId -ne [int]$env:RC_V2_OWNER_SEAT){throw 'SEAT_CHANGED'}",
    "if($p.ProcessName.ToLowerInvariant() -notin @('brave','firefox','chrome','msedge')){throw 'NOT_BROWSER'}",
    "if(([long]$p.MainWindowHandle).ToString() -ne $env:RC_V2_OWNER_HWND){throw 'WINDOW_REPLACED'}",
    "if(([long]$p.StartTime.ToUniversalTime().Ticks).ToString() -ne $env:RC_V2_OWNER_START){throw 'PROCESS_REPLACED'}",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -AssemblyName UIAutomationTypes",
    "$root=[Windows.Automation.AutomationElement]::FromHandle([IntPtr]([long]$env:RC_V2_OWNER_HWND))",
    "if(!$root){throw 'UIA_UNAVAILABLE'}",
    "$button=[Windows.Automation.ControlType]::Button",
    "$condition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty,$button)",
    "$items=$root.FindAll([Windows.Automation.TreeScope]::Descendants,$condition)",
    "$allow=@('Back','Forward','Reload','Search','New Tab','Home','Downloads','Bookmark this tab')",
    "$found=New-Object 'System.Collections.Generic.List[string]'",
    "for($i=0;$i -lt $items.Count -and $found.Count -lt 16;$i++){",
    " try{$v=$items.Item($i).Current.Name",
    " if($v -in $allow -and !$found.Contains($v)){$found.Add($v)}}catch{}",
    "}",
    "$again=Get-Process -Id ([int]$env:RC_V2_OWNER_PID) -ErrorAction Stop",
    "if($again.SessionId -ne $p.SessionId -or [long]$again.MainWindowHandle -ne [long]$p.MainWindowHandle -or [long]$again.StartTime.ToUniversalTime().Ticks -ne [long]$p.StartTime.ToUniversalTime().Ticks){throw 'WINDOW_CHANGED_DURING_UIA'}",
    "[pscustomobject]@{status='OBSERVED';controls=@($found.ToArray())}|ConvertTo-Json -Depth 3 -Compress"
  ].join('\n');
  const ps=join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const {stdout}=await run(ps,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{
    windowsHide:true,timeout:6500,maxBuffer:4096,
    env:{...process.env,RC_V2_OWNER_PID:String(pid),RC_V2_OWNER_SEAT:String(seat),
      RC_V2_OWNER_HWND:windowId,RC_V2_OWNER_START:processStartTicks}
  });
  return normalizeOwnerUiaChrome(JSON.parse(stdout.trim()));
 }catch{return normalizeOwnerUiaChrome({status:'UNAVAILABLE'});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [,seatString,pidString,windowId,processStartTicks]=process.argv.slice(2);
 if(process.argv[2]!=='--read-only'||!positive(seatString)||!positive(pidString)||
   !positive(windowId)||!positive(processStartTicks)||process.argv.length!==7||
   process.platform!=='win32'||!process.env.LOCALAPPDATA||
   userInfo().username.toLowerCase()!==String(process.env.USERNAME||'').toLowerCase()){
   process.stderr.write('V2_OWNER_UIA_ARGS_INVALID\n');process.exitCode=2;
 }else{
  try{
   const result=await inspectOwnerUiaChrome({seat:Number(seatString),pid:Number(pidString),
     windowId,processStartTicks});
   const dir=join(process.env.LOCALAPPDATA,'ChatGPTRemoteCommander','V2OwnerSeat');
   await mkdir(dir,{recursive:true});
   await writeFile(join(dir,'uia-chrome.json'),JSON.stringify({
     schema:1,mode:'READ_ONLY',seat:Number(seatString),pid:Number(pidString),
     windowId,processStartTicks,result,credentialAccessed:false,
     actionAuthorized:false,at:new Date().toISOString()
   })+'\n',{flag:'w',mode:0o600});
  }catch{process.stderr.write('V2_OWNER_UIA_PROBE_FAILED\n');process.exitCode=2;}
 }
}
