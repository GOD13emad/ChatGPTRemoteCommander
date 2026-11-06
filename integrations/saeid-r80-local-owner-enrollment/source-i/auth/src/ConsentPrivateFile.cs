using System.Security.AccessControl;using System.Security.Principal;
namespace CommanderOwnerConsent;
internal static class ConsentPrivateFile
{
    internal static FileSecurity Descriptor()
    {var acl=new FileSecurity();acl.SetOwner(new SecurityIdentifier("S-1-5-32-544"));acl.SetAccessRuleProtection(true,false);foreach(var sid in new[]{"S-1-5-18","S-1-5-32-544"})acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid),FileSystemRights.FullControl,AccessControlType.Allow));return acl;}
    internal static FileStream Create(string path)
    {WindowsGuard.Protected(Path.GetDirectoryName(path)!,true);return CreateFile(path,Descriptor());}
    private static FileStream CreateFile(string path,FileSecurity acl)=>new FileInfo(path).Create(FileMode.CreateNew,FileSystemRights.FullControl,FileShare.None,4096,FileOptions.WriteThrough,acl);
#if R80_BOUNDARY_FIXTURE
    internal static FileStream CreateBoundaryFixtureFile(string path)
    {var acl=Descriptor();var current=WindowsIdentity.GetCurrent().User!;acl.SetOwner(current);acl.AddAccessRule(new FileSystemAccessRule(current,FileSystemRights.FullControl,AccessControlType.Allow));return CreateFile(path,acl);}
#endif
}
