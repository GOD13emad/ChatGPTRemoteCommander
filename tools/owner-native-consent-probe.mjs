// Optional owner-present OS-consent diagnostic (Issue #225). Not a privileged broker.
// No arbitrary executable, arguments, script path, credentials, or durable admin authority.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ACTION = 'diagnostic.elevated-identity';
export const MAX_TIMEOUT_MS = 60_000;
const APPROVED_MARKER = 'RC_OWNER_OS_CONSENT_APPROVED';

function reject(code) { const e = new Error(code); e.code = code; throw e; }
const sha256 = text => createHash('sha256').update(text).digest('hex');

// Fixed elevated PowerShell diagnostic exits 73 only with a real elevated OS token.
// It does not start a service, alter settings, open a shell for a client or persist secrets.
const child = [
  '$id=[Security.Principal.WindowsIdentity]::GetCurrent()',
  '$who=[Security.Principal.WindowsPrincipal]::new($id)',
  'if($who.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){exit 73}',
  'exit 7'
].join(';');
const childB64 = Buffer.from(child, 'utf16le').toString('base64');
const winParent = [
  "$ErrorActionPreference='Stop'",
  "$exe='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
  "try {",
  " $p=Start-Process -FilePath $exe -Verb RunAs -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','"+childB64+"') -PassThru -Wait -ErrorAction Stop",
  " if($p.ExitCode -eq 73){Write-Output '"+APPROVED_MARKER+"';exit 0}",
  " exit 8",
  "} catch [System.ComponentModel.Win32Exception] {",
  " if($_.Exception.NativeErrorCode -eq 1223){exit 126}",
  " exit 127",
  "} catch { exit 127 }"
].join('\n');

export function planOwnerConsent({ platform = process.platform, ownerPresent = false, timeoutMs = 30_000, action = ACTION } = {}) {
  if(action !== ACTION) reject('UNSUPPORTED_PRIVILEGED_ACTION');
  if(ownerPresent !== true) reject('EXPLICIT_CURRENT_OWNER_CONSENT_REQUIRED');
  if(!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > MAX_TIMEOUT_MS) reject('INVALID_APPROVAL_TIMEOUT');
  if(platform !== 'win32' && platform !== 'linux') reject('UNSUPPORTED_OS_NATIVE_APPROVAL');
  const file = platform === 'win32' ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' : '/usr/bin/pkexec';
  const args = platform === 'win32'
    ? ['-NoProfile','-NonInteractive','-EncodedCommand', Buffer.from(winParent,'utf16le').toString('base64')]
    : ['--disable-internal-agent','/usr/bin/id','-u'];
  const commandIdentity = sha256(JSON.stringify({platform,file,args,action}));
  return Object.freeze({platform,file,args:Object.freeze(args),action,timeoutMs,commandIdentity,
    description:'Owner-present native OS authorization for read-only elevated identity test only'});
}

export function classifyNativeResult(plan, {status, stdout = '', error = null, signal = null} = {}) {
  if(!plan || plan.action !== ACTION || !['win32','linux'].includes(plan.platform)) reject('INVALID_APPROVAL_PLAN');
  if(error?.code === 'ETIMEDOUT' || signal) return {status:'UNCERTAIN_TIMEOUT',approved:false,commandIdentity:plan.commandIdentity};
  if(error || status === 127 || status === null || status === undefined) return {status:'UNAVAILABLE',approved:false,commandIdentity:plan.commandIdentity};
  if(status === 126) return {status:'DENIED_BY_OS',approved:false,commandIdentity:plan.commandIdentity};
  const marker = plan.platform === 'win32' ? APPROVED_MARKER : '0';
  const exact = stdout.trim() === marker;
  if(status === 0 && exact) return {status:'APPROVED_DIAGNOSTIC_ONLY',approved:true,commandIdentity:plan.commandIdentity};
  return {status:'UNVERIFIED_OR_FAILED',approved:false,commandIdentity:plan.commandIdentity};
}

export function runOwnerConsentProbe(options, runner = spawnSync) {
  const plan = planOwnerConsent(options);
  const result = runner(plan.file, [...plan.args], {
    shell:false, encoding:'utf8', timeout:plan.timeoutMs, maxBuffer:2048,
    windowsHide:false, stdio:['ignore','pipe','pipe']
  });
  // Raw stderr intentionally discarded; UAC / sudo authentication text is never an output artifact.
  return classifyNativeResult(plan,{status:result.status,stdout:result.stdout??'',error:result.error,signal:result.signal});
}

if(process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if(process.argv.length === 3 && process.argv[2] === '--readiness') {
    process.stdout.write(JSON.stringify({platform:process.platform,requiresOwnerConsent:true,
      action:ACTION, supported:['win32','linux'].includes(process.platform),privilegedBroker:false})+'\n');
  } else if(process.argv.length === 3 && process.argv[2] === '--owner-present-readonly-probe') {
    // Explicitly opted in; requires a current physical interactive OS session.
    try {
      const output = runOwnerConsentProbe({ownerPresent:true});
      process.stdout.write(JSON.stringify(output)+'\n');
      process.exit(output.approved?0:output.status==='DENIED_BY_OS'?126:2);
    } catch(e) {
      process.stderr.write('NATIVE_OWNER_CONSENT_PROBE_UNAVAILABLE\n');
      process.exit(2);
    }
  } else {
    process.stderr.write('Usage: node tools/owner-native-consent-probe.mjs --readiness | --owner-present-readonly-probe\n');
    process.exit(2);
  }
}
