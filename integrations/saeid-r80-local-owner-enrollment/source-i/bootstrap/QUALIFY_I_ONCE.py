import pathlib,os,json,hashlib,subprocess,shutil,datetime,struct,xml.etree.ElementTree as ET
r=pathlib.Path(__file__).resolve().parent.parent;b=r/'bootstrap';a=r/'auth';q=b/'qa/i';short=pathlib.Path(r'G:\CodexWork\RC1R80Bootstrap');assert not q.exists();q.mkdir();h=json.loads((b/'qa/h/RECEIPT.json').read_text());assert h['status']=='PASS_SOURCE_PARTIAL_ROLLBACK_SELECTION_AND_NATIVE_NEGATIVES_ONLY';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert json.loads((short/'OWNER.json').read_text())['sourceRoot']==str(r)
guard=a/'src/WindowsGuard.cs';assert sha(guard)=='6ffd5e017ac734572d564ddf4268d02abbee9adecc4e0527081b0b5d0cc331e9'
admission={'schema':'r80-i-build-admission-v1','owner':'saeed','role':'ordinary source/native guard and diagnostic QA only; no deployment','sharedGuardSha256':sha(guard),'hUacConsumed':True,'oneRootCause':'exact trusted OS ancestor servicing identity missing from shared private-path ancestor guard'}
(q/'ADMISSION.json').write_text(json.dumps(admission,indent=2),encoding='utf-8')
source=short/'auth-i';assert not source.exists();source.mkdir()
for p in (a/'src').iterdir():
    if p.is_file():shutil.copyfile(p,source/p.name)
shared=pathlib.Path(r'G:\CodexWork\RC1R78AuthAot');r78=r.parent/'commander-one-integration-r78'
env={k:v for k,v in os.environ.items() if k.lower() not in {'path','dotnet_startup_hooks','dotnet_root','psmodulepath'}};env.update({'Path':r'C:\Program Files\dotnet;C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0','PSModulePath':r'C:\Windows\System32\WindowsPowerShell\v1.0\Modules','DOTNET_GENERATE_ASPNET_CERTIFICATE':'false','DOTNET_CLI_TELEMETRY_OPTOUT':'1','DOTNET_SKIP_FIRST_TIME_EXPERIENCE':'1','DOTNET_NOLOGO':'1','DOTNET_CLI_HOME':str(short/'dotnet-home'),'NUGET_PACKAGES':str(shared/'packages'),'NUGET_HTTP_CACHE_PATH':str(short/'http-cache'),'NUGET_PLUGINS_CACHE_PATH':str(short/'plugins'),'NUGET_SCRATCH':str(short/'scratch'),'TEMP':str(short/'temp'),'TMP':str(short/'temp'),'DOTNET_PROCESSOR_COUNT':'2'})
phases=[];facts={'sharedGuardSha256':sha(guard),'partialRollbackCasesReused':15,'journalCasesReused':21};fault=None
def run(name,args,expected=0):
    p=subprocess.run(args,cwd=short,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180,creationflags=subprocess.CREATE_NO_WINDOW);(q/(name+'.stdout.log')).write_bytes(p.stdout);(q/(name+'.stderr.log')).write_bytes(p.stderr);phases.append({'phase':name,'exitCode':p.returncode,'expectedExit':expected});assert p.returncode==expected,name;return p
def compile(name,project,extra=None):
    dotnet=r'C:\Program Files\dotnet\dotnet.exe';prop='-p:FrozenR78SourceRoot='+str(r78);obj=str(short/('obj-'+name))+os.sep
    run(name+'-restore',[dotnet,'restore',str(project),'--configfile',str(short/'NuGet.offline.config'),prop,'-p:BaseIntermediateOutputPath='+obj,'-p:NuGetAudit=false']+(extra or []))
    run(name+'-publish',[dotnet,'publish',str(project),'--no-restore','-c','Release','-o',str(short/name),prop,'-p:BaseIntermediateOutputPath='+obj,'-m:1','-p:IlcOptimizationPreference=Size']+(extra or []))
def pe(p):
    data=p.read_bytes();h=struct.unpack_from('<I',data,0x3c)[0];opt=h+24;assert struct.unpack_from('<II',data,opt+112+14*8)==(0,0);count=struct.unpack_from('<H',data,h+6)[0];section=opt+struct.unpack_from('<H',data,h+20)[0];rva,size=struct.unpack_from('<II',data,opt+112+10*8);off=None
    for i in range(count):
        vs,va,rs,raw=struct.unpack_from('<IIII',data,section+40*i+8)
        if va<=rva<va+max(vs,rs):off=raw+rva-va
    assert off is not None and struct.unpack_from('<H',data,off+78)[0]==0x800
    return {'path':str(p),'sha256':sha(p),'bytes':len(data),'clrDirectoryZero':True,'dependentLoadFlags':2048}
try:
    compile('host-i',source/'OwnerIssuerR80.csproj');facts['host']=pe(short/'host-i/CommanderNativeIssuer.exe')
    p=run('host-i-ordinary-denial',[facts['host']['path'],'--serve-once'],2);assert json.loads(p.stderr)['code']=='HOST_SYSTEM_TOKEN_REQUIRED'
    compile('consent-i',source/'OwnerConsentR80.csproj');facts['consent']=pe(short/'consent-i/CommanderOwnerConsent.exe')
    p=run('consent-i-ordinary-denial',[facts['consent']['path'],'--request','A'*43],2);assert json.loads(p.stderr)['code']=='REAL_UAC_REQUIRED'
    print(json.dumps({'phase':'AUTH_I_BINARIES_READY','host':facts['host'],'consent':facts['consent']}),flush=True)
    (q/'AUTH_BINARY_PINS.json').write_text(json.dumps({'host':facts['host'],'consent':facts['consent'],'guardSha256':sha(guard)},indent=2),encoding='utf-8')
    policy=b/'src/BootstrapPolicy.cs';before=policy.read_bytes();text=before.decode('utf-8')
    for field,old,new in [('FrozenHost',h['facts']['host']['sha256'],facts['host']['sha256']),('FrozenConsent',h['facts']['consent']['sha256'],facts['consent']['sha256'])]:
        anchor=field+'="'+old+'"';assert text.count(anchor)==1;text=text.replace(anchor,field+'="'+new+'"')
    policy.write_text(text,encoding='utf-8');facts['bootstrapPinChange']={'preSha256':hashlib.sha256(before).hexdigest(),'postSha256':sha(policy)}
    bs=short/'bootstrap-i-src';bs.mkdir()
    for p in (b/'src').iterdir():
        if p.is_file():shutil.copyfile(p,bs/p.name)
    compile('bootstrap-native-i',bs/'OwnerBootstrap.csproj');facts['bootstrap']=pe(short/'bootstrap-native-i/CommanderOwnerBootstrap.exe')
    p=run('bootstrap-i-diagnostic',[facts['bootstrap']['path'],'--diagnose']);facts['diagnostic']=json.loads(p.stdout)
    for mode,arg in [('apply',['--apply','G:\\INVALID_NO_READ','a'*64,'S-1-5-21-1-2-3-1001']),('rollback',['--rollback','S-1-5-21-1-2-3-1001'])]:
        p=run('bootstrap-i-ordinary-'+mode,[facts['bootstrap']['path']]+arg,2);error=json.loads(p.stderr);assert error['code']=='SAME_OWNER_REAL_UAC_TOKEN_REQUIRED';assert error['automaticRetryAllowed'] is False
    compile('bootstrap-qa-i',bs/'OwnerBootstrap.csproj',['-p:BootstrapFixtureOnly=true','-p:StartupObject=CommanderOwnerBootstrap.BootstrapQA','-p:AssemblyName=BootstrapQA'])
    p=run('bootstrap-i-native-qa',[str(short/'bootstrap-qa-i/BootstrapQA.exe')]);facts['bootstrapQa']=json.loads(p.stdout);assert facts['bootstrapQa']['fail']==0
    compile('journal-qa-i',source/'JournalBoundaryQA.csproj');p=run('journal-i-cases',[str(short/'journal-qa-i/JournalBoundaryQA.exe'),str(short/'boundary-fixtures-i')]);facts['journalQa']=json.loads(p.stdout);assert facts['journalQa']['fail']==0
    mt=r'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\mt.exe'
    for name in ['host','consent','bootstrap']:
        exe=pathlib.Path(facts[name]['path']);run(name+'-i-manifest',[mt,'-nologo','-inputresource:'+str(exe)+';#1','-out:'+str(q/(name+'.manifest'))]);xml=ET.parse(q/(name+'.manifest'));level=xml.findall('.//{urn:schemas-microsoft-com:asm.v3}requestedExecutionLevel');assert len(level)==1 and level[0].get('level')=='asInvoker' and level[0].get('uiAccess')=='false'
except Exception as e:fault=type(e).__name__+':'+str(e)
files=[{'path':str(p.relative_to(r)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':sha(p)} for folder in [b/'src',a/'src'] for p in folder.iterdir() if p.is_file()]
receipt={'schema':'r80-shared-os-ancestor-native-i-qa-v1','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS_SHARED_OS_ANCESTOR_AND_SANITIZED_DIAGNOSTIC_SOURCE_ONLY' if fault is None else 'FAIL_I_QUALIFICATION','phases':phases,'facts':facts,'failure':fault,'sourceFiles':files,'hApplyConsumed':True,'hActualCode':'UNOBSERVED','hCausalBlockedPath':'CONFIRMED_DETERMINISTIC_SOURCE_AND_OS_ACL','productionUiAndProtectedOutcome':'UNPROVEN','uacOpened':False,'taskRegisteredOrStarted':False,'productionKeysCreated':False,'installedCommanderChanged':False,'jobsStoppedOrReplayed':False,'newDeploymentAuthorized':False}
(q/'RECEIPT.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print(json.dumps({'status':receipt['status'],'failure':fault,'facts':facts}),flush=True)
