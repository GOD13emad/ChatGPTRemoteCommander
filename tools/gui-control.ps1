$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'GUI control is currently supported on Windows only.' }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$nativeSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class RcGuiNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  public sealed class WindowInfo {
    public long Handle { get; set; }
    public string Title { get; set; }
    public int ProcessId { get; set; }
  }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint nInputs, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion { [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  const uint INPUT_KEYBOARD = 1;
  const uint MOUSE_MOVE = 0x0001;
  const uint MOUSE_LEFTDOWN = 0x0002;
  const uint MOUSE_LEFTUP = 0x0004;
  const uint MOUSE_RIGHTDOWN = 0x0008;
  const uint MOUSE_RIGHTUP = 0x0010;
  const uint MOUSE_MIDDLEDOWN = 0x0020;
  const uint MOUSE_MIDDLEUP = 0x0040;
  const uint MOUSE_WHEEL = 0x0800;
  const uint MOUSE_HWHEEL = 0x1000;
  const uint KEYEVENTF_KEYUP = 0x0002;
  const uint KEYEVENTF_UNICODE = 0x0004;

  public static POINT Cursor() {
    POINT p;
    if (!GetCursorPos(out p)) throw new InvalidOperationException("GetCursorPos failed");
    return p;
  }

  static void MouseFlags(string button, bool down) {
    uint flag;
    switch ((button ?? "left").ToLowerInvariant()) {
      case "right": flag = down ? MOUSE_RIGHTDOWN : MOUSE_RIGHTUP; break;
      case "middle": flag = down ? MOUSE_MIDDLEDOWN : MOUSE_MIDDLEUP; break;
      default: flag = down ? MOUSE_LEFTDOWN : MOUSE_LEFTUP; break;
    }
    mouse_event(flag, 0, 0, 0, UIntPtr.Zero);
  }

  public static void Click(string button, int clicks, int intervalMs) {
    clicks = Math.Max(1, Math.Min(10, clicks));
    for (int i = 0; i < clicks; i++) {
      MouseFlags(button, true);
      System.Threading.Thread.Sleep(20);
      MouseFlags(button, false);
      if (i + 1 < clicks) System.Threading.Thread.Sleep(Math.Max(20, intervalMs));
    }
  }

  public static void MouseDown(string button) { MouseFlags(button, true); }
  public static void MouseUp(string button) { MouseFlags(button, false); }
  public static void MoveRelative(int dx, int dy) {
    mouse_event(MOUSE_MOVE, unchecked((uint)dx), unchecked((uint)dy), 0, UIntPtr.Zero);
  }
  public static void Scroll(int delta, bool horizontal) {
    mouse_event(horizontal ? MOUSE_HWHEEL : MOUSE_WHEEL, 0, 0, unchecked((uint)delta), UIntPtr.Zero);
  }

  static byte KeyCode(string name) {
    if (String.IsNullOrWhiteSpace(name)) throw new ArgumentException("key is required");
    string n = name.Trim().ToUpperInvariant();
    switch (n) {
      case "CTRL": case "CONTROL": return 0x11;
      case "SHIFT": return 0x10;
      case "ALT": return 0x12;
      case "WIN": case "WINDOWS": return 0x5B;
      case "ENTER": case "RETURN": return 0x0D;
      case "TAB": return 0x09;
      case "ESC": case "ESCAPE": return 0x1B;
      case "SPACE": return 0x20;
      case "BACKSPACE": return 0x08;
      case "DELETE": case "DEL": return 0x2E;
      case "INSERT": case "INS": return 0x2D;
      case "HOME": return 0x24;
      case "END": return 0x23;
      case "PAGEUP": case "PGUP": return 0x21;
      case "PAGEDOWN": case "PGDN": return 0x22;
      case "LEFT": return 0x25;
      case "UP": return 0x26;
      case "RIGHT": return 0x27;
      case "DOWN": return 0x28;
    }
    if (n.Length == 1) {
      char c = n[0];
      if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return (byte)c;
    }
    int fn;
    if (n.StartsWith("F") && Int32.TryParse(n.Substring(1), out fn) && fn >= 1 && fn <= 24)
      return (byte)(0x70 + fn - 1);
    throw new ArgumentException("unsupported key: " + name);
  }

  public static void KeyCombo(string[] keys, int holdMs) {
    if (keys == null || keys.Length == 0) throw new ArgumentException("keys are required");
    var codes = new List<byte>();
    foreach (var key in keys) {
      byte code = KeyCode(key);
      codes.Add(code);
      keybd_event(code, 0, 0, UIntPtr.Zero);
      System.Threading.Thread.Sleep(10);
    }
    if (holdMs > 0) System.Threading.Thread.Sleep(Math.Min(holdMs, 5000));
    for (int i = codes.Count - 1; i >= 0; i--) {
      keybd_event(codes[i], 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
      System.Threading.Thread.Sleep(10);
    }
  }

  public static void TypeUnicode(string text, int intervalMs) {
    if (text == null) text = "";
    intervalMs = Math.Max(0, Math.Min(1000, intervalMs));
    foreach (char ch in text) {
      var inputs = new INPUT[] {
        new INPUT { type = INPUT_KEYBOARD, U = new InputUnion { ki = new KEYBDINPUT { wVk = 0, wScan = ch, dwFlags = KEYEVENTF_UNICODE } } },
        new INPUT { type = INPUT_KEYBOARD, U = new InputUnion { ki = new KEYBDINPUT { wVk = 0, wScan = ch, dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP } } }
      };
      if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length)
        throw new InvalidOperationException("SendInput Unicode failed");
      if (intervalMs > 0) System.Threading.Thread.Sleep(intervalMs);
    }
  }

  public static List<WindowInfo> ListWindows() {
    var result = new List<WindowInfo>();
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      int len = GetWindowTextLength(hWnd);
      if (len <= 0) return true;
      var sb = new StringBuilder(len + 1);
      GetWindowText(hWnd, sb, sb.Capacity);
      string title = sb.ToString();
      if (String.IsNullOrWhiteSpace(title)) return true;
      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      result.Add(new WindowInfo { Handle = hWnd.ToInt64(), Title = title, ProcessId = (int)pid });
      return true;
    }, IntPtr.Zero);
    return result;
  }

  public static bool FocusWindow(long handle) {
    IntPtr hWnd = new IntPtr(handle);
    ShowWindow(hWnd, 9);
    return SetForegroundWindow(hWnd);
  }
}
'@

Add-Type -TypeDefinition $nativeSource -Language CSharp

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { throw 'GUI request JSON is required on stdin.' }
$req = $raw | ConvertFrom-Json
$action = [string]$req.action

function Get-ScreenBounds([int]$screenIndex = 0) {
  if ($screenIndex -ge 0) {
    $screens = [System.Windows.Forms.Screen]::AllScreens
    if ($screenIndex -ge $screens.Length) { throw "screen index out of range: $screenIndex" }
    return $screens[$screenIndex].Bounds
  }
  return [System.Windows.Forms.SystemInformation]::VirtualScreen
}

function Resolve-Point($request) {
  $bounds = Get-ScreenBounds ([int]($request.screenIndex ?? 0))
  $mode = if ($request.coordinateMode) { [string]$request.coordinateMode } else { 'absolute' }
  if ($mode -eq 'relative') {
    $rx = [double]$request.x
    $ry = [double]$request.y
    if ($rx -lt 0 -or $rx -gt 1 -or $ry -lt 0 -or $ry -gt 1) { throw 'relative x/y must be between 0 and 1' }
    return @{
      X = $bounds.Left + [int][Math]::Round($rx * [Math]::Max(0, $bounds.Width - 1))
      Y = $bounds.Top + [int][Math]::Round($ry * [Math]::Max(0, $bounds.Height - 1))
    }
  }
  return @{ X = [int]$request.x; Y = [int]$request.y }
}

$result = switch ($action) {
  'status' {
    $screens = @()
    $all = [System.Windows.Forms.Screen]::AllScreens
    for ($i = 0; $i -lt $all.Length; $i++) {
      $b = $all[$i].Bounds
      $screens += @{ index=$i; primary=$all[$i].Primary; deviceName=$all[$i].DeviceName; left=$b.Left; top=$b.Top; width=$b.Width; height=$b.Height }
    }
    @{ ok=$true; interactive=[Environment]::UserInteractive; session=[System.Diagnostics.Process]::GetCurrentProcess().SessionId; screens=$screens }
  }
  'screenshot' {
    $bounds = Get-ScreenBounds ([int]($req.screenIndex ?? 0))
    $bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
      $format = if ($req.format) { ([string]$req.format).ToLowerInvariant() } else { 'jpeg' }
      $stream = [System.IO.MemoryStream]::new()
      try {
        if ($format -eq 'png') {
          $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png); $mime='image/png'
        } else {
          $quality=[Math]::Max(25,[Math]::Min(95,[int]($req.quality ?? 75)))
          $codec=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg' | Select-Object -First 1
          $params=[System.Drawing.Imaging.EncoderParameters]::new(1)
          $params.Param[0]=[System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality,[long]$quality)
          $bitmap.Save($stream,$codec,$params); $mime='image/jpeg'
        }
        @{ ok=$true; mimeType=$mime; data=[Convert]::ToBase64String($stream.ToArray()); left=$bounds.Left; top=$bounds.Top; width=$bounds.Width; height=$bounds.Height; screenIndex=[int]($req.screenIndex ?? 0) }
      } finally { $stream.Dispose() }
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }
  'cursor' { $p=[RcGuiNative]::Cursor(); @{ok=$true;x=$p.X;y=$p.Y} }
  'move' {
    $p=Resolve-Point $req
    if(-not [RcGuiNative]::SetCursorPos($p.X,$p.Y)){throw 'SetCursorPos failed'}
    @{ok=$true;x=$p.X;y=$p.Y}
  }
  'moveRelative' {
    [RcGuiNative]::MoveRelative([int]$req.dx,[int]$req.dy)
    $p=[RcGuiNative]::Cursor()
    @{ok=$true;dx=[int]$req.dx;dy=[int]$req.dy;x=$p.X;y=$p.Y}
  }
  'scroll' {
    [RcGuiNative]::Scroll([int]$req.delta,[bool]($req.horizontal ?? $false))
    @{ok=$true;delta=[int]$req.delta;horizontal=[bool]($req.horizontal ?? $false)}
  }
  'click' {
    $p=Resolve-Point $req
    if(-not [RcGuiNative]::SetCursorPos($p.X,$p.Y)){throw 'SetCursorPos failed'}
    [RcGuiNative]::Click([string]($req.button ?? 'left'),[int]($req.clicks ?? 1),[int]($req.intervalMs ?? 120))
    @{ok=$true;x=$p.X;y=$p.Y;button=[string]($req.button ?? 'left');clicks=[int]($req.clicks ?? 1)}
  }
  'drag' {
    $from=Resolve-Point $req.from; $to=Resolve-Point $req.to
    $duration=[Math]::Max(50,[Math]::Min(10000,[int]($req.durationMs ?? 500)))
    $steps=[Math]::Max(2,[Math]::Min(120,[int]($req.steps ?? 24)))
    [RcGuiNative]::SetCursorPos($from.X,$from.Y)|Out-Null
    [RcGuiNative]::MouseDown([string]($req.button ?? 'left'))
    try {
      for($i=1;$i -le $steps;$i++){
        $x=[int][Math]::Round($from.X+(($to.X-$from.X)*$i/$steps))
        $y=[int][Math]::Round($from.Y+(($to.Y-$from.Y)*$i/$steps))
        [RcGuiNative]::SetCursorPos($x,$y)|Out-Null
        Start-Sleep -Milliseconds ([Math]::Max(1,[int]($duration/$steps)))
      }
    } finally { [RcGuiNative]::MouseUp([string]($req.button ?? 'left')) }
    @{ok=$true;from=$from;to=$to;durationMs=$duration}
  }
  'typeText' {
    $text=[string]($req.text ?? '')
    if($text.Length -gt 4096){throw 'text exceeds 4096 characters'}
    $interval=[Math]::Max(0,[Math]::Min(1000,[int]($req.intervalMs ?? 0)))
    [RcGuiNative]::TypeUnicode($text,$interval)
    @{ok=$true;characters=$text.Length;intervalMs=$interval}
  }
  'keyPress' {
    $keys=@($req.keys|ForEach-Object{[string]$_})
    [RcGuiNative]::KeyCombo($keys,[int]($req.holdMs ?? 0))
    @{ok=$true;keys=$keys;holdMs=[int]($req.holdMs ?? 0)}
  }
  'listWindows' { $items=@([RcGuiNative]::ListWindows()); @{ok=$true;count=$items.Count;windows=$items} }
  'focusWindow' {
    $items=@([RcGuiNative]::ListWindows()); $target=$null
    if($req.handle){$target=$items|Where-Object{$_.Handle -eq [long]$req.handle}|Select-Object -First 1}
    elseif($req.titleContains){$needle=[string]$req.titleContains;$target=$items|Where-Object{$_.Title.IndexOf($needle,[StringComparison]::OrdinalIgnoreCase)-ge 0}|Select-Object -First 1}
    if(-not $target){throw 'window not found'}
    $focused=[RcGuiNative]::FocusWindow([long]$target.Handle)
    @{ok=$focused;handle=$target.Handle;title=$target.Title;processId=$target.ProcessId}
  }
  default { throw "unknown GUI action: $action" }
}
$result | ConvertTo-Json -Depth 8 -Compress
