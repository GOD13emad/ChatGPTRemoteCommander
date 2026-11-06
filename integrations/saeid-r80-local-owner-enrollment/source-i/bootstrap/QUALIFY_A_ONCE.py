import pathlib,os,json,hashlib,subprocess,shutil,datetime,struct
r=pathlib.Path(__file__).resolve().parent.parent;boot=r/'bootstrap';auth=r/'auth';q=boot/'qa/a';short=pathlib.Path(r'G:\CodexWork\RC1R80Bootstrap');shared=pathlib.Path(r'G:\CodexWork\RC1R78AuthAot');r78=r.parent/'commander-one-integration-r78'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert not q.exists() and not short.exists(),'CONSUMED_OR_UNKNOWN_ROOT'
q.mkdir();short.mkdir();(short/'temp').mkdir()
pin=json.loads((boot/'SOURCE_PREBUILD.json').read_text())
for f in pin['files']:assert sha(r/f['path'])==f['sha256'],'SOURCE_DRIFT'
admit={'schema':'r80-bootstrap-private-build-admission-v1','owner':'saeed','sourceRoot':str(r),'sourceManifestSha256':sha(boot/'SOURCE_PREBUILD.json'),'role':'ordinary native compile/diagnose/denial/boundary QA only; no installation/enrollment/task/UAC','shortBuildRoot':str(short),'sharedPackageCache':str(shared/'packages')}
(short/'OWNER.json').write_text(json.dumps(admit,indent=2));(boot/'BUILD_ADMISSION_A.json').write_text(json.dumps(admit,indent=2))
for part in ['bootstrap','auth']:
    target=short/part;target.mkdir()
    for f in (r/part/'src').glob('*'):shutil.copyfile(f,target/f.name)
config=(r78/'reviews/durable/local-owner-auth/native-consent-aot/NuGet.official-c.config').read_text().replace('value="https://api.nuget.org/v3/index.json" protocolVersion="3"','value="'+str(shared/'packages')+'"');(short/'NuGet.offline.config').write_text(config)
env={k:v for k,v in os.environ.items() if k.lower() not in {'path','dotnet_startup_hooks','dotnet_root'}};env.update({'Path':r'C:\Program Files\dotnet;C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0','DOTNET_GENERATE_ASPNET_CERTIFICATE':'false','DOTNET_CLI_TELEMETRY_OPTOUT':'1','DOTNET_SKIP_FIRST_TIME_EXPERIENCE':'1','DOTNET_NOLOGO':'1','DOTNET_CLI_HOME':str(short/'dotnet-home'),'NUGET_PACKAGES':str(shared/'packages'),'NUGET_HTTP_CACHE_PATH':str(short/'http-cache'),'NUGET_PLUGINS_CACHE_PATH':str(short/'plugins'),'NUGET_SCRATCH':str(short/'scratch'),'TEMP':str(short/'temp'),'TMP':str(short/'temp'),'DOTNET_PROCESSOR_COUNT':'2'})
dotnet=r'C:\Program Files\dotnet\dotnet.exe';phases=[];facts={};failure=None
def run(name,args,cwd=None,expected=0):
    p=subprocess.run(args,cwd=cwd or short,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180,creationflags=subprocess.CREATE_NO_WINDOW)
    (q/(name+'.stdout.log')).write_bytes(p.stdout);(q/(name+'.stderr.log')).write_bytes(p.stderr);phases.append({'phase':name,'exitCode':p.returncode,'expectedExit':expected});assert p.returncode==expected,name;return p
def compile(name,project,extra=None):
    prop='-p:FrozenR78SourceRoot='+str(r78);obj=str(short/('obj-'+name))+os.sep
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
    compile('host',short/'auth/OwnerIssuerR80.csproj');facts['host']=pe(short/'host/CommanderNativeIssuer.exe')
    p=run('host-ordinary-denial',[str(short/'host/CommanderNativeIssuer.exe'),'--serve-once'],pathlib.Path(r'C:\Windows\System32'),2);assert json.loads(p.stderr)['code']=='HOST_SYSTEM_TOKEN_REQUIRED'
    compile('bootstrap-native',short/'bootstrap/OwnerBootstrap.csproj');exe=short/'bootstrap-native/CommanderOwnerBootstrap.exe';facts['bootstrap']=pe(exe)
    p=run('bootstrap-diagnose',[str(exe),'--diagnose']);facts['diagnose']=json.loads(p.stdout);assert facts['diagnose']['authorityOpened'] is False
    p=run('bootstrap-ordinary-apply-denial',[str(exe),'--apply','G:\\INVALID_NO_READ','a'*64,'S-1-5-21-1-2-3-1001'],expected=2);assert json.loads(p.stderr)['code']=='SAME_OWNER_REAL_UAC_TOKEN_REQUIRED'
    p=run('bootstrap-ordinary-rollback-denial',[str(exe),'--rollback','S-1-5-21-1-2-3-1001'],expected=2);assert json.loads(p.stderr)['code']=='SAME_OWNER_REAL_UAC_TOKEN_REQUIRED'
    compile('bootstrap-qa',short/'bootstrap/OwnerBootstrap.csproj',['-p:BootstrapFixtureOnly=true','-p:StartupObject=CommanderOwnerBootstrap.BootstrapQA','-p:AssemblyName=BootstrapQA'])
    p=run('bootstrap-pure-qa',[str(short/'bootstrap-qa/BootstrapQA.exe')]);facts['bootstrapQa']=json.loads(p.stdout);assert facts['bootstrapQa']['fail']==0
    compile('journal-qa',short/'auth/JournalBoundaryQA.csproj');p=run('journal-boundary-qa',[str(short/'journal-qa/JournalBoundaryQA.exe'),str(short/'boundary-fixtures')]);facts['journalQa']=json.loads(p.stdout);assert facts['journalQa']['fail']==0
    ps=r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe';script=str(boot/'src/TaskOwner.ps1').replace("'","''")
    p=run('task-script-parse',[ps,'-NoLogo','-NoProfile','-NonInteractive','-Command',"$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile('"+script+"',[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object{$_.Message};exit 2};'PARSE_ONLY_PASS'"]);facts['taskScriptParsedOnly']=True
except Exception as e:failure=type(e).__name__+':'+str(e)
unchanged=all(sha(r/f['path'])==f['sha256'] for f in pin['files'])
receipt={'schema':'r80-native-bootstrap-auth-qa-v1','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS_SOURCE_NATIVE_ORDINARY_NEGATIVES_ONLY' if failure is None and unchanged else 'FAIL_NATIVE_BOOTSTRAP_QA','phases':phases,'facts':facts,'failure':failure,'sourcesUnchanged':unchanged,'uacOpened':False,'taskRegisteredOrStarted':False,'productionKeysCreated':False,'ownerEnrolled':False,'installedCommanderChanged':False,'jobsStoppedOrReplayed':False,'realProtectedJournalPositive':'UNPROVEN','replayAllowed':False}
(q/'RECEIPT.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))
