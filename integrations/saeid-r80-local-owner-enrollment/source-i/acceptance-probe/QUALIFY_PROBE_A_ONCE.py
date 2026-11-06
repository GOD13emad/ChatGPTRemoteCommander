import pathlib,os,subprocess,json,datetime,hashlib,struct,re
r=pathlib.Path(__file__).resolve().parent;base=r.parent.parent;short=pathlib.Path('G:/CodexWork/RC1R80ProbeBuild');q=r/'qa-a';q.mkdir(exist_ok=False)
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert not short.exists(),'UNKNOWN_SHORT_ROOT'
client=r.parent/'client';cm=json.loads((client/'SOURCE_INPUT_MANIFEST_B.json').read_bytes());frozen=cm['frozenDependencies']+[{'path':str(client/'src/ClientPolicy.cs'),'sha256':'a623a0068f1bc717b04a903070488d772db7b090cff3366c2cddad0757bd2d72'}]
for x in frozen:assert h(pathlib.Path(x['path']))==x['sha256'],'FROZEN_INPUT_DRIFT'
cache=pathlib.Path('G:/CodexWork/RC1R78AuthAot/packages');r78=base/'commander-one-integration-r78';checked=0
for x in json.loads((r78/'reviews/durable/local-owner-auth/native-consent-aot/qa-f/TRANSFER.json').read_bytes()):
 p=pathlib.Path(x['target'])
 if x['role']=='verified-build-package-file' and str(p).lower().startswith(str(cache).lower()+os.sep):assert h(p)==x['sha256'],'CACHE_DRIFT';checked+=1
assert checked>0
sources=[{'path':str(p),'bytes':p.stat().st_size,'sha256':h(p)} for p in sorted((r/'src').iterdir()) if p.is_file()]
admit={'schema':'r80-probe-source-admission-a-v1','owner':'saeed','sourceRoot':str(r),'shortBuildRoot':str(short),'futureRuntimePrivateRoot':'G:/CodexWork/RC1R80OwnerProbe','futureRootNotUsedForQA':True,'role':'NativeAOT source compile/pure privacy/ordinary early-negative only; no real owner modes/keys/UAC/task/proxy','sources':sources,'frozenDependencies':frozen,'sharedCache':str(cache),'checkedCacheFiles':checked}
(r/'SOURCE_INPUT_MANIFEST_A.json').write_text(json.dumps(admit,indent=2),encoding='utf-8');short.mkdir();(short/'OWNER.json').write_text(json.dumps(admit,indent=2),encoding='utf-8');(short/'temp').mkdir();(short/'NuGet.offline.config').write_text('<configuration><packageSources><clear/><add key="verified-local" value="'+str(cache)+'"/></packageSources></configuration>',encoding='utf-8')
env={k:v for k,v in os.environ.items() if k.lower() not in {'path','dotnet_startup_hooks','dotnet_root'}};env['PATH']='C:\\Program Files\\dotnet;C:\\Windows\\System32;C:\\Windows';env['PATHEXT']='.COM;.EXE;.BAT;.CMD'
for k,v in {'DOTNET_GENERATE_ASPNET_CERTIFICATE':'false','DOTNET_CLI_TELEMETRY_OPTOUT':'1','DOTNET_SKIP_FIRST_TIME_EXPERIENCE':'1','DOTNET_NOLOGO':'1','DOTNET_CLI_HOME':str(short/'dotnet-home'),'NUGET_PACKAGES':str(cache),'NUGET_HTTP_CACHE_PATH':str(short/'http-cache'),'NUGET_PLUGINS_CACHE_PATH':str(short/'plugins-cache'),'NUGET_SCRATCH':str(short/'scratch'),'TEMP':str(short/'temp'),'TMP':str(short/'temp'),'DOTNET_PROCESSOR_COUNT':'2'}.items():env[k]=v
props=['-p:FrozenR79Root='+str(base/'commander-one-native-issuer-r79'),'-p:FrozenR78Root='+str(r78),'-p:FrozenClientRoot='+str(client),'-p:BaseIntermediateOutputPath='+str(short/'obj')+os.sep,'-p:BaseOutputPath='+str(short/'bin')+os.sep]
phases=[];facts={};fault=None;dotnet='C:/Program Files/dotnet/dotnet.exe'
def run(name,args,expected=0):
 p=subprocess.run(args,cwd=short,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180,creationflags=subprocess.CREATE_NO_WINDOW)
 (q/(name+'.stdout.log')).write_bytes(p.stdout);(q/(name+'.stderr.log')).write_bytes(p.stderr);phases.append({'phase':name,'exitCode':p.returncode,'expected':expected});assert p.returncode==expected,name;return p
try:
 project=str(r/'src/CommanderOwnerAcceptance.csproj')
 run('restore-offline',[dotnet,'restore',project,'--configfile',str(short/'NuGet.offline.config'),*props,'-p:NuGetAudit=false'])
 run('publish-native',[dotnet,'publish',project,'--no-restore','-c','Release','-o',str(short/'native-a'),*props,'-m:1','-p:IlcOptimizationPreference=Size'])
 exe=short/'native-a/CommanderOwnerAcceptance.exe';b=exe.read_bytes();facts['binary']={'path':str(exe),'sha256':h(exe),'bytes':len(b)};pe=struct.unpack_from('<I',b,0x3c)[0];opt=pe+24;assert struct.unpack_from('<II',b,opt+112+14*8)==(0,0);rva,size=struct.unpack_from('<II',b,opt+112+10*8);off=None
 for i in range(struct.unpack_from('<H',b,pe+6)[0]):
  s=opt+struct.unpack_from('<H',b,pe+20)[0]+40*i;vs,va,rs,raw=struct.unpack_from('<IIII',b,s+8)
  if va<=rva<va+max(vs,rs):off=raw+rva-va
 assert off is not None and struct.unpack_from('<H',b,off+78)[0]==0x800;facts['nativeClrZero']=True;facts['dependentLoadFlags']=2048
 p=run('pure-signature-claims-privacy',[str(exe),'--selftest']);facts['pureQA']=json.loads(p.stdout);assert facts['pureQA']['fail']==0 and not facts['pureQA']['realPrivateKeyOpened'];assert not re.search(rb'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+',p.stdout+p.stderr),'TOKEN_LOG_LEAK';facts['jwtNotPrintedInQA']=True
 p=run('ordinary-diagnostic',[str(exe),'--diagnose']);facts['diagnostic']=json.loads(p.stdout);assert not facts['diagnostic']['elevated'] and not facts['diagnostic']['authorityOpened']
 p=run('ordinary-approve-uac-denial',[str(exe),'--approve-compose'],2);denied=json.loads(p.stderr);assert denied['code']=='PROBE_REAL_OWNER_UAC_REQUIRED' and not denied['externalEffectMayHaveOccurred'] and not denied['privateKeyOpened'];facts['ordinaryNegative']=denied
 p=run('unknown-mode-denial',[str(exe),'--sign-anything'],2);assert json.loads(p.stderr)['code']=='PROBE_EXACT_MODE';facts['arbitrarySigningModeDenied']=True
 facts['binaryPostSha256']=h(exe);assert facts['binaryPostSha256']==facts['binary']['sha256'];facts['noManagedOutputsUnderSource']=not (r/'src/bin').exists() and not (r/'src/obj').exists();assert facts['noManagedOutputsUnderSource']
except Exception as e:fault=type(e).__name__+':'+str(e)
unchanged=all(h(pathlib.Path(x['path']))==x['sha256'] for x in sources+frozen)
receipt={'schema':'r80-owner-acceptance-probe-qa-a-v1','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS_NATIVE_PROBE_SOURCE_PURE_PRIVACY_ORDINARY_NEGATIVES_ONLY' if fault is None and unchanged else 'FAIL_PROBE_A_QUALIFICATION','failure':fault,'phases':phases,'facts':facts,'sourceManifestSha256':h(r/'SOURCE_INPUT_MANIFEST_A.json'),'sourcesUnchanged':unchanged,'realPrepareModeExecuted':False,'realVerifyModeExecuted':False,'ownerUacOrConsentShown':False,'realPrivateKeyOpened':False,'realProxyOrTaskStarted':False,'runtimeGDirectoryCreatedByQA':False,'actualOwnerE2EProven':False,'installedVersionChanged':False,'activeJobsStoppedOrReplayed':False}
(q/'RECEIPT.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print(json.dumps(receipt))
