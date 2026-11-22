// Native Windows owner-constrained Worker key custody. NO_GRANT by construction.
// Reuse existing private account Tunnel and J01 consent; DPAPI CurrentUser
// protects a fresh signing seed, transmitted only by an anonymous stdin pipe.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash,createPrivateKey,createPublicKey,randomBytes,
  sign,verify,X509Certificate} from 'node:crypto';
import {createWindowsNativeOwnerSessionProvider}
  from '../src/native-owner-session-provider-windows.mjs';
import {createWindowsNativeOwnerSidHashResolver,
  createWindowsDpapiWorkerKeyProvider}
  from '../src/native-worker-key-provider-windows.mjs';

const FILE=path.join(path.dirname(fileURLToPath(import.meta.url)),
  'owner-dpapi-worker-key-windows.ps1');
const TUNNEL=path.join(path.dirname(fileURLToPath(import.meta.url)),
  'enroll-owner-private-tunnel-windows.mjs');
const PROFILE=/^[A-Za-z0-9_-]{1,64}$/;
const SHA=/^[a-f0-9]{64}$/;
const PREFIX=Buffer.from('302e020100300506032b657004220420','hex');
const sha=data=>createHash('sha256').update(data).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const regular=(file,maxBytes=4096)=>{
  const s=fs.lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1
    ||s.size<1||s.size>maxBytes)
    fail('RC012_WINDOWS_OWNER_WORKER_FILE_UNTRUSTED');
  return fs.readFileSync(file);
};
function trustRecord(directory,profile,seat){
  const pair=profile==='chatgpt-remote-commander'?'default':profile;
  const root=path.join(directory,'ChatGPTRemoteCommander','private-pair',pair);
  const dir=fs.lstatSync(root);
  if(!dir.isDirectory()||dir.isSymbolicLink())
    fail('RC012_WINDOWS_OWNER_WORKER_PAIR_INVALID');
  const pin=JSON.parse(regular(path.join(root,
    'owner-tunnel-trust.json')).toString('utf8'));
  const cert=new X509Certificate(regular(path.join(root,'client.crt'),65536));
  const leaf=sha(cert.raw);
  if(pin.schema!==1||pin.kind!=='windows-owner-private-one-tunnel'
    ||pin.profileId!==profile||pin.hostId!==os.hostname()
    ||pin.ownerSidHash!==seat.ownerSidHash
    ||pin.expectedClientLeafDerSha256!==leaf
    ||Date.parse(cert.validTo)<=Date.now())
    fail('RC012_WINDOWS_OWNER_WORKER_TUNNEL_PIN_INVALID');
  return Object.freeze({root,hostId:pin.hostId,clientLeafSha256:leaf});
}
function powershell(){
  const candidate=path.join(process.env.ProgramFiles??'C:\\Program Files',
    'PowerShell','7','pwsh.exe');
  const s=fs.lstatSync(candidate);
  if(!s.isFile()||s.isSymbolicLink()
    ||!fs.lstatSync(FILE).isFile()||fs.lstatSync(FILE).isSymbolicLink())
    fail('RC012_WINDOWS_OWNER_WORKER_POWERSHELL_INVALID');
  return candidate;
}
function processProof(profile){
  const r=spawnSync(process.execPath,[TUNNEL,profile,'--preflight'],{
    encoding:'utf8',timeout:16000,maxBuffer:4096,windowsHide:true
  });
  if(r.error||r.status!==0||r.signal)
    fail('RC012_WINDOWS_OWNER_WORKER_TUNNEL_PROCESS_INVALID');
  let obj;
  try{obj=JSON.parse(r.stdout);}catch{
    fail('RC012_WINDOWS_OWNER_WORKER_TUNNEL_PROCESS_INVALID');
  }
  if(obj.result!=='RC012_WINDOWS_TUNNEL_OWNER_PREFLIGHT_PASS'
    ||obj.profile!==profile||obj.ownerSeatVerified!==true
    ||obj.processOwnerVerified!==true||obj.pidSocketBound!==true
    ||obj.controlPlanePollVerified!==true)
    fail('RC012_WINDOWS_OWNER_WORKER_TUNNEL_PROCESS_INVALID');
}
function keyId(seed){
  let der;
  try{
    der=Buffer.concat([PREFIX,seed]);
    const privateKey=createPrivateKey({key:der,format:'der',type:'pkcs8'});
    return sha(createPublicKey(privateKey).export({type:'spki',format:'der'}));
  }finally{der?.fill(0);}
}
function callPs(executable,mode,profile,seat,pin,key,seed){
  const args=['-NoLogo','-NoProfile','-NonInteractive',
    '-File',FILE,'-Mode',mode,
    '-ProfileName',profile,'-OwnerSidHash',seat.ownerSidHash,
    '-KeyId',key,'-ClientLeafSha256',pin.clientLeafSha256,
    '-HostId',pin.hostId];
  const r=spawnSync(executable,args,{
    input:seed??Buffer.alloc(0),encoding:'utf8',
    timeout:18000,maxBuffer:2048,windowsHide:true
  });
  const expected=mode==='Verify'
    ?'RC012_WINDOWS_OWNER_DPAPI_WORKER_VERIFY_PASS'
    :'RC012_WINDOWS_OWNER_DPAPI_WORKER_ENROLL_PASS';
  if(r.error||r.signal||r.status!==0||r.stdout.trim()!==expected
    ||r.stderr.trim()!=='')
    fail('RC012_WINDOWS_OWNER_WORKER_DPAPI_OPERATION_FAILED');
}
async function verifyExisting(profile,seat,pin,pwsh){
  const dir=path.join(pin.root,'worker-identity');
  const blob=path.join(dir,'worker-ed25519-seed.dpapi');
  const receiptFile=path.join(dir,'worker-key-id.json');
  const receipt=JSON.parse(regular(receiptFile).toString('utf8'));
  if(receipt.schema!==1||receipt.profileId!==profile
    ||receipt.ownerSidHash!==seat.ownerSidHash
    ||receipt.hostId!==pin.hostId
    ||receipt.clientLeafDerSha256!==pin.clientLeafSha256
    ||typeof receipt.keyId!=='string'||!SHA.test(receipt.keyId)
    ||typeof receipt.cipherSha256!=='string'||!SHA.test(receipt.cipherSha256))
    fail('RC012_WINDOWS_OWNER_WORKER_RECEIPT_INVALID');
  const cipher=regular(blob);
  const digest=sha(cipher);cipher.fill(0);
  if(digest!==receipt.cipherSha256)
    fail('RC012_WINDOWS_OWNER_WORKER_CIPHER_INVALID');
  callPs(pwsh,'Verify',profile,seat,pin,receipt.keyId,null);
  const native=createWindowsNativeOwnerSessionProvider();
  const provider=createWindowsDpapiWorkerKeyProvider({
    profileId:profile,expectedKeyId:receipt.keyId,credentialPath:blob,
    ownerHashMode:'native-j01-v2',
    resolveOwnerSidHash:native.resolveOwnerSidHash
  });
  const privateKey=await provider.loadPrivateKey();
  const pub=createPublicKey(privateKey);
  const nonce=randomBytes(64);
  let signature;
  try{
    signature=sign(null,nonce,privateKey);
    if(!verifySignature(nonce,pub,signature))
      fail('RC012_WINDOWS_OWNER_WORKER_SIGN_VERIFY_FAILED');
  }finally{nonce.fill(0);signature?.fill(0);}
  return true;
}
const verifySignature=(msg,key,sig)=>verify(null,msg,key,sig)===true;
async function main(){
  if(process.platform!=='win32'||!process.env.APPDATA
    ||!path.isAbsolute(process.env.APPDATA)||process.argv.length!==4
    ||!['--preflight','--enroll'].includes(process.argv[2])
    ||!PROFILE.test(process.argv[3]))
    fail('RC012_WINDOWS_OWNER_WORKER_ARGS_INVALID');
  const mode=process.argv[2],profile=process.argv[3];
  const pwsh=powershell();
  const native=createWindowsNativeOwnerSessionProvider();
  const seat=await native.getOwnerSessionSnapshot();
  const resolver=createWindowsNativeOwnerSidHashResolver({
    ownerHashMode:'native-j01-v2'
  });
  if(await resolver()!==seat.ownerSidHash)
    fail('RC012_WINDOWS_OWNER_WORKER_J01_HASH_MISMATCH');
  const pin=trustRecord(process.env.APPDATA,profile,seat);
  processProof(profile);
  const capsule=path.join(pin.root,'worker-identity');
  // A real existing capsule, even damaged, must never be overwritten.
  if(fs.existsSync(capsule)){
    await verifyExisting(profile,seat,pin,pwsh);
    console.log(JSON.stringify({
      result:'RC012_WINDOWS_OWNER_WORKER_EXISTING_VERIFIED',profile,
      ownerAndTunnelPinned:true,credentialProvisioned:true,
      nativeKeySignVerified:true,workerGrantIssued:false,
      noTunnelOrServiceMutation:true
    }));
    return;
  }
  if(mode==='--preflight'){
    console.log(JSON.stringify({
      result:'RC012_WINDOWS_OWNER_WORKER_PREFLIGHT_PASS',profile,
      ownerAndTunnelPinned:true,credentialProvisioned:false,
      ownerConsentRequested:false,workerGrantIssued:false
    }));
    return;
  }
  const approved=await native.requestConsent({
    title:'Commander 0.12 — Existing private pair Worker key',
    message:[
      'Approve an encrypted Ed25519 signing key for this OS owner?',
      'Host: '+pin.hostId,'Existing account Tunnel profile: '+profile,
      'Windows owner session: '+seat.osSessionId,
      'Client certificate hash (prefix): '+pin.clientLeafSha256.slice(0,12),
      '',
      'This creates a DPAPI CurrentUser key with an owner-only ACL.',
      'It does not register a Worker, grant commands, change any',
      'Tunnel/API key, elevate privileges or enable Full Access.'
    ].join('\n'),
    expectedOwnerSidHash:seat.ownerSidHash,
    expectedOsSessionId:seat.osSessionId
  });
  if(!approved)fail('RC012_WINDOWS_OWNER_WORKER_CONSENT_REQUIRED');
  const next=await native.getOwnerSessionSnapshot();
  if(next.ownerSidHash!==seat.ownerSidHash||next.osSessionId!==seat.osSessionId)
    fail('RC012_WINDOWS_OWNER_WORKER_SEAT_CHANGED');
  const renewed=trustRecord(process.env.APPDATA,profile,next);
  processProof(profile);
  if(renewed.clientLeafSha256!==pin.clientLeafSha256
    ||fs.existsSync(capsule))
    fail('RC012_WINDOWS_OWNER_WORKER_PIN_CHANGED');
  const seed=randomBytes(32);
  try{
    const id=keyId(seed);
    callPs(pwsh,'Enroll',profile,seat,pin,id,seed);
  }finally{seed.fill(0);}
  await verifyExisting(profile,seat,pin,pwsh);
  console.log(JSON.stringify({
    result:'RC012_WINDOWS_OWNER_DPAPI_WORKER_KEY_ENROLLED_PASS',
    profile,ownerAndTunnelRechecked:true,credentialProvisioned:true,
    nativeOwnerConsentApproved:true,nativeKeySignVerified:true,
    workerGrantIssued:false,noTunnelOrServiceMutation:true
  }));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{
    console.error(e?.code?.startsWith?.('RC012_')
      ?e.code:'RC012_WINDOWS_OWNER_WORKER_FAILED');
    process.exitCode=2;
  });
