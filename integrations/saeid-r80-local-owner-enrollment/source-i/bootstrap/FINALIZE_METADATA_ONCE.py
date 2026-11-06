import pathlib,json,hashlib,datetime,xml.etree.ElementTree as ET
b=pathlib.Path(__file__).resolve().parent;r=b.parent;a=r/'auth';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();g=json.loads((b/'qa/g/RECEIPT.json').read_text());assert g['status']=='PASS_NATIVE_SOURCE_FINITE_HELPER_AND_NEGATIVES_ONLY'
assert not (b/'QUALIFICATION.json').exists(),'CONSUMED_METADATA'
for f in g['sourceFiles']:assert sha(r/f['path'])==f['sha256']
for name in ['host','consent','bootstrap']:assert sha(pathlib.Path(g['facts'][name]['path']))==g['facts'][name]['sha256']
deps={};r78=r.parent/'commander-one-integration-r78'
for project in [b/'src/OwnerBootstrap.csproj',a/'src/OwnerIssuerR80.csproj',a/'src/OwnerConsentR80.csproj']:
    for node in ET.parse(project).getroot().iter('Compile'):
        text=node.get('Include','').replace('$(FrozenR78SourceRoot)',str(r78));p=pathlib.Path(text)
        if not p.is_absolute():p=project.parent/p
        p=p.resolve()
        if p.is_file() and not p.is_relative_to(r):
            actual=sha(p);expected=node.get('ExpectedHash');assert expected is None or actual==expected.lower(),'FROZEN_DEPENDENCY_CHANGED';deps[str(p)]={'path':str(p),'bytes':p.stat().st_size,'sha256':actual}
(b/'DEPENDENCIES.json').write_text(json.dumps({'schema':'r80-bootstrap-auth-frozen-source-dependencies-v1','role':'build-time source reconstruction only; no runtime request source root','dependencies':list(deps.values()),'sharedMicrosoftCache':'G:/CodexWork/RC1R78AuthAot/packages','copyCacheIntoReturn':False,'r78AndR79Sealed':True},indent=2),encoding='utf-8')
qual={'schema':'r80-bootstrap-auth-source-qualification-v1','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':g['status'],'nativeArtifacts':{n:g['facts'][n] for n in ['host','consent','bootstrap']},'bootstrapCases':g['facts']['bootstrapQa']['pass'],'journalCases':21,'failures':0,'sourceFiles':g['sourceFiles'],'finalReceipt':{'path':'qa/g/RECEIPT.json','sha256':sha(b/'qa/g/RECEIPT.json')},'componentReceipts':['qa/a/RECEIPT.json','qa/c/RECEIPT.json','qa/d/RECEIPT.json','qa/e/RECEIPT.json'],'preservedFailedOrSuperseded':['qa/a (bootstrap rollback inventory superseded)','qa/b (before compilation)','qa/c (QA-only nullable warning)','qa/d (QA modulepath)','qa/f (primary error preservation superseded)'],'handoffSha256':sha(b/'HANDOFF.md'),'dependenciesSha256':sha(b/'DEPENDENCIES.json'),'protectedAclPositive':'UNPROVEN','enrolled':False,'taskRegisteredOrStarted':False,'uacOpened':False,'productionKeysCreated':False,'installedCommanderChanged':False,'activeJobsStoppedOrReplayed':False,'runtimeLogin':'UNPROVEN','whole':'NOT_FINAL','cleanupOnlyDiagnosticEdge':'Code OWN_HELPER_CLEANUP_UNCERTAIN_NO_RETRY authoritative; metadata boolean false for cleanup-only error without prior exception Data','next':'parent independent review reconciliation, exact BUNDLE/preflight, native UAC then real protected acceptance; no automatic promotion','parentOwnsDelivery':True}
(b/'QUALIFICATION.json').write_text(json.dumps(qual,indent=2),encoding='utf-8')
files=[]
for base in [b,a]:
    for p in sorted(base.rglob('*')):
        if not p.is_file():continue
        relative=p.relative_to(base)
        if any(part in ['bin','obj'] for part in relative.parts) or p==b/'MANIFEST.json':continue
        files.append({'path':str(p.relative_to(r)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':sha(p)})
manifest={'schema':'r80-bootstrap-auth-author-manifest-v1','role':'author files only; client/probe/reviewer/parent delivery registered separately','files':files,'nativeArtifactsExternalReferenceOnly':qual['nativeArtifacts'],'noNestedArchiveOrCache':True}
(b/'MANIFEST.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps({'qualificationSha256':sha(b/'QUALIFICATION.json'),'handoffSha256':sha(b/'HANDOFF.md'),'manifestSha256':sha(b/'MANIFEST.json'),'dependencySha256':sha(b/'DEPENDENCIES.json'),'receiptSha256':sha(b/'qa/g/RECEIPT.json'),'entries':len(files)}))
