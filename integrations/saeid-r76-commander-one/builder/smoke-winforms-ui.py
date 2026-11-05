#!/usr/bin/env python3
"""Offscreen QA only: bounded file-backed child capture and no ambiguous Stop retry."""
import argparse,hashlib,json,os,shutil,subprocess,sys,tempfile,time
from pathlib import Path
from qa_stop_guard import retain_recovery

HERE=Path(__file__).resolve().parent
NAMES=('ManagedPreviewForm.cs','ManagedProfileUiOffscreenQA.cs','ManagedProfileUiOffscreenQA.csproj')
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--installer',type=Path,required=True)
 ap.add_argument('--mode',choices=('standard','full'),required=True);args=ap.parse_args()
 if os.name!='nt':raise RuntimeError('WINFORMS_QA_WINDOWS_ONLY')
 if not args.installer.is_file() or args.installer.is_symlink():raise RuntimeError('WINFORMS_INSTALLER_UNSAFE')
 root=Path(tempfile.mkdtemp(prefix='.rc-wf-q-',dir=Path.home()));installed=root/'CommanderOne'
 src=root/'source';out=root/'out';logs=root/'qa-child-logs';src.mkdir();logs.mkdir()
 started=time.monotonic();deadline=started+148;sequence=0;deployed=False;done=False;submitted=False
 def journal(phase,state,**extra):
  with open(root/'QA_WRAPPER_SUBPHASE.jsonl','a',encoding='utf8') as f:
   f.write(json.dumps({'phase':phase,'state':state,'elapsedMs':round((time.monotonic()-started)*1000),**extra})+'\n');f.flush();os.fsync(f.fileno())
 def run(phase,command,cap,reserve=7,checked=True):
  nonlocal sequence
  remaining=deadline-time.monotonic()-reserve
  if remaining<=0:raise TimeoutError('WINFORMS_SHARED_DEADLINE_EXHAUSTED:'+phase)
  timeout=min(cap,remaining);sequence+=1
  prefix=str(sequence).zfill(3)+'-'+phase;stdout=logs/(prefix+'.stdout.log');stderr=logs/(prefix+'.stderr.log')
  journal(phase,'ENTER',timeoutSeconds=timeout,stdout=str(stdout),stderr=str(stderr))
  # Files are already durable when a timeout happens; no communicate() pipe
  # drain can wait forever on an inherited descendant stdout/stderr handle.
  try:
   with open(stdout,'wb') as so,open(stderr,'wb') as se:
    child=subprocess.run([str(x) for x in command],stdout=so,stderr=se,
     timeout=timeout,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
   journal(phase,'EXIT',exitCode=child.returncode,stdoutBytes=stdout.stat().st_size,stderrBytes=stderr.stat().st_size)
  except subprocess.TimeoutExpired:
   journal(phase,'TIMEOUT_OUTPUT_FILES_PRESERVED',stdoutBytes=stdout.stat().st_size,stderrBytes=stderr.stat().st_size)
   raise
  if stdout.stat().st_size>2*1024*1024 or stderr.stat().st_size>2*1024*1024:raise RuntimeError('WINFORMS_QA_OUTPUT_LIMIT')
  text=stdout.read_text(encoding='utf8',errors='replace');error=stderr.read_text(encoding='utf8',errors='replace')
  if checked and child.returncode:raise RuntimeError('WINFORMS_PHASE_FAILED:'+phase+':'+str(child.returncode)+':'+error[-700:])
  return child.returncode,text,error
 def response(phase,command,cap=5,reserve=7,checked=True):
  code,text,error=run(phase,command,cap,reserve,checked)
  try:value=json.loads((text or error).strip().splitlines()[-1])
  except (ValueError,IndexError):value={'unparsed':True}
  if checked and value.get('ok') is not True:raise RuntimeError('WINFORMS_QA_RECEIPT_INVALID:'+phase)
  return code,value
 primary=None;secondary=[]
 try:
  for name in NAMES:
   p=HERE/name
   if not p.is_file() or p.is_symlink():raise RuntimeError('WINFORMS_QA_SOURCE_UNSAFE:'+name)
   shutil.copy2(p,src/name)
  (src/'NuGet.Config').write_text('<configuration><packageSources><clear /></packageSources></configuration>\n',encoding='utf8')
  run('BUILD',['dotnet','build',src/'ManagedProfileUiOffscreenQA.csproj','-c','Release','-o',out,'--verbosity','quiet','--disable-build-servers'],45)
  dll=out/'ManagedProfileUiOffscreenQA.dll'
  if not dll.is_file():raise RuntimeError('WINFORMS_QA_BINARY_MISSING')
  _,probe,_=run('REAL_UI_DIALECT_PROBE',['dotnet',dll,'--qa-ui-dialect-probe'],8)
  proof=json.loads(probe.strip().splitlines()[-1])
  if proof.get('status')!='PASS_REAL_UI_FORMATTER_ROUNDTRIP_WITH_NEGATIVES' or proof.get('oldRawValidatorAcceptedUiReceipt') is not False or proof.get('negativeCases',0)<8:raise RuntimeError('WINFORMS_REAL_DIALECT_PROBE_UNPROVEN')
  run('STOP_GUARD_SELFTEST',['dotnet',dll,'--qa-stop-guard-selftest'],8)
  _,receipt=response('INSTALL',[args.installer,'--install','--mode',args.mode,'--target',installed],25)
  if receipt.get('installed') is not True:raise RuntimeError('WINFORMS_QA_INSTALL_INCOMPLETE')
  deployed=True;submitted=True
  _,observed,_=run('REAL_BUTTON_HARNESS',['dotnet',dll,installed],75)
  for marker in ('WINFORMS_MANAGED_CLICK_START_STATUS_STOP_PASS','WINFORMS_OWNER_GUI_NO_PHYSICAL_MOUSE_FOCUS_PASS'):
   if marker not in observed:raise RuntimeError('WINFORMS_QA_BUTTON_EVENT_MISSING:'+marker)
  _,state=response('VERIFIED_STOP_POSTSTATE',[installed/'Commander.exe','--runtime-status','--target',installed,'--profile','default'],5)
  if state.get('profile')!='default' or state.get('running') is not False or state.get('verified') is not False:raise RuntimeError('WINFORMS_QA_POSTSTATE_UNVERIFIED')
  evidence=Path.home()/'qa-winforms-evidence'/root.name;evidence.mkdir(parents=True,exist_ok=False)
  for p in [root/'QA_WRAPPER_SUBPHASE.jsonl',installed/'QA_WINFORMS_SUBPHASE.jsonl']:
   if p.is_file():shutil.copy2(p,evidence/p.name)
  shutil.copytree(logs,evidence/'qa-child-logs')
  journal('FUNCTIONAL','PASS');done=True
  print(json.dumps({'status':'WINFORMS_MANAGED_STOP_DENY_ACCEPT_E2E_PASS','mode':args.mode,'realButtonEvents':True,'stopDenyPreservesBackend':True,'stopAcceptStopsBackend':True,'ownerDesktopTouched':False,'productionTouched':False,'scope':'Private fixture only','elapsedSeconds':round(time.monotonic()-started,3),'root':str(root),'evidence':str(evidence),'rootRetained':True,'fileBackedCapture':True,'overallDeadlineSeconds':148}))
 except BaseException as error:
  primary=error;journal('PRIMARY','FAIL',exception=type(error).__name__,message=str(error)[:900]);raise
 finally:
  if not done:
   if deployed:
    try:
     code,state=response('READONLY_FAILURE_RECONCILE',[installed/'Commander.exe','--runtime-status','--target',installed,'--profile','default'],5,reserve=0,checked=False)
     journal('RECOVERY','READ_ONLY',harnessSubmitted=submitted,exitCode=code,running=state.get('running'),verified=state.get('verified'))
    except BaseException as error:secondary.append(error)
   retain_recovery(root,primary,secondary=secondary)
   print('WINFORMS_QA_RECOVERY_ROOT='+str(root),flush=True)
if __name__=='__main__':main()
