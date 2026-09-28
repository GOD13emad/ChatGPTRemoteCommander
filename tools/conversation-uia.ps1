param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class RcConversationNative {
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static double IdleMilliseconds() {
    var li=new LASTINPUTINFO(); li.cbSize=(uint)Marshal.SizeOf(li);
    if(!GetLastInputInfo(ref li)) return 0;
    return Math.Max(0, Environment.TickCount64 - li.dwTime);
  }
}
"@

function Emit-Result([string]$State,[string]$Code,[hashtable]$Extra=@{}){
  $o=[ordered]@{ok=($State -in @('SENT','READY'));state=$State;code=$Code;at=(Get-Date).ToUniversalTime().ToString('o')}
  foreach($k in $Extra.Keys){$o[$k]=$Extra[$k]}
  $o|ConvertTo-Json -Depth 8 -Compress
}
function Get-Names([object]$Value,[string[]]$Fallback){
  $items=@()
  if($null-ne$Value){$items=@($Value|ForEach-Object{[string]$_}|Where-Object{$_})}
  if($items.Count-eq0){$items=$Fallback}
  return $items
}
function Get-Buttons($Root,[string[]]$Names){
  $buttons=$Root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button)))
  $matches=@()
  foreach($b in $buttons){
    try{
      $n=([string]$b.Current.Name).Trim()
      if($Names -contains $n){$matches+=$b}
    }catch{}
  }
  return @($matches)
}
function Get-Composers($Root,[string[]]$Names){
  $edits=$Root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit)))
  $matches=@()
  foreach($e in $edits){
    try{
      $n=([string]$e.Current.Name).Trim()
      if($Names -contains $n){$matches+=$e}
    }catch{}
  }
  return @($matches)
}
function Get-SelectedTab($Root){
  $tabs=$Root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::TabItem)))
  foreach($t in $tabs){
    try{
      $p=$t.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
      if($p.Current.IsSelected){return $t}
    }catch{}
  }
  return $null
}
function Find-Context([string]$Browser,[string]$Title){
  $procName=if($Browser -eq 'edge'){'msedge'}else{'chrome'}
  $matches=@()
  foreach($p in (Get-Process $procName -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle-ne0})){
    try{
      $root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
      $tabs=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
          [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
          [System.Windows.Automation.ControlType]::TabItem)))
      foreach($t in $tabs){
        try{
          if(([string]$t.Current.Name).Trim() -eq $Title){
            $matches += [pscustomobject]@{Process=$p;Root=$root;Tab=$t;Title=([string]$t.Current.Name).Trim()}
          }
        }catch{}
      }
    }catch{}
  }
  return @($matches)
}
function Inspect-Composer($Composer,[string[]]$Names){
  $vp=$Composer.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  if($vp.Current.IsReadOnly){return [pscustomobject]@{Empty=$false;Value='<READ_ONLY>';Pattern=$vp}}
  $v=([string]$vp.Current.Value).Trim()
  $empty=([string]::IsNullOrWhiteSpace($v) -or ($Names -contains $v))
  return [pscustomobject]@{Empty=$empty;Value=$v;Pattern=$vp}
}

$result=$null
$original=$null
$ctx=$null
$invoked=$false
$messageSet=$false

try{
  if([Threading.Thread]::CurrentThread.GetApartmentState().ToString() -ne 'MTA'){
    $result=@{State='DEFERRED';Code='UIA_MTA_REQUIRED';Extra=@{apartment=[Threading.Thread]::CurrentThread.GetApartmentState().ToString()}}
    throw [System.OperationCanceledException]::new('handled')
  }
  $req=Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8|ConvertFrom-Json
  $action=[string]$req.action
  $browser=[string]$req.browser
  $title=[string]$req.tabTitle
  if($action -notin @('status','send') -or $browser -notin @('chrome','edge') -or [string]::IsNullOrWhiteSpace($title)){
    $result=@{State='DEFERRED';Code='REQUEST_INVALID';Extra=@{}}
    throw [System.OperationCanceledException]::new('handled')
  }
  $composerNames=Get-Names $req.composerNames @('Ask ChatGPT')
  $sendNames=Get-Names $req.sendNames @('Send','Send prompt','Submit')
  $stopNames=Get-Names $req.stopNames @('Stop','Stop generating')
  $ctxs=Find-Context $browser $title
  if($ctxs.Count-eq0){
    $result=@{State='DEFERRED';Code='WAITING_FOR_CHAT_TAB';Extra=@{matchCount=0}}
    throw [System.OperationCanceledException]::new('handled')
  }
  if($ctxs.Count-ne1){
    $result=@{State='DEFERRED';Code='CHAT_TAB_AMBIGUOUS';Extra=@{matchCount=$ctxs.Count}}
    throw [System.OperationCanceledException]::new('handled')
  }
  $ctx=$ctxs[0]
  if($action -eq 'status'){
    $result=@{State='READY';Code='CHAT_TAB_FOUND';Extra=@{
      matchCount=1;title=$ctx.Title;processId=$ctx.Process.Id;windowHandle=[long]$ctx.Process.MainWindowHandle;
      minimized=[RcConversationNative]::IsIconic([IntPtr]$ctx.Process.MainWindowHandle);
      idleMs=[math]::Round([RcConversationNative]::IdleMilliseconds())
    }}
    throw [System.OperationCanceledException]::new('handled')
  }

  $idleRequired=[Math]::Max(5000,[int]($req.idleBeforeSendMs??12000))
  $idle=[RcConversationNative]::IdleMilliseconds()
  if($idle-lt$idleRequired){
    $result=@{State='DEFERRED';Code='USER_ACTIVE';Extra=@{idleMs=[math]::Round($idle);requiredMs=$idleRequired}}
    throw [System.OperationCanceledException]::new('handled')
  }
  $hwnd=[IntPtr]$ctx.Process.MainWindowHandle
  if([RcConversationNative]::IsIconic($hwnd)){
    $result=@{State='DEFERRED';Code='CHAT_WINDOW_MINIMIZED';Extra=@{}}
    throw [System.OperationCanceledException]::new('handled')
  }

  $original=Get-SelectedTab $ctx.Root
  $select=$ctx.Tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
  if(-not$select.Current.IsSelected){
    if([RcConversationNative]::GetForegroundWindow() -eq $hwnd){
      $result=@{State='DEFERRED';Code='FOREGROUND_TAB_SWITCH_REQUIRED';Extra=@{}}
      throw [System.OperationCanceledException]::new('handled')
    }
    $select.Select();Start-Sleep -Milliseconds 350
  }
  $root=[System.Windows.Automation.AutomationElement]::FromHandle($hwnd)

  if((Get-Buttons $root $stopNames).Count-gt0){
    $result=@{State='DEFERRED';Code='CHAT_BUSY';Extra=@{}}
    throw [System.OperationCanceledException]::new('handled')
  }

  $composers=Get-Composers $root $composerNames
  if($composers.Count-eq0){
    $result=@{State='DEFERRED';Code='COMPOSER_NOT_FOUND';Extra=@{}}
    throw [System.OperationCanceledException]::new('handled')
  }
  if($composers.Count-ne1){
    $result=@{State='DEFERRED';Code='COMPOSER_AMBIGUOUS';Extra=@{matchCount=$composers.Count}}
    throw [System.OperationCanceledException]::new('handled')
  }
  $check=Inspect-Composer $composers[0] $composerNames
  if(-not$check.Empty){
    $result=@{State='DEFERRED';Code='COMPOSER_NOT_EMPTY';Extra=@{}}
    throw [System.OperationCanceledException]::new('handled')
  }
  if(-not$composers[0].Current.IsEnabled){
    $result=@{State='DEFERRED';Code='COMPOSER_DISABLED';Extra=@{}}
    throw [System.OperationCanceledException]::new('handled')
  }

  $msg=[string]$req.message
  if([string]::IsNullOrWhiteSpace($msg) -or [Text.Encoding]::UTF8.GetByteCount($msg)-gt12000){
    $result=@{State='DEFERRED';Code='MESSAGE_INVALID';Extra=@{}}
    throw [System.OperationCanceledException]::new('handled')
  }
  $check.Pattern.SetValue($msg)
  $messageSet=$true
  Start-Sleep -Milliseconds 350

  $root=[System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
  $sends=@(Get-Buttons $root $sendNames|Where-Object{$_.Current.IsEnabled-and-not$_.Current.IsOffscreen})
  if($sends.Count-eq0){
    try{$check.Pattern.SetValue('');$messageSet=$false}catch{}
    $result=@{State='DEFERRED';Code='SEND_BUTTON_NOT_FOUND';Extra=@{}}
    throw [System.OperationCanceledException]::new('handled')
  }
  if($sends.Count-ne1){
    try{$check.Pattern.SetValue('');$messageSet=$false}catch{}
    $result=@{State='DEFERRED';Code='SEND_BUTTON_AMBIGUOUS';Extra=@{matchCount=$sends.Count}}
    throw [System.OperationCanceledException]::new('handled')
  }

  $invoke=$sends[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $invoke.Invoke()
  $invoked=$true
  $deadline=(Get-Date).AddMilliseconds([Math]::Max(1000,[int]($req.ackTimeoutMs??4500)))
  $ack=$false
  while((Get-Date)-lt$deadline-and-not$ack){
    Start-Sleep -Milliseconds 250
    try{
      $fresh=[System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
      $freshComposers=Get-Composers $fresh $composerNames
      if($freshComposers.Count-eq1){
        $after=Inspect-Composer $freshComposers[0] $composerNames
        if($after.Empty){$ack=$true;break}
      }
      if((Get-Buttons $fresh $stopNames).Count-gt0){$ack=$true;break}
    }catch{}
  }
  if(-not$ack){
    $result=@{State='UNCERTAIN';Code='SEND_NOT_ACKNOWLEDGED';Extra=@{invoked=$true}}
  }else{
    $result=@{State='SENT';Code='UI_ACKNOWLEDGED';Extra=@{
      invoked=$true;openedNewTab=$false;usedClipboard=$false;usedMouse=$false;title=$ctx.Title
    }}
  }
}catch [System.OperationCanceledException]{
  if($_.Exception.Message-ne'handled' -and -not$result){
    $result=@{State='UNCERTAIN';Code='UIA_HELPER_CANCELLED';Extra=@{}}
  }
}catch{
  if($invoked){
    $result=@{State='UNCERTAIN';Code='UIA_EXCEPTION_AFTER_INVOKE';Extra=@{error=$_.Exception.GetType().Name}}
  }else{
    if($messageSet){try{$check.Pattern.SetValue('')}catch{}}
    $result=@{State='DEFERRED';Code='UIA_EXCEPTION_BEFORE_INVOKE';Extra=@{error=$_.Exception.GetType().Name}}
  }
}finally{
  if($original){
    try{
      $p=$original.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
      if(-not$p.Current.IsSelected){$p.Select();Start-Sleep -Milliseconds 120}
    }catch{
      if($result -and $result.State -eq 'SENT'){$result.Extra.restoreWarning=$_.Exception.GetType().Name}
    }
  }
}

if(-not$result){$result=@{State='UNCERTAIN';Code='UIA_HELPER_FATAL';Extra=@{}}}
Emit-Result $result.State $result.Code $result.Extra
