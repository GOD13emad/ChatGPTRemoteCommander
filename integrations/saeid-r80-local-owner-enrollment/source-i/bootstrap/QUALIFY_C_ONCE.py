import pathlib,os,json,hashlib,subprocess,shutil,datetime,struct,xml.etree.ElementTree as ET
r=pathlib.Path(__file__).resolve().parent.parent;boot=r/'bootstrap';auth=r/'auth';q=boot/'qa/c';short=pathlib.Path(r'G:\CodexWork\RC1R80Bootstrap');r78=r.parent/'commander-one-integration-r78';r79=r.parent/'commander-one-native-issuer-r79'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert not q.exists() and json.loads((short/'OWNER.json').read_text())['sourceRoot']==str(r),'CONSUMED_OR_UNKNOWN_ROOT'
q.mkdir();history=boot/'source-history-a';history.mkdir(exist_ok=True)
for p in (short/'bootstrap').glob('*'):
    if p.is_file():shutil.copyfile(p,history/p.name)
old=json.loads((boot/'qa/a/RECEIPT.json').read_text());assert old['status']=='PASS_SOURCE_NATIVE_ORDINARY_NEGATIVES_ONLY';assert sha(pathlib.Path(old['facts']['host']['path']))==old['facts']['host']['sha256']
env={k:v for k,v in os.environ.items() if k.lower() not in {'path','dotnet_startup_hooks','dotnet_root'}};shared=pathlib.Path(r'G:\CodexWork\RC1R78AuthAot');env.update({'Path':r'C:\Program Files\dotnet;C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0','DOTNET_GENERATE_ASPNET_CERTIFICATE':'false','DOTNET_CLI_TELEMETRY_OPTOUT':'1','DOTNET_SKIP_FIRST_TIME_EXPERIENCE':'1','DOTNET_NOLOGO':'1','DOTNET_CLI_HOME':str(short/'dotnet-home'),'NUGET_PACKAGES':str(shared/'packages'),'NUGET_HTTP_CACHE_PATH':str(short/'http-cache'),'NUGET_PLUGINS_CACHE_PATH':str(short/'plugins'),'NUGET_SCRATCH':str(short/'scratch'),'TEMP':str(short/'temp'),'TMP':str(short/'temp'),'DOTNET_PROCESSOR_COUNT':'2'})
dotnet=r'C:\Program Files\dotnet\dotnet.exe';phases=[];facts={'hostReusedUnchanged':old['facts']['host']};failure=None
def run(name,args,cwd=None,expected=0):
    p=subprocess.run(args,cwd=cwd or short,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180,creationflags=subprocess.CREATE_NO_WINDOW)
    (q/(name+'.stdout.log')).write_bytes(p.stdout);(q/(name+'.stderr.log')).write_bytes(p.stderr);phases.append({'phase':name,'exitCode':p.returncode,'expectedExit':expected});assert p.returncode==expected,name;return p
def update_pins(project):
    doc=ET.parse(project)
    for n in doc.getroot().iter('Compile'):
        if n.get('ExpectedHash'):n.set('ExpectedHash',sha(pathlib.Path(n.get('Include'))).upper())
    ET.indent(doc.getroot());doc.write(project,encoding='unicode')
def compile(name,project,extra=None):
    obj=str(short/('obj-'+name))+os.sep;prop='-p:FrozenR78SourceRoot='+str(r78)
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
    # Only known source projects are updated; frozen dependencies are rehashed.
    update_pins(auth/'src/OwnerConsentR80.csproj')
    compile('consent-b',auth/'src/OwnerConsentR80.csproj');helper=short/'consent-b/CommanderOwnerConsent.exe';facts['consent']=pe(helper)
    p=run('consent-diagnose',[str(helper),'--diagnose']);facts['consentDiagnostic']=json.loads(p.stdout)
    p=run('consent-ordinary-request-denial',[str(helper),'--request','A'*43],expected=2);assert json.loads(p.stderr)['code']=='REAL_UAC_REQUIRED'
    policy=boot/'src/BootstrapPolicy.cs';before=policy.read_bytes();text=before.decode('utf-8');old_pin='FrozenConsent="1ae194557963771ebc0b74d5590542fd3013494985a3a266963da4b0048b84c4"';assert text.count(old_pin)==1;policy.write_text(text.replace(old_pin,'FrozenConsent="'+sha(helper)+'"'),encoding='utf-8');facts['consentPinMutation']={'preSha256':hashlib.sha256(before).hexdigest(),'postSha256':sha(policy),'helperSha256':sha(helper)}
    # Add the production ACL primitive to fixture compile, not production host.
    doc=ET.parse(auth/'src/JournalBoundaryQA.csproj');ig=doc.getroot().find('ItemGroup');ET.SubElement(ig,'Compile',Include='ConsentPrivateFile.cs');ET.indent(doc.getroot());doc.write(auth/'src/JournalBoundaryQA.csproj',encoding='unicode')
    for part in ['bootstrap','auth']:
        target=short/(part+'-b');target.mkdir()
        for f in (r/part/'src').glob('*'):
            if f.is_file():shutil.copyfile(f,target/f.name)
    facts['sourceFiles']=[{'path':str(p.relative_to(r)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':sha(p)} for p in list((boot/'src').glob('*'))+list((auth/'src').glob('*')) if p.is_file()]
    compile('bootstrap-b',short/'bootstrap-b/OwnerBootstrap.csproj');exe=short/'bootstrap-b/CommanderOwnerBootstrap.exe';facts['bootstrap']=pe(exe)
    p=run('bootstrap-b-diagnose',[str(exe),'--diagnose']);facts['diagnostic']=json.loads(p.stdout)
    for mode,args in [('apply',['--apply','G:\\INVALID_NO_READ','a'*64,'S-1-5-21-1-2-3-1001']),('rollback',['--rollback','S-1-5-21-1-2-3-1001'])]:
        p=run('bootstrap-b-ordinary-'+mode+'-denial',[str(exe)]+args,expected=2);assert json.loads(p.stderr)['code']=='SAME_OWNER_REAL_UAC_TOKEN_REQUIRED'
    compile('bootstrap-qa-b',short/'bootstrap-b/OwnerBootstrap.csproj',['-p:BootstrapFixtureOnly=true','-p:StartupObject=CommanderOwnerBootstrap.BootstrapQA','-p:AssemblyName=BootstrapQA'])
    p=run('bootstrap-b-pure-qa',[str(short/'bootstrap-qa-b/BootstrapQA.exe')]);facts['bootstrapQa']=json.loads(p.stdout);assert facts['bootstrapQa']['fail']==0
    compile('journal-qa-b',short/'auth-b/JournalBoundaryQA.csproj');p=run('journal-boundary-qa-b',[str(short/'journal-qa-b/JournalBoundaryQA.exe'),str(short/'boundary-fixtures-b')]);facts['journalQa']=json.loads(p.stdout);assert facts['journalQa']['fail']==0
    ps=r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe';script=str(boot/'src/TaskOwner.ps1').replace("'","''")
    run('task-script-b-parse',[ps,'-NoLogo','-NoProfile','-NonInteractive','-Command',"$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile('"+script+"',[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object{$_.Message};exit 2};'PARSE_ONLY_PASS'"])
    p=run('current-execution-policy-readonly',[ps,'-NoLogo','-NoProfile','-NonInteractive','-Command','(Get-ExecutionPolicy).ToString()']);facts['effectiveScriptPolicy']=p.stdout.decode().strip();assert facts['effectiveScriptPolicy']=='RemoteSigned'
except Exception as e:failure=type(e).__name__+':'+str(e)
unchanged=all(sha(r/f['path'])==f['sha256'] for f in facts.get('sourceFiles',[]))
receipt={'schema':'r80-bootstrap-auth-corrected-native-qa-v1','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS_CORRECTED_SOURCE_NATIVE_NEGATIVES_ONLY' if failure is None and unchanged else 'FAIL_CORRECTED_QA','phases':phases,'facts':facts,'failure':failure,'sourcesUnchanged':unchanged,'uacOpened':False,'taskRegisteredOrStarted':False,'productionKeysCreated':False,'ownerEnrolled':False,'installedCommanderChanged':False,'jobsStoppedOrReplayed':False,'realProtectedAclPositive':'UNPROVEN','replayAllowed':False,'bootstrapA':'superseded: immutable inventory included mutable zero journals; original preserved'}
(q/'RECEIPT.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))

