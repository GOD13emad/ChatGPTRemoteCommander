from pathlib import Path
import json,hashlib,datetime,struct
r=Path('G:/CodexWork/RemoteCommander_ConnectionRecovery_20261027/commander-one-owner-enrollment-r80');o=r/'reviews/independent'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();read=lambda p:json.loads(p.read_text(encoding='utf-8'))
expected={'bootstrap/qa/h/RECEIPT.json':'e4b68f9b7d29beb03a4a1260fbd55f2dedef572fc4c995e443fcc19237f1d2b5','bootstrap/QUALIFICATION.json':'1157391b7751887ad5e498dcd7e61d92e1be39a39814a078176beacb446a4955','bootstrap/HANDOFF.md':'95f3f5763102f52e592034ffb10f08332c9d91d6a37622559ab1936811512ea5','bootstrap/MANIFEST.json':'fac9cb068f47233d915512c8eed111d801ccc8697887cb0f88cbae6bc67cd569','00_DELIVERY/OPEN_REVIEWED_OWNER_ENROLLMENT_R80_ONCE.ps1':'596f8131a201d32b86a3e8079e712ae3ffdf45284ccaeaccdd41791633d19346'}
assert all(sha(r/p)==v for p,v in expected.items())
q=read(r/'bootstrap/qa/h/RECEIPT.json');assert q['failure']is None and all(x['exitCode']==x['expectedExit']for x in q['phases'])
assert len(q['sourceFiles'])==18 and all(sha(r/x['path'])==x['sha256']for x in q['sourceFiles'])
facts=q['facts'];assert facts['bootstrapQa']['pass']==19 and facts['bootstrapQa']['fail']==0
partial=facts['partialRollbackQa'];assert partial['pass']==15 and partial['fail']==0 and not partial['outerScriptExecuted']and not partial['comCreated']and not partial['taskQueriedOrChanged']
m=read(r/'bootstrap/MANIFEST.json');assert len(m['files'])==217 and all(sha(r/x['path'])==x['sha256']for x in m['files'])
binary=Path(facts['bootstrap']['path']);raw=binary.read_bytes();assert sha(binary)=='b14c1eea5ded82ca77e679460088d5792b8948f9204ea791bf575450c8a72ac3'and len(raw)==3862528
u16=lambda at:struct.unpack_from('<H',raw,at)[0];u32=lambda at:struct.unpack_from('<I',raw,at)[0]
pe=u32(0x3c);opt=pe+24;assert raw[:2]==b'MZ'and raw[pe:pe+4]==b'PE\0\0'and u16(pe+4)==0x8664 and u16(opt)==0x20b and u32(opt+112+14*8)==0 and u32(opt+112+14*8+4)==0
rva=u32(opt+112+10*8);off=None;sections=opt+u16(pe+20)
for i in range(u16(pe+6)):
 s=sections+i*40;va=u32(s+12)
 if va<=rva<va+max(u32(s+8),u32(s+16)):off=u32(s+20)+rva-va
assert off is not None and u16(off+78)==2048
manifest=r/'bootstrap/qa/h/bootstrap.manifest';text=manifest.read_text(encoding='utf-8-sig');assert 'asInvoker'in text and 'uiAccess="false"'in text
common={'generatedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS_SCOPED_SOURCE_REVIEW','whole':'NOT_FINAL','actualUacOrEnrollmentByReviewer':False,'installedChanged':False,'activeJobsStoppedOrReplayed':0,'runtimeLogin':'UNPROVEN'}
h={**common,'schema':'R80_INDEPENDENT_BOOTSTRAP_H_REVIEW_V1','sourceFiles':q['sourceFiles'],'sourcePinsVerified':18,'binary':facts['bootstrap'],'receiptPath':str(r/'bootstrap/qa/h/RECEIPT.json'),'receiptSha256':expected['bootstrap/qa/h/RECEIPT.json'],'authorQualificationSha256':expected['bootstrap/QUALIFICATION.json'],'authorManifestSha256':expected['bootstrap/MANIFEST.json'],'authorFilesVerified':217,'bootstrapCases':19,'productionSelectorAstCases':15,'actualTaskComExecuted':False,'journalCasesReused':21,'partialRollbackSelection':'PASS_SOURCE_ONLY','productionTaskRollbackActual':'UNPROVEN','supersedesUacHoldSha256':'d19e63188adb42fb162964b8305f340b4ab8eac43c4ce5b5038169ec7654ff15','priorGReadiness':'HISTORICAL_SUPERSEDED_BY_H','readyFor':'PARENT_FROZEN_PLAN_PREFLIGHT_AND_OWNER_UAC','reviewSha256':sha(o/'BOOTSTRAP_H_REVIEW.md'),'noProjectScopeOnly':True}
launcher={**common,'schema':'R80_INDEPENDENT_PARENT_LAUNCHER_REVIEW_V1','sourcePath':str(r/'00_DELIVERY/OPEN_REVIEWED_OWNER_ENROLLMENT_R80_ONCE.ps1'),'sourceSha256':expected['00_DELIVERY/OPEN_REVIEWED_OWNER_ENROLLMENT_R80_ONCE.ps1'],'planPin':'MANDATORY_EXTERNAL_EXPECTED_SHA_PLUS_HELD_BYTES','bootstrapPin':'HASH_FROM_HELD_IMAGE_AFTER_OPEN','parentParserErrorsReported':0,'reviewerExecuted':False,'concretePlanFrozen':False,'readyFor':'PARENT_FREEZE_EXACT_PLAN_THEN_ONE_OWNER_UAC_ATTEMPT','reviewSha256':sha(o/'PARENT_LAUNCHER_REVIEW.md')}
for name,obj in [('BOOTSTRAP_H_REVIEW.json',h),('PARENT_LAUNCHER_REVIEW.json',launcher)]:
 with (o/name).open('x',encoding='utf-8',newline='\n')as f:json.dump(obj,f,indent=2);f.write('\n')
print(json.dumps({'status':'PASS_SCOPED_SOURCE_REVIEW','bootstrapReviewSha256':sha(o/'BOOTSTRAP_H_REVIEW.md'),'bootstrapReceiptSha256':sha(o/'BOOTSTRAP_H_REVIEW.json'),'launcherReviewSha256':sha(o/'PARENT_LAUNCHER_REVIEW.md'),'launcherReceiptSha256':sha(o/'PARENT_LAUNCHER_REVIEW.json'),'sourcePins':18,'manifestFiles':217}))
