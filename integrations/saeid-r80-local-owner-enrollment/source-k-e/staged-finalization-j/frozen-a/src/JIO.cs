using CommanderOwnerConsent;using CommanderOwnerBootstrap;using System.Diagnostics;using System.Security.AccessControl;using System.Security.Principal;using System.Text;using System.Text.Json;
namespace CommanderOwnerFinalizeJ;
internal static class JIO
{
 internal static bool CleanupUncertain;
 internal static void Absent(string p)=>ConsentCore.Need(!File.Exists(p)&&!Directory.Exists(p),"J_EXISTING_TARGET_STOP_NO_OVERWRITE");
 internal static void Write(string p,byte[] b,string owner)
 {
  Absent(p);WindowsGuard.Protected(Path.GetDirectoryName(p)!,true);var acl=new FileSecurity();acl.SetOwner(new SecurityIdentifier("S-1-5-32-544"));acl.SetAccessRuleProtection(true,false);foreach(var sid in new[]{"S-1-5-18","S-1-5-32-544"})acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid),FileSystemRights.FullControl,AccessControlType.Allow));acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(owner),FileSystemRights.ReadAndExecute,AccessControlType.Allow));
  using(var f=new FileInfo(p).Create(FileMode.CreateNew,FileSystemRights.FullControl,FileShare.None,4096,FileOptions.WriteThrough,acl)){f.Write(b);f.Flush(true);}using var check=WindowsGuard.OpenProtected(p,32768);ConsentCore.Need(WindowsGuard.Read(check).SequenceEqual(b),"J_CREATE_POSTVALIDATION");
 }
 internal static FileStream Hold(string p,byte[] expected){var f=WindowsGuard.OpenProtected(p,32768);try{ConsentCore.Need(WindowsGuard.Read(f).SequenceEqual(expected),"J_INPUT_CHANGED");return f;}catch{f.Dispose();throw;}}
 static bool OsTrusted(string s)=>s is "S-1-5-18" or "S-1-5-32-544" or "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
 internal static FileStream SystemTool()
 {
  var p=Path.Combine(Environment.SystemDirectory,"WindowsPowerShell","v1.0","powershell.exe");
  void Check(){WindowsGuard.NoReparse(p);var a=new FileInfo(p).GetAccessControl(AccessControlSections.Owner|AccessControlSections.Access);ConsentCore.Need(OsTrusted(a.GetOwner(typeof(SecurityIdentifier))?.Value??""),"J_SYSTEM_TOOL_OWNER");var writes=FileSystemRights.Write|FileSystemRights.Delete|FileSystemRights.ChangePermissions|FileSystemRights.TakeOwnership;foreach(FileSystemAccessRule r in a.GetAccessRules(true,true,typeof(SecurityIdentifier)))if(r.AccessControlType==AccessControlType.Allow&&(r.FileSystemRights&writes)!=0)ConsentCore.Need(OsTrusted(r.IdentityReference.Value),"J_SYSTEM_TOOL_WRITE");for(var parent=Path.GetDirectoryName(p);!string.IsNullOrEmpty(parent);parent=Path.GetDirectoryName(parent)){var acl=new DirectoryInfo(parent).GetAccessControl(AccessControlSections.Access);foreach(FileSystemAccessRule r in acl.GetAccessRules(true,true,typeof(SecurityIdentifier)))if(r.AccessControlType==AccessControlType.Allow&&(r.FileSystemRights&FileSystemRights.DeleteSubdirectoriesAndFiles)!=0)ConsentCore.Need(OsTrusted(r.IdentityReference.Value),"J_SYSTEM_TOOL_PARENT");if(Path.GetPathRoot(parent)==parent)break;}}
  Check();var held=new FileStream(p,FileMode.Open,FileAccess.Read,FileShare.Read);try{Check();return held;}catch{held.Dispose();throw;}
 }
 static async Task<string> ReadBounded(StreamReader reader){var b=new StringBuilder();var chars=new char[1024];for(;;){int n=await reader.ReadAsync(chars.AsMemory());if(n==0)return b.ToString();ConsentCore.Need(b.Length+n<=32768,"J_HELPER_OUTPUT_BOUND");b.Append(chars,0,n);}}
 internal static byte[] Invoke(string script,string operation)
 {
  ConsentCore.Need(operation is "inspect" or "finalize" or "rollback","J_FIXED_OPERATION");using var tool=SystemTool();var start=new ProcessStartInfo(tool.Name){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=Environment.SystemDirectory,RedirectStandardOutput=true,RedirectStandardError=true};start.Environment.Clear();var win=Environment.GetFolderPath(Environment.SpecialFolder.Windows);foreach(var pair in new[]{("SystemRoot",win),("windir",win),("PATH",Environment.SystemDirectory),("PSModulePath",Path.Combine(Environment.SystemDirectory,"WindowsPowerShell","v1.0","Modules")),("TEMP",Path.Combine(JContract.StateRoot,"task-temp")),("TMP",Path.Combine(JContract.StateRoot,"task-temp"))})start.Environment[pair.Item1]=pair.Item2;foreach(var v in new[]{"-NoLogo","-NoProfile","-NonInteractive","-File",script,"-Operation",operation})start.ArgumentList.Add(v);
  // A failed start/capture can be ambiguous. Only a captured held original helper may be reaped.
  Process? process=null;OwnedHelper? own=null;Exception? primary=null;CleanupUncertain=true;
  try{
   process=Process.Start(start)??throw new JFault("J_HELPER_START_UNCERTAIN_NO_RETRY","HelperStart");own=new OwnedHelper(process,start.FileName);var output=ReadBounded(process.StandardOutput);var error=ReadBounded(process.StandardError);using var deadline=new CancellationTokenSource(30000);try{Task.WhenAll(output,error,process.WaitForExitAsync(deadline.Token)).GetAwaiter().GetResult();}catch(OperationCanceledException){throw new JFault("J_HELPER_TIMEOUT_TASK_UNKNOWN_NO_RETRY","HelperWait");}
   var stdout=output.GetAwaiter().GetResult();var stderr=error.GetAwaiter().GetResult();if(process.ExitCode!=0){try{using var d=ConsentCore.Strict(Encoding.UTF8.GetBytes(stderr.Trim()));var e=d.RootElement;ConsentCore.Fields(e,"schema","code","phase","hresult","hresultHex","exceptionType","automaticRetryAllowed");ConsentCore.Need(ConsentCore.Text(e,"schema")=="RC_OWNER_J_HELPER_ERROR_V1"&&!e.GetProperty("automaticRetryAllowed").GetBoolean(),"J_TYPED_HELPER_ERROR_SCHEMA");var code=ConsentCore.Text(e,"code",100);var phase=ConsentCore.Text(e,"phase",100);var kind=ConsentCore.Text(e,"exceptionType",100);ConsentCore.Need(Safe(code)&&Safe(phase)&&Safe(kind),"J_TYPED_HELPER_ERROR_TEXT");throw new JFault(code,phase,e.GetProperty("hresult").GetInt32(),kind);}catch(JFault){throw;}catch{throw new JFault("J_HELPER_UNTYPED_FAILURE_NO_RETRY","HelperResponse");}}
   ConsentCore.Need(stderr.Length==0,"J_HELPER_UNEXPECTED_STDERR");return Encoding.UTF8.GetBytes(stdout.Trim());
  }catch(Exception e){primary=e;throw;}finally{var clean=own?.ReapOnlyOriginal()??false;CleanupUncertain=!clean;process?.Dispose();if(!clean&&primary!=null)primary.Data["ownedHelperCleanupUncertain"]=true;if(!clean&&primary==null)throw new JFault("J_HELPER_CLEANUP_UNCERTAIN_NO_RETRY","HelperCleanup");}
 }
 internal static bool Safe(string value)=>System.Text.RegularExpressions.Regex.IsMatch(value,"^[A-Za-z][A-Za-z0-9_]{0,99}$");
}
