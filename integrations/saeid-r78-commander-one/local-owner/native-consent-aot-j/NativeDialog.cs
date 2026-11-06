// Win32-only UI source; no WinForms/WPF, browser, shell or hyperlink handler.
// This positive path has NOT been displayed or accepted in source QA.
using System.Runtime.InteropServices;
namespace CommanderOwnerConsent;
internal static class NativeDialog
{
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]private delegate int Callback(nint window,uint notification,nuint wParam,nint lParam,nint data);
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode,Pack=1)]private struct Button {internal int Id;[MarshalAs(UnmanagedType.LPWStr)]internal string Text;}
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode,Pack=1)]private struct Config
    {
        internal uint Size;internal nint Parent,Instance;internal uint Flags,CommonButtons;
        [MarshalAs(UnmanagedType.LPWStr)]internal string Title;internal nint Icon;
        [MarshalAs(UnmanagedType.LPWStr)]internal string Instruction;
        [MarshalAs(UnmanagedType.LPWStr)]internal string Content;
        internal uint ButtonCount;internal nint Buttons;internal int DefaultButton;internal uint RadioCount;internal nint Radios;internal int DefaultRadio;
        [MarshalAs(UnmanagedType.LPWStr)]internal string Verification;
        internal nint Expanded,ExpandedControl,CollapsedControl,FooterIcon,Footer;
        internal nint Callback;internal nint CallbackData;internal uint Width;
    }
    [DllImport("comctl32.dll",CharSet=CharSet.Unicode,ExactSpelling=true)]private static extern int TaskDialogIndirect(in Config config,out int button,out int radio,[MarshalAs(UnmanagedType.Bool)]out bool verified);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]private static extern nint SendMessageW(nint window,uint message,nuint wParam,nint lParam);
    internal static bool Show(ApprovedRequest r)
    {
        const int Approve=1001,Cancel=2;const uint TimerNotification=4,ClickButton=0x0400+102;
        var buttons=new[]{new Button{Id=Approve,Text="تأیید همین درخواست"},new Button{Id=Cancel,Text="رد درخواست"}};
        var size=Marshal.SizeOf<Button>();var memory=Marshal.AllocHGlobal(size*buttons.Length);var initialized=0;
        Callback callback=(window,n,_,_,_)=>{if(n==TimerNotification&&DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()>=r.ExpiresAt)SendMessageW(window,ClickButton,Cancel,0);return 0;};
        try
        {
            for(var i=0;i<buttons.Length;i++){Marshal.StructureToPtr(buttons[i],memory+i*size,false);initialized++;}
            var config=new Config{Size=(uint)Marshal.SizeOf<Config>(),Flags=0x0008|0x0800|0x2000,Title="تأیید ورود محلی مالک Commander",Instruction="فقط دسترسی‌های همین درخواست را بررسی کنید.",
                Content=$"Client: {r.ClientId}\nRedirect: {r.RedirectUri}\nResource: {r.Resource}\nProfile: {r.Profile}\nRoot policy: {r.RootPolicy}\nActions: {string.Join(", ",r.Actions)}\nScopes: {string.Join(", ",r.Scopes)}\nRequest: {r.RequestId}\nDigest: {r.RequestDigest}\nهیچ کار قبلی اجرا یا تکرار نمی‌شود.",
                ButtonCount=2,Buttons=memory,DefaultButton=Cancel,Verification="مشخصات و دسترسی‌های بالا را خواندم و این ورود را تأیید می‌کنم.",Callback=Marshal.GetFunctionPointerForDelegate(callback),Width=420};
            var result=TaskDialogIndirect(config,out var pressed,out _,out var verified);GC.KeepAlive(callback);
            return result==0&&pressed==Approve&&verified&&DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()<r.ExpiresAt;
        }
        finally{for(var i=0;i<initialized;i++)Marshal.DestroyStructure<Button>(memory+i*size);Marshal.FreeHGlobal(memory);GC.KeepAlive(callback);}
    }
}
