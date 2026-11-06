import pathlib,json,hashlib,datetime,xml.etree.ElementTree as ET,os
b=pathlib.Path(__file__).resolve().parent;r=b.parent;a=r/'auth';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();q=json.loads((b/'qa/i/RECEIPT.json').read_text());assert q['status']=='PASS_SHARED_OS_ANCESTOR_AND_SANITIZED_DIAGNOSTIC_SOURCE_ONLY'
assert not (b/'I_SUBREVISION.json').exists(),'CONSUMED_I_METADATA'
for f in q['sourceFiles']:assert sha(r/f['path'])==f['sha256']
for role in ['host','consent','bootstrap']:assert sha(pathlib.Path(q['facts'][role]['path']))==q['facts'][role]['sha256']
pre={name:sha(b/name) for name in ['HANDOFF.md','QUALIFICATION.json','MANIFEST.json','DEPENDENCIES.json']}
text=(b/'HANDOFF.md').read_text().replace('qa/h/RECEIPT.json','qa/i/RECEIPT.json').replace('corrected bootstrap H','corrected bootstrap I').replace('Final H bootstrap, 3,862,528 bytes','Final I bootstrap, 3,874,304 bytes').replace('bootstrap-native-h','bootstrap-native-i').replace('b14c1eea5ded82ca77e679460088d5792b8948f9204ea791bf575450c8a72ac3','318f5c2d05aa841908368be99433d7e3e95235a2e25e8e20422230e511195212').replace('Derived issuer, 4,129,280 bytes','Derived I issuer, 4,131,328 bytes').replace('RC1R80Bootstrap\\host\\CommanderNativeIssuer.exe','RC1R80Bootstrap\\host-i\\CommanderNativeIssuer.exe').replace('f4bf84f09cabae3a128d577cc5f4f07f8708a2b5fdf6d67432eccc6bdbdb58f9','310e0a3f13a4b7dadc71f16df9683915641392d34a15d93d4c3ebd4ec29cbd26').replace('Derived consent, 3,564,544 bytes','Derived I consent, 3,566,080 bytes').replace('consent-b\\CommanderOwnerConsent.exe','consent-i\\CommanderOwnerConsent.exe').replace('599847485c8650740bd59228a4f7629534acf0d85ca84593b81faf38ac990a13','b5ff1b8fdc5aea05e338b2a2ff4ec71146136c22b66728e5bf25b108016c4020').replace('Bootstrap19, partial-rollback selection15','Bootstrap29, partial-rollback selection15').replace('A-H runners are consumed DO NOT RUN','A-I runners are consumed DO NOT RUN')
text+="""

## I shared OS ancestor defect and retained apply diagnostics

H's one real UAC apply exited2 before creating any proposed root. Parent
observed task absent and config/route unchanged. The child's stdout/stderr was
lost, so its exact primary code remains UNOBSERVED. Actual read-only ACL
evidence and source flow prove a deterministic blocked path: Program Files
grants its trusted Windows servicing identity, TrustedInstaller, DeleteChild,
but H's creation guard AND shared WindowsGuard ancestor check trusted only
SY/BA. A bootstrap-only fix would still fail after creation or in host/helper/
client/probe. H is consumed DO NOT RUN, not a failed action to blindly replay.

I derives auth/src/WindowsGuard.cs from frozen R78, SHA
6ffd5e017ac734572d564ddf4268d02abbee9adecc4e0527081b0b5d0cc331e9.
Only the parent DeleteChild predicate changes: exact TrustedInstaller SID
is accepted only for existing exact ProgramFiles/CommonApplicationData/Windows/
system-drive-root ancestors. Private application/key owner/writer/confidential
checks remain byte-identical SY/BA-only. No Windows ACL is changed. Native
host/helper/bootstrap and their boundary QA all bind this same derived source;
client/probe source owner must independently bind and rebuild it too.

Ordinary --preflight now runs the same parent/ancestor predicate before UAC.
Actual read-only OS preflight passes; untrusted user/service SIDs and TI as
private owner stay denied. I records fixed allowlisted code/phase: owner-
readable bootstrap.outcome.json only in a protected state root this process
actually created; no arbitrary output path or elevated G write. Before such
a root exists, an actual elevated --apply failure can show a short native
Persian code/phase alert. Ordinary negative QA remains noninteractive. Raw
exception text, credentials, paths and tokens are never exposed.

I bootstrap29 and journal21 cases pass with actual native CLR0/load0x800/
asInvoker builds and guarded ordinary denials. Protected outcome creation,
elevated native alert and new real setup remain UNPROVEN until parent's
separately reviewed new UAC plan. H partial rollback and its actual production
selector15 are unchanged, not replaced. Distinct failure classes/history/
primary evidence are in reviews/install-failure/FAILURE_MATRIX_I.md.
The previously documented cleanup-only boolean edge is corrected while
constructing the new sanitized diagnostic payload; primary fault still wins.
"""
nextfile=b/'HANDOFF.i.next';assert not nextfile.exists();nextfile.write_text(text,encoding='utf-8');os.replace(nextfile,b/'HANDOFF.md')
deps={};r78=r.parent/'commander-one-integration-r78'
for project in [b/'src/OwnerBootstrap.csproj',a/'src/OwnerIssuerR80.csproj',a/'src/OwnerConsentR80.csproj',a/'src/JournalBoundaryQA.csproj']:
    for n in ET.parse(project).getroot().iter('Compile'):
        p=pathlib.Path(n.get('Include','').replace('$(FrozenR78SourceRoot)',str(r78)));p=p if p.is_absolute() else project.parent/p;p=p.resolve()
        if p.is_file() and not p.is_relative_to(r):
            actual=sha(p);expected=n.get('ExpectedHash');assert expected is None or actual==expected.lower();deps[str(p)]={'path':str(p),'bytes':p.stat().st_size,'sha256':actual}
(b/'DEPENDENCIES.json').write_text(json.dumps({'schema':'r80-i-source-dependencies-v1','externalSources':list(deps.values()),'sharedGuard':{'path':'auth/src/WindowsGuard.cs','sha256':sha(a/'src/WindowsGuard.cs')},'sharedPackageCache':'G:/CodexWork/RC1R78AuthAot/packages','copyCacheIntoReturn':False},indent=2),encoding='utf-8')
qual={'schema':'r80-shared-os-ancestor-i-source-qualification-v1','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':q['status'],'nativeArtifacts':{n:q['facts'][n] for n in ['host','consent','bootstrap']},'sharedGuardSha256':q['facts']['sharedGuardSha256'],'bootstrapCases':q['facts']['bootstrapQa']['pass'],'journalCases':q['facts']['journalQa']['pass'],'partialRollbackCasesUnchangedReused':15,'sourceFiles':q['sourceFiles'],'finalReceipt':{'path':'qa/i/RECEIPT.json','sha256':sha(b/'qa/i/RECEIPT.json')},'handoffSha256':sha(b/'HANDOFF.md'),'dependenciesSha256':sha(b/'DEPENDENCIES.json'),'hApplyConsumed':True,'hActualCode':'UNOBSERVED','hCausalBlockedPath':'CONFIRMED_DETERMINISTIC_SOURCE_AND_OS_ACL','iUacOpened':False,'iTaskRegisteredOrStarted':False,'iProductionKeysCreated':False,'iInstalledCommanderChanged':False,'activeJobsStoppedOrReplayed':False,'actualProtectedOutcomeAndElevatedUi':'UNPROVEN','whole':'NOT_FINAL','next':'parent verifies matching client/probe derived guard + independent reviews; freeze new plan/preflight and owner-controlled UAC, never replay H','parentOwnsDeploymentAndDelivery':True}
(b/'QUALIFICATION.json').write_text(json.dumps(qual,indent=2),encoding='utf-8')
(b/'I_SUBREVISION.json').write_text(json.dumps({'schema':'r80-i-source-subrevision-v1','utc':qual['utc'],'oneRootCause':'trusted OS servicing ancestor not distinguished from private application ACL','preMetadataSha256':pre,'preservedH':'H_* metadata and source-history-h','sourceOnlyInThisChild':True,'hConsumedRealAttemptParentOwned':True},indent=2),encoding='utf-8')
files=[]
for base in [b,a,r/'reviews/install-failure']:
    for p in sorted(base.rglob('*')):
        if not p.is_file() or p==b/'MANIFEST.json':continue
        if any(x in ['bin','obj'] for x in p.relative_to(base).parts) or p.suffix.lower() in ['.exe','.pdb']:continue
        files.append({'path':str(p.relative_to(r)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':sha(p)})
(b/'MANIFEST.json').write_text(json.dumps({'schema':'r80-bootstrap-auth-i-author-manifest-v1','role':'source/evidence whitelist only; client/probe/review/parent delivery separate','files':files,'nativeArtifactsExternalReferenceOnly':qual['nativeArtifacts'],'noNestedArchiveOrCache':True},indent=2),encoding='utf-8')
print(json.dumps({'qualificationSha256':sha(b/'QUALIFICATION.json'),'handoffSha256':sha(b/'HANDOFF.md'),'manifestSha256':sha(b/'MANIFEST.json'),'receiptSha256':sha(b/'qa/i/RECEIPT.json'),'entries':len(files),'bytes':sum(x['bytes'] for x in files)}))
