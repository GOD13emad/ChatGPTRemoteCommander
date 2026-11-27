// Fixed-action owner-local client for the encrypted systemd Worker signer.
// No private key is materialized in this Core process. The signed result is
// STILL NOT authority: a separate current-J01 WorkerIdentityAuthority must
// register it after owner-approved exact worker.register grants.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyWorkerRegistration} from './worker-identity-authority.mjs';
import {resolveLinuxNativeOwnerWitnessPaths}
  from './linux-native-owner-witness-paths.mjs';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,62}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const signer=fileURLToPath(new URL('../tools/v012-native-worker-registration-signer-linux.mjs',import.meta.url));
const node='/usr/lib/chatgpt-remote-commander/runtime/node';
function privateCredential(p,uid){
  const s=fs.lstatSync(p);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==uid
    ||(s.mode&0o077)!==0||s.size<32||s.size>262144)
    fail('RC012_OWNER_SIGNER_CREDENTIAL_NOT_PRIVATE');
}
function trustedSignerSource(p,uid){
  // Packaged signed/unsigned binaries normally have read-only public 0644
  // source files owned by root, not 0600 per-owner credentials.
  const s=fs.lstatSync(p);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1
    ||![0,uid].includes(s.uid)||(s.mode&0o022)!==0
    ||s.size<32||s.size>262144)
    fail('RC012_OWNER_SIGNER_SOURCE_UNTRUSTED');
}
function boundedRun(args,input){
  return new Promise((resolve,reject)=>{
    const child=spawn('/usr/bin/systemd-run',args,{
      stdio:['pipe','pipe','pipe'],windowsHide:true
    });
    let stdout='',stderrBytes=0,settled=false;
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
    });
    child.once('close',code=>{
      if(code!==0||stderrBytes>16384||!stdout.trim())
        finish(Object.assign(new Error('RC012_OWNER_SIGNER_UNIT_FAILED'),
          {code:'RC012_OWNER_SIGNER_UNIT_FAILED'}));
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
