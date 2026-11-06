import pathlib,hashlib,json,xml.etree.ElementTree as ET
r=pathlib.Path(__file__).resolve().parent.parent;r78=r.parent/'commander-one-integration-r78';r79=r.parent/'commander-one-native-issuer-r79';auth=r/'auth';boot=r/'bootstrap'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
base=ET.parse(r79/'src/CommanderNativeIssuer.csproj').getroot()
props=base.find('PropertyGroup');props.find('AssemblyName').text='CommanderNativeIssuerR80'
# Fixed protected host filename remains CommanderNativeIssuer.exe.
props.find('AssemblyName').text='CommanderNativeIssuer'
items=base.find('ItemGroup');own=list(items)
for node in own:
    if node.tag=='Compile' and not node.get('Include','').startswith('$'):
        path=r79/'src'/node.get('Include');node.set('Include',str(path));node.set('ExpectedHash',sha(path).upper())
    if node.tag=='Compile' and node.get('Link') in ['Frozen/ProtectedIssuerState.cs','Frozen/ExchangeJournal.cs']:
        path=auth/'src'/pathlib.Path(node.get('Link')).name;node.set('Include',str(path));node.set('ExpectedHash',sha(path).upper())
ET.SubElement(items,'Compile',Include=str(auth/'src/ProtectedJournal.cs'),ExpectedHash=sha(auth/'src/ProtectedJournal.cs').upper())
base.remove(base.findall('ItemGroup')[-1])
props.find('ApplicationManifest').text=str(r79/'src/host.manifest')
ET.indent(base);ET.ElementTree(base).write(auth/'src/OwnerIssuerR80.csproj',encoding='unicode')
# Bootstrap project only shares frozen core/guard/dll policy.
b=ET.Element('Project',Sdk='Microsoft.NET.Sdk');pg=ET.SubElement(b,'PropertyGroup')
for k,v in {'OutputType':'Exe','TargetFramework':'net10.0-windows','RuntimeIdentifier':'win-x64','PublishAot':'true','SelfContained':'true','InvariantGlobalization':'true','RuntimeFrameworkVersion':'10.0.14','IlcPackageVersion':'10.0.14','DisableTransitiveFrameworkReferenceDownloads':'true','Nullable':'enable','ImplicitUsings':'enable','TreatWarningsAsErrors':'true','EnableDefaultCompileItems':'false','AssemblyName':'CommanderOwnerBootstrap','ApplicationManifest':str(r79/'src/host.manifest')}.items():ET.SubElement(pg,k).text=v
for t in base.findall('Target'):b.append(ET.fromstring(ET.tostring(t)))
ig=ET.SubElement(b,'ItemGroup')
for name in ['Program.cs','Bundle.cs','BootstrapPolicy.cs','ProtectedInstall.cs']:ET.SubElement(ig,'Compile',Include=name)
for n in items.findall('Compile'):
    if n.get('Link') in ['Frozen/OwnerConsentCore.cs','Frozen/WindowsGuard.cs','Frozen/SystemDllPolicy.cs']:ig.append(ET.fromstring(ET.tostring(n)))
ET.SubElement(ig,'LinkerArg',Include='/DEPENDENTLOADFLAG:0x800');ET.SubElement(ig,'EmbeddedResource',Include='TaskOwner.ps1',LogicalName='TaskOwner.ps1')
fixture=ET.SubElement(b,'ItemGroup',Condition="'$(BootstrapFixtureOnly)'=='true'");ET.SubElement(fixture,'Compile',Include='BootstrapQA.cs')
ET.indent(b);ET.ElementTree(b).write(boot/'src/OwnerBootstrap.csproj',encoding='unicode')
# Boundary fixture links production ProtectedJournal and exact frozen guards.
j=ET.fromstring(ET.tostring(b));j.find('PropertyGroup').find('AssemblyName').text='JournalBoundaryQA';ET.SubElement(j.find('PropertyGroup'),'DefineConstants').text='R80_BOUNDARY_FIXTURE';ji=j.find('ItemGroup')
for node in list(ji):
    if node.tag in ['Compile','EmbeddedResource'] and not node.get('Include','').startswith('$'):ji.remove(node)
ET.SubElement(ji,'Compile',Include='JournalBoundaryQA.cs');ET.SubElement(ji,'Compile',Include='ProtectedJournal.cs')
j.remove(j.findall('ItemGroup')[-1]);ET.indent(j);ET.ElementTree(j).write(auth/'src/JournalBoundaryQA.csproj',encoding='unicode')
files=[]
for p in list((boot/'src').glob('*'))+list((auth/'src').glob('*')):files.append({'path':str(p.relative_to(r)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':sha(p)})
(boot/'SOURCE_PREBUILD.json').write_text(json.dumps({'schema':'r80-bootstrap-auth-source-prebuild-v1','files':files,'r78Sealed':True,'r79Sealed':True,'sourceOnly':True},indent=2),encoding='utf-8')
print(json.dumps({'sourceFiles':len(files),'prebuildSha256':sha(boot/'SOURCE_PREBUILD.json')}))
