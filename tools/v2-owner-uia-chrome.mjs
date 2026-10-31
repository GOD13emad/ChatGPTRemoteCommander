// V2 native owner's read-only browser-chrome accessibility adapter.
// This is NOT an action broker or authentication. The upper-window geometry
// and Document-ancestor filters are privacy guards, not proof of chrome origin.
// Never read page content, URLs, passwords, cookies, profiles, DOM or clipboard.
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
// Bounding rectangles are untrusted location hints, never action authority.
// Filtering them before reading a UIA label reduces webpage-label exposure.
export function isOwnerUiaTopBandBounds({window,control}={}){
 const rect=r=>r&&typeof r==='object'&&['x','y','width','height'].every(k=>
  typeof r[k]==='number'&&Number.isFinite(r[k]))&&r.width>0&&r.height>0;
 if(!rect(window)||!rect(control))return false;
 const band=Math.min(150,Math.max(80,window.height*0.12));
 return control.width<=96&&control.height<=64&&
  control.x>=window.x&&control.y>=window.y&&
  control.x+control.width<=window.x+window.width&&
  control.y+control.height<=window.y+band;
}
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
    "$box=$root.Current.BoundingRectangle",
    "if($box.IsEmpty -or $box.Width -le 0 -or $box.Height -le 0){throw 'WINDOW_BOUNDS_UNAVAILABLE'}",
    "$band=[Math]::Min(150,[Math]::Max(80,$box.Height*0.12))",
    "$walker=[Windows.Automation.TreeWalker]::ControlViewWalker",
    "$document=[Windows.Automation.ControlType]::Document",
    "$allow=@('Back','Forward','Reload','Search','New Tab','Home','Downloads','Bookmark this tab')",
    "$found=New-Object 'System.Collections.Generic.List[string]'",
    "for($i=0;$i -lt $items.Count -and $found.Count -lt 16;$i++){",
    " try{$candidate=$items.Item($i)",
    " $b=$candidate.Current.BoundingRectangle",
    " if($candidate.Current.IsOffscreen -or $b.IsEmpty -or $b.Width -le 0 -or $b.Height -le 0 -or $b.Width -gt 96 -or $b.Height -gt 64){continue}",
    " if($b.X -lt $box.X -or $b.Y -lt $box.Y -or $b.Right -gt $box.Right -or $b.Bottom -gt ($box.Top+$band)){continue}",
    " $ancestor=$walker.GetParent($candidate);$atRoot=$false;$inDocument=$false",
    " for($depth=0;$depth -lt 32 -and $ancestor;$depth++){",
    "  if($ancestor.Equals($root)){$atRoot=$true;break}",
    "  if($ancestor.Current.ControlType -eq $document){$inDocument=$true;break}",
    "  $ancestor=$walker.GetParent($ancestor)",
    " }",
    " if(!$atRoot -or $inDocument){continue}",
    " $v=$candidate.Current.Name",
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
