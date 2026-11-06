import pathlib,json,hashlib
r=pathlib.Path(__file__).resolve().parent.parent;a=r/'auth';assert not a.exists(),'UNKNOWN_AUTH_ROOT'
a.mkdir();(a/'src').mkdir()
old=r.parent/'commander-one-integration-r78/reviews/durable/local-owner-auth'
files=[(old/'protected-issuer-state/ProtectedIssuerState.cs','ProtectedIssuerState.cs'),(old/'protected-oauth-exchange/ExchangeJournal.cs','ExchangeJournal.cs')]
admitted=[]
for source,name in files:
    raw=source.read_bytes();text=raw.decode('utf-8')
    anchor='if(!fixture){using var f=WindowsGuard.OpenProtected(path,max);return WindowsGuard.Read(f);}' if name.startswith('Protected') else 'if(!fixture){using var f=WindowsGuard.OpenProtected(p,max);return WindowsGuard.Read(f);}'
    replacement='if(!fixture){if(Path.GetFileName(path)=="issuer.journal")return ProtectedJournal.Read(root,"issuer.journal",max,EnrollmentHash);using var f=WindowsGuard.OpenProtected(path,max);return WindowsGuard.Read(f);}' if name.startswith('Protected') else 'if(!fixture){if(Path.GetFileName(p)=="exchange.journal")return ProtectedJournal.Read(root,"exchange.journal",max,enrollmentHash);using var f=WindowsGuard.OpenProtected(p,max);return WindowsGuard.Read(f);}'
    assert text.count(anchor)==1
    dest=a/'src'/name;dest.write_text(text.replace(anchor,replacement),encoding='utf-8')
    admitted.append({'source':str(source),'preSha256':hashlib.sha256(raw).hexdigest(),'derived':str(dest),'postSha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'change':'fixed journal only; empty initial-state bound reader; global protected-file guard unchanged'})
(a/'ADMISSION.json').write_text(json.dumps({'schema':'r80-derived-auth-admission-v1','owner':'saeed','role':'source-only first protected journal correction; no enrollment','sources':admitted},indent=2),encoding='utf-8')
print(json.dumps(admitted))
