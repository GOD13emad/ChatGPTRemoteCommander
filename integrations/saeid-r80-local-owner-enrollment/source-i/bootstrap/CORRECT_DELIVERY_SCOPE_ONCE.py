import pathlib,json,hashlib,datetime
b=pathlib.Path(__file__).resolve().parent;r=b.parent;sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
path=b/'MANIFEST.json';old=path.read_bytes();original=json.loads(old);excluded=[x for x in original['files'] if pathlib.Path(x['path']).suffix.lower() in ['.exe','.pdb']]
assert len(excluded)==2 and sum(x['bytes'] for x in excluded)==20632064,'UNEXPECTED_DELIVERY_SCOPE'
saved=b/'MANIFEST_INITIAL_OVERSCOPE.json';assert not saved.exists();saved.write_bytes(old)
correction={'schema':'r80-author-manifest-scope-correction-v1','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'oldManifestSha256':hashlib.sha256(old).hexdigest(),'cause':'C bootstrap project source and publish folder shared a name; historical source-only snapshot copied known compiler outputs','excludedFromReturn':excluded,'filesDeleted':False,'rebuild':'bootstrap/source-history-c source + shared official NativeAOT package cache; current native binary is separate finalG reference','preserveHistoricalSource':True}
(b/'MANIFEST_SCOPE_CORRECTION.json').write_text(json.dumps(correction,indent=2),encoding='utf-8')
files=[]
for base in [b,r/'auth']:
    for p in sorted(base.rglob('*')):
        if not p.is_file() or p==path:continue
        rel=p.relative_to(base)
        if any(x in ['bin','obj'] for x in rel.parts) or p.suffix.lower() in ['.exe','.pdb']:continue
        files.append({'path':str(p.relative_to(r)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':sha(p)})
original['files']=files;original['excludedCompilerCopies']=excluded;original['scopeCorrection']='bootstrap/MANIFEST_SCOPE_CORRECTION.json'
path.write_text(json.dumps(original,indent=2),encoding='utf-8')
print(json.dumps({'manifestSha256':sha(path),'entries':len(files),'sourceEvidenceBytes':sum(x['bytes'] for x in files),'excludedBytes':sum(x['bytes'] for x in excluded),'excludedFilesDeleted':False}))
