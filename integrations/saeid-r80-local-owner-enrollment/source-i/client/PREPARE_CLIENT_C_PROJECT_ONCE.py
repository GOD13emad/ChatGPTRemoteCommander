import pathlib,json,hashlib,xml.etree.ElementTree as ET
r=pathlib.Path(__file__).resolve().parent;src=r/'src-c';guard=r.parent/'auth/src/WindowsGuard.cs';pin='6ffd5e017ac734572d564ddf4268d02abbee9adecc4e0527081b0b5d0cc331e9';h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert h(guard)==pin
b=json.loads((r/'SOURCE_INPUT_MANIFEST_B.json').read_bytes());assert all(h(pathlib.Path(x['path']))==x['sha256'] for x in b['sources']+b['frozenDependencies'])
out=src/'CommanderOwnerProxyC.csproj';assert not out.exists();tree=ET.parse(r/'src/CommanderOwnerProxy.csproj');root=tree.getroot();root.find('.//ApplicationManifest').text=str(r/'src/client.manifest')
for item in root.findall('.//Compile'):
 inc=item.get('Include')
 if inc=='$(FrozenR78Root)/reviews/durable/local-owner-auth/native-consent-aot-j/WindowsGuard.cs':item.set('Include','$(DerivedGuardRoot)/WindowsGuard.cs');item.set('ExpectedHash',pin.upper())
 elif not inc.startswith('$('):p=r/'src'/inc;item.set('Include',str(p));item.set('Link','FrozenClientB/'+p.name);item.set('ExpectedHash',h(p).upper())
root.find('.//Target[@Name="RequireFrozenSourceAdmission"]/Error').set('Condition',"'$(FrozenR79Root)'=='' Or '$(FrozenR78Root)'=='' Or '$(DerivedGuardRoot)'==''")
g=ET.SubElement(root,'ItemGroup',Condition="'$(AncestorFixtureOnly)'=='true'");ET.SubElement(g,'Compile',Include='AncestorGuardQA.cs')
ET.indent(tree,space='  ');tree.write(out,encoding='utf-8',xml_declaration=True)
admit={'schema':'r80-client-c-source-admission-v1','change':'ONLY exact OS ancestor TI guard import; frozen client B sources and protocol unchanged','project':str(out),'projectSha256':h(out),'guard':str(guard),'guardSha256':pin,'baseManifestSha256':h(r/'SOURCE_INPUT_MANIFEST_B.json'),'baseSources':b['sources'],'baseFrozenDependencies':b['frozenDependencies'],'newQaSource':{'path':str(src/'AncestorGuardQA.cs'),'sha256':h(src/'AncestorGuardQA.cs')},'ordinaryReadonlyOsAclOnly':True,'realAuthorityOrKeysAllowed':False}
(r/'SOURCE_INPUT_MANIFEST_C.json').write_text(json.dumps(admit,indent=2),encoding='utf-8');print(json.dumps({'status':'C_PROJECT_PREPARED','manifestSha256':h(r/'SOURCE_INPUT_MANIFEST_C.json')}))
