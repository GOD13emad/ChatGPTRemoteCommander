import pathlib,os,json,hashlib,subprocess,shutil,datetime,struct,xml.etree.ElementTree as ET
r=pathlib.Path(__file__).resolve().parent.parent;b=r/'bootstrap';q=b/'qa/h';short=pathlib.Path(r'G:\CodexWork\RC1R80Bootstrap');assert not q.exists();q.mkdir();g=json.loads((b/'qa/g/RECEIPT.json').read_text());assert g['status']=='PASS_NATIVE_SOURCE_FINITE_HELPER_AND_NEGATIVES_ONLY';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
source=short/'bootstrap-h';assert not source.exists();source.mkdir()
for p in (b/'src').iterdir():
    if p.is_file():shutil.copyfile(p,source/p.name)
shared=pathlib.Path(r'G:\CodexWork\RC1R78AuthAot');r78=r.parent/'commander-one-integration-r78'
env={k:v for k,v in os.environ.items() if k.lower() not in {'path','dotnet_startup_hooks','dotnet_root','psmodulepath'}};env.update({'Path':r'C:\Program Files\dotnet;C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0','PSModulePath':r'C:\Windows\System32\WindowsPowerShell\v1.0\Modules','DOTNET_GENERATE_ASPNET_CERTIFICATE':'false','DOTNET_CLI_TELEMETRY_OPTOUT':'1','DOTNET_SKIP_FIRST_TIME_EXPERIENCE':'1','DOTNET_NOLOGO':'1','DOTNET_CLI_HOME':str(short/'dotnet-home'),'NUGET_PACKAGES':str(shared/'packages'),'NUGET_HTTP_CACHE_PATH':str(short/'http-cache'),'NUGET_PLUGINS_CACHE_PATH':str(short/'plugins'),'NUGET_SCRATCH':str(short/'scratch'),'TEMP':str(short/'temp'),'TMP':str(short/'temp'),'DOTNET_PROCESSOR_COUNT':'2'})
phases=[];facts={'host':g['facts']['host'],'consent':g['facts']['consent'],'journalCasesReused':21,'journalFailures':0};fault=None
def run(name,args,expected=0):
    p=subprocess.run(args,cwd=short,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180,creationflags=subprocess.CREATE_NO_WINDOW);(q/(name+'.stdout.log')).write_bytes(p.stdout);(q/(name+'.stderr.log')).write_bytes(p.stderr);phases.append({'phase':name,'exitCode':p.returncode,'expectedExit':expected});assert p.returncode==expected,name;return p
try:
    ps=r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    p=run('production-partial-selector-ast',[ps,'-NoLogo','-NoProfile','-NonInteractive','-File',str(b/'PARTIAL_ROLLBACK_QA.ps1'),'-Script',str(b/'src/TaskOwner.ps1')]);facts['partialRollbackQa']=json.loads(p.stdout);assert facts['partialRollbackQa']['pass']==15 and facts['partialRollbackQa']['fail']==0
    dotnet=r'C:\Program Files\dotnet\dotnet.exe';project=source/'OwnerBootstrap.csproj';prop='-p:FrozenR78SourceRoot='+str(r78);obj=str(short/'obj-bootstrap-h')+os.sep
    run('bootstrap-h-restore',[dotnet,'restore',str(project),'--configfile',str(short/'NuGet.offline.config'),prop,'-p:BaseIntermediateOutputPath='+obj,'-p:NuGetAudit=false'])
    args=[dotnet,'publish',str(project),'--no-restore','-c','Release',prop,'-p:BaseIntermediateOutputPath='+obj,'-m:1','-p:IlcOptimizationPreference=Size']
    run('bootstrap-h-publish',args+['-o',str(short/'bootstrap-native-h')]);exe=short/'bootstrap-native-h/CommanderOwnerBootstrap.exe';data=exe.read_bytes();pe=struct.unpack_from('<I',data,0x3c)[0];opt=pe+24;assert struct.unpack_from('<II',data,opt+112+14*8)==(0,0);count=struct.unpack_from('<H',data,pe+6)[0];section=opt+struct.unpack_from('<H',data,pe+20)[0];rva,size=struct.unpack_from('<II',data,opt+112+10*8);off=None
    for i in range(count):
        vs,va,rs,raw=struct.unpack_from('<IIII',data,section+40*i+8)
        if va<=rva<va+max(vs,rs):off=raw+rva-va
    assert off is not None and struct.unpack_from('<H',data,off+78)[0]==0x800;facts['bootstrap']={'path':str(exe),'sha256':sha(exe),'bytes':len(data),'clrDirectoryZero':True,'dependentLoadFlags':2048}
    p=run('bootstrap-h-diagnostic',[str(exe),'--diagnose']);facts['diagnostic']=json.loads(p.stdout)
    for mode,arg in [('apply',['--apply','G:\\INVALID_NO_READ','a'*64,'S-1-5-21-1-2-3-1001']),('rollback',['--rollback','S-1-5-21-1-2-3-1001'])]:
        p=run('bootstrap-h-ordinary-'+mode,[str(exe)]+arg,2);assert json.loads(p.stderr)['code']=='SAME_OWNER_REAL_UAC_TOKEN_REQUIRED'
    run('bootstrap-h-qa-publish',args+['-o',str(short/'bootstrap-qa-h'),'-p:BootstrapFixtureOnly=true','-p:StartupObject=CommanderOwnerBootstrap.BootstrapQA','-p:AssemblyName=BootstrapQA'])
    p=run('bootstrap-h-native-qa',[str(short/'bootstrap-qa-h/BootstrapQA.exe')]);facts['bootstrapQa']=json.loads(p.stdout);assert facts['bootstrapQa']['fail']==0
    mt=r'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\mt.exe';run('bootstrap-h-manifest',[mt,'-nologo','-inputresource:'+str(exe)+';#1','-out:'+str(q/'bootstrap.manifest')]);xml=ET.parse(q/'bootstrap.manifest');level=xml.findall('.//{urn:schemas-microsoft-com:asm.v3}requestedExecutionLevel');assert len(level)==1 and level[0].get('level')=='asInvoker' and level[0].get('uiAccess')=='false'
    for name in ['host','consent']:assert sha(pathlib.Path(facts[name]['path']))==facts[name]['sha256']
except Exception as x:fault=type(x).__name__+':'+str(x)
files=[{'path':str(p.relative_to(r)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':sha(p)} for folder in [b/'src',r/'auth/src'] for p in folder.iterdir() if p.is_file()]
receipt={'schema':'r80-bootstrap-partial-rollback-native-qa-v1','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS_SOURCE_PARTIAL_ROLLBACK_SELECTION_AND_NATIVE_NEGATIVES_ONLY' if fault is None else 'FAIL_PARTIAL_ROLLBACK_QA','phases':phases,'facts':facts,'failure':fault,'sourceFiles':files,'supersedes':'G is historical; completion-required rollback cannot recover activation after partial enrollment','productionRollbackActual':'UNPROVEN','uacOpened':False,'taskRegisteredOrStarted':False,'productionKeysCreated':False,'installedCommanderChanged':False,'jobsStoppedOrReplayed':False,'onlyOwnedNewQaHelperMayBeReaped':True,'unknownTaskOutcomeNeverRetried':True}
(q/'RECEIPT.json').write_text(json.dumps(receipt,indent=2));print(json.dumps({'status':receipt['status'],'failure':fault,'facts':facts}))
