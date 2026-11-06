import pathlib,re,hashlib,json
b=pathlib.Path(__file__).resolve().parent;source=b/'src';target=source/'OutcomeCodes.cs';assert not target.exists()
old=b.parent.parent/'commander-one-integration-r78/reviews/durable/local-owner-auth/native-consent-aot-j';inputs=list(source.glob('*.cs'))+[old/'WindowsGuard.cs',old/'OwnerConsentCore.cs']
codes=set()
for p in inputs:codes.update(re.findall(r'"([A-Z][A-Z0-9_]{0,95})"',p.read_text(encoding='utf-8')))
codes.update(['INVALID_JSON','ACCESS_DENIED','IO_UNCERTAIN_RECONCILE_NO_RETRY','BOOTSTRAP_UNAVAILABLE_NO_RETRY'])
text='namespace CommanderOwnerBootstrap;\ninternal static partial class NativeOutcome\n{\n    private static readonly System.Collections.Generic.HashSet<string> FaultCodes=new(System.StringComparer.Ordinal)\n    {\n'+''.join('        "'+c+'",\n' for c in sorted(codes))+'    };\n}\n';target.write_text(text,encoding='utf-8')
print(json.dumps({'allowlistedStaticCodes':len(codes),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'noRuntimeMutation':True}))
