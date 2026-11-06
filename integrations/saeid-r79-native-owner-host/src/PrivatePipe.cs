using Microsoft.Win32.SafeHandles;using System.IO.Pipes;using System.Runtime.InteropServices;using CommanderOwnerConsent;
namespace CommanderNativeIssuer;
internal static class PrivatePipe
{
    private const string PipeName=@"\\.\pipe\ChatGPTRemoteCommanderNativeIssuerV1";
    [StructLayout(LayoutKind.Sequential)]private struct SecurityAttributes{internal int Length;internal nint Descriptor;internal int Inherit;}
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string s,uint revision,out nint descriptor,out uint size);
    [DllImport("kernel32.dll")]private static extern nint LocalFree(nint memory);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]private static extern SafePipeHandle CreateNamedPipeW(string name,uint openMode,uint pipeMode,uint instances,uint outBuffer,uint inBuffer,uint timeout,in SecurityAttributes security);
    internal static NamedPipeServerStream Create(HostPolicy policy)
    {
        HostPolicy.RequireSystem();policy.Revalidate();var sddl="D:P(A;;GA;;;SY)(A;;0x0012019B;;;"+policy.OwnerSid+")";ConsentCore.Need(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl,1,out var descriptor,out _),"PIPE_SECURITY_DESCRIPTOR");
        try
        {
            var a=new SecurityAttributes{Length=Marshal.SizeOf<SecurityAttributes>(),Descriptor=descriptor,Inherit=0};
            // FIRST_PIPE_INSTANCE prevents attaching to another server's name;
            // REJECT_REMOTE_CLIENTS is a pipe MODE bit, not an ACL assertion.
            var handle=CreateNamedPipeW(PipeName,0x00000003|0x40000000|0x00080000,0x00000008,1,IssuerProtocol.MaxFrameBytes,IssuerProtocol.MaxFrameBytes,5000,a);
            ConsentCore.Need(!handle.IsInvalid,"PIPE_CREATE_FAILED_NO_RETRY");try{return new(PipeDirection.InOut,true,false,handle);}catch{handle.Dispose();throw;}
        }
        finally{LocalFree(descriptor);}
    }
}
