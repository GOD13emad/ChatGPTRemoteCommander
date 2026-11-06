from pathlib import Path
import json,hashlib,datetime
r=Path('G:/CodexWork/RemoteCommander_ConnectionRecovery_20261027/commander-one-owner-enrollment-r80');o=r/'reviews/independent'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();read=lambda p:json.loads(p.read_text(encoding='utf-8'))
pins={'bootstrap/QUALIFICATION.json':'41852875fa85bd41d680c5a6770e184ef1229ce08694b0ce135cdfdda8fef7d2','bootstrap/HANDOFF.md':'e39c3a9eebe099ba7029beb76a8c527f8937585bf61a35df398325dfe0623cb9','bootstrap/MANIFEST.json':'395317c3a9e9e09e769310da814fcf5c40d5393fc33ef22e563d4198871c0108','bootstrap/DEPENDENCIES.json':'43a7a125c72910173bff1fd4ac7712fa56fd216806311b6c5fcd30c92865ebe4'}
assert all(sha(r/p)==v for p,v in pins.items())
m=read(r/'bootstrap/MANIFEST.json');assert len(m['files'])==181
assert all(sha(r/x['path'])==x['sha256']for x in m['files'])
q=read(r/'bootstrap/QUALIFICATION.json');review=read(o/'BOOTSTRAP_REVIEW.json')
assert q['sourceFiles']==review['sourceFiles']and q['bootstrapCases']==17 and q['journalCases']==21 and q['failures']==0
assert not q['enrolled']and not q['uacOpened']and q['runtimeLogin']=='UNPROVEN'
result={'schema':'R80_INDEPENDENT_AUTHOR_METADATA_RECONCILIATION_V1','generatedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS_SCOPED_SOURCE_REVIEW','authorPins':pins,'authorManifestFilesVerified':len(m['files']),'authorManifestBytes':sum(x['bytes']for x in m['files']),'bootstrapReviewSha256':sha(o/'BOOTSTRAP_REVIEW.json'),'clientReviewSha256':sha(o/'CLIENT_REVIEW.json'),'lifecyclePrimaryDeltaSha256':sha(o/'OWNED_HELPER_CONTRACT.md'),'codeOrBinaryChangedAfterReview':False,'readyFor':'PARENT_EXACT_BUNDLE_PREFLIGHT_AND_ACTUAL_OWNER_UAC_ACCEPTANCE','whole':'NOT_FINAL','runtimeLogin':'UNPROVEN','installedChanged':False,'reviewerAuthorityEffects':False}
target=o/'AUTHOR_METADATA_RECONCILIATION.json'
with target.open('x',encoding='utf-8',newline='\n')as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps({'status':result['status'],'receiptSha256':sha(target),'authorFiles':len(m['files']),'authorBytes':result['authorManifestBytes']}))
