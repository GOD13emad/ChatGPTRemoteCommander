import pathlib,os,subprocess,json,datetime,hashlib,struct
r=pathlib.Path(__file__).resolve().parent;base=r.parent.parent;short=pathlib.Path('G:/CodexWork/RC1R80Client');q=r/'qa-c';q.mkdir(exist_ok=False);h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
c=json.loads((r/'SOURCE_INPUT_MANIFEST_C.json').read_bytes());assert h(pathlib.Path(c['guard']))==c['guardSha256'] and h(pathlib.Path(c['project']))==c['projectSha256'];assert all(h(pathlib.Path(x['path']))==x['sha256'] for x in c['baseSources']+c['baseFrozenDependencies']);assert h(pathlib.Path(c['newQaSource']['path']))==c['newQaSource']['sha256'];a=json.loads((r/'SOURCE_INPUT_MANIFEST_A.json').read_bytes());assert json.loads((short/'OWNER.json').read_bytes())==a
build=short/'c';build.mkdir();(build/'OWNER.json').write_text(json.dumps({'owner':'R80-client-C','sourceManifestSha256':h(r/'SOURCE_INPUT_MANIFEST_C.json'),'guardSha256':c['guardSha256'],'scope':'ordinary compile, actual readonly OS ancestor guard, no authority/task/key'},indent=2),encoding='utf-8');(build/'temp').mkdir()
env={k:v for k,v in os.environ.items() if k.lower() not in {'path','dotnet_startup_hooks','dotnet_root'}};env['PATH']='C:\\Program Files\\dotnet;C:\\Windows\\System32;C:\\Windows';env['PATHEXT']='.COM;.EXE;.BAT;.CMD'
for k,v in {'DOTNET_GENERATE_ASPNET_CERTIFICATE':'false','DOTNET_CLI_TELEMETRY_OPTOUT':'1','DOTNET_SKIP_FIRST_TIME_EXPERIENCE':'1','DOTNET_NOLOGO':'1','DOTNET_CLI_HOME':str(build/'dotnet-home'),'NUGET_PACKAGES':a['sharedCache'],'NUGET_HTTP_CACHE_PATH':str(build/'http-cache'),'NUGET_PLUGINS_CACHE_PATH':str(build/'plugins-cache'),'NUGET_SCRATCH':str(build/'scratch'),'TEMP':str(build/'temp'),'TMP':str(build/'temp'),'DOTNET_PROCESSOR_COUNT':'2'}.items():env[k]=v
props=['-p:FrozenR79Root='+str(base/'commander-one-native-issuer-r79'),'-p:FrozenR78Root='+str(base/'commander-one-integration-r78'),'-p:DerivedGuardRoot='+str(pathlib.Path(c['guard']).parent),'-p:BaseIntermediateOutputPath='+str(build/'obj')+os.sep,'-p:BaseOutputPath='+str(build/'bin')+os.sep];phases=[];facts={};fault=None
def run(name,args):
 p=subprocess.run(args,cwd=build,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180,creationflags=subprocess.CREATE_NO_WINDOW);(q/(name+'.stdout.log')).write_bytes(p.stdout);(q/(name+'.stderr.log')).write_bytes(p.stderr);phases.append({'phase':name,'exitCode':p.returncode});assert p.returncode==0,name;return p
def native(exe):
 b=exe.read_bytes();pe=struct.unpack_from('<I',b,0x3c)[0];opt=pe+24;assert struct.unpack_from('<II',b,opt+112+14*8)==(0,0);rva,size=struct.unpack_from('<II',b,opt+112+10*8);off=None
 for i in range(struct.unpack_from('<H',b,pe+6)[0]):
  s=opt+struct.unpack_from('<H',b,pe+20)[0]+40*i;vs,va,rs,raw=struct.unpack_from('<IIII',b,s+8)
  if va<=rva<va+max(vs,rs):off=raw+rva-va
 assert off is not None and struct.unpack_from('<H',b,off+78)[0]==0x800
 return {'path':str(exe),'sha256':h(exe),'bytes':len(b),'clrDirectory':[0,0],'dependentLoadFlags':2048}
dotnet='C:/Program Files/dotnet/dotnet.exe';project=c['project']
try:
 run('restore-c-offline',[dotnet,'restore',project,'--configfile',str(short/'NuGet.offline.config'),*props,'-p:NuGetAudit=false'])
 run('publish-c-native',[dotnet,'publish',project,'--no-restore','-c','Release','-o',str(build/'native'),*props,'-m:1','-p:IlcOptimizationPreference=Size']);exe=build/'native/CommanderOwnerProxy.exe';facts['binary']=native(exe)
 p=run('client-c-parser-privacy-regression',[str(exe),'--selftest']);facts['pureRegression']=json.loads(p.stdout);assert facts['pureRegression']['fail']==0
 p=run('client-c-ordinary-diagnostic',[str(exe),'--diagnose']);facts['diagnostic']=json.loads(p.stdout);assert not facts['diagnostic']['systemSid'] and not facts['diagnostic']['policyOpened']
 run('publish-readonly-ancestor-fixture',[dotnet,'publish',project,'--no-restore','-c','Release','-o',str(build/'ancestor-qa'),*props,'-p:AncestorFixtureOnly=true','-p:StartupObject=CommanderOwnerProxy.AncestorGuardQA','-p:AssemblyName=CommanderOsAncestorQA','-m:1','-p:IlcOptimizationPreference=Size']);fixture=build/'ancestor-qa/CommanderOsAncestorQA.exe';facts['fixtureBinary']=native(fixture)
 p=run('actual-readonly-os-ancestor-and-private-negatives',[str(fixture)]);facts['actualOsGuard']=json.loads(p.stdout);assert facts['actualOsGuard']['actualOsAncestorPredicatePassed'] and facts['actualOsGuard']['untrustedSidDenied'] and not facts['actualOsGuard']['aclMutated'] and not facts['actualOsGuard']['installedAuthorityPositiveProven']
 facts['binaryPostSha256']=h(exe);assert facts['binaryPostSha256']==facts['binary']['sha256']
except Exception as error:fault=type(error).__name__+':'+str(error)
unchanged=all(h(pathlib.Path(x['path']))==x['sha256'] for x in c['baseSources']+c['baseFrozenDependencies']) and h(pathlib.Path(c['guard']))==c['guardSha256'] and h(pathlib.Path(c['project']))==c['projectSha256']
receipt={'schema':'r80-client-c-qualification-v1','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS_CLIENT_C_NATIVE_REAL_OS_ANCESTOR_GUARD_AND_PRIVATE_NEGATIVES_ONLY' if fault is None and unchanged else 'FAIL_CLIENT_C_QUALIFICATION','failure':fault,'phases':phases,'facts':facts,'sourceManifestSha256':h(r/'SOURCE_INPUT_MANIFEST_C.json'),'bSourcesUnchanged':unchanged,'taskOrProxyRuntimeStarted':False,'uacOrKeysOpened':False,'installedAuthorityPositiveProven':False,'installedVersionChanged':False,'activeJobsStoppedOrReplayed':False};(q/'RECEIPT.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print(json.dumps(receipt))
