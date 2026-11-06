"""Ordinary source qualification only. Never runs privileged finalizer/task modes as admin."""
import pathlib,os,json,hashlib,subprocess,datetime,struct,xml.etree.ElementTree as ET
root=pathlib.Path(__file__).resolve().parent;src=root/'src';short=pathlib.Path(r'G:\CodexWork\RC1R80FinalizeK');qa=root/'qa';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert short.exists() and not qa.exists(),'FRESH_K_ONE_USE_REQUIRED';assert json.loads((short/'OWNER.json').read_text())['sourceRoot']==str(root);qa.mkdir();(short/'qa').mkdir()
(short/'QUALIFICATION_OWNER.json').write_text(json.dumps({'schema':'r80-j-admitted-build-root-v1','sourceRoot':str(root),'owner':'saeed','role':'ordinary source compile and memory-only COM QA; no protected stage IO or task actions'},indent=2),encoding='utf-8')
shared=pathlib.Path(r'G:\CodexWork\RC1R78AuthAot');transfer=root.parent.parent/'commander-one-integration-r78/reviews/durable/local-owner-auth/native-consent-aot/qa-f/TRANSFER.json'
manifest=json.loads(transfer.read_text());packageRows=manifest if isinstance(manifest,list) else manifest.get('files',manifest.get('entries',[]))
packageRows=[r for r in packageRows if r.get('role')=='verified-build-package-file'];assert packageRows,'PACKAGE_MANIFEST_SCHEMA'
for row in packageRows:
 p=pathlib.Path(row['target']);assert str(p).lower().startswith(str(shared/'packages').lower()+os.sep);assert sha(p)==row['sha256'],'PACKAGE_PIN'
config=short/'NuGet.offline.config';config.write_text('<configuration><packageSources><clear/><add key="local" value="'+str(shared/'packages')+'"/></packageSources></configuration>',encoding='utf-8')
env={k:v for k,v in os.environ.items() if k.lower() not in {'path','dotnet_startup_hooks','dotnet_root','psmodulepath'}}
env.update({'Path':r'C:\Program Files\dotnet;C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0','PSModulePath':r'C:\Windows\System32\WindowsPowerShell\v1.0\Modules','DOTNET_GENERATE_ASPNET_CERTIFICATE':'false','DOTNET_CLI_TELEMETRY_OPTOUT':'1','DOTNET_SKIP_FIRST_TIME_EXPERIENCE':'1','DOTNET_NOLOGO':'1','DOTNET_CLI_HOME':str(short/'dotnet-home'),'NUGET_PACKAGES':str(shared/'packages'),'NUGET_HTTP_CACHE_PATH':str(short/'http-cache'),'NUGET_PLUGINS_CACHE_PATH':str(short/'plugins'),'NUGET_SCRATCH':str(short/'scratch'),'TEMP':str(short/'temp'),'TMP':str(short/'temp'),'DOTNET_PROCESSOR_COUNT':'2'})
for name in ['dotnet-home','http-cache','plugins','scratch','temp']: (short/name).mkdir(exist_ok=True)
sourceRows=[{'path':str(p),'sha256':sha(p)} for p in src.iterdir() if p.is_file()];(qa/'SOURCE_PRE.json').write_text(json.dumps(sourceRows,indent=2),encoding='utf-8')
phases=[];facts={'verifiedSharedPackageFiles':len(packageRows)};failure=None
def run(name,args,expected=0,timeout=180):
 print(json.dumps({'phase':name,'status':'START'}),flush=True)
 p=subprocess.run(args,cwd=short,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout,creationflags=subprocess.CREATE_NO_WINDOW)
 (qa/(name+'.stdout.log')).write_bytes(p.stdout);(qa/(name+'.stderr.log')).write_bytes(p.stderr);phases.append({'phase':name,'exitCode':p.returncode,'expected':expected});assert p.returncode==expected,name;return p
def compile(name,extra=[]):
 dotnet=r'C:\Program Files\dotnet\dotnet.exe';project=str(src/'OwnerFinalizeK.csproj');props=['-p:BaseIntermediateOutputPath='+str(short/('obj-'+name))+os.sep,'-p:BaseOutputPath='+str(short/('bin-'+name))+os.sep,'-p:NuGetAudit=false']+extra
 run(name+'-restore',[dotnet,'restore',project,'--configfile',str(config)]+props)
 run(name+'-publish',[dotnet,'publish',project,'--no-restore','-c','Release','-o',str(short/name),'-m:1','-p:IlcOptimizationPreference=Size']+props)
def pe(p):
 b=p.read_bytes();h=struct.unpack_from('<I',b,0x3c)[0];opt=h+24;assert struct.unpack_from('<II',b,opt+112+14*8)==(0,0);rva,size=struct.unpack_from('<II',b,opt+112+10*8);sections=opt+struct.unpack_from('<H',b,h+20)[0];off=None
 for i in range(struct.unpack_from('<H',b,h+6)[0]):
  vs,va,rs,raw=struct.unpack_from('<IIII',b,sections+40*i+8)
  if va<=rva<va+max(vs,rs):off=raw+rva-va
 assert off is not None and struct.unpack_from('<H',b,off+78)[0]==0x800
 return {'path':str(p),'sha256':sha(p),'bytes':len(b),'clrDirectoryZero':True,'dependentLoadFlags':2048}
try:
 compile('native');exe=short/'native/CommanderOwnerFinalizeK.exe';facts['native']=pe(exe)
 p=run('ordinary-diagnose',[str(exe),'--diagnose']);facts['diagnostic']=json.loads(p.stdout);assert facts['diagnostic']['elevated'] is False
 for mode in ['--finalize-staged','--rollback-finalized']:
  p=run('ordinary-'+mode[2:],[str(exe),mode,'S-1-5-21-1-2-3-1001','0'*64],2);d=json.loads(p.stderr);assert d['code']=='SAME_OWNER_REAL_UAC_TOKEN_REQUIRED' and d['phase']=='OwnerToken' and d['automaticRetryAllowed'] is False
 compile('native-qa',['-p:KFixtureOnly=true','-p:StartupObject=CommanderOwnerFinalizeK.KQA','-p:AssemblyName=FinalizeKQA'])
 p=run('native-pure-guard-qa',[str(short/'native-qa/FinalizeKQA.exe')]);facts['nativeQA']=json.loads(p.stdout);assert facts['nativeQA']['fail']==0
 p=run('actual-memory-com-qa',[r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-File',str(root/'QA_MEMORY_ONLY.ps1'),'-Source',str(src/'TaskFinalizerJ.ps1'),'-Fixture',str(short/'qa/fixture.json')]);facts['memoryCOM']=json.loads(p.stdout.decode('utf-8-sig'));assert facts['memoryCOM']['fail']==0
 mt=r'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\mt.exe';run('native-manifest',[mt,'-nologo','-inputresource:'+str(exe)+';#1','-out:'+str(qa/'native.manifest')]);node=ET.parse(qa/'native.manifest').findall('.//{urn:schemas-microsoft-com:asm.v3}requestedExecutionLevel');assert len(node)==1 and node[0].get('level')=='asInvoker' and node[0].get('uiAccess')=='false';facts['asInvoker']=True
 for row in sourceRows: assert sha(pathlib.Path(row['path']))==row['sha256'],'SOURCE_CHANGED_DURING_QA'
except Exception as e:failure=type(e).__name__+':'+str(e)
receipt={'schema':'r80-k-clean-context-native-qualification-v1','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS_SCOPED_SOURCE_NATIVE_AND_MEMORY_COM_ONLY' if failure is None else 'FAIL_J_QUALIFICATION_NO_RUNTIME_ACTION','failure':failure,'facts':facts,'phases':phases,'sourceFiles':sourceRows,'uacOpened':False,'protectedStageRead':False,'taskRegisteredStarted':False,'privateKeysOpened':False,'installedCommanderChanged':False,'jobsStoppedOrReplayed':False,'actualFinalization':'UNPROVEN_PARENT_REVIEW_AND_OWNER_UAC_REQUIRED'}
(qa/'RECEIPT.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print(json.dumps({'status':receipt['status'],'failure':failure,'facts':facts}),flush=True)
raise SystemExit(0 if failure is None else 2)
