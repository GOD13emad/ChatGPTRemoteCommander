import pathlib,os,subprocess,json,datetime,hashlib,struct
r=pathlib.Path(__file__).resolve().parent
project=r.parent.parent
r79=project/'commander-one-native-issuer-r79'
r78=project/'commander-one-integration-r78'
shared=pathlib.Path('G:/CodexWork/RC1R78AuthAot')
short=pathlib.Path('G:/CodexWork/RC1R80Client')
q=r/'qa-a';q.mkdir(exist_ok=False)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
rows=[{'path':str(p),'sha256':sha(p),'bytes':p.stat().st_size} for p in sorted((r/'src').iterdir()) if p.is_file()]
frozen=[(r79/'src/IssuerProtocol.cs','3e89674ed8590a54fd08b570d897ac0ceca17ceb4e2ed355fb5e5e436d37cb3f'),(r79/'src/HostPolicy.cs','facd7e6d66b8fc280806d997b1063eac312c74861162564a2f9be132bd418302')]
for suffix,pin in [('OwnerConsentCore.cs','684dd5d8efdc9a90c6d00e1ee6adb7a04bdf3563d716fa9e2dc76c8fab28d663'),('WindowsGuard.cs','30d773de2fde0a50f5519961f0d19ebbeb59bf6f6346f7d3bc9301f4f79ec0b5'),('SystemDllPolicy.cs','916e611fd3dfbd23614e774b134f0a5f90fcbecbdc385e53b15d03e32a6d2347')]:frozen.append((r78/'reviews/durable/local-owner-auth/native-consent-aot-j'/suffix,pin))
assert not short.exists(),'UNKNOWN_SHORT_ROOT'
for path,pin in frozen:assert sha(path)==pin,'FROZEN_SOURCE_DRIFT'
transfer=json.loads((r78/'reviews/durable/local-owner-auth/native-consent-aot/qa-f/TRANSFER.json').read_text());checked=0
for f in transfer:
 p=pathlib.Path(f['target'])
 if f['role']=='verified-build-package-file' and str(p).lower().startswith(str(shared/'packages').lower()+os.sep):assert sha(p)==f['sha256'],'ADMITTED_CACHE_DRIFT';checked+=1
assert checked>0
admission={'schema':'r80-client-build-admission-v1','owner':'saeed','project':'Remote Commander Saeed','sourceRoot':str(r),'shortRoot':str(short),'role':'ordinary NativeAOT compile/parser/negative QA; no task start, listener, SYSTEM, enrollment, UAC or install','sources':rows,'frozenDependencies':[{'path':str(p),'sha256':h} for p,h in frozen],'sharedCache':str(shared/'packages'),'verifiedSharedFiles':checked}
(r/'SOURCE_INPUT_MANIFEST_A.json').write_text(json.dumps(admission,indent=2),encoding='utf-8');short.mkdir();(short/'OWNER.json').write_text(json.dumps(admission,indent=2),encoding='utf-8');(short/'temp').mkdir()
config='<configuration><packageSources><clear/><add key="verified-local" value="'+str(shared/'packages')+'"/></packageSources><packageSourceMapping><packageSource key="verified-local"><package pattern="*"/></packageSource></packageSourceMapping></configuration>'
(short/'NuGet.offline.config').write_text(config,encoding='utf-8')
env={k:v for k,v in os.environ.items() if k.lower() not in {'path','dotnet_startup_hooks','dotnet_root'}};env['Path']='C:\\Program Files\\dotnet;C:\\Windows\\System32;C:\\Windows';env['PATHEXT']='.COM;.EXE;.BAT;.CMD'
for k,v in {'DOTNET_GENERATE_ASPNET_CERTIFICATE':'false','DOTNET_CLI_TELEMETRY_OPTOUT':'1','DOTNET_SKIP_FIRST_TIME_EXPERIENCE':'1','DOTNET_NOLOGO':'1','DOTNET_CLI_HOME':str(short/'dotnet-home'),'NUGET_PACKAGES':str(shared/'packages'),'NUGET_HTTP_CACHE_PATH':str(short/'http-cache'),'NUGET_PLUGINS_CACHE_PATH':str(short/'plugins-cache'),'NUGET_SCRATCH':str(short/'scratch'),'TEMP':str(short/'temp'),'TMP':str(short/'temp'),'DOTNET_PROCESSOR_COUNT':'2'}.items():env[k]=v
dotnet='C:/Program Files/dotnet/dotnet.exe';phases=[];facts={};fault=None
def run(name,args,input=None,expected=0):
 p=subprocess.run(args,cwd=short,env=env,input=input,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180,creationflags=subprocess.CREATE_NO_WINDOW)
 (q/(name+'.stdout.log')).write_bytes(p.stdout);(q/(name+'.stderr.log')).write_bytes(p.stderr);phases.append({'phase':name,'exitCode':p.returncode,'expected':expected});assert p.returncode==expected,name;return p
props=['-p:FrozenR79Root='+str(r79),'-p:FrozenR78Root='+str(r78),'-p:BaseIntermediateOutputPath='+str(short/'obj')+os.sep]
try:
 run('restore-offline',[dotnet,'restore',str(r/'src/CommanderOwnerProxy.csproj'),'--configfile',str(short/'NuGet.offline.config'),*props,'-p:NuGetAudit=false'])
 run('publish-native',[dotnet,'publish',str(r/'src/CommanderOwnerProxy.csproj'),'--no-restore','-c','Release','-o',str(short/'native'),*props,'-m:1','-p:IlcOptimizationPreference=Size'])
 exe=short/'native/CommanderOwnerProxy.exe';data=exe.read_bytes();facts['binary']={'path':str(exe),'sha256':sha(exe),'bytes':len(data)};pe=struct.unpack_from('<I',data,0x3c)[0];opt=pe+24;assert struct.unpack_from('<II',data,opt+112+14*8)==(0,0);rva,size=struct.unpack_from('<II',data,opt+112+10*8);off=None
 for i in range(struct.unpack_from('<H',data,pe+6)[0]):
  s=opt+struct.unpack_from('<H',data,pe+20)[0]+40*i;vs,va,rs,raw=struct.unpack_from('<IIII',data,s+8)
  if va<=rva<va+max(vs,rs):off=raw+rva-va
 assert off is not None and struct.unpack_from('<H',data,off+78)[0]==0x800;facts['clrDirectory']=[0,0];facts['dependentLoadFlags']=2048
 p=run('pure-parser-frame-policy',[str(exe),'--selftest']);facts['pureQA']=json.loads(p.stdout);assert facts['pureQA']['fail']==0
 p=run('ordinary-diagnostic',[str(exe),'--diagnose']);facts['diagnostic']=json.loads(p.stdout);assert not facts['diagnostic']['systemSid'] and not facts['diagnostic']['pipeConnected'] and not facts['diagnostic']['taskStarted']
 request={'version':1,'id':'a0000080-bbbb-cccc-dddd-eeeeeeeeeeee','action':'state','arguments':{'grantId':'grant:r80-private-negative'}}
 p=run('ordinary-unenrolled-rpc',[str(exe),'--rpc'],json.dumps(request).encode(),2);negative=json.loads(p.stderr);assert not negative['effectMayHaveOccurred'] and not negative['taskLaunchAttempted'] and p.stdout==b'';facts['ordinaryNegative']=negative
 facts['binaryPostSha256']=sha(exe);assert facts['binaryPostSha256']==facts['binary']['sha256']
except Exception as e:fault=type(e).__name__+':'+str(e)
unchanged=all(sha(pathlib.Path(x['path']))==x['sha256'] for x in rows) and all(sha(p)==pin for p,pin in frozen)
receipt={'schema':'r80-native-client-qa-v1','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS_NATIVE_CLIENT_AND_ORDINARY_NEGATIVES_ONLY' if fault is None and unchanged else 'FAIL_CLIENT_QUALIFICATION','failure':fault,'phases':phases,'facts':facts,'sourceManifestSha256':sha(r/'SOURCE_INPUT_MANIFEST_A.json'),'sourcesUnchanged':unchanged,'taskLaunched':False,'listenerCreated':False,'enrollmentInstalled':False,'systemPositivePeerProven':False,'installedVersionChanged':False,'activeJobsStoppedOrReplayed':False,'automaticRetryAllowed':False}
(q/'RECEIPT.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print(json.dumps(receipt))
