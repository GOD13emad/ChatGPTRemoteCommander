import pathlib,json,hashlib,datetime,os
b=pathlib.Path(__file__).resolve().parent;r=b.parent;a=r/'auth';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();h=json.loads((b/'qa/h/RECEIPT.json').read_text());assert h['status']=='PASS_SOURCE_PARTIAL_ROLLBACK_SELECTION_AND_NATIVE_NEGATIVES_ONLY'
assert not (b/'H_SUBREVISION.json').exists(),'CONSUMED_H_METADATA'
for f in h['sourceFiles']:assert sha(r/f['path'])==f['sha256']
for role in ['host','consent','bootstrap']:assert sha(pathlib.Path(h['facts'][role]['path']))==h['facts'][role]['sha256']
pre={name:sha(b/name) for name in ['HANDOFF.md','QUALIFICATION.json','MANIFEST.json']}
text=(b/'HANDOFF.md').read_text();text=text.replace('qa/g/RECEIPT.json','qa/h/RECEIPT.json').replace('corrected bootstrap G','corrected bootstrap H').replace('Final G bootstrap, 3,849,216 bytes','Final H bootstrap, 3,862,528 bytes').replace('bootstrap-native-g','bootstrap-native-h').replace('2f38a41423b36e387685062bca824b01d72e2576d0109cde99116290413b4771','b14c1eea5ded82ca77e679460088d5792b8948f9204ea791bf575450c8a72ac3').replace('Bootstrap17 and journal/file-boundary21','Bootstrap19, partial-rollback selection15 and journal/file-boundary21').replace('and corrected bootstrap G.','and corrected bootstrap H.').replace('A-G runners are consumed DO NOT RUN','A-H runners are consumed DO NOT RUN')
text+="""

## H required partial-enrollment rollback correction

G is retained as historical source/native-negative evidence, but was NOT
ready for UAC: its rollback required enrollment.complete.json and an attested
task, so a crash after Register or client-policy publication could leave
activation without a recovery path. Parent stopped before any UAC.

H writes a unique protected enrollmentId in enrollment.intent.json. Before
Register, it flushes task.prepared.json containing exact XML/SDDL and
bundle/enrollment/owner identity, and task.registration.intent.json pinning
those bytes. Unique bundle+enrollment description is verified alongside actual
safe action/principal/context/settings/no-triggers/SDDL; description alone
does not establish ownership. Native code holds and checks these files through
the fixed script execution. Completion/attestation files are not prerequisites
for partial rollback and are never fabricated.

Rollback now starts from the protected enrollment intent. If completion exists
its old immutable checks remain. If it does not, prepared/registration inputs
still determine only this transaction's known activation. A missing task is
read-only verified deactivated success, including a repeated inspection after
an earlier delete; no second delete is sent. An existing task without matching
registration intent, prepared bytes, actual unique definition/SDDL or known
idle/disabled state is STOP. A known exact idle task is freshly read/verified
again immediately before the sole DeleteTask. No process, task instance,
unknown task, private key, state file, journal or residual directory is stopped,
deleted or restored. Existing rollback receipt is checked rather than replaced.

If partial enrollment stopped before the program-script copy, rollback may
stage only the exact compiled task-inspection script at a new protected
state/rollback-helper.ps1 path. Existing helper bytes must match; no authority,
key, policy or completion record is repaired. Missing original enrollment
intent/unknown target ownership still STOP. This role is an audit helper,
not an enrollment retry. Rollback preserves every partial file and key.

PARTIAL_ROLLBACK_QA.ps1 imports only the AST of the actual production
Select-RollbackPlan function; the outer script/COM/task access never runs.
Fifteen cases cover intent/preparation/registration boundaries, Register-before-
attestation crash, client-policy-before-completion crash, completed/disabled
idle, already missing, unknown task, changed definition/SDDL and active/queued/
unknown state. Nineteen native bootstrap cases additionally prove unique
prepared binding/schema, ordinary denials, policy readiness and owned-helper
lifecycle. Real task deletion and protected UAC rollback are still UNPROVEN.
"""
nextfile=b/'HANDOFF.h.next';assert not nextfile.exists();nextfile.write_text(text,encoding='utf-8');os.replace(nextfile,b/'HANDOFF.md')
qual={'schema':'r80-bootstrap-partial-rollback-source-qualification-v1','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':h['status'],'nativeArtifacts':{n:h['facts'][n] for n in ['host','consent','bootstrap']},'bootstrapCases':h['facts']['bootstrapQa']['pass'],'partialRollbackProductionAstCases':h['facts']['partialRollbackQa']['pass'],'journalCasesReused':21,'sourceFiles':h['sourceFiles'],'finalReceipt':{'path':'qa/h/RECEIPT.json','sha256':sha(b/'qa/h/RECEIPT.json')},'priorG':'G_QUALIFICATION.json and source-history-g; source-negative pass only, not UAC-ready due missing partial rollback','handoffSha256':sha(b/'HANDOFF.md'),'dependenciesSha256':sha(b/'DEPENDENCIES.json'),'productionRollbackActual':'UNPROVEN','realProtectedAclPositive':'UNPROVEN','enrolled':False,'taskRegisteredOrStarted':False,'uacOpened':False,'productionKeysCreated':False,'installedCommanderChanged':False,'activeJobsStoppedOrReplayed':False,'whole':'NOT_FINAL','next':'parent H review, exact final bundle and readonly preflight, then owner-controlled UAC and independent real acceptance probe','cleanupOnlyDiagnosticEdge':'authoritative error code; boolean false only cleanup-alone without prior exception Data','parentOwnsDelivery':True}
(b/'QUALIFICATION.json').write_text(json.dumps(qual,indent=2),encoding='utf-8')
event={'schema':'r80-bootstrap-h-source-subrevision-v1','utc':qual['utc'],'oneBlocker':'rollback after partial task activation without enrollment completion','preMetadataSha256':pre,'preservedGSource':'source-history-g','preservedGMetadata':['G_QUALIFICATION.json','G_MANIFEST.json','G_HANDOFF.md'],'receiptSha256':sha(b/'qa/h/RECEIPT.json'),'sourceAndNativeOnly':True,'taskOrInstallationMutation':False,'noOldRunnerReplayed':True}
(b/'H_SUBREVISION.json').write_text(json.dumps(event,indent=2),encoding='utf-8')
files=[]
for base in [b,a]:
    for p in sorted(base.rglob('*')):
        if not p.is_file() or p==b/'MANIFEST.json':continue
        if any(x in ['bin','obj'] for x in p.relative_to(base).parts) or p.suffix.lower() in ['.exe','.pdb']:continue
        files.append({'path':str(p.relative_to(r)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':sha(p)})
(b/'MANIFEST.json').write_text(json.dumps({'schema':'r80-bootstrap-auth-h-author-manifest-v1','role':'source/evidence whitelist; client/probe/review/delivery separately owned','files':files,'nativeArtifactsExternalReferenceOnly':qual['nativeArtifacts'],'noNestedArchiveOrCache':True,'excludedCompilerCopiesLedger':'MANIFEST_SCOPE_CORRECTION.json'},indent=2),encoding='utf-8')
print(json.dumps({'qualificationSha256':sha(b/'QUALIFICATION.json'),'handoffSha256':sha(b/'HANDOFF.md'),'manifestSha256':sha(b/'MANIFEST.json'),'receiptSha256':sha(b/'qa/h/RECEIPT.json'),'entries':len(files),'bytes':sum(x['bytes'] for x in files)}))
