// QA ONLY: read-only bridge from TWO ephemeral real Win32 Desktop objects
// to observation-only broker evidence. NOT a live retained GUI workspace.
// This adapter does NOT authenticate a ChatGPT conversation or Windows token,
// and neither captured metadata nor a transient desktop can authorize input.
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const HEX=/^[a-f0-9]{64}$/;
const DESK=/^RcQaHost_[a-f0-9]{32}$/;
const fail=code=>Object.assign(new Error(code),{code});
const script=fileURLToPath(new URL('../tools/native-desktop-host-two-children-win-qa.ps1',import.meta.url));
const exe=path.join(process.env.ProgramFiles||'C:\\Program Files','PowerShell','7','pwsh.exe');

export function validateWindowsDesktopEvidenceQA(report,workspaceRefs,nonce){
  if(!Array.isArray(workspaceRefs)||workspaceRefs.length!==2||
     !workspaceRefs.every(ref=>HEX.test(ref??''))||
     workspaceRefs[0]===workspaceRefs[1]||
     !HEX.test(nonce??''))throw fail('DESKTOP_EVIDENCE_ARGUMENT_INVALID');
  if(!report||report.schema!==1||report.pass!==true||
     report.station!=='WinSta0'||!Number.isSafeInteger(report.sessionId)||
     report.sessionId<1||report.noSwitchDesktop!==true||
     report.noUserInput!==true||!Array.isArray(report.children)||
     report.children.length!==2)
    throw fail('DESKTOP_EVIDENCE_UNTRUSTED');
  const seenDesktops=new Set(),seenPids=new Set();
  const observations=new Map();
  for(let i=0;i<2;i++){
    const item=report.children[i],child=item?.reported;
    if(!item||!child||!DESK.test(item.requestedDesktop??'')||
       !Number.isSafeInteger(item.pid)||item.pid<1||
       seenPids.has(item.pid)||seenDesktops.has(item.requestedDesktop)||
       item.desktopCreated!==true||item.desktopHandleClosed!==true||
       item.childExitCode!==0||item.error!==null||
       item.matched!==true||item.desktopEnumerationSucceeded!==true||
       item.ownWindowObserved!==true||
       item.observedQaWindowPids!==String(item.pid)||
       child.pid!==item.pid||child.desktop!==item.requestedDesktop||
       child.sessionId!==report.sessionId||child.station!=='WinSta0'||
       child.hiddenWindowCreated!==true||child.hiddenWindowDestroyed!==true||
       child.hiddenWindowOwnerPid!==item.pid||child.hiddenWindowCreateError!==0||
       child.inputNotSent!==true||child.windowsNotShown!==true)
      throw fail('DESKTOP_EVIDENCE_UNTRUSTED');
    seenPids.add(item.pid);seenDesktops.add(item.requestedDesktop);
    // A random per-probe challenge binds these hashes to exactly one
    // validated report; never use them as a signed proof or pixel digest.
    const digest=createHash('sha256').update(JSON.stringify({
      version:1,nonce,workspaceRef:workspaceRefs[i],desktop:item.requestedDesktop,
      pid:item.pid,sessionId:report.sessionId,qaWindowOwner:item.pid
    })).digest('hex');
    observations.set(workspaceRefs[i],Object.freeze({
      sha256:digest,effectMode:'observation-only'
    }));
  }
  return Object.freeze({
    station:report.station,sessionId:report.sessionId,
    workspaces:Object.freeze([...workspaceRefs]),
    observations
  });
}
export function captureWindowsDesktopEvidenceQA({workspaceRefs,timeoutMs=27000}={}){
  if(process.platform!=='win32')throw fail('DESKTOP_PLATFORM_UNSUPPORTED');
  if(!Array.isArray(workspaceRefs)||workspaceRefs.length!==2||
     !workspaceRefs.every(ref=>HEX.test(ref??''))||
     workspaceRefs[0]===workspaceRefs[1])throw fail('DESKTOP_EVIDENCE_ARGUMENT_INVALID');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)
    throw fail('DESKTOP_CAPTURE_TIMEOUT_INVALID');
  const nonce=randomBytes(32).toString('hex');
  const result=spawnSync(exe,['-NoLogo','-NoProfile','-NonInteractive',
    '-File',script],{
      windowsHide:true,encoding:'utf8',timeout:timeoutMs,maxBuffer:65536
    });
  if(result.error||result.signal||result.status!==0)
    throw fail('DESKTOP_CAPTURE_UNAVAILABLE');
  let report;
  try{report=JSON.parse(result.stdout.trim());}
  catch{throw fail('DESKTOP_CAPTURE_INVALID');}
  return validateWindowsDesktopEvidenceQA(report,workspaceRefs,nonce);
}
