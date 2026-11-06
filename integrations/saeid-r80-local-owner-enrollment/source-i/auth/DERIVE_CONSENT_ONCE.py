import pathlib,hashlib,json,xml.etree.ElementTree as ET
a=pathlib.Path(__file__).resolve().parent;r=a.parent;old=r.parent/'commander-one-integration-r78/reviews/durable/local-owner-auth/native-consent-aot-j'
src=old/'NativeAotOwnerConsent.cs';raw=src.read_bytes();s=raw.decode('utf-8');target=a/'src/NativeAotOwnerConsent.cs';assert not target.exists()
anchors={'new FileStream(Path.Combine(stateRoot,"events",requestId+".intent"),FileMode.CreateNew,FileAccess.Write,FileShare.None)':'ConsentPrivateFile.Create(Path.Combine(stateRoot,"events",requestId+".intent"))','new FileStream(Path.Combine(root,"receipts",requestId+".json"),FileMode.CreateNew,FileAccess.Write,FileShare.None)':'ConsentPrivateFile.Create(Path.Combine(root,"receipts",requestId+".json"))'}
for before,after in anchors.items():assert s.count(before)==1;s=s.replace(before,after)
target.write_text(s,encoding='utf-8')
tree=ET.parse(old/'OwnerConsentAot.csproj');p=tree.getroot();p.find('PropertyGroup').find('ApplicationManifest').text=str(old/'owner-consent.manifest')
ig=p.find('ItemGroup')
for item in ig.findall('Compile'):
    name=item.get('Include');path=target if name=='NativeAotOwnerConsent.cs' else old/name
    item.set('Include',str(path));item.set('ExpectedHash',hashlib.sha256(path.read_bytes()).hexdigest().upper())
ET.SubElement(ig,'Compile',Include=str(a/'src/ConsentPrivateFile.cs'),ExpectedHash=hashlib.sha256((a/'src/ConsentPrivateFile.cs').read_bytes()).hexdigest().upper())
t=ET.SubElement(p,'Target',Name='VerifyFrozenSourcePins',BeforeTargets='CoreCompile')
group=ET.SubElement(t,'ItemGroup');ET.SubElement(group,'_Pinned',Include='@(Compile)',Condition="'%(Compile.ExpectedHash)'!=''")
task=ET.SubElement(t,'GetFileHash',Files='@(_Pinned)',Algorithm='SHA256',MetadataName='ObservedHash');ET.SubElement(task,'Output',TaskParameter='Items',ItemName='_Observed');ET.SubElement(t,'Error',Condition="'%(_Observed.ObservedHash)'!='%(_Observed.ExpectedHash)'",Text='Pinned consent source changed: %(_Observed.Identity)')
ET.indent(p);tree.write(a/'src/OwnerConsentR80.csproj',encoding='unicode')
(a/'CONSENT_DERIVATION.json').write_text(json.dumps({'schema':'r80-consent-file-acl-derivation-v1','source':str(src),'preSha256':hashlib.sha256(raw).hexdigest(),'derived':str(target),'postSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'change':'Explicit protected BA/SYSTEM-only DACL+owner, CreateNew/WriteThrough/fsync unchanged, event and receipt only','noUiOrEnrollment':True},indent=2))
print('DERIVED_CONSENT_SOURCE_CREATED')
