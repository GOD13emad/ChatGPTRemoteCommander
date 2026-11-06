using CommanderOwnerConsent;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Diagnostics;
namespace CommanderOwnerBootstrap;
internal static class ProtectedInstall
{
    [StructLayout(LayoutKind.Sequential)]private struct SA{internal int Length;internal nint Descriptor;internal int Inherit;}
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string s,int revision,out nint descriptor,out uint size);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]private static extern bool CreateDirectoryW(string path,ref SA sa);
    [DllImport("kernel32.dll")]private static extern nint LocalFree(nint memory);
    private static bool OsTrusted(string sid)=>sid is "S-1-5-18" or "S-1-5-32-544" or "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
    private static FileStream ProtectSystemTool(string path)
    {
        void Validate(){WindowsGuard.NoReparse(path);var a=new FileInfo(path).GetAccessControl(AccessControlSections.Owner|AccessControlSections.Access);ConsentCore.Need(OsTrusted(a.GetOwner(typeof(SecurityIdentifier))?.Value??""),"SYSTEM_TOOL_OWNER");var writes=FileSystemRights.Write|FileSystemRights.Delete|FileSystemRights.ChangePermissions|FileSystemRights.TakeOwnership;foreach(FileSystemAccessRule rule in a.GetAccessRules(true,true,typeof(SecurityIdentifier)))if(rule.AccessControlType==AccessControlType.Allow&&(rule.FileSystemRights&writes)!=0)ConsentCore.Need(OsTrusted(rule.IdentityReference.Value),"SYSTEM_TOOL_WRITABLE");for(var p=Path.GetDirectoryName(path);!string.IsNullOrEmpty(p);p=Path.GetDirectoryName(p)){var acl=new DirectoryInfo(p).GetAccessControl(AccessControlSections.Access);foreach(FileSystemAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier)))if(rule.AccessControlType==AccessControlType.Allow&&(rule.FileSystemRights&FileSystemRights.DeleteSubdirectoriesAndFiles)!=0)ConsentCore.Need(OsTrusted(rule.IdentityReference.Value),"SYSTEM_TOOL_PARENT_DELETE");if(Path.GetPathRoot(p)==p)break;}}
        Validate();var held=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read);try{Validate();return held;}catch{held.Dispose();throw;}
    }
    internal static string ProgramRoot=>Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"ChatGPTRemoteCommander","owner-auth");
    internal static string StateRoot=>Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"ChatGPTRemoteCommander","owner-auth");
    internal static byte[] TaskScript(){using var stream=typeof(ProtectedInstall).Assembly.GetManifestResourceStream("TaskOwner.ps1")??throw new ConsentFault("TASK_SCRIPT_RESOURCE");using var m=new MemoryStream();stream.CopyTo(m);return m.ToArray();}
    private static ProcessStartInfo ShellStart(string exe)
    {
        var start=new ProcessStartInfo(exe){UseShellExecute=false,WorkingDirectory=Environment.SystemDirectory,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
        start.Environment.Clear();foreach(var pair in new[]{("SystemRoot",Environment.GetFolderPath(Environment.SpecialFolder.Windows)),("windir",Environment.GetFolderPath(Environment.SpecialFolder.Windows)),("PATH",Environment.SystemDirectory),("PSModulePath",Path.Combine(Environment.SystemDirectory,"WindowsPowerShell","v1.0","Modules"))})start.Environment[pair.Item1]=pair.Item2;
        return start;
    }
    internal static void RequireScriptPolicyReady()
    {
        var exe=Path.Combine(Environment.SystemDirectory,"WindowsPowerShell","v1.0","powershell.exe");using var held=ProtectSystemTool(exe);var start=ShellStart(exe);
        // Read-only effective-policy query. No -ExecutionPolicy, policy mutation,
        // profile loading or inline task/enrollment script.
        foreach(var v in new[]{"-NoLogo","-NoProfile","-NonInteractive","-Command","(Get-ExecutionPolicy).ToString()"})start.ArgumentList.Add(v);
        var result=RunOwned(start,10000);var value=result.Output.Trim();ConsentCore.Need(result.ExitCode==0&&result.Error.Length==0&&value is "RemoteSigned" or "Unrestricted" or "Bypass","EFFECTIVE_SCRIPT_POLICY_BLOCKS_APPLY");
    }
    internal static void RequireAbsent(string path)=>ConsentCore.Need(!File.Exists(path)&&!Directory.Exists(path),"EXISTING_TARGET_STOP_NO_OVERWRITE");
    internal static void Ancestors(string path)
    {
        for(var p=path;!string.IsNullOrEmpty(p);p=Path.GetDirectoryName(p))
        {WindowsGuard.NoReparse(p);var acl=new DirectoryInfo(p).GetAccessControl(AccessControlSections.Access);foreach(FileSystemAccessRule a in acl.GetAccessRules(true,true,typeof(SecurityIdentifier)))if(a.AccessControlType==AccessControlType.Allow&&(a.FileSystemRights&FileSystemRights.DeleteSubdirectoriesAndFiles)!=0)ConsentCore.Need(TrustedAncestor(a.IdentityReference.Value,p),"PARENT_DELETE_RIGHTS_UNTRUSTED");if(Path.GetPathRoot(p)==p)break;}
    }
    internal static bool TrustedAncestor(string sid,string path)
        =>WindowsGuard.TrustedAncestorSid(sid,path);
    internal static void PreflightParents()
    {
        foreach(var target in new[]{ProgramRoot,StateRoot})
        {var parent=Path.GetDirectoryName(target)!;if(Directory.Exists(parent))WindowsGuard.Protected(parent,true);else Ancestors(Path.GetDirectoryName(parent)!);}
    }
    internal static void NewDirectory(string path,string owner)
    {
        RequireAbsent(path);Ancestors(Path.GetDirectoryName(path)!);var sddl="O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;;GRGX;;;"+owner+")";
        ConsentCore.Need(ConvertStringSecurityDescriptorToSecurityDescriptor(sddl,1,out var descriptor,out _),"DIRECTORY_DACL_FORMAT");
        try{var sa=new SA{Length=Marshal.SizeOf<SA>(),Descriptor=descriptor,Inherit=0};ConsentCore.Need(CreateDirectoryW(path,ref sa),"DIRECTORY_CREATE_EXCLUSIVE_FAILED");}finally{LocalFree(descriptor);}
        WindowsGuard.Protected(path,true);
    }
    internal static void Parent(string target,string owner){var p=Path.GetDirectoryName(target)!;if(Directory.Exists(p))WindowsGuard.Protected(p,true);else NewDirectory(p,owner);}
    internal static void Write(string path,byte[] bytes,string owner,bool publicRead=false)
    {
        RequireAbsent(path);WindowsGuard.Protected(Path.GetDirectoryName(path)!,true);var acl=new FileSecurity();var admin=new SecurityIdentifier("S-1-5-32-544");acl.SetOwner(admin);acl.SetAccessRuleProtection(true,false);foreach(var id in new[]{"S-1-5-18","S-1-5-32-544"})acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(id),FileSystemRights.FullControl,AccessControlType.Allow));if(publicRead)acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(owner),FileSystemRights.ReadAndExecute,AccessControlType.Allow));
        using var f=new FileInfo(path).Create(FileMode.CreateNew,FileSystemRights.FullControl,FileShare.None,4096,FileOptions.WriteThrough,acl);f.Write(bytes);f.Flush(true);
    }
    internal static string InvokeTaskScript(string operation)
    {
        ConsentCore.Need(operation is "apply" or "rollback","TASK_FIXED_OPERATION");
        using var intentFile=WindowsGuard.OpenProtected(Path.Combine(StateRoot,"enrollment.intent.json"),32768);using var intent=ConsentCore.Strict(WindowsGuard.Read(intentFile));var owner=ConsentCore.Text(intent.RootElement,"ownerSid");
        var taskInputs=new List<FileStream>();
        try{
        ValidateTaskInputs(intent.RootElement,operation,taskInputs);
        var script=Path.Combine(ProgramRoot,"TaskOwner.ps1");
        if(operation=="rollback"&&!File.Exists(script))
        {
            // A crash before the program-script copy may still leave an owned
            // enrollment intent. Stage only this exact inspection helper into
            // the protected state root; never repair keys/policies/completion.
            script=Path.Combine(StateRoot,"rollback-helper.ps1");if(!File.Exists(script))Write(script,TaskScript(),owner);
        }
        using var held=WindowsGuard.OpenProtected(script,32768);ConsentCore.Need(WindowsGuard.Read(held).SequenceEqual(TaskScript()),"TASK_SCRIPT_PIN_CHANGED");
        var exe=Path.Combine(Environment.SystemDirectory,"WindowsPowerShell","v1.0","powershell.exe");using var tool=ProtectSystemTool(exe);var start=ShellStart(exe);start.Environment["TEMP"]=Path.Combine(StateRoot,"task-temp");start.Environment["TMP"]=Path.Combine(StateRoot,"task-temp");
        if(!Directory.Exists(start.Environment["TEMP"]!)){start.Environment["TEMP"]=StateRoot;start.Environment["TMP"]=StateRoot;}
        foreach(var value in new[]{"-NoLogo","-NoProfile","-NonInteractive","-File",script,"-Operation",operation})start.ArgumentList.Add(value);
        var result=RunOwned(start,30000);ConsentCore.Need(result.ExitCode==0&&result.Output.Length<32768&&result.Error.Length==0,"TASK_HELPER_FAILED_RECONCILE_NO_RETRY");using var d=ConsentCore.Strict(Encoding.UTF8.GetBytes(result.Output.Trim()));ConsentCore.Fields(d.RootElement,"status");return ConsentCore.Text(d.RootElement,"status");
        }finally{foreach(var input in taskInputs)input.Dispose();}
    }
    private static void ValidateTaskInputs(JsonElement intent,string operation,List<FileStream> held)
    {
        ConsentCore.Fields(intent,"schema","ownerSid","ownerSessionId","bundleSha256","scope","enrollmentId");ConsentCore.Need(ConsentCore.Text(intent,"schema")=="RC_OWNER_ENROLLMENT_INTENT_V1"&&ConsentCore.Text(intent,"scope")=="no-project-selftest-only","ROLLBACK_INTENT_SCHEMA");
        var owner=ConsentCore.Text(intent,"ownerSid");WindowsGuard.RequireOwner(WindowsGuard.Inspect(),owner);var bundle=ConsentCore.Text(intent,"bundleSha256");var enrollment=ConsentCore.Text(intent,"enrollmentId");var expected=TaskPlan.Prepared(owner,bundle,enrollment);
        var planPath=Path.Combine(StateRoot,"task.prepared.json");var registration=Path.Combine(StateRoot,"task.registration.intent.json");var hasPlan=File.Exists(planPath);var hasRegistration=File.Exists(registration);
        ConsentCore.Need(operation!="apply"||hasPlan&&hasRegistration,"TASK_REGISTRATION_INPUTS_REQUIRED");ConsentCore.Need(!hasRegistration||hasPlan,"TASK_INTENT_WITHOUT_PREPARATION");
        if(hasPlan){var f=WindowsGuard.OpenProtected(planPath,32768);held.Add(f);ConsentCore.Need(WindowsGuard.Read(f).SequenceEqual(expected),"PREPARED_TASK_CHANGED");}
        if(hasRegistration){var f=WindowsGuard.OpenProtected(registration,32768);held.Add(f);using var d=ConsentCore.Strict(WindowsGuard.Read(f));var e=d.RootElement;ConsentCore.Fields(e,"schema","ownerSid","bundleSha256","enrollmentId","preparedSha256");ConsentCore.Need(ConsentCore.Text(e,"schema")=="RC_OWNER_TASK_REGISTRATION_INTENT_V1"&&ConsentCore.Text(e,"ownerSid")==owner&&ConsentCore.Text(e,"bundleSha256")==bundle&&ConsentCore.Text(e,"enrollmentId")==enrollment&&ConsentCore.Text(e,"preparedSha256")==BootstrapPolicy.Hex(expected),"REGISTRATION_INTENT_CHANGED");}
    }
    private static (int ExitCode,string Output,string Error) RunOwned(ProcessStartInfo start,int milliseconds)
    {
        using var process=Process.Start(start)??throw new ConsentFault("OWN_HELPER_START_UNCERTAIN_NO_RETRY");var owned=new OwnedHelper(process,start.FileName);Exception? primary=null;
        try{var stdout=process.StandardOutput.ReadToEndAsync();var stderr=process.StandardError.ReadToEndAsync();ConsentCore.Need(process.WaitForExit(milliseconds),"OWN_HELPER_TIMEOUT_TASK_OUTCOME_UNKNOWN_NO_RETRY");var output=stdout.GetAwaiter().GetResult();var error=stderr.GetAwaiter().GetResult();ConsentCore.Need(output.Length<=32768&&error.Length<=32768,"OWN_HELPER_OUTPUT_BOUND");return(process.ExitCode,output,error);}
        catch(Exception error){primary=error;throw;}
        finally{OwnedHelper.PreservePrimary(primary,owned.ReapOnlyOriginal());}
    }
    internal static string Rollback(string owner)
    {
        WindowsGuard.RequireOwner(WindowsGuard.Inspect(),owner);if(Directory.Exists(ProgramRoot))WindowsGuard.Protected(ProgramRoot,true);WindowsGuard.Protected(StateRoot,true);
        using var intentFile=WindowsGuard.OpenProtected(Path.Combine(StateRoot,"enrollment.intent.json"),32768);using var intent=ConsentCore.Strict(WindowsGuard.Read(intentFile));ConsentCore.Need(ConsentCore.Text(intent.RootElement,"ownerSid")==owner,"ROLLBACK_OWNER_BINDING");
        var enrollment=ConsentCore.Text(intent.RootElement,"enrollmentId");var complete=Path.Combine(StateRoot,"enrollment.complete.json");
        if(File.Exists(complete))
        {
            using var f=WindowsGuard.OpenProtected(complete,32768);using var doc=ConsentCore.Strict(WindowsGuard.Read(f));var e=doc.RootElement;ConsentCore.Need(ConsentCore.Text(e,"ownerSid")==owner,"ROLLBACK_OWNER_BINDING");
            foreach(var row in e.GetProperty("immutableFiles").EnumerateArray())
            {var root=ConsentCore.Text(row,"root")=="program"?ProgramRoot:StateRoot;var name=ConsentCore.Text(row,"name");ConsentCore.Need(!name.Contains("..")&&!Path.IsPathRooted(name),"ROLLBACK_PATH");using var input=WindowsGuard.OpenProtected(Path.Combine(root,name),64*1024*1024);ConsentCore.Need(BootstrapPolicy.Hex(WindowsGuard.Read(input))==ConsentCore.Text(row,"sha256"),"ROLLBACK_SOURCE_CHANGED_STOP");}
        }
        // No process stop and no secret/state deletion. Remove only this exact
        // idle task after attestation equality. Installed Commander is unrelated.
        var status=InvokeTaskScript("rollback");ConsentCore.Need(status is "TASK_REMOVED_FILES_AND_KEYS_PRESERVED" or "TASK_ABSENT_DEACTIVATED_FILES_AND_KEYS_PRESERVED","ROLLBACK_TASK_RESULT");var receipt=Path.Combine(StateRoot,"rollback.complete.json");
        if(!File.Exists(receipt))Write(receipt,BootstrapPolicy.Json(w=>{w.WriteString("schema","RC_OWNER_BOOTSTRAP_ROLLBACK_V1");w.WriteString("status",status);w.WriteString("ownerSid",owner);w.WriteString("enrollmentId",enrollment);w.WriteBoolean("keysAndStatePreserved",true);w.WriteBoolean("commanderUnchanged",true);}),owner);
        else{using var previous=WindowsGuard.OpenProtected(receipt,32768);using var d=ConsentCore.Strict(WindowsGuard.Read(previous));ConsentCore.Need(ConsentCore.Text(d.RootElement,"schema")=="RC_OWNER_BOOTSTRAP_ROLLBACK_V1"&&ConsentCore.Text(d.RootElement,"ownerSid")==owner&&ConsentCore.Text(d.RootElement,"enrollmentId")==enrollment,"ROLLBACK_RECEIPT_CHANGED");}
        return status;
    }
}
