from pathlib import Path
import json,hashlib,datetime,struct
r=Path('G:/CodexWork/RemoteCommander_ConnectionRecovery_20261027/commander-one-owner-enrollment-r80');o=r/'reviews/independent'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();read=lambda p:json.loads(p.read_text(encoding='utf-8'))
expected={'bootstrap/qa/g/RECEIPT.json':'d445584d93e5d6936af4b61d643abd7c82b73ac8f0ee097b72cecb91c4e733b8','bootstrap/qa/e/RECEIPT.json':'6278975b323d47055d73dc2d9c9c743752d973605ed493dd0e262c98eda22be6','bootstrap/qa/d/RECEIPT.json':'81f8cd53bd0d3d5de6f09653f612ff77f47e07cbca37fec07041e656788b40c7','bootstrap/qa/c/RECEIPT.json':'4c2d4a3e8bdd64115de4085021a1bfeae99189fa462c78e21aee250c477c865e'}
assert all(sha(r/p)==v for p,v in expected.items())
g=read(r/'bootstrap/qa/g/RECEIPT.json');d=read(r/'bootstrap/qa/d/RECEIPT.json');e=read(r/'bootstrap/qa/e/RECEIPT.json')
assert g['failure']is None and all(x['exitCode']==x['expectedExit']for x in g['phases'])
assert all(sha(r/x['path'])==x['sha256']for x in g['sourceFiles'])
assert g['facts']['bootstrapQa']['pass']==17 and g['facts']['bootstrapQa']['fail']==0
journal=read(r/'bootstrap/qa/d/journal-d-cases.stdout.log');assert journal['pass']==21 and journal['fail']==0 and not journal['productionAclPositive']
assert e['facts']['effectiveScriptPolicy']=='RemoteSigned'
for name in ['apply','rollback']:
 x=read(r/f'bootstrap/qa/g/bootstrap-g-ordinary-{name}.stderr.log');assert x['code']=='SAME_OWNER_REAL_UAC_TOKEN_REQUIRED'
artifacts=[]
for role in ['host','consent','bootstrap']:
 artifact=g['facts'][role];p=Path(artifact['path']);raw=p.read_bytes();assert len(raw)==artifact['bytes']and sha(p)==artifact['sha256']
 u16=lambda at:struct.unpack_from('<H',raw,at)[0];u32=lambda at:struct.unpack_from('<I',raw,at)[0]
 pe=u32(0x3c);opt=pe+24;assert raw[:2]==b'MZ'and raw[pe:pe+4]==b'PE\0\0'and u16(pe+4)==0x8664 and u16(opt)==0x20b and u32(opt+112+14*8)==0 and u32(opt+112+14*8+4)==0
 rva=u32(opt+112+10*8);off=None;sections=opt+u16(pe+20)
 for i in range(u16(pe+6)):
  s=sections+i*40;va=u32(s+12)
  if va<=rva<va+max(u32(s+8),u32(s+16)):off=u32(s+20)+rva-va
 assert off is not None and u16(off+78)==2048
 manifest=r/('bootstrap/qa/g/bootstrap.manifest'if role=='bootstrap'else f'bootstrap/qa/e/{role}.manifest')
 text=manifest.read_text(encoding='utf-8-sig');assert 'asInvoker'in text and 'uiAccess="false"'in text
 artifacts.append({'role':role,**artifact,'reviewerReadPeVerified':True,'manifestPath':str(manifest),'manifestSha256':sha(manifest),'reviewerExecuted':False})
pins=[{'path':str(r/p),'sha256':v}for p,v in expected.items()]
for name in ['PRIMARY_CONTRACTS.md','FILE_LIFECYCLE_AUDIT_A.md','BOOTSTRAP_REVIEW.md','FINALIZE_BOOTSTRAP_REVIEW_ONCE.py']:
 pins.append({'path':str(o/name),'sha256':sha(o/name)})
result={'schema':'R80_INDEPENDENT_BOOTSTRAP_AUTH_G_REVIEW_V1','generatedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS_SCOPED_SOURCE_REVIEW','whole':'NOT_FINAL','reviewSha256':sha(o/'BOOTSTRAP_REVIEW.md'),'sourcePinsVerified':len(g['sourceFiles']),'sourceFiles':g['sourceFiles'],'artifacts':artifacts,'qualification':{'bootstrapCases':17,'journalCases':21,'journalProtectedAclPositive':False,'effectivePolicyObserved':'RemoteSigned','testsRerunByReviewer':0,'retainedFailedReceiptsNotRelabeled':['bootstrap/qa/c/RECEIPT.json','bootstrap/qa/d/RECEIPT.json']},'mapping':{'zeroJournalReader':'RESOLVED_DEDICATED_VALIDATED_INITIAL_READ','inheritedReceiptDacl':'RESOLVED_DERIVED_EXPLICIT_PRIVATE_WRITER','mutableRollbackInventory':'RESOLVED_PRESERVE_ONLY_MUTABLE_ROLES','ownedHelperLifetime':'RESOLVED_EXACT_HELD_HANDLE_GENERATION','primaryErrorPreservation':'RESOLVED_KEEP_ORIGINAL_WITH_SANITIZED_METADATA'},'acceptedDiagnosticLimitation':{'case':'cleanup-only failure code may coexist with false auxiliary boolean','authoritativeCode':'OWN_HELPER_CLEANUP_UNCERTAIN_NO_RETRY','parentRule':'ANY nonzero apply outcome requires reconciliation/no retry; never infer cleanup confirmation from boolean','authorityRelaxed':False},'readyFor':'PARENT_EXACT_BUNDLE_PREFLIGHT_AND_ACTUAL_OWNER_UAC_ACCEPTANCE','positiveProtectedAcl':'UNPROVEN','positiveKernelPeer':'UNPROVEN','realOwnerLogin':'UNPROVEN','taskRollbackActual':'UNPROVEN','scope':'NO_PROJECT_SELFTEST_ONLY','uacOrTaskOrKeysByReviewer':False,'sealedR78R79Changed':False,'installedChanged':False,'activeJobsStoppedOrReplayed':0,'pins':pins}
target=o/'BOOTSTRAP_REVIEW.json'
with target.open('x',encoding='utf-8',newline='\n')as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps({'status':result['status'],'reviewSha256':sha(o/'BOOTSTRAP_REVIEW.md'),'receiptSha256':sha(target),'sourcePins':result['sourcePinsVerified'],'artifacts':len(artifacts),'readyFor':result['readyFor']}))
