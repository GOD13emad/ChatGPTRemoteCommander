import pathlib,hashlib,json,xml.etree.ElementTree as ET
b=pathlib.Path(__file__).resolve().parent;r=b.parent;a=r/'auth';old=r.parent/'commander-one-integration-r78/reviews/durable/local-owner-auth/native-consent-aot-j/WindowsGuard.cs';target=a/'src/WindowsGuard.cs'
assert not target.exists(),'DERIVED_GUARD_ALREADY_EXISTS'
raw=old.read_bytes();s=raw.decode('utf-8');before='ConsentCore.Need(TrustedSid(r.IdentityReference.Value),"UNTRUSTED_PARENT_DELETE_ACL")';after='ConsentCore.Need(TrustedAncestorSid(r.IdentityReference.Value,parent),"UNTRUSTED_PARENT_DELETE_ACL")';assert s.count(before)==1;s=s.replace(before,after)
anchor='    internal static void NoReparse(string path)'
method='''    internal static bool TrustedAncestorSid(string sid,string path)
    {
        if(TrustedSid(sid))return true;
        if(sid!="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464")return false;
        var candidate=Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
        if(!Directory.Exists(candidate))return false;
        return new[]{Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),Environment.GetFolderPath(Environment.SpecialFolder.Windows),Path.GetPathRoot(Environment.SystemDirectory)!}.Any(root=>Path.TrimEndingDirectorySeparator(Path.GetFullPath(root)).Equals(candidate,StringComparison.OrdinalIgnoreCase));
    }
'''
assert s.count(anchor)==1;s=s.replace(anchor,method+anchor);target.write_text(s,encoding='utf-8')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
projects=[b/'src/OwnerBootstrap.csproj',a/'src/OwnerIssuerR80.csproj',a/'src/OwnerConsentR80.csproj',a/'src/JournalBoundaryQA.csproj'];changes=[]
for p in projects:
    before_sha=sha(p);tree=ET.parse(p);matches=[n for n in tree.getroot().iter('Compile') if pathlib.Path(n.get('Include','')).name=='WindowsGuard.cs'];assert len(matches)==1
    n=matches[0];n.set('Include',str(target));n.set('ExpectedHash',sha(target).upper());ET.indent(tree.getroot());tree.write(p,encoding='unicode')
    changes.append({'path':str(p),'preSha256':before_sha,'postSha256':sha(p)})
(a/'OS_ANCESTOR_GUARD_DERIVATION_I.json').write_text(json.dumps({'schema':'r80-derived-os-ancestor-guard-v1','source':str(old),'preSha256':hashlib.sha256(raw).hexdigest(),'derived':str(target),'postSha256':sha(target),'change':'ONLY parent DeleteChild trust uses exactTI on existing known OS ancestors; private owner/writer/confidential checks staySY/BA','projects':changes,'hApplyConsumed':True,'actualHCode':'UNOBSERVED','runtimeMutation':False},indent=2),encoding='utf-8')
print(json.dumps({'guardPath':str(target),'sha256':sha(target),'projects':len(changes)}))
