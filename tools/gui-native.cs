using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;

// Standard user-session APIs only. No elevation, desktop switching, hooks, or drivers.
public static class RcGuiNative {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx, dy; public uint mouseData, dwFlags, time; public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
    public ushort wVk, wScan; public uint dwFlags, time; public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL, wParamH; }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion U; }
  public sealed class WindowInfo { public string Handle; public string Title; public uint ProcessId; }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll", SetLastError=true)] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int capacity);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
  [DllImport("user32.dll", SetLastError=true)] static extern bool AttachThreadInput(uint attach, uint attachTo, bool value);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder name, int size, out int needed);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("wtsapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool WTSQuerySessionInformation(IntPtr server, int session, int infoClass, out IntPtr buffer, out int bytes);
  [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr buffer);
  public static int InputSize() { return Marshal.SizeOf(typeof(INPUT)); }
  public static void AssertLayout() {
    if (InputSize() != (IntPtr.Size == 8 ? 40 : 28)) throw new InvalidOperationException("GUI_INPUT_LAYOUT");
  }
  static string DesktopName(IntPtr handle) {
    int needed; var name = new StringBuilder(256);
    return GetUserObjectInformation(handle, 2, name, name.Capacity * 2, out needed) ? name.ToString() : "";
  }
  public static bool Available() {
    if (!Environment.UserInteractive || Process.GetCurrentProcess().SessionId == 0) return false;
    IntPtr state; int bytes;
    if (!WTSQuerySessionInformation(IntPtr.Zero, Process.GetCurrentProcess().SessionId, 8, out state, out bytes)) return false;
    try { if (bytes < 4 || Marshal.ReadInt32(state) != 0) return false; }
    finally { WTSFreeMemory(state); }
    IntPtr desktop = OpenInputDesktop(0, false, 1); // DESKTOP_READOBJECTS only; no SwitchDesktop.
    if (desktop == IntPtr.Zero) return false;
    try {
      string name = DesktopName(desktop);
      return name.Equals("Default", StringComparison.OrdinalIgnoreCase) && name.Equals(DesktopName(GetThreadDesktop(GetCurrentThreadId())), StringComparison.OrdinalIgnoreCase);
    } finally { CloseDesktop(desktop); }
  }
  public static void Guard(string stopFile) {
    if (File.Exists(stopFile) || (GetAsyncKeyState(0x1B) & 0x8000) != 0) throw new InvalidOperationException("GUI_LOCAL_STOP");
    if (!Available()) throw new InvalidOperationException("GUI_DESKTOP_UNAVAILABLE");
  }
  public static string Foreground() { return GetForegroundWindow().ToInt64().ToString(); }
  public static uint ForegroundPid() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid; }
  public static void CheckForeground(string handle, uint pid) {
    if (Foreground() != handle || ForegroundPid() != pid) throw new InvalidOperationException("GUI_FOREGROUND_CHANGED");
  }
  public static POINT Cursor() { POINT p; if (!GetCursorPos(out p)) throw new InvalidOperationException("GUI_CURSOR_FAILED"); return p; }
  static void MouseFree() {
    foreach(int key in new int[]{1,2,4}) if((GetAsyncKeyState(key)&0x8000)!=0) throw new InvalidOperationException("GUI_PHYSICAL_MOUSE_HELD");
  }
  static void MoveRaw(int x,int y,string stop) { Guard(stop); if(!SetCursorPos(x,y)) throw new InvalidOperationException("GUI_MOVE_FAILED"); }
  public static void Move(int x,int y,string stop) { MouseFree(); MoveRaw(x,y,stop); }
  static INPUT Key(ushort key, bool up, bool unicode = false, bool extended = false) {
    return new INPUT { type=1, U=new InputUnion { ki=new KEYBDINPUT { wVk=unicode ? (ushort)0 : key, wScan=unicode ? key : (ushort)0, dwFlags=(up ? 2u : 0u) | (unicode ? 4u : 0u) | (extended ? 1u : 0u) } } };
  }
  static INPUT Mouse(uint flags, int dx=0, int dy=0, int data=0) {
    return new INPUT { type=0, U=new InputUnion { mi=new MOUSEINPUT { dx=dx, dy=dy, mouseData=unchecked((uint)data), dwFlags=flags } } };
  }
  static void Send(params INPUT[] inputs) {
    AssertLayout();
    if (SendInput((uint)inputs.Length, inputs, InputSize()) != (uint)inputs.Length) throw new InvalidOperationException("GUI_SENDINPUT_FAILED");
  }
  static bool Extended(ushort key) { return (key>=0x21 && key<=0x2E) || key==0x5B; }
  public static ushort KeyCode(string value) {
    if (String.IsNullOrEmpty(value)) throw new InvalidOperationException("GUI_INVALID_KEY");
    string n=value.ToUpperInvariant();
    switch(n) {
      case "CTRL": return 0x11; case "SHIFT": return 0x10; case "ALT": return 0x12; case "WIN": return 0x5B;
      case "ENTER": return 0x0D; case "TAB": return 0x09; case "SPACE": return 0x20; case "BACKSPACE": return 0x08;
      case "DELETE": return 0x2E; case "INSERT": return 0x2D; case "HOME": return 0x24; case "END": return 0x23;
      case "PGUP": return 0x21; case "PGDN": return 0x22; case "LEFT": return 0x25; case "UP": return 0x26;
      case "RIGHT": return 0x27; case "DOWN": return 0x28;
    }
    if (n.Length==1 && ((n[0]>='A' && n[0]<='Z') || (n[0]>='0' && n[0]<='9'))) return n[0];
    int f; if (n.StartsWith("F") && Int32.TryParse(n.Substring(1),out f) && f>=1 && f<=24) return (ushort)(0x70+f-1);
    throw new InvalidOperationException("GUI_INVALID_KEY");
  }
  static void Wait(int milliseconds, string stop) {
    var watch=Stopwatch.StartNew();
    while(watch.ElapsedMilliseconds < milliseconds) { Guard(stop); Thread.Sleep(10); }
  }
  public static void KeyCombo(string[] keys, int holdMs, string stop) {
    if(keys==null || keys.Length<1 || keys.Length>6 || holdMs<0 || holdMs>3000) throw new InvalidOperationException("GUI_INPUT_BOUNDS");
    var codes=new List<ushort>();
    foreach(string k in keys) { ushort code=KeyCode(k); if(codes.Contains(code)) throw new InvalidOperationException("GUI_DUPLICATE_KEY"); codes.Add(code); }
    Guard(stop);
    foreach(int modifier in new int[]{0x10,0x11,0x12,0x5B,0x5C}) if((GetAsyncKeyState(modifier)&0x8000)!=0) throw new InvalidOperationException("GUI_PHYSICAL_KEY_HELD");
    foreach(ushort k in codes) if((GetAsyncKeyState(k)&0x8000)!=0) throw new InvalidOperationException("GUI_PHYSICAL_KEY_HELD");
    var attempted=new List<ushort>();
    try {
      foreach(ushort k in codes) { Guard(stop); attempted.Add(k); Send(Key(k,false,false,Extended(k))); }
      Wait(holdMs,stop);
    } finally {
      // Attempt every release. A failed release makes the outcome uncertain.
      bool releaseFailed=false;
      for(int i=attempted.Count-1;i>=0;i--) { try { Send(Key(attempted[i],true,false,Extended(attempted[i]))); } catch { releaseFailed=true; } }
      if(releaseFailed) throw new InvalidOperationException("GUI_RELEASE_UNCERTAIN");
    }
  }
  public static void TypeUnicode(string text, int interval, string stop, string foreground, uint pid) {
    if(text==null || text.Length>1024 || interval<0 || interval>100 || (long)text.Length*interval>3000) throw new InvalidOperationException("GUI_INPUT_BOUNDS");
    // Validate the complete UTF-16 string before any injection, even for local callers.
    for(int j=0;j<text.Length;j++) {
      char c=text[j];
      if(char.IsLowSurrogate(c) || (char.IsHighSurrogate(c) && (j+1>=text.Length || !char.IsLowSurrogate(text[j+1])))) throw new InvalidOperationException("GUI_INVALID_TEXT_SURROGATE");
      if(char.IsHighSurrogate(c)) j++;
      else if((char.IsControl(c) && c!='\r' && c!='\n' && c!='\t')) throw new InvalidOperationException("GUI_INVALID_TEXT_CONTROL");
    }
    // Do not let a human-held modifier turn text into global shortcuts.
    foreach(int key in new int[]{0x10,0x11,0x12,0x5B,0x5C}) if((GetAsyncKeyState(key)&0x8000)!=0) throw new InvalidOperationException("GUI_PHYSICAL_KEY_HELD");
    text=text.Replace("\r\n","\n").Replace("\r","\n");
    for(int i=0;i<text.Length;i++) {
      Guard(stop); CheckForeground(foreground,pid);
      char ch=text[i];
      if(char.IsLowSurrogate(ch) || (char.IsHighSurrogate(ch) && (i+1>=text.Length || !char.IsLowSurrogate(text[i+1])))) throw new InvalidOperationException("GUI_INVALID_TEXT_SURROGATE");
      if(ch=='\n' || ch=='\t') { ushort k=(ushort)(ch=='\n'?0x0D:0x09); Send(Key(k,false),Key(k,true)); }
      else if(char.IsHighSurrogate(ch)) { char low=text[++i]; Send(Key(ch,false,true),Key(ch,true,true),Key(low,false,true),Key(low,true,true)); }
      else Send(Key(ch,false,true),Key(ch,true,true));
      Wait(interval,stop);
    }
  }
  static uint Button(string button, bool up) {
    switch(button) { case "left": return up?4u:2u; case "right": return up?16u:8u; case "middle": return up?64u:32u; default: throw new InvalidOperationException("GUI_INVALID_BUTTON"); }
  }
  public static void Click(string button, int clicks, int interval, string stop) {
    if(clicks<1 || clicks>2 || interval<20 || interval>300) throw new InvalidOperationException("GUI_INPUT_BOUNDS");
    MouseFree(); uint down=Button(button,false),up=Button(button,true);
    for(int i=0;i<clicks;i++) { Guard(stop); try { Send(Mouse(down)); Wait(20,stop); } finally { Send(Mouse(up)); } if(i+1<clicks) Wait(interval,stop); }
  }
  public static void Delta(int dx,int dy,string stop) {
    if(Math.Abs((long)dx)>1000 || Math.Abs((long)dy)>1000) throw new InvalidOperationException("GUI_INPUT_BOUNDS");
    Guard(stop); MouseFree(); Send(Mouse(1,dx,dy));
  }
  public static void Scroll(int delta,bool horizontal,string stop) {
    if(Math.Abs((long)delta)>1200) throw new InvalidOperationException("GUI_INPUT_BOUNDS");
    Guard(stop); MouseFree(); Send(Mouse(horizontal?0x1000u:0x0800u,0,0,delta));
  }
  public static void Drag(int x1,int y1,int x2,int y2,int duration,int steps,string button,string stop) {
    if(duration<50 || duration>3000 || steps<2 || steps>120) throw new InvalidOperationException("GUI_INPUT_BOUNDS");
    MouseFree(); uint down=Button(button,false),up=Button(button,true); MoveRaw(x1,y1,stop);
    try { Send(Mouse(down)); for(int i=1;i<=steps;i++) { MoveRaw((int)Math.Round(x1+((double)x2-x1)*i/steps),(int)Math.Round(y1+((double)y2-y1)*i/steps),stop); Wait(Math.Max(1,duration/steps),stop); } }
    finally { Send(Mouse(up)); }
  }
  public static List<WindowInfo> ListWindows() {
    var result=new List<WindowInfo>();
    EnumWindows((handle,parameter)=> {
      if(result.Count>=300) return false;
      if(!IsWindowVisible(handle)) return true;
      var title=new StringBuilder(256); GetWindowText(handle,title,title.Capacity);
      if(title.Length==0) return true;
      uint pid; GetWindowThreadProcessId(handle,out pid);
      result.Add(new WindowInfo {Handle=handle.ToInt64().ToString(),Title=title.ToString(),ProcessId=pid}); return true;
    },IntPtr.Zero); return result;
  }
  public static void Focus(string handle,string stop) {
    Guard(stop);
    var window=new IntPtr(Int64.Parse(handle));
    if(window==IntPtr.Zero || !IsWindowVisible(window)) throw new InvalidOperationException("GUI_WINDOW_NOT_VISIBLE");
    if(Foreground()==handle) return;

    MouseFree();
    foreach(int key in new int[]{0x10,0x11,0x12,0x5B,0x5C})
      if((GetAsyncKeyState(key)&0x8000)!=0) throw new InvalidOperationException("GUI_PHYSICAL_KEY_HELD");

    IntPtr foreground=GetForegroundWindow();
    uint ignored;
    uint foregroundThread=foreground==IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground,out ignored);
    uint targetThread=GetWindowThreadProcessId(window,out ignored);
    uint currentThread=GetCurrentThreadId();
    bool attachedForeground=false, attachedTarget=false;
    try {
      if(foregroundThread!=0 && foregroundThread!=currentThread) {
        attachedForeground=AttachThreadInput(currentThread,foregroundThread,true);
      }
      if(targetThread!=0 && targetThread!=currentThread && targetThread!=foregroundThread) {
        attachedTarget=AttachThreadInput(currentThread,targetThread,true);
      }
      ShowWindow(window,9);
      BringWindowToTop(window);
      SetForegroundWindow(window);
      Wait(120,stop);
      if(Foreground()!=handle) throw new InvalidOperationException("GUI_FOCUS_NOT_CONFIRMED");
    } finally {
      if(attachedTarget) AttachThreadInput(currentThread,targetThread,false);
      if(attachedForeground) AttachThreadInput(currentThread,foregroundThread,false);
    }
  }
}
