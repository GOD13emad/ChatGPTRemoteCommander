using System.Security.AccessControl;using System.Security.Principal;using System.Text.Json;using CommanderOwnerConsent;using CommanderNativeIssuer;
namespace CommanderOwnerProxy;
internal static class AncestorGuardQA
{
    internal static int Main()
    {
        const string ti="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";var os=Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);WindowsGuard.NoReparse(os);var a=new DirectoryInfo(os).GetAccessControl(AccessControlSections.Owner|AccessControlSections.Access);var owner=a.GetOwner(typeof(SecurityIdentifier))?.Value??"";ConsentCore.Need(WindowsGuard.TrustedAncestorSid(owner,os),"REAL_OS_ANCESTOR_OWNER_DENIED");var rules=0;var tiRules=0;
        foreach(FileSystemAccessRule r in a.GetAccessRules(true,true,typeof(SecurityIdentifier)))if(r.AccessControlType==AccessControlType.Allow&&(r.FileSystemRights&FileSystemRights.DeleteSubdirectoriesAndFiles)!=0){rules++;ConsentCore.Need(WindowsGuard.TrustedAncestorSid(r.IdentityReference.Value,os),"REAL_OS_ANCESTOR_DELETE_GUARD");if(r.IdentityReference.Value==ti)tiRules++;}
        ConsentCore.Need(rules>0&&tiRules>0,"EXPECTED_REAL_TI_RULE_MISSING");ConsentCore.Need(WindowsGuard.TrustedAncestorSid(ti,os),"EXACT_OS_TI_REQUIRED");ConsentCore.Need(!WindowsGuard.TrustedAncestorSid(ti,Path.Combine(os,"ChatGPTRemoteCommander","owner-auth")),"PRIVATE_TI_BOUNDARY_BROKEN");ConsentCore.Need(!WindowsGuard.TrustedAncestorSid("S-1-5-21-1-2-3-1001",os),"UNTRUSTED_OWNER_ANCESTOR_ACCEPTED");ConsentCore.Need(!WindowsGuard.TrustedAncestorSid("S-1-5-11",os),"UNTRUSTED_AUTHENTICATED_ANCESTOR_ACCEPTED");
        bool privateOwnerDenied=false;try{WindowsGuard.Protected(os,true);}catch(ConsentFault error){privateOwnerDenied=error.Message=="PROTECTED_OWNER_REQUIRED";}ConsentCore.Need(privateOwnerDenied,"PRIVATE_OWNER_STILL_MUST_BE_SY_BA");
        Console.WriteLine(System.Text.Encoding.UTF8.GetString(IssuerProtocol.Json(w=>{w.WriteString("schema","RC_OS_ANCESTOR_READONLY_GUARD_C_V1");w.WriteBoolean("actualProgramFilesAclRead",true);w.WriteNumber("actualDeleteChildRules",rules);w.WriteNumber("actualTrustedInstallerDeleteChildRules",tiRules);w.WriteBoolean("actualOsAncestorPredicatePassed",true);w.WriteBoolean("untrustedSidDenied",true);w.WriteBoolean("privateAuthorityTiDenied",true);w.WriteBoolean("privateObjectOwnerRemainsSyBa",privateOwnerDenied);w.WriteBoolean("aclMutated",false);w.WriteBoolean("installedAuthorityPositiveProven",false);w.WriteBoolean("keysOpened",false);})));return 0;
    }
}
