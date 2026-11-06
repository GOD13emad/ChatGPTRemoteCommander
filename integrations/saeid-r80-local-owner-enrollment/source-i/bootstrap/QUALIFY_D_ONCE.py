import pathlib,os,json,hashlib,subprocess,shutil,datetime
r=pathlib.Path(__file__).resolve().parent.parent;boot=r/'bootstrap';auth=r/'auth';short=pathlib.Path(r'G:\CodexWork\RC1R80Bootstrap');q=boot/'qa/d';assert not q.exists();q.mkdir()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
c=json.loads((boot/'qa/c/RECEIPT.json').read_text());assert c['failure']=='AssertionError:journal-qa-b-publish'
for f in c['facts']['sourceFiles']:
    if f['path']!='auth/src/JournalBoundaryQA.cs':assert sha(r/f['path'])==f['sha256'],'UNEXPECTED_SOURCE_DRIFT'
target=short/'auth-d';target.mkdir()
for p in (auth/'src').iterdir():
    if p.is_file():shutil.copyfile(p,target/p.name)
shared=pathlib.Path(r'G:\CodexWork\RC1R78AuthAot');r78=r.parent/'commander-one-integration-r78'
env={k:v for k,v in os.environ.items() if k.lower() not in {'path','dotnet_startup_hooks','dotnet_root'}};env.update({'Path':r'C:\Program Files\dotnet;C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0','DOTNET_GENERATE_ASPNET_CERTIFICATE':'false','DOTNET_CLI_TELEMETRY_OPTOUT':'1','DOTNET_SKIP_FIRST_TIME_EXPERIENCE':'1','DOTNET_NOLOGO':'1','DOTNET_CLI_HOME':str(short/'dotnet-home'),'NUGET_PACKAGES':str(shared/'packages'),'NUGET_HTTP_CACHE_PATH':str(short/'http-cache'),'NUGET_PLUGINS_CACHE_PATH':str(short/'plugins'),'NUGET_SCRATCH':str(short/'scratch'),'TEMP':str(short/'temp'),'TMP':str(short/'temp'),'DOTNET_PROCESSOR_COUNT':'2'})
phases=[];facts={'reusedCompiledFacts':{k:c['facts'][k] for k in ['hostReusedUnchanged','consent','bootstrap','bootstrapQa','diagnostic']}};fault=None
def run(name,args,expected=0):
    p=subprocess.run(args,cwd=short,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180,creationflags=subprocess.CREATE_NO_WINDOW);(q/(name+'.stdout.log')).write_bytes(p.stdout);(q/(name+'.stderr.log')).write_bytes(p.stderr);phases.append({'phase':name,'exitCode':p.returncode,'expectedExit':expected});assert p.returncode==expected,name;return p
try:
    project=target/'JournalBoundaryQA.csproj';dotnet=r'C:\Program Files\dotnet\dotnet.exe';obj=str(short/'obj-journal-d')+os.sep;prop='-p:FrozenR78SourceRoot='+str(r78)
    run('journal-d-restore',[dotnet,'restore',str(project),'--configfile',str(short/'NuGet.offline.config'),prop,'-p:BaseIntermediateOutputPath='+obj,'-p:NuGetAudit=false'])
    run('journal-d-publish',[dotnet,'publish',str(project),'--no-restore','-c','Release','-o',str(short/'journal-qa-d'),prop,'-p:BaseIntermediateOutputPath='+obj,'-m:1','-p:IlcOptimizationPreference=Size'])
    p=run('journal-d-cases',[str(short/'journal-qa-d/JournalBoundaryQA.exe'),str(short/'boundary-fixtures-d')]);facts['journalQa']=json.loads(p.stdout);assert facts['journalQa']['fail']==0
    ps=r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe';script=str(boot/'src/TaskOwner.ps1').replace("'","''")
    run('task-script-parse',[ps,'-NoLogo','-NoProfile','-NonInteractive','-Command',"$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile('"+script+"',[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object{$_.Message};exit 2};'PARSE_ONLY_PASS'"])
    p=run('current-policy-readonly',[ps,'-NoLogo','-NoProfile','-NonInteractive','-Command','(Get-ExecutionPolicy).ToString()']);facts['effectiveScriptPolicy']=p.stdout.decode().strip()
    mt=r'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\mt.exe'
    for name,info in facts['reusedCompiledFacts'].items():
        if isinstance(info,dict) and 'path' in info:
            exe=pathlib.Path(info['path']);assert sha(exe)==info['sha256'];run(name+'-manifest',[mt,'-nologo','-inputresource:'+str(exe)+';#1','-out:'+str(q/(name+'.manifest'))])
except Exception as e:fault=type(e).__name__+':'+str(e)
files=[{'path':str(p.relative_to(r)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':sha(p)} for folder in [boot/'src',auth/'src'] for p in folder.iterdir() if p.is_file()]
receipt={'schema':'r80-bootstrap-auth-final-boundary-qa-v1','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS_SOURCE_NATIVE_BOUNDARY_AND_ORDINARY_NEGATIVES_ONLY' if fault is None else 'FAIL_FINAL_BOUNDARY_QA','phases':phases,'facts':facts,'failure':fault,'sourceFiles':files,'supersededBootstrapA':'rollback inventory corrected; original native negative QA retained','failedB':'file copy glob included bin directory; no compilation/mutation','failedC':'nullable warning in new QA only; compiled native host/helper/bootstrap evidence retained unchanged','productionAclPositive':'UNPROVEN','uacOpened':False,'taskRegisteredOrStarted':False,'productionKeysCreated':False,'installedCommanderChanged':False,'jobsStoppedOrReplayed':False,'replayAllowed':False}
(q/'RECEIPT.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))
