"""Read-only known-folder diagnostic: no task API, protected file IO, UAC, keys or mutation."""
import pathlib,hashlib,json,subprocess,os,datetime
r=pathlib.Path(__file__).resolve().parent;q=r/'diagnosis-knownfolders-b';assert not q.exists(),'CONSUMED_DIAGNOSTIC';q.mkdir()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
(q/'ADMISSION.json').write_text(json.dumps({'schema':'r80-knownfolder-readonly-diagnostic-v1','scope':'ordinary fixed WinPS read-only known-folder output in exact J-clean/full/controlled-completion environments','jBActualUacConsumed':True,'parentReportedPrimary':{'phase':'ReadIOwner','exceptionType':'DirectoryNotFoundException','hresultHex':'0x80070003'},'productionPatches':False,'taskApis':False,'protectedFilesReadWritten':False,'sourceBHash':sha(r/'src/JIO.cs')},indent=2),encoding='utf-8')
exe=r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
command="""$ErrorActionPreference='Stop';[ordered]@{schema='r80-knownfolders-observed-v1';processBitness=[IntPtr]::Size*8;psVersion=$PSVersionTable.PSVersion.ToString();runtime=[Environment]::Version.ToString();programFiles=[Environment]::GetFolderPath('ProgramFiles');commonApplicationData=[Environment]::GetFolderPath('CommonApplicationData');windows=[Environment]::GetFolderPath('Windows');system=[Environment]::SystemDirectory;envProgramData=[Environment]::GetEnvironmentVariable('ProgramData');envAllUsersProfile=[Environment]::GetEnvironmentVariable('ALLUSERSPROFILE');envProgramFiles=[Environment]::GetEnvironmentVariable('ProgramFiles');envSystemRoot=[Environment]::GetEnvironmentVariable('SystemRoot')}|ConvertTo-Json -Compress"""
args=[exe,'-NoLogo','-NoProfile','-NonInteractive','-Command',command];state=r'C:\ProgramData\ChatGPTRemoteCommander\owner-auth';base={'SystemRoot':r'C:\Windows','windir':r'C:\Windows','PATH':r'C:\Windows\System32','PSModulePath':r'C:\Windows\System32\WindowsPowerShell\v1.0\Modules','TEMP':state+r'\task-temp','TMP':state+r'\task-temp'}
envs=[('exact-j-production',base),('ordinary-full-control',dict(os.environ)),('diagnostic-knownfolder-only-completion',dict(base,ProgramData=r'C:\ProgramData',ALLUSERSPROFILE=r'C:\ProgramData',ProgramFiles=r'C:\Program Files'))]
rows=[];failure=None
for name,env in envs:
 try:
  p=subprocess.run(args,env=env,cwd=r'C:\Windows\System32',stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15,creationflags=subprocess.CREATE_NO_WINDOW)
  (q/(name+'.stdout.json')).write_bytes(p.stdout);(q/(name+'.stderr.log')).write_bytes(p.stderr)
  assert p.returncode==0 and not p.stderr,name
  data=json.loads(p.stdout.decode('utf-8-sig'));rows.append({'name':name,'status':'OBSERVED','result':data,'outputSha256':hashlib.sha256(p.stdout).hexdigest()})
 except Exception as e:failure=type(e).__name__+':'+str(e);break
receipt={'schema':'r80-j-knownfolder-causality-receipt-v1','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'READONLY_DIAGNOSTIC_COMPLETE' if failure is None else 'DIAGNOSTIC_FAILED_NO_RETRY','failure':failure,'rows':rows,'productionPatch':False,'taskApis':False,'protectedFilesOpened':False,'privateKeysOpened':False,'uacOpened':False,'oldActionReplayed':False}
(q/'RECEIPT.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print(json.dumps(receipt))
