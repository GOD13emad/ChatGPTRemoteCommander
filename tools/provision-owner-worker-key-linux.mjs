// Owner-local v0.12 reusable worker-key provisioning. One EXISTING account/Tunnel
// and one native owner at a time. No API key, second Tunnel, OS elevation,
// executable grant, installed-Core mutation, or automatic migration.
// The persistent 32-byte Ed25519 seed exists ONLY as an encrypted
// systemd-credentials blob, under a private per-pair directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {
  createHash,createPrivateKey,createPublicKey,randomBytes
} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createLinuxNativeOwnerSessionProvider}
  from '../src/native-owner-session-provider-linux.mjs';
import {createPinnedLinuxPrivateTunnelIdentity}
  from '../src/linux-private-tunnel-owner-pin.mjs';
import {assertTrustedLinuxMappedRootExecutable}
  from '../src/native-linux-host-owner-identity.mjs';

const PROFILE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA=/^[a-f0-9]{64}$/;
const CRED_NAME='worker-ed25519-seed';
const CRYPTO='/usr/bin/systemd-creds';
const FILES=['worker-ed25519-seed.cred','worker-key-id.json'];
const MANIFEST=[
  'schema','hostId','profileId','ownerSidHash','tunnelIdHash',
  'keyId','cipherSha256'
];
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hash=b=>createHash('sha256').update(b).digest('hex');
function privateDir(p,uid){
  const s=fs.lstatSync(p);
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==uid
    ||(s.mode&0o077)!==0||fs.realpathSync.native(p)!==p)
    fail('RC012_WORKER_KEY_DIRECTORY_NOT_PRIVATE');
}
function privateFile(p,uid,max=262144){
  const s=fs.lstatSync(p);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==uid
    ||(s.mode&0o077)!==0||s.size<1||s.size>max)
    fail('RC012_WORKER_KEY_FILE_NOT_PRIVATE');
  return fs.readFileSync(p);
}
export function keyIdForSeed(seed){
  if(!Buffer.isBuffer(seed)||seed.length!==32)
    fail('RC012_WORKER_KEY_SEED_INVALID');
  const der=Buffer.concat([
    Buffer.from('302e020100300506032b657004220420','hex'),seed
  ]);
  try{
    const privateKey=createPrivateKey({key:der,format:'der',type:'pkcs8'});
    return hash(createPublicKey(privateKey).export({type:'spki',format:'der'}));
  }finally{der.fill(0);}
}
function systemdCreds(args,{input=null,stdoutBytes=512}={}){
  assertTrustedLinuxMappedRootExecutable(CRYPTO);
  const result=spawnSync(CRYPTO,args,{
    input,encoding:null,timeout:12000,maxBuffer:Math.max(stdoutBytes,1024),
    stdio:['pipe','pipe','ignore'],windowsHide:true
  });
  if(result.error||result.signal||result.status!==0)
    fail('RC012_WORKER_KEY_SYSTEMD_CREDS_FAILED');
  if((result.stdout?.length??0)>stdoutBytes)
    fail('RC012_WORKER_KEY_CREDENTIAL_OUTPUT_BOUNDS');
  return result.stdout;
}
function decrypt(file){
  const raw=systemdCreds(['decrypt','--user','--refuse-null',
    '--name='+CRED_NAME,file,'-'],{stdoutBytes:64});
  if(!Buffer.isBuffer(raw)||raw.length!==32){
    raw?.fill(0);fail('RC012_WORKER_KEY_DECRYPT_INVALID');
  }
  return raw;
}
export function inspectOwnerWorkerKeyCapsule({
  directory,profile,identity,ownerUid=process.getuid?.(),unseal=decrypt
}={}){
  if(typeof profile!=='string'||!PROFILE.test(profile)
    ||!identity||typeof identity!=='object'
    ||!Number.isSafeInteger(ownerUid)||ownerUid<1
    ||typeof unseal!=='function')
    fail('RC012_WORKER_KEY_CAPSULE_INSPECT_ARGS_INVALID');
  const file=directory,uid=ownerUid;
  privateDir(file,uid);
  const existing=fs.readdirSync(file).sort();
  if(existing.length!==FILES.length
    ||FILES.some(x=>!existing.includes(x)))
    fail('RC012_WORKER_KEY_CAPSULE_UNEXPECTED_FILES');
  const credential=path.join(file,FILES[0]),metaFile=path.join(file,FILES[1]);
  const ciphertext=privateFile(credential,uid),metadata=privateFile(metaFile,uid,4096);
  const content=metadata.toString('utf8');
  let m;
  try{m=JSON.parse(content);}catch{fail('RC012_WORKER_KEY_RECEIPT_INVALID');}
  if(!m||typeof m!=='object'||Array.isArray(m)
    ||Object.keys(m).sort().join(',')!==[...MANIFEST].sort().join(',')
    ||m.schema!==1||m.hostId!==identity.hostId
    ||m.profileId!==profile||m.ownerSidHash!==identity.expectedOwnerSidHash
    ||m.tunnelIdHash!==identity.expectedTunnelIdHash
    ||!SHA.test(m.keyId)||m.cipherSha256!==hash(ciphertext)
    ||content!==JSON.stringify(m)+'\n')
    fail('RC012_WORKER_KEY_RECEIPT_INVALID');
  const seed=unseal(credential);
  try{
    if(!Buffer.isBuffer(seed)||seed.length!==32)
      fail('RC012_WORKER_KEY_DECRYPT_INVALID');
    if(keyIdForSeed(seed)!==m.keyId)
      fail('RC012_WORKER_KEY_IDENTITY_MISMATCH');
  }finally{if(Buffer.isBuffer(seed))seed.fill(0);ciphertext.fill(0);metadata.fill(0);}
  return Object.freeze({profileId:profile,keyId:m.keyId,verified:true});
}
function sameSeat(a,b){
  return ['ownerSidHash','osSessionId','seatId','displayId',
    'sessionType','leaderPid'].every(k=>a?.[k]===b?.[k]);
}
function sameTunnel(a,b){
  return a?.authenticated===true&&b?.authenticated===true
    &&a?.controlPlanePollOk===true&&b?.controlPlanePollOk===true
    &&['profileId','tunnelIdHash','ownerSidHash'].every(k=>a[k]===b[k]);
}
async function main(){
  if(process.platform!=='linux'||typeof process.getuid!=='function'
    ||process.getuid()===0||process.argv.length!==4
    ||!['--preflight','--enroll'].includes(process.argv[2])
    ||!PROFILE.test(process.argv[3])||process.argv[3].includes('..'))
    fail('RC012_WORKER_KEY_OWNER_ARGS_REQUIRED');
  const mode=process.argv[2],profile=process.argv[3],uid=process.getuid();
  const home=os.homedir(),base=path.join(home,'.local','state',
    'chatgpt-remote-commander');
  const security=path.join(base,'private-pair-security-'+profile);
  privateDir(base,uid);privateDir(security,uid);
  const pinnedDirectory=path.join(home,'.config',
    'chatgpt-remote-commander','private-pair',
    profile==='chatgpt-remote-commander'?'default':profile);
  const native=createLinuxNativeOwnerSessionProvider({
    ownerIdentityMode:'host-uid-v2'
  });
  const seat=await native.getOwnerSessionSnapshot();
  const identity=await createPinnedLinuxPrivateTunnelIdentity({
    directory:pinnedDirectory,resolveOwnerSidHash:native.resolveOwnerSidHash
  });
  const first=await identity.resolveTransportIdentity();
  if(!sameTunnel(first,first)
    ||first.ownerSidHash!==seat.ownerSidHash
    ||identity.profileId!==profile)
    fail('RC012_WORKER_KEY_PINNED_TUNNEL_REQUIRED');
  const directory=path.join(security,'worker-identity');
  const existing=fs.existsSync(directory);
  if(existing)inspectOwnerWorkerKeyCapsule({directory,profile,identity,ownerUid:uid});
  if(mode==='--preflight'||existing){
    console.log(JSON.stringify({
      result:existing?'RC012_NATIVE_WORKER_KEY_EXISTING_VERIFIED':
        'RC012_NATIVE_WORKER_KEY_PREFLIGHT_PASS',
      profile,ownerSeatVerified:true,oneTunnelPinned:true,
      credentialProvisioned:existing,ownerConsentRequested:false,
      workerGrantIssued:false,fullAccessActive:false
    }));
    return;
  }
  const secret=randomBytes(32);
  const keyId=keyIdForSeed(secret);
  let stage=null,locked=false,lockFd;
  const lockFile=path.join(security,'.worker-identity-provision.lock');
  try{
    const message=[
      'Approve one local encrypted Commander Ed25519 Worker signing key?',
      'Existing host: '+identity.hostId,
      'Existing ChatGPT account Tunnel profile: '+profile,
      'Current native owner session: '+seat.osSessionId,
      'Pinned Tunnel hash (prefix): '+identity.expectedTunnelIdHash.slice(0,12),
      'New signing key ID (prefix): '+keyId.slice(0,12),
      '',
      'The encrypted key is saved only for this OS owner and existing profile.',
      'This does NOT register a Worker, grant tool execution, change the',
      'existing Tunnel, enable Full Access, or elevate OS privileges.',
      'Deny unless this local key provisioning was requested.'
    ].join('\n');
    const approved=await native.requestConsent({
      title:'Commander 0.12 — Provision local Worker signing key',
      message,expectedOwnerSidHash:seat.ownerSidHash,
      expectedOsSessionId:seat.osSessionId
    });
    if(!approved)fail('RC012_WORKER_KEY_NATIVE_OWNER_CONSENT_REQUIRED');
    const secondSeat=await native.getOwnerSessionSnapshot();
    const second=await identity.resolveTransportIdentity();
    if(!sameSeat(seat,secondSeat)||!sameTunnel(first,second)
      ||fs.existsSync(directory))
      fail('RC012_WORKER_KEY_OWNER_OR_PROFILE_CHANGED');
    lockFd=fs.openSync(lockFile,fs.constants.O_CREAT|fs.constants.O_EXCL
      |fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
    locked=true;
    fs.writeFileSync(lockFd,'RC012_OWNER_WORKER_KEY_PROVISION\n');
    fs.fsyncSync(lockFd);fs.closeSync(lockFd);lockFd=undefined;
    const name='.worker-key-stage-'+randomBytes(12).toString('hex');
    stage=path.join(security,name);
    fs.mkdirSync(stage,{mode:0o700});
    privateDir(stage,uid);
    const sealed=path.join(stage,FILES[0]);
    systemdCreds(['encrypt','--user','--with-key=host',
      '--name='+CRED_NAME,'-',sealed],{input:secret,stdoutBytes:256});
    fs.chmodSync(sealed,0o600);
    const ciphertext=privateFile(sealed,uid);
    const digest=hash(ciphertext);
    ciphertext.fill(0);
    const result=decrypt(sealed);
    try{
      if(keyIdForSeed(result)!==keyId)
        fail('RC012_WORKER_KEY_ENCRYPTION_READBACK_MISMATCH');
    }finally{result.fill(0);}
    const manifest={schema:1,hostId:identity.hostId,profileId:profile,
      ownerSidHash:identity.expectedOwnerSidHash,
      tunnelIdHash:identity.expectedTunnelIdHash,keyId,
      cipherSha256:digest};
    const manifestFile=path.join(stage,FILES[1]);
    const fd=fs.openSync(manifestFile,fs.constants.O_CREAT|fs.constants.O_EXCL
      |fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
    try{fs.writeFileSync(fd,JSON.stringify(manifest)+'\n');fs.fsyncSync(fd);}
    finally{fs.closeSync(fd);}
    inspectOwnerWorkerKeyCapsule({directory:stage,profile,identity,ownerUid:uid});
    const finalSeat=await native.getOwnerSessionSnapshot();
    const finalTunnel=await identity.resolveTransportIdentity();
    if(!sameSeat(seat,finalSeat)||!sameTunnel(first,finalTunnel)
      ||fs.existsSync(directory))
      fail('RC012_WORKER_KEY_OWNER_OR_PROFILE_CHANGED');
    fs.renameSync(stage,directory);stage=null;
    const parent=fs.openSync(security,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
    try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
    inspectOwnerWorkerKeyCapsule({directory,profile,identity,ownerUid:uid});
    console.log(JSON.stringify({
      result:'RC012_NATIVE_OWNER_ENCRYPTED_WORKER_KEY_STAGED_PASS',
      profile,encryptedCurrentUser:true,ownerConsentRequested:true,
      ownerAndTunnelRechecked:true,workerGrantIssued:false,
      nativeServiceChanged:false,fullAccessActive:false
    }));
  }finally{
    secret.fill(0);
    if(lockFd!==undefined)fs.closeSync(lockFd);
    if(stage&&fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:false});
    if(locked)fs.unlinkSync(lockFile);
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{
    console.error(error?.code??'RC012_NATIVE_WORKER_KEY_STAGE_FAILED');
    process.exitCode=2;
  });
