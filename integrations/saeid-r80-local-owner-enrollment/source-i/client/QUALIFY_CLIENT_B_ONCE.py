import pathlib,os,subprocess,json,datetime,hashlib,struct
r=pathlib.Path(__file__).resolve().parent;short=pathlib.Path('G:/CodexWork/RC1R80Client');q=r/'qa-b';q.mkdir(exist_ok=False)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
a=json.loads((r/'SOURCE_INPUT_MANIFEST_A.json').read_bytes());marker=json.loads((short/'OWNER.json').read_bytes());assert marker==a and a['sourceRoot']==str(r)
for row in a['frozenDependencies']:assert sha(pathlib.Path(row['path']))==row['sha256'],'FROZEN_INPUT_CHANGED'
for row in json.loads((r/'source-history-a/PINS.json').read_bytes()):assert sha(pathlib.Path(row['backup']))==row['sha256'],'A_SOURCE_BACKUP_CHANGED'
rows=[{'path':str(p),'sha256':sha(p),'bytes':p.stat().st_size} for p in sorted((r/'src').iterdir()) if p.is_file()]
admission={**a,'schema':'r80-client-build-admission-b-v1','sources':rows,'change':'Own transient launcher exact held-handle/creation/image bounded cleanup; one-shot race closure after request; no SYSTEM task or project stop'}
(r/'SOURCE_INPUT_MANIFEST_B.json').write_text(json.dumps(admission,indent=2),encoding='utf-8')
env={k:v for k,v in os.environ.items() if k.lower() not in {'path','dotnet_startup_hooks','dotnet_root'}};env['Path']='C:\\Program Files\\dotnet;C:\\Windows\\System32;C:\\Windows';env['PATHEXT']='.COM;.EXE;.BAT;.CMD'
for k,v in {'DOTNET_GENERATE_ASPNET_CERTIFICATE':'false','DOTNET_CLI_TELEMETRY_OPTOUT':'1','DOTNET_SKIP_FIRST_TIME_EXPERIENCE':'1','DOTNET_NOLOGO':'1','DOTNET_CLI_HOME':str(short/'dotnet-home'),'NUGET_PACKAGES':a['sharedCache'],'NUGET_HTTP_CACHE_PATH':str(short/'http-cache'),'NUGET_PLUGINS_CACHE_PATH':str(short/'plugins-cache'),'NUGET_SCRATCH':str(short/'scratch'),'TEMP':str(short/'temp'),'TMP':str(short/'temp'),'DOTNET_PROCESSOR_COUNT':'2'}.items():env[k]=v
dotnet='C:/Program Files/dotnet/dotnet.exe';phases=[];facts={};fault=None
def run(name,args,input=None,expected=0):
 p=subprocess.run(args,cwd=short,env=env,input=input,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180,creationflags=subprocess.CREATE_NO_WINDOW)
 (q/(name+'.stdout.log')).write_bytes(p.stdout);(q/(name+'.stderr.log')).write_bytes(p.stderr);phases.append({'phase':name,'exitCode':p.returncode,'expected':expected});assert p.returncode==expected,name;return p
def inspect(exe):
 data=exe.read_bytes();pe=struct.unpack_from('<I',data,0x3c)[0];opt=pe+24;assert struct.unpack_from('<II',data,opt+112+14*8)==(0,0);rva,size=struct.unpack_from('<II',data,opt+112+10*8);off=None
 for i in range(struct.unpack_from('<H',data,pe+6)[0]):
  s=opt+struct.unpack_from('<H',data,pe+20)[0]+40*i;vs,va,rs,raw=struct.unpack_from('<IIII',data,s+8)
  if va<=rva<va+max(vs,rs):off=raw+rva-va
 assert off is not None and struct.unpack_from('<H',data,off+78)[0]==0x800
 return {'path':str(exe),'sha256':sha(exe),'bytes':len(data),'clrDirectory':[0,0],'dependentLoadFlags':2048}
props=['-p:FrozenR79Root='+str(r.parent.parent/'commander-one-native-issuer-r79'),'-p:FrozenR78Root='+str(r.parent.parent/'commander-one-integration-r78'),'-p:BaseIntermediateOutputPath='+str(short/'obj')+os.sep]
try:
 run('publish-native-b',[dotnet,'publish',str(r/'src/CommanderOwnerProxy.csproj'),'--no-restore','-c','Release','-o',str(short/'native-b'),*props,'-m:1','-p:IlcOptimizationPreference=Size'])
 exe=short/'native-b/CommanderOwnerProxy.exe';facts['binary']=inspect(exe)
 p=run('pure-parser-frame-policy-b',[str(exe),'--selftest']);facts['pureQA']=json.loads(p.stdout);assert facts['pureQA']['fail']==0
 p=run('ordinary-diagnostic-b',[str(exe),'--diagnose']);facts['diagnostic']=json.loads(p.stdout);assert not facts['diagnostic']['systemSid'] and not facts['diagnostic']['pipeConnected'] and not facts['diagnostic']['taskStarted']
 request={'version':1,'id':'b0000080-bbbb-cccc-dddd-eeeeeeeeeeee','action':'state','arguments':{'grantId':'grant:r80-private-negative-b'}}
 p=run('ordinary-unenrolled-rpc-b',[str(exe),'--rpc'],json.dumps(request).encode(),2);neg=json.loads(p.stderr);assert not neg['effectMayHaveOccurred'] and not neg['taskLaunchAttempted'] and not neg['launcherCleanupUncertain'] and neg['launcherCleanupConfirmed'] and not p.stdout;facts['ordinaryNegative']=neg
 run('publish-private-launcher-fixture',[dotnet,'publish',str(r/'src/CommanderOwnerProxy.csproj'),'--no-restore','-c','Release','-o',str(short/'launcher-fixture-b'),*props,'-p:LauncherFixtureOnly=true','-p:StartupObject=CommanderOwnerProxy.LauncherQA','-p:AssemblyName=CommanderOwnerLauncherQA','-m:1','-p:IlcOptimizationPreference=Size'])
 fixture=short/'launcher-fixture-b/CommanderOwnerLauncherQA.exe';facts['fixtureBinary']=inspect(fixture)
 p=run('actual-owned-launcher-cleanup',[str(fixture)]);facts['launcherLifecycle']=json.loads(p.stdout);assert facts['launcherLifecycle']['heldOwnChildCleanupConfirmed'] and not facts['launcherLifecycle']['systemTaskStartedOrStopped']
 facts['binaryPostSha256']=sha(exe);assert facts['binaryPostSha256']==facts['binary']['sha256']
except Exception as e:fault=type(e).__name__+':'+str(e)
unchanged=all(sha(pathlib.Path(x['path']))==x['sha256'] for x in rows) and all(sha(pathlib.Path(x['path']))==x['sha256'] for x in a['frozenDependencies'])
receipt={'schema':'r80-native-client-qa-b-v1','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS_NATIVE_CLIENT_PARSER_ORDINARY_NEGATIVE_AND_OWN_CHILD_LIFECYCLE' if fault is None and unchanged else 'FAIL_CLIENT_B_QUALIFICATION','failure':fault,'phases':phases,'facts':facts,'sourceManifestSha256':sha(r/'SOURCE_INPUT_MANIFEST_B.json'),'sourcesUnchanged':unchanged,'systemTaskLaunched':False,'listenerCreated':False,'enrollmentInstalled':False,'systemPositivePeerProven':False,'installedVersionChanged':False,'activeJobsStoppedOrReplayed':False,'automaticRetryAllowed':False}
(q/'RECEIPT.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print(json.dumps(receipt))
