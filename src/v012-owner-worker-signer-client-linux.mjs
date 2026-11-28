// Fixed-action owner-local client for the encrypted systemd Worker signer.
// No private key is materialized in this Core process. The signed result is
// STILL NOT authority: a separate current-J01 WorkerIdentityAuthority must
// register it after owner-approved exact worker.register grants.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyWorkerRegistration} from './worker-identity-authority.mjs';
import {resolveLinuxNativeOwnerWitnessPaths}
  from './linux-native-owner-witness-paths.mjs';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,62}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function safeOwnerSignerFailureCode(stderr){
 if(typeof stderr!=='string'||Buffer.byteLength(stderr)>16384)
  return 'RC012_OWNER_SIGNER_UNIT_FAILED';
 const lines=stderr.trim().split(/\r?\n/);
 return lines.length===1
  &&/^(?:RC012_NATIVE_SIGNER|RC012_WORKER_SIGNING|NATIVE_WORKER_KEY|WORKER_IDENTITY)[A-Z0-9_]{0,80}$/.test(lines[0])
  ?lines[0]:'RC012_OWNER_SIGNER_UNIT_FAILED';
}

const signer=fileURLToPath(new URL('../tools/v012-native-worker-registration-signer-linux.mjs',import.meta.url));
const node='/usr/lib/chatgpt-remote-commander/runtime/node';
function privateCredential(p,uid){
  const s=fs.lstatSync(p);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==uid
    ||(s.mode&0o077)!==0||s.size<32||s.size>262144)
    fail('RC012_OWNER_SIGNER_CREDENTIAL_NOT_PRIVATE');
}
// Diagnostic categories preserve ALL original hard-deny conditions. Nothing
// about an untrusted file, path, identity or source bytes is logged or accepted.
export function nativeSignerSourceTrustFailure(stat,uid){
  if(!Number.isSafeInteger(uid)||uid<1)return 'RC012_OWNER_SIGNER_SOURCE_OWNER_INVALID';
  if(!stat||typeof stat.isFile!=='function'||typeof stat.isSymbolicLink!=='function'
    ||!stat.isFile())return 'RC012_OWNER_SIGNER_SOURCE_NOT_FILE';
  if(stat.isSymbolicLink())return 'RC012_OWNER_SIGNER_SOURCE_ALIAS';
  if(stat.nlink!==1)return 'RC012_OWNER_SIGNER_SOURCE_LINK_COUNT';
  if(![0,uid].includes(stat.uid))return 'RC012_OWNER_SIGNER_SOURCE_OWNER_CHANGED';
  if((stat.mode&0o022)!==0)return 'RC012_OWNER_SIGNER_SOURCE_WRITABLE';
  if(!Number.isSafeInteger(stat.size)||stat.size<32||stat.size>262144)
    return 'RC012_OWNER_SIGNER_SOURCE_BOUNDS';
  return null;
}
// In unprivileged systemd --user units ProtectSystem=full maps ONLY the
// service UID; a root-owned, packaged /usr/lib file appears as overflow UID
// 65534. Do NOT trust this overflow UID by itself: it can represent ANY
// unmapped identity. Admit only the immutable exact installed package member
// when the namespace map, directory metadata and package digest all agree.
export function packagedSignerRootMappedTrust(p,uid,sourceStat=undefined){
  try{
    const root='/usr/lib/chatgpt-remote-commander/app';
    const member='tools/v012-native-worker-registration-signer-linux.mjs';
    const fixed=path.join(root,member);
    if(process.platform!=='linux'||p!==fixed||!Number.isSafeInteger(uid)||uid<1)
      return false;
    const s=sourceStat??fs.lstatSync(p);
    if(s.uid!==65534)return false;
    const checks={isFile:()=>s.isFile(),isSymbolicLink:()=>s.isSymbolicLink(),
      uid:0,nlink:s.nlink,mode:s.mode,size:s.size};
    if(nativeSignerSourceTrustFailure(checks,uid)!==null)return false;
    const lines=fs.readFileSync('/proc/self/uid_map','utf8').trim().split(/\r?\n/);
    if(lines.length!==1)return false;
    const row=lines[0].trim().split(/\s+/).map(Number);
    if(row.length!==3||row[0]!==uid||row[1]!==uid||row[2]!==1)return false;
    for(const dir of ['/usr','/usr/lib','/usr/lib/chatgpt-remote-commander',
      root,path.join(root,'tools')]){
      const d=fs.lstatSync(dir);
      if(!d.isDirectory()||d.isSymbolicLink()||d.uid!==65534
        ||(d.mode&0o022)!==0||fs.realpathSync.native(dir)!==dir)return false;
    }
    if(fs.realpathSync.native(p)!==p)return false;
    const manifestPath=path.join(root,'source-manifest.json');
    const m=fs.lstatSync(manifestPath);
    if(!m.isFile()||m.isSymbolicLink()||m.nlink!==1||m.uid!==65534
      ||(m.mode&0o022)!==0||m.size<32||m.size>262144
      ||fs.realpathSync.native(manifestPath)!==manifestPath)return false;
    const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    const expected=manifest?.files?.[member];
    if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))
      return false;
    return createHash('sha256').update(fs.readFileSync(p)).digest('hex')===expected;
  }catch{return false;}
}
function trustedSignerSource(p,uid){
  const stat=fs.lstatSync(p);
  const reason=nativeSignerSourceTrustFailure(stat,uid);
  if(reason==='RC012_OWNER_SIGNER_SOURCE_OWNER_CHANGED'
    &&packagedSignerRootMappedTrust(p,uid,stat))return;
  if(reason)fail(reason);
}
function boundedRun(args,input){
  return new Promise((resolve,reject)=>{
    const child=spawn('/usr/bin/systemd-run',args,{
      stdio:['pipe','pipe','pipe'],windowsHide:true
    });
    let stdout='',stderr='',stderrBytes=0,settled=false;
    const finish=(error,result)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);
      if(error)reject(error);else resolve(result);
    };
    const timer=setTimeout(()=>{
      child.kill('SIGKILL');
      finish(Object.assign(new Error('RC012_OWNER_SIGNER_TIMEOUT'),
        {code:'RC012_OWNER_SIGNER_TIMEOUT'}));
    },30000);
    child.once('error',()=>finish(Object.assign(new Error('RC012_OWNER_SIGNER_SPAWN_FAILED'),
      {code:'RC012_OWNER_SIGNER_SPAWN_FAILED'})));
    child.stdout.on('data',chunk=>{
      stdout+=chunk.toString('utf8');
      if(Buffer.byteLength(stdout)>16384){
        child.kill('SIGKILL');
        finish(Object.assign(new Error('RC012_OWNER_SIGNER_OUTPUT_BOUNDS'),
          {code:'RC012_OWNER_SIGNER_OUTPUT_BOUNDS'}));
      }
    });
    child.stderr.on('data',chunk=>{
      stderrBytes+=chunk.length;
      if(stderrBytes>16384)child.kill('SIGKILL');
      else stderr+=chunk.toString('utf8');
    });
    child.once('close',code=>{
      if(code!==0||stderrBytes>16384||!stdout.trim())
        finish(Object.assign(new Error('RC012_OWNER_SIGNER_UNIT_FAILED'),
          {code:stderrBytes>16384?'RC012_OWNER_SIGNER_UNIT_FAILED'
           :safeOwnerSignerFailureCode(stderr)}));
      else finish(null,stdout.trim());
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(input);
  });
}
export function createOwnerNativeSignedWorkerClient({
  home=os.homedir(),profile,witnessSocketPath,witnessPublicKeyPath
}={}){
  const uid=process.getuid?.();
  if(process.platform!=='linux'||!Number.isSafeInteger(uid)||uid<1
    ||typeof home!=='string'||!path.isAbsolute(home)
    ||typeof profile!=='string'||!ID.test(profile)
    ||profile==='.'||profile==='..')
    fail('RC012_OWNER_SIGNER_PROFILE_INVALID');
  const witness=resolveLinuxNativeOwnerWitnessPaths({
    home,profile,uid,socketPath:witnessSocketPath,
    publicKeyPath:witnessPublicKeyPath
  });
  const credential=path.join(home,'.local/state/chatgpt-remote-commander',
    'private-pair-security-'+profile,'worker-identity','worker-ed25519-seed.cred');
  return Object.freeze({
    async sign(intent){
      privateCredential(credential,uid);
      trustedSignerSource(signer,uid);
      const input=JSON.stringify(intent);
      if(!input||Buffer.byteLength(input)>4096)
        fail('RC012_OWNER_SIGNER_INPUT_BOUNDS');
      const unit='rc012-owner-sign-'+randomBytes(8).toString('hex');
      const output=await boundedRun([
        '--user','--quiet','--pipe','--wait','--collect','--unit='+unit,
        '-p','NoNewPrivileges=yes','-p','RuntimeMaxSec=25s',
        '-p','LoadCredentialEncrypted=worker-ed25519-seed:'+credential,
        '-E','RC012_NATIVE_SIGNER_SCOPE=SIGNED_ENVELOPE_NO_GRANT',
        '-E','RC012_OWNER_WITNESS_SOCKET_PATH='+witness.socketPath,
        '-E','RC012_OWNER_WITNESS_PUBLIC_KEY_PATH='+witness.publicKeyPath,
        node,signer,profile
      ],input+'\n');
      let envelope;
      try{envelope=JSON.parse(output);}
      catch{fail('RC012_OWNER_SIGNER_ENVELOPE_INVALID');}
      const verified=verifyWorkerRegistration(envelope,{
        issuer:'commander.local',audience:'remote-commander',
        now:Date.now,maxTtlMs:120000
      });
      const c=verified.claims;
      if(c.hostId!==intent.hostId||c.profileId!==profile
        ||c.principalId!==intent.principalId
        ||c.conversationId!==intent.conversationId
        ||c.bindingId!==intent.bindingId
        ||c.ownerSidHash!==intent.ownerSidHash
        ||c.deviceIdHash!==intent.deviceIdHash
        ||c.tunnelIdHash!==intent.tunnelIdHash
        ||c.capabilityPolicyDigest!==intent.capabilityPolicyDigest
        ||c.grantRevision!==intent.grantRevision
        ||c.expiresAtMs!==intent.expiresAtMs)
        fail('RC012_OWNER_SIGNER_IDENTITY_CHANGED');
      return envelope;
    }
  });
}
