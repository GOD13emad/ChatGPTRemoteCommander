import pathlib,os,subprocess,json,datetime,hashlib,shutil,struct,xml.etree.ElementTree as ET
r=pathlib.Path(__file__).resolve().parent;r78=r.parent/'commander-one-integration-r78';shared=pathlib.Path(r'G:\CodexWork\RC1R78AuthAot');short=pathlib.Path(r'G:\CodexWork\RC1R79Issuer');q=r/'qa/a';q.mkdir(exist_ok=False)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
manifest=json.loads((r/'SOURCE_INPUT_MANIFEST.json').read_text());assert sha(r78/'RETURN_R78.zip')==manifest['r78ReturnSha256'];assert not short.exists(),'UNKNOWN_SHORT_ROOT'
for f in manifest['hostSourceFiles']:assert sha(r/f['path'])==f['sha256'],'HOST_SOURCE_DRIFT'
for f in manifest['dependencies']:assert sha(r78/f['path'])==f['sha256'],'FROZEN_SOURCE_DRIFT'
# Recheck already-admitted expanded build dependency files, not only archives.
transfer=json.loads((r78/'reviews/durable/local-owner-auth/native-consent-aot/qa-f/TRANSFER.json').read_text());checked=0
for f in transfer:
    p=pathlib.Path(f['target'])
    if f['role']=='verified-build-package-file' and str(p).lower().startswith(str(shared/'packages').lower()+os.sep):assert sha(p)==f['sha256'],'ADMITTED_BUILD_FILE_DRIFT';checked+=1
assert checked>0
admission={'schema':'r79-native-host-build-admission-v1','owner':'saeed','project':'Remote Commander Saeed','sourceRoot':str(r),'shortBuildRoot':str(short),'sourceManifestSha256':sha(r/'SOURCE_INPUT_MANIFEST.json'),'r78ReturnSha256':manifest['r78ReturnSha256'],'role':'ordinary NativeAOT/protocol negative QA only; no listeners/enrollment/installation','checkedSharedBuildFiles':checked,'sharedCache':str(shared/'packages')}
(r/'BUILD_ADMISSION_A.json').write_text(json.dumps(admission,indent=2),encoding='utf-8');short.mkdir();(short/'OWNER.json').write_text(json.dumps(admission,indent=2),encoding='utf-8');(short/'src').mkdir();(short/'temp').mkdir()
for f in manifest['hostSourceFiles']:shutil.copyfile(r/f['path'],short/'src'/pathlib.Path(f['path']).name)
config=(r78/'reviews/durable/local-owner-auth/native-consent-aot/NuGet.official-c.config').read_text().replace('value="https://api.nuget.org/v3/index.json" protocolVersion="3"','value="'+str(shared/'packages')+'"');(short/'NuGet.offline.config').write_text(config,encoding='utf-8')
env={k:v for k,v in os.environ.items() if k.lower() not in {'path','dotnet_startup_hooks','dotnet_root'}};env['Path']=r'C:\Program Files\dotnet;C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0';env['PATHEXT']='.COM;.EXE;.BAT;.CMD'
for k,v in {'DOTNET_GENERATE_ASPNET_CERTIFICATE':'false','DOTNET_CLI_TELEMETRY_OPTOUT':'1','DOTNET_SKIP_FIRST_TIME_EXPERIENCE':'1','DOTNET_NOLOGO':'1','DOTNET_CLI_HOME':str(short/'dotnet-home'),'NUGET_PACKAGES':str(shared/'packages'),'NUGET_HTTP_CACHE_PATH':str(short/'http-cache'),'NUGET_PLUGINS_CACHE_PATH':str(short/'plugins-cache'),'NUGET_SCRATCH':str(short/'scratch'),'TEMP':str(short/'temp'),'TMP':str(short/'temp'),'DOTNET_PROCESSOR_COUNT':'2'}.items():env[k]=v
dotnet=r'C:\Program Files\dotnet\dotnet.exe';phases=[];facts={};fault=None
def run(name,args,cwd=None,expected=0):
    p=subprocess.run(args,cwd=cwd or short/'src',env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180,creationflags=subprocess.CREATE_NO_WINDOW)
    (q/(name+'.stdout.log')).write_bytes(p.stdout);(q/(name+'.stderr.log')).write_bytes(p.stderr);phases.append({'phase':name,'exitCode':p.returncode,'expectedExit':expected});assert p.returncode==expected,name;return p
try:
    prop='-p:FrozenR78SourceRoot='+str(r78)
    run('restore-offline',[dotnet,'restore','CommanderNativeIssuer.csproj','--configfile',str(short/'NuGet.offline.config'),prop,'-p:BaseIntermediateOutputPath='+str(short/'obj-prod')+os.sep,'-p:NuGetAudit=false'])
    run('publish-native',[dotnet,'publish','CommanderNativeIssuer.csproj','--no-restore','-c','Release','-o',str(short/'native'),prop,'-p:BaseIntermediateOutputPath='+str(short/'obj-prod')+os.sep,'-m:1','-p:IlcOptimizationPreference=Size'])
    exe=short/'native/CommanderNativeIssuer.exe';data=exe.read_bytes();facts['binary']={'path':str(exe),'bytes':len(data),'sha256':sha(exe)}
    pe=struct.unpack_from('<I',data,0x3c)[0];opt=pe+24;assert struct.unpack_from('<II',data,opt+112+14*8)==(0,0);count=struct.unpack_from('<H',data,pe+6)[0];sections=opt+struct.unpack_from('<H',data,pe+20)[0];rva,size=struct.unpack_from('<II',data,opt+112+10*8);off=None
    for i in range(count):
        s=sections+40*i;vs,va,rs,raw=struct.unpack_from('<IIII',data,s+8)
        if va<=rva<va+max(vs,rs):off=raw+rva-va
    assert off is not None and struct.unpack_from('<H',data,off+78)[0]==0x800;facts['clrDirectory']=[0,0];facts['dependentLoadFlags']=2048
    dump=r'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\dumpbin.exe';run('native-imports',[dump,'/dependents',str(exe)]);run('native-loadconfig',[dump,'/loadconfig',str(exe)])
    mt=r'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\mt.exe';run('embedded-manifest',[mt,'-nologo','-inputresource:'+str(exe)+';#1','-out:'+str(q/'embedded.manifest')]);xml=ET.parse(q/'embedded.manifest');levels=xml.findall('.//{urn:schemas-microsoft-com:asm.v3}requestedExecutionLevel');assert len(levels)==1 and levels[0].get('level')=='asInvoker' and levels[0].get('uiAccess')=='false';facts['manifestAsInvoker']=True
    p=run('ordinary-diagnostic',[str(exe),'--diagnose'],pathlib.Path(r'C:\Windows\System32'));facts['diagnostic']=json.loads(p.stdout);assert facts['diagnostic']['systemSid'] is False and facts['diagnostic']['pipeCreated'] is False
    p=run('ordinary-serve-denial',[str(exe),'--serve-once'],pathlib.Path(r'C:\Windows\System32'),2);assert json.loads(p.stderr)['code']=='HOST_SYSTEM_TOKEN_REQUIRED';facts['ordinaryServeDeniedBeforeAuthorityPaths']=True
    run('publish-native-protocol-qa',[dotnet,'publish','CommanderNativeIssuer.csproj','--no-restore','-c','Release','-o',str(short/'protocol-qa'),prop,'-p:BaseIntermediateOutputPath='+str(short/'obj-prod')+os.sep,'-p:ProtocolFixtureOnly=true','-p:StartupObject=CommanderNativeIssuer.ProtocolQA','-p:AssemblyName=CommanderNativeIssuerProtocolQA','-m:1','-p:IlcOptimizationPreference=Size'])
    p=run('protocol-qa',[str(short/'protocol-qa/CommanderNativeIssuerProtocolQA.exe')]);cases=json.loads(p.stdout);assert cases['fail']==0;facts['protocolPass']=cases['pass'];facts['protocolFail']=0
    facts['postBinarySha256']=sha(exe);assert facts['postBinarySha256']==facts['binary']['sha256']
except Exception as e:fault=type(e).__name__+':'+str(e)
unchanged=all(sha(r/f['path'])==f['sha256'] for f in manifest['hostSourceFiles']) and all(sha(r78/f['path'])==f['sha256'] for f in manifest['dependencies'])
receipt={'schema':'r79-native-host-source-qa-v1','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS_NATIVE_HOST_LOAD_AND_ORDINARY_NEGATIVES_ONLY' if fault is None and unchanged else 'FAIL_NATIVE_HOST_QUALIFICATION','phases':phases,'facts':facts,'failure':fault,'sourceManifestSha256':sha(r/'SOURCE_INPUT_MANIFEST.json'),'sourcesUnchanged':unchanged,'r78Sealed':True,'listenerOpened':False,'keysEnrolledOrOpened':False,'systemPositivePeerProven':False,'hostInstalled':False,'activeJobsStoppedOrReplayed':False,'automaticRetryAllowed':False}
(q/'RECEIPT.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print(json.dumps(receipt))
