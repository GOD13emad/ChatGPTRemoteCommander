#!/usr/bin/env python3
"""Isolated packaged lifecycle; consumed/unknown Stop is never replayed."""
import argparse,json,os,subprocess,tempfile,time,hashlib,shutil,sys
from pathlib import Path
from qa_stop_guard import QaStopGuard,cleanup_once,retain_recovery

def call(cmd,timeout=25,fail=False):
 p=subprocess.run(cmd,capture_output=True,text=True,timeout=timeout)
 line=(p.stdout or p.stderr).strip().splitlines()
 try:data=json.loads(line[-1]) if line else {}
 except ValueError:data={'unparsed':line[-1] if line else ''}
 if not fail and p.returncode!=0:raise RuntimeError('LAUNCH_COMMAND_FAILED:'+str(cmd[1:4])+':'+str(data))
 if fail and p.returncode==0:raise RuntimeError('EXPECTED_REJECTION_NOT_OBSERVED:'+str(cmd[1:4]))
 return data

def poll_no_file(file):
 for _ in range(30):
  if not file.exists():return True
  time.sleep(.1)
 return False

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--installer',type=Path,required=True)
 ap.add_argument('--previous-installer',type=Path);ap.add_argument('--mode',choices=('standard','full'),default='standard')
 opt=ap.parse_args();source=opt.installer.resolve()
 td=Path(tempfile.mkdtemp(prefix='commander-one-r38-lifecycle-',dir=Path(os.environ.get('TEMP',Path.home()/'.cache'))))
 root=td/'product';guards={};started=[];exe=None;controls=root/'state/controls';done=False
 try:
  if opt.previous_installer:
   oldroot=td/'previous';call([str(opt.previous_installer.resolve()),'--install','--target',str(oldroot),'--mode',opt.mode],timeout=45)
   marker=oldroot/'product.json';before=hashlib.sha256(marker.read_bytes()).hexdigest()
   blocked=call([str(source),'--install','--target',str(oldroot),'--mode',opt.mode],fail=True)
   assert blocked.get('errorCode')=='INSTALLER_SAME_BUILD_DIFFERENT_PAYLOAD_REQUIRES_UPGRADE',blocked
   assert hashlib.sha256(marker.read_bytes()).hexdigest()==before
  call([str(source),'--install','--target',str(root),'--mode',opt.mode],timeout=45)
  exe=[str(root/'Commander.exe')] if os.name=='nt' else [str(root/'bin/node'),str(root/'Commander.cjs')]
  call(exe+['--add-profile','--profile','MMZ','--target',str(root)])
  cfgs=[json.loads((root/'state/profiles'/f'{p}.json').read_text()) for p in ('default','MMZ')];ports=[j['port'] for j in cfgs]
  assert len(set(ports))==2 and all(p not in range(47831,47838) for p in ports),ports
  try:
   import socket
   with socket.socket() as blocker:
    blocker.bind(('127.0.0.1',ports[0]));blocker.listen(1)
    conflict=call(exe+['--start','--target',str(root),'--profile','default'],fail=True)
    assert conflict.get('errorCode')=='INSTALLER_PORT_OCCUPIED_NO_TAKEOVER',conflict
   for profile in ('default','MMZ'):
    command=exe+['--start','--target',str(root),'--profile',profile];start=call(command,timeout=34)
    assert start['verifiedHealth'] and start['started'] and start['profile']==profile,start
    guard=QaStopGuard(root,profile);guard.after_verified_start(start);guards[profile]=guard;started.append(profile)
    state=call(exe+['--runtime-status','--target',str(root),'--profile',profile])
    assert state.get('running') and state.get('verified') and state.get('backendPort')==start['backendPort'],state
    duplicate=call(command,fail=True);assert duplicate.get('errorCode')=='INSTALLER_EXISTING_CONTROL_RECORD_RECONCILE_FIRST',duplicate
    record=controls/(profile+'.json');original=record.read_bytes();forged=json.loads(original);forged['token']='0'*64
    if forged['token']==json.loads(original)['token']:forged['token']='1'*64
    record.write_text(json.dumps(forged))
    try:
     refused=guard.stop_once(lambda:call(exe+['--stop','--target',str(root),'--profile',profile],fail=True),'forged-token-rejection-probe')
     assert refused.get('errorCode')=='INSTALLER_CONTROL_IDENTITY_MISMATCH',refused
    finally:record.write_bytes(original)
    still=call(exe+['--runtime-status','--target',str(root),'--profile',profile]);assert still['running'] and still['verified'],still
    assert hashlib.sha256(record.read_bytes()).digest()==hashlib.sha256(original).digest()
    guard.resolve_rejected_probe_no_effect(refused,still)
   for profile in reversed(started):
    stop=guards[profile].stop_once(lambda:call(exe+['--stop','--target',str(root),'--profile',profile]),'verified-lifecycle-stop')
    assert stop.get('stopped') and stop.get('verifiedIdentity'),stop
    assert poll_no_file(controls/(profile+'.json')),'CONTROL_FILE_NOT_CLEANED'
    state=call(exe+['--runtime-status','--target',str(root),'--profile',profile]);assert state.get('running') is False,state
  finally:
   primary=sys.exc_info()[1]
   cleanup_once(list(guards.values()),lambda p:call(exe+['--stop','--target',str(root),'--profile',p],timeout=9),
       lambda p:call(exe+['--runtime-status','--target',str(root),'--profile',p],timeout=9),
       lambda p:poll_no_file(controls/(p+'.json')),primary)
  done=True
  print(json.dumps({'status':'LIFECYCLE_PASS','os':os.name,'mode':opt.mode,'profiles':len(started),'distinctOwnerPorts':True,
   'forbiddenRouterPortsAvoided':True,'duplicateStartRejected':True,'occupiedPortRejected':True,'forgedStopRejected':True,
   'sameBuildPayloadConflictRejected':bool(opt.previous_installer),'authenticatedStop':True,'verifiedEndpointIdentity':True,
   'stateCleaned':True,'productionStateChanged':False,'installerSHA256':hashlib.sha256(source.read_bytes()).hexdigest()}))
 finally:
  if done:shutil.rmtree(td)
  else:retain_recovery(td,sys.exc_info()[1],guards.values())
 if done:print('LIFECYCLE_TEMP_CLEANED')
if __name__=='__main__':main()
