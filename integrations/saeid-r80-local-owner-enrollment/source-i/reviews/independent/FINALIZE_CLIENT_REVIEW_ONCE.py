from pathlib import Path
import json,hashlib,datetime,struct
r=Path('G:/CodexWork/RemoteCommander_ConnectionRecovery_20261027/commander-one-owner-enrollment-r80')
client=r/'client';out=r/'reviews/independent'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
read=lambda p:json.loads(p.read_text(encoding='utf-8'))
expected={'SOURCE_INPUT_MANIFEST_B.json':'29a5ab426c32df2dce7052e20c61e29d8059cfdf8abaab14cb73def5883f1b6d','DELIVERY_MANIFEST.json':'f774acf21331a5b8c3f42fb27c2ea5baf96cd6c68e2f97c46a064397ae72bd2b','HANDOFF.md':'282adfed058f714f6b03ee4887e702a010b34923e9bb74d91c5fb9e589966ec2','CLIENT_CONTRACT.json':'df70b98349f338087618d648afb625e1b05d59b60c5404a10f6afb71cee73d3e'}
assert all(sha(client/p)==v for p,v in expected.items())
m=read(client/'SOURCE_INPUT_MANIFEST_B.json');d=read(client/'DELIVERY_MANIFEST.json');q=read(client/'qa-b/RECEIPT.json')
assert all(sha(Path(x['path']))==x['sha256']for x in m['sources']+m['frozenDependencies'])
assert all(sha(client/x['path'])==x['sha256']for x in d['files'])
assert all(p['exitCode']==p['expected']for p in q['phases'])and q['failure']is None and q['sourcesUnchanged']
facts=q['facts'];assert facts['pureQA']['pass']==34 and facts['pureQA']['fail']==0
assert facts['ordinaryNegative']['code']=='CLIENT_PROTECTED_ENROLLMENT_NOT_READY'and not facts['ordinaryNegative']['effectMayHaveOccurred']and not facts['ordinaryNegative']['taskLaunchAttempted']
life=facts['launcherLifecycle'];assert life['heldOwnChildCleanupConfirmed']and life['alreadyExitedObservationConfirmed']and not life['otherPidsOpened']and not life['systemTaskStartedOrStopped']
binary=Path(facts['binary']['path']);raw=binary.read_bytes();assert len(raw)==3136000 and sha(binary)=='95800e1ca4eecd36dfd858f760b0f36d83c0305829c4cc4546a126ff100a8eaa'
u16=lambda p:struct.unpack_from('<H',raw,p)[0];u32=lambda p:struct.unpack_from('<I',raw,p)[0]
pe=u32(0x3c);opt=pe+24;assert raw[:2]==b'MZ'and raw[pe:pe+4]==b'PE\0\0'and u16(pe+4)==0x8664 and u16(opt)==0x20b and u32(opt+112+14*8)==0 and u32(opt+112+14*8+4)==0
rva=u32(opt+112+10*8);offset=None;sections=opt+u16(pe+20)
for i in range(u16(pe+6)):
 s=sections+i*40;va=u32(s+12)
 if va<=rva<va+max(u32(s+8),u32(s+16)):offset=u32(s+20)+rva-va
assert offset is not None and u16(offset+78)==0x800
result={'schema':'R80_INDEPENDENT_CLIENT_B_REVIEW_V1','generatedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS_SCOPED_SOURCE_REVIEW','whole':'NOT_FINAL','reviewSha256':sha(out/'CLIENT_REVIEW.md'),'sourceManifestSha256':expected['SOURCE_INPUT_MANIFEST_B.json'],'sourcePinsVerified':len(m['sources'])+len(m['frozenDependencies']),'sourcePins':m['sources'],'frozenDependencyPins':m['frozenDependencies'],'deliveryManifestSha256':expected['DELIVERY_MANIFEST.json'],'filteredDeliveryFilesVerified':len(d['files']),'contractSha256':expected['CLIENT_CONTRACT.json'],'qualificationReceipt':str(client/'qa-b/RECEIPT.json'),'qualificationReceiptSha256':sha(client/'qa-b/RECEIPT.json'),'binary':facts['binary'],'pureCases':34,'actualOrdinaryUnenrolledDenial':facts['ordinaryNegative'],'actualPrivateLauncherLifecycle':life,'testRerunByReviewer':0,'issuesResolved':['one-shot host exit race before and after reply read','fresh owned launcher finite lifetime cleanup'],'positiveSystemPeer':'UNPROVEN','realTaskInvocation':'UNPROVEN','realOwnerLogin':'UNPROVEN','deployment':'PARENT_REVIEWED_BOOTSTRAP_AND_REAL_UAC_ACCEPTANCE_REQUIRED','scope':'NO_PROJECT_SELFTEST_ONLY','sealedR78R79Changed':False,'installedChanged':False,'activeJobsStoppedOrReplayed':0}
target=out/'CLIENT_REVIEW.json'
with target.open('x',encoding='utf-8',newline='\n')as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps({'status':result['status'],'reviewSha256':sha(out/'CLIENT_REVIEW.md'),'receiptSha256':sha(target),'sourcePins':result['sourcePinsVerified'],'deliveryFiles':result['filteredDeliveryFilesVerified']}))
